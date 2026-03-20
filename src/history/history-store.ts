// SQLite-backed play history store — tracks, plays, session state, and cleanup operations.

import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { getHistoryDbPath } from '../runtime/runtime-data-paths.js';
import type { PersonaTraits } from '../taste/taste-engine.js';
import { normalizeTrackId, DEFAULT_PERSONA_TRAITS_JSON } from './history-schema.js';
import {
  clearHistoryData,
  clearProviderCacheData,
  fullResetData,
  getHistoryDatabaseStats,
  type HistoryCleanupResult,
  type HistoryDatabaseStats,
} from './history-store-maintenance.js';
import { applyHistoryStoreMigrations } from './history-store-migrations.js';

export type { HistoryCleanupResult, HistoryDatabaseStats } from './history-store-maintenance.js';

export interface TrackRecord {
  id: string;
  title: string;
  artist: string;
  duration_sec: number;
  thumbnail: string;
  tags_json: string;
  yt_video_id: string;
  first_played_at: number;
  play_count: number;
}

export interface TrackInput {
  title: string;
  artist: string;
  duration: number;
  thumbnail: string;
  ytVideoId: string;
}

export interface CanonicalOverride {
  artist: string;
  title: string;
}

export interface PlayContext {
  context?: string;
  source?: string;
  [key: string]: unknown;
}

export interface BatchTrackStats {
  trackId: string;
  playCount: number;
  avgCompletion: number;
  skipRate: number;
  hoursSinceLastPlay: number;
}

const DEFAULT_PERSONA_TRAITS: PersonaTraits = JSON.parse(DEFAULT_PERSONA_TRAITS_JSON) as PersonaTraits;

export class HistoryStore {
  private readonly db: Database.Database;

  constructor(private readonly dbPath: string) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    applyHistoryStoreMigrations(this.db);
  }

  recordPlay(track: TrackInput, context?: PlayContext, canonicalOverride?: CanonicalOverride): number {
    const artist = canonicalOverride?.artist ?? track.artist;
    const title = canonicalOverride?.title ?? track.title;
    const trackId = normalizeTrackId(artist, title);
    const now = Date.now();

    this.db.prepare(`
      INSERT INTO tracks (id, title, artist, duration_sec, thumbnail, yt_video_id, first_played_at, play_count)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1)
      ON CONFLICT(id) DO UPDATE SET
        play_count = play_count + 1,
        duration_sec = excluded.duration_sec,
        thumbnail = excluded.thumbnail,
        yt_video_id = CASE WHEN excluded.yt_video_id != '' THEN excluded.yt_video_id ELSE yt_video_id END
    `).run(trackId, title, artist, track.duration, track.thumbnail, track.ytVideoId, now);

    const result = this.db.prepare(`
      INSERT INTO plays (track_id, started_at, context_json)
      VALUES (?, ?, ?)
    `).run(trackId, now, JSON.stringify(context ?? {}));

    return Number(result.lastInsertRowid);
  }

  updateTrackCanonical(trackId: string, canonical: CanonicalOverride): void {
    this.db.prepare(`
      UPDATE tracks SET artist = ?, title = ? WHERE id = ?
    `).run(canonical.artist, canonical.title, trackId);
  }

  updatePlay(playId: number, updates: { played_sec?: number; skipped?: boolean }): void {
    const sets: string[] = [];
    const params: number[] = [];
    if (updates.played_sec !== undefined) {
      sets.push('played_sec = ?');
      params.push(updates.played_sec);
    }
    if (updates.skipped !== undefined) {
      sets.push('skipped = ?');
      params.push(updates.skipped ? 1 : 0);
    }
    if (sets.length === 0) return;
    params.push(playId);
    this.db.prepare(`UPDATE plays SET ${sets.join(', ')} WHERE id = ?`).run(...params);
  }

  getTrackTags(trackId: string): string[] {
    const row = this.db.prepare('SELECT tags_json FROM tracks WHERE id = ?').get(trackId) as
      | { tags_json: string }
      | undefined;
    if (!row) return [];
    try {
      return JSON.parse(row.tags_json);
    } catch {
      return [];
    }
  }

  getRecent(limit = 20, query?: string): Array<TrackRecord & { started_at: number; played_sec: number; skipped: number }> {
    const baseQuery = `
      SELECT t.*, p.started_at, p.played_sec, p.skipped
      FROM plays p
      JOIN tracks t ON t.id = p.track_id
      ${query ? 'WHERE t.title LIKE ? OR t.artist LIKE ?' : ''}
      ORDER BY p.started_at DESC
      LIMIT ?
    `;

    if (query) {
      const pattern = `%${query}%`;
      return this.db.prepare(baseQuery).all(pattern, pattern, limit) as Array<
        TrackRecord & { started_at: number; played_sec: number; skipped: number }
      >;
    }
    return this.db.prepare(baseQuery).all(limit) as Array<
      TrackRecord & { started_at: number; played_sec: number; skipped: number }
    >;
  }

  getTrackStats(trackId: string): { playCount: number; avgCompletion: number; skipRate: number } {
    const track = this.db.prepare('SELECT duration_sec, play_count FROM tracks WHERE id = ?')
      .get(trackId) as { duration_sec: number; play_count: number } | undefined;
    if (!track || track.play_count === 0) {
      return { playCount: 0, avgCompletion: 0, skipRate: 0 };
    }

    const stats = this.db.prepare(`
      SELECT
        COUNT(*) as total,
        AVG(CASE WHEN ? > 0 THEN CAST(played_sec AS REAL) / ? ELSE 0 END) as avg_completion,
        SUM(CASE WHEN skipped = 1 THEN 1 ELSE 0 END) as skip_count
      FROM plays WHERE track_id = ?
    `).get(track.duration_sec, track.duration_sec, trackId) as {
      total: number;
      avg_completion: number;
      skip_count: number;
    };

    return {
      playCount: track.play_count,
      avgCompletion: Math.min(1, stats.avg_completion ?? 0),
      skipRate: stats.total > 0 ? stats.skip_count / stats.total : 0,
    };
  }

  batchGetTrackStats(trackIds: string[]): Map<string, BatchTrackStats> {
    const uniqueTrackIds = [...new Set(trackIds)];
    if (uniqueTrackIds.length === 0) return new Map();

    const placeholders = uniqueTrackIds.map(() => '?').join(', ');
    const trackRows = this.db.prepare(`
      SELECT id, play_count, duration_sec
      FROM tracks
      WHERE id IN (${placeholders})
    `).all(...uniqueTrackIds) as Array<{ id: string; play_count: number; duration_sec: number }>;

    const trackMap = new Map(trackRows.map((row) => [row.id, row]));
    const statsRows = this.db.prepare(`
      SELECT
        p.track_id as trackId,
        COUNT(*) as total,
        AVG(
          CASE WHEN t.duration_sec > 0
            THEN MIN(1.0, CAST(p.played_sec AS REAL) / t.duration_sec)
            ELSE 0
          END
        ) as avgCompletion,
        AVG(CASE WHEN p.skipped = 1 THEN 1.0 ELSE 0 END) as skipRate,
        MAX(p.started_at) as lastPlayedAt
      FROM plays p
      JOIN tracks t ON t.id = p.track_id
      WHERE p.track_id IN (${placeholders})
      GROUP BY p.track_id
    `).all(...uniqueTrackIds) as Array<{
      trackId: string;
      total: number;
      avgCompletion: number | null;
      skipRate: number | null;
      lastPlayedAt: number | null;
    }>;

    const statsMap = new Map(statsRows.map((row) => [row.trackId, row]));
    const now = Date.now();
    const batchStats = new Map<string, BatchTrackStats>();

    for (const trackId of uniqueTrackIds) {
      const track = trackMap.get(trackId);
      const stats = statsMap.get(trackId);
      batchStats.set(trackId, {
        trackId,
        playCount: track?.play_count ?? 0,
        avgCompletion: Math.min(1, stats?.avgCompletion ?? 0),
        skipRate: stats?.skipRate ?? 0,
        hoursSinceLastPlay: stats?.lastPlayedAt
          ? (now - stats.lastPlayedAt) / (1000 * 60 * 60)
          : Infinity,
      });
    }

    return batchStats;
  }

  getTopTracks(limit = 10): TrackRecord[] {
    return this.db.prepare(`
      SELECT * FROM tracks
      WHERE play_count > 0
      ORDER BY play_count DESC
      LIMIT ?
    `).all(limit) as TrackRecord[];
  }

  getTrackPlayCount(artist: string, title: string): number {
    const trackId = normalizeTrackId(artist, title);
    const row = this.db.prepare('SELECT play_count FROM tracks WHERE id = ?')
      .get(trackId) as { play_count: number } | undefined;
    return row?.play_count ?? 0;
  }

  hoursSinceLastPlay(artist: string, title: string): number {
    const trackId = normalizeTrackId(artist, title);
    const row = this.db.prepare(`
      SELECT MAX(started_at) as last_at FROM plays WHERE track_id = ?
    `).get(trackId) as { last_at: number | null } | undefined;
    if (!row?.last_at) return Infinity;
    return (Date.now() - row.last_at) / (1000 * 60 * 60);
  }

  getTopArtists(limit = 10): Array<{ artist: string; plays: number; avgCompletion: number }> {
    return this.db.prepare(`
      SELECT t.artist, COUNT(p.id) as plays,
        AVG(CASE WHEN t.duration_sec > 0
          THEN MIN(1.0, CAST(p.played_sec AS REAL) / t.duration_sec) ELSE 0 END) as avgCompletion
      FROM plays p
      JOIN tracks t ON t.id = p.track_id
      GROUP BY LOWER(t.artist)
      ORDER BY plays DESC
      LIMIT ?
    `).all(limit) as Array<{ artist: string; plays: number; avgCompletion: number }>;
  }

  getTopTags(limit = 10): Array<{ tag: string; frequency: number }> {
    const rows = this.db.prepare(`
      SELECT tags_json, play_count FROM tracks
      WHERE tags_json != '[]' AND play_count > 0
      ORDER BY play_count DESC
      LIMIT 50
    `).all() as Array<{ tags_json: string; play_count: number }>;

    const freq: Record<string, number> = {};
    for (const row of rows) {
      try {
        const tags: string[] = JSON.parse(row.tags_json);
        for (const tag of tags) {
          freq[tag.toLowerCase()] = (freq[tag.toLowerCase()] ?? 0) + row.play_count;
        }
      } catch {
        // Ignore malformed tag payloads.
      }
    }

    return Object.entries(freq)
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([tag, frequency]) => ({ tag, frequency }));
  }

  getRecentPlaysDetailed(limit = 20): Array<{
    title: string;
    artist: string;
    completion: number;
    skipped: boolean;
    playedAt: number;
    tags: string[];
  }> {
    const rows = this.db.prepare(`
      SELECT t.title, t.artist, t.duration_sec, t.tags_json,
        p.played_sec, p.skipped, p.started_at
      FROM plays p
      JOIN tracks t ON t.id = p.track_id
      ORDER BY p.started_at DESC
      LIMIT ?
    `).all(limit) as Array<{
      title: string;
      artist: string;
      duration_sec: number;
      tags_json: string;
      played_sec: number;
      skipped: number;
      started_at: number;
    }>;

    return rows.map((row) => ({
      title: row.title,
      artist: row.artist,
      completion: row.duration_sec > 0 ? Math.min(1, row.played_sec / row.duration_sec) : 0,
      skipped: row.skipped === 1,
      playedAt: row.started_at,
      tags: parseJsonArray(row.tags_json),
    }));
  }

  getPersonaTasteText(): string {
    const row = this.db.prepare('SELECT persona_taste_text FROM session_state WHERE id = 1')
      .get() as { persona_taste_text: string } | undefined;
    return row?.persona_taste_text ?? '';
  }

  savePersonaTasteText(text: string): void {
    this.db.prepare(`
      INSERT INTO session_state (id, persona_taste_text) VALUES (1, ?)
      ON CONFLICT(id) DO UPDATE SET persona_taste_text = excluded.persona_taste_text
    `).run(text);
  }

  getPersonaTraits(): PersonaTraits {
    const row = this.db.prepare('SELECT persona_traits_json FROM session_state WHERE id = 1')
      .get() as { persona_traits_json: string } | undefined;

    if (!row?.persona_traits_json) {
      return { ...DEFAULT_PERSONA_TRAITS };
    }

    try {
      return parsePersonaTraits(row.persona_traits_json);
    } catch {
      console.error('[sbotify] Corrupted persona_traits_json — using neutral defaults.');
      return { ...DEFAULT_PERSONA_TRAITS };
    }
  }

  savePersonaTraits(traits: PersonaTraits): void {
    const normalized = validatePersonaTraits(traits);
    this.db.prepare(`
      INSERT INTO session_state (id, persona_traits_json) VALUES (1, ?)
      ON CONFLICT(id) DO UPDATE SET persona_traits_json = excluded.persona_traits_json
    `).run(JSON.stringify(normalized));
  }

  getDatabaseStats(): HistoryDatabaseStats {
    return getHistoryDatabaseStats(this.db, this.dbPath);
  }

  clearHistory(): HistoryCleanupResult {
    return clearHistoryData(this.db, this.dbPath);
  }

  clearProviderCache(): HistoryCleanupResult {
    return clearProviderCacheData(this.db, this.dbPath);
  }

  fullReset(): HistoryCleanupResult {
    return fullResetData(this.db, this.dbPath);
  }

  getDatabase(): Database.Database {
    return this.db;
  }

  getDatabasePath(): string {
    return this.dbPath;
  }

  updateTrackTags(trackId: string, tags: string[]): void {
    this.db.prepare('UPDATE tracks SET tags_json = ? WHERE id = ?')
      .run(JSON.stringify(tags), trackId);
  }

  close(): void {
    this.db.close();
  }
}

function parseJsonArray(raw: string): string[] {
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function parsePersonaTraits(raw: string): PersonaTraits {
  return validatePersonaTraits(JSON.parse(raw) as unknown);
}

function validatePersonaTraits(raw: unknown): PersonaTraits {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Persona traits must be an object.');
  }

  const traits = raw as Record<string, unknown>;
  return {
    exploration: validateTraitNumber(traits.exploration, 'exploration'),
    variety: validateTraitNumber(traits.variety, 'variety'),
    loyalty: validateTraitNumber(traits.loyalty, 'loyalty'),
  };
}

function validateTraitNumber(value: unknown, field: keyof PersonaTraits): number {
  if (typeof value !== 'number' || Number.isNaN(value) || value < 0 || value > 1) {
    throw new Error(`persona traits.${field} must be a number between 0 and 1.`);
  }
  return value;
}

let historyStore: HistoryStore | null = null;

export function createHistoryStore(): HistoryStore {
  if (!historyStore) {
    const dbPath = getHistoryDbPath();
    historyStore = new HistoryStore(dbPath);
    console.error(`[sbotify] History DB initialized at ${dbPath}`);
  }
  return historyStore;
}

export function getHistoryStore(): HistoryStore | null {
  return historyStore;
}
