import type { HistoryStore } from '../history/history-store.js';
import type { AppleTrack } from '../providers/apple-search-provider.js';

export interface DiscoverCandidate {
  title: string;
  artist: string;
  tags: string[];
  provider: 'apple';
  appleTrackId?: number;
  appleArtistId?: number;
}

export interface DiscoverBatchParams {
  artist?: string;
  genres?: string[];
}

interface DiscoverAppleProvider {
  getArtistTracks(artist: string, limit?: number): Promise<AppleTrack[]>;
  searchByGenre(genre: string, limit?: number): Promise<AppleTrack[]>;
}

const MAX_APPLE_CALLS = 6;
const ARTIST_RESULT_LIMIT = 15;
const GENRE_RESULT_LIMIT = 10;

export class DiscoverBatchBuilder {
  constructor(
    private readonly apple: DiscoverAppleProvider,
    private readonly historyStore: Pick<HistoryStore, 'getTopArtists' | 'getTopTags'>,
  ) {}

  async buildBatches(params: DiscoverBatchParams): Promise<DiscoverCandidate[]> {
    const normalizedArtist = normalizeSeed(params.artist);
    const normalizedGenres = normalizeSeeds(params.genres ?? []);

    let artistSeeds = normalizedArtist ? [normalizedArtist] : [];
    let genreSeeds = normalizedGenres;

    if (artistSeeds.length === 0 && genreSeeds.length === 0) {
      const defaultSeeds = this.getDefaultSeeds();
      artistSeeds = defaultSeeds.artistSeeds;
      genreSeeds = defaultSeeds.genreSeeds;
    }

    if (artistSeeds.length === 0 && genreSeeds.length === 0) {
      return [];
    }

    const selectedArtistSeeds = artistSeeds.slice(0, MAX_APPLE_CALLS);
    const remainingCalls = MAX_APPLE_CALLS - selectedArtistSeeds.length;
    const selectedGenreSeeds = genreSeeds.slice(0, remainingCalls);

    const artistPromises = selectedArtistSeeds.map((artist) => this.loadArtistCandidates(artist));
    const genrePromises = selectedGenreSeeds.map((genre) => this.loadGenreCandidates(genre));
    const batches = await Promise.all([...artistPromises, ...genrePromises]);

    return batches.flat();
  }

  private getDefaultSeeds(): { artistSeeds: string[]; genreSeeds: string[] } {
    const artistSeeds = normalizeSeeds(this.historyStore.getTopArtists(3).map((artist) => artist.artist));
    const genreSeeds = normalizeSeeds(this.historyStore.getTopTags(3).map((tag) => tag.tag));
    return { artistSeeds, genreSeeds };
  }

  private async loadArtistCandidates(artist: string): Promise<DiscoverCandidate[]> {
    try {
      const tracks = await this.apple.getArtistTracks(artist, ARTIST_RESULT_LIMIT);
      return tracks.map((track) => mapArtistTrack(track));
    } catch (err) {
      console.error(`[sbotify] Discover artist batch failed for "${artist}": ${(err as Error).message}`);
      return [];
    }
  }

  private async loadGenreCandidates(genre: string): Promise<DiscoverCandidate[]> {
    try {
      const tracks = await this.apple.searchByGenre(genre, GENRE_RESULT_LIMIT);
      return tracks.map((track) => mapGenreTrack(track, genre));
    } catch (err) {
      console.error(`[sbotify] Discover genre batch failed for "${genre}": ${(err as Error).message}`);
      return [];
    }
  }
}

function mapArtistTrack(track: AppleTrack): DiscoverCandidate {
  return {
    title: track.title,
    artist: track.artist,
    tags: collectTags(track.genre),
    provider: 'apple',
    appleTrackId: track.trackId,
    appleArtistId: track.artistId,
  };
}

function mapGenreTrack(track: AppleTrack, genre: string): DiscoverCandidate {
  return {
    title: track.title,
    artist: track.artist,
    tags: collectTags(genre, track.genre),
    provider: 'apple',
    appleTrackId: track.trackId,
    appleArtistId: track.artistId,
  };
}

function collectTags(...values: Array<string | undefined>): string[] {
  const seen = new Set<string>();
  const tags: string[] = [];

  for (const value of values) {
    const normalized = normalizeSeed(value);
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    tags.push(normalized);
  }

  return tags.length > 0 ? tags : ['unknown'];
}

function normalizeSeeds(values: string[]): string[] {
  const seen = new Set<string>();
  const normalizedValues: string[] = [];

  for (const value of values) {
    const normalized = normalizeSeed(value);
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    normalizedValues.push(normalized);
  }

  return normalizedValues;
}

function normalizeSeed(value?: string): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}
