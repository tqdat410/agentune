// Last.fm API provider with SQLite cache — data source for discovery pipeline
// Endpoints: similar artists, similar tracks, top tags, top tracks by tag
// Cache: 7-day TTL in lastfm_cache table (schema from history-schema.ts)

import type Database from 'better-sqlite3';

const LASTFM_API_URL = 'https://ws.audioscrobbler.com/2.0/';
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const FETCH_TIMEOUT_MS = 5000;
const CACHE_FETCH_LIMIT = 50; // Always fetch large batch; slice at return to avoid cache poisoning

export interface SimilarArtist {
  name: string;
  match: number; // 0-1 similarity score
}

export interface SimilarTrack {
  title: string;
  artist: string;
  match: number; // 0-1 similarity score
}

export interface Tag {
  name: string;
  count: number;
}

export interface TagTrack {
  title: string;
  artist: string;
}

export class LastFmProvider {
  constructor(
    private readonly apiKey: string,
    private readonly db: Database.Database,
  ) {
    // Evict expired cache rows on startup
    this.db.prepare('DELETE FROM lastfm_cache WHERE fetched_at < ?')
      .run(Date.now() - CACHE_TTL_MS);
  }

  async getSimilarArtists(artist: string, limit = 10): Promise<SimilarArtist[]> {
    const normalized = this.normalizeForQuery(artist);
    const cacheKey = this.buildCacheKey('similar_artists', normalized);
    const cached = this.getCached(cacheKey);
    if (cached) return (cached as SimilarArtist[]).slice(0, limit);

    const data = await this.fetchApi({
      method: 'artist.getsimilar',
      artist: normalized,
      limit: String(CACHE_FETCH_LIMIT),
    });
    if (!data) return [];

    const raw = (data as { similarartists?: { artist?: Array<{ name: string; match: string }> } })
      ?.similarartists?.artist ?? [];
    const results: SimilarArtist[] = raw.map((a) => ({
      name: a.name,
      match: parseFloat(a.match) || 0,
    }));

    this.setCache(cacheKey, results);
    return results.slice(0, limit);
  }

  async getSimilarTracks(artist: string, track: string, limit = 10): Promise<SimilarTrack[]> {
    const normArtist = this.normalizeForQuery(artist);
    const normTrack = this.normalizeForQuery(track);
    const cacheKey = this.buildCacheKey('similar_tracks', normArtist, normTrack);
    const cached = this.getCached(cacheKey);
    if (cached) return (cached as SimilarTrack[]).slice(0, limit);

    const data = await this.fetchApi({
      method: 'track.getsimilar',
      artist: normArtist,
      track: normTrack,
      limit: String(CACHE_FETCH_LIMIT),
    });
    if (!data) return [];

    const raw = (data as { similartracks?: { track?: Array<{ name: string; artist: { name: string }; match: string }> } })
      ?.similartracks?.track ?? [];
    const results: SimilarTrack[] = raw.map((t) => ({
      title: t.name,
      artist: t.artist?.name ?? '',
      match: parseFloat(t.match) || 0,
    }));

    this.setCache(cacheKey, results);
    return results.slice(0, limit);
  }

  async getTopTags(artist: string, track?: string): Promise<Tag[]> {
    const normArtist = this.normalizeForQuery(artist);
    const normTrack = track ? this.normalizeForQuery(track) : undefined;
    const cacheKey = normTrack
      ? this.buildCacheKey('tags', normArtist, normTrack)
      : this.buildCacheKey('tags', normArtist);
    const cached = this.getCached(cacheKey);
    if (cached) return cached as Tag[];

    const params: Record<string, string> = normTrack
      ? { method: 'track.gettoptags', artist: normArtist, track: normTrack }
      : { method: 'artist.gettoptags', artist: normArtist };
    const data = await this.fetchApi(params);
    if (!data) return [];

    const raw = (data as { toptags?: { tag?: Array<{ name: string; count: number }> } })
      ?.toptags?.tag ?? [];
    const results: Tag[] = raw.map((t) => ({
      name: t.name,
      count: Number(t.count) || 0,
    }));

    this.setCache(cacheKey, results);
    return results;
  }

  async getTopTracksByTag(tag: string, limit = 10): Promise<TagTrack[]> {
    const normTag = tag.toLowerCase().trim();
    const cacheKey = this.buildCacheKey('tag_tracks', normTag);
    const cached = this.getCached(cacheKey);
    if (cached) return (cached as TagTrack[]).slice(0, limit);

    const data = await this.fetchApi({
      method: 'tag.gettoptracks',
      tag: normTag,
      limit: String(CACHE_FETCH_LIMIT),
    });
    if (!data) return [];

    const raw = (data as { tracks?: { track?: Array<{ name: string; artist: { name: string } }> } })
      ?.tracks?.track ?? [];
    const results: TagTrack[] = raw.map((t) => ({
      title: t.name,
      artist: t.artist?.name ?? '',
    }));

    this.setCache(cacheKey, results);
    return results.slice(0, limit);
  }

  // --- Cache methods (private) ---

  private getCached(key: string): unknown | null {
    const row = this.db.prepare(
      'SELECT response_json, fetched_at FROM lastfm_cache WHERE cache_key = ?',
    ).get(key) as { response_json: string; fetched_at: number } | undefined;
    if (!row) return null;
    if (Date.now() - row.fetched_at > CACHE_TTL_MS) return null;
    try {
      return JSON.parse(row.response_json);
    } catch {
      return null;
    }
  }

  private setCache(key: string, data: unknown): void {
    this.db.prepare(
      'INSERT OR REPLACE INTO lastfm_cache (cache_key, response_json, fetched_at) VALUES (?, ?, ?)',
    ).run(key, JSON.stringify(data), Date.now());
  }

  private buildCacheKey(method: string, ...args: string[]): string {
    return `${method}:${args.map((a) => a.toLowerCase().trim()).join(':')}`;
  }

  // --- HTTP (private) ---

  private async fetchApi(params: Record<string, string>): Promise<unknown> {
    const url = new URL(LASTFM_API_URL);
    url.searchParams.set('api_key', this.apiKey);
    url.searchParams.set('format', 'json');
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, v);
    }

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
      const response = await fetch(url.toString(), { signal: controller.signal });
      clearTimeout(timeout);

      if (!response.ok) {
        console.error(`[sbotify] Last.fm API error: ${response.status} ${response.statusText}`);
        return null;
      }

      const json = await response.json();
      // Last.fm returns { error: N, message: "..." } on bad requests
      if (json && typeof json === 'object' && 'error' in json) {
        console.error(`[sbotify] Last.fm API error: ${(json as { message: string }).message}`);
        return null;
      }
      return json;
    } catch (err) {
      console.error(`[sbotify] Last.fm fetch failed: ${(err as Error).message}`);
      return null;
    }
  }

  // --- Normalization (private) ---

  /** Strip YouTube metadata noise before querying Last.fm */
  private normalizeForQuery(text: string): string {
    return text
      .replace(/\s*\(official\s*(audio|video|music\s*video|lyric\s*video|visualizer)\)/gi, '')
      .replace(/\s*\[official\s*(audio|video|music\s*video|lyric\s*video|visualizer)\]/gi, '')
      .replace(/\s*\((lyrics?|hd|hq|4k|live)\)/gi, '')
      .replace(/\s*\[(lyrics?|hd|hq|4k|live)\]/gi, '')
      .replace(/\s*\(feat\.?\s*[^)]+\)/gi, '')
      .replace(/\s*\(ft\.?\s*[^)]+\)/gi, '')
      .replace(/\s*\[feat\.?\s*[^\]]+\]/gi, '')
      .replace(/\s*\[ft\.?\s*[^\]]+\]/gi, '')
      .replace(/\s+/g, ' ')
      .trim();
  }
}

// -- Singleton --

let lastFmProvider: LastFmProvider | null = null;

export function createLastFmProvider(apiKey: string, db: Database.Database): LastFmProvider {
  if (!lastFmProvider) {
    lastFmProvider = new LastFmProvider(apiKey, db);
  }
  return lastFmProvider;
}

export function getLastFmProvider(): LastFmProvider | null {
  return lastFmProvider;
}
