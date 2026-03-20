import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import fs from 'fs';
import os from 'os';
import path from 'path';
import test from 'node:test';
import { HistoryStore } from './history-store.js';

function getTempDbPath(): string {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sbotify-history-redesign-'));
  return path.join(tmpDir, 'history.db');
}

function cleanupDb(dbPath: string): void {
  const dir = path.dirname(dbPath);
  try {
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
    if (fs.existsSync(`${dbPath}-wal`)) fs.unlinkSync(`${dbPath}-wal`);
    if (fs.existsSync(`${dbPath}-shm`)) fs.unlinkSync(`${dbPath}-shm`);
    if (fs.existsSync(dir)) fs.rmdirSync(dir);
  } catch {
    // Ignore cleanup errors in tests.
  }
}

function recordPlay(
  store: HistoryStore,
  track: { title: string; artist: string; duration: number; tags?: string[]; playedSec?: number; skipped?: boolean },
): void {
  const playId = store.recordPlay({
    title: track.title,
    artist: track.artist,
    duration: track.duration,
    thumbnail: 'thumb',
    ytVideoId: `${track.artist}-${track.title}`.replace(/\s+/g, '-').toLowerCase(),
  });
  if (track.tags) {
    store.updateTrackTags(`${track.artist.toLowerCase()}::${track.title.toLowerCase()}`, track.tags);
  }
  store.updatePlay(playId, { played_sec: track.playedSec ?? track.duration, skipped: track.skipped ?? false });
}

test('HistoryStore.getTopArtists counts real plays instead of multiplying track totals', () => {
  const dbPath = getTempDbPath();
  try {
    const store = new HistoryStore(dbPath);
    recordPlay(store, { title: 'Track 1', artist: 'Artist A', duration: 200, playedSec: 180 });
    recordPlay(store, { title: 'Track 2', artist: 'Artist A', duration: 200, playedSec: 190 });
    recordPlay(store, { title: 'Track 3', artist: 'Artist A', duration: 200, playedSec: 170 });
    recordPlay(store, { title: 'Track 4', artist: 'Artist B', duration: 200, playedSec: 120, skipped: true });

    const topArtists = store.getTopArtists(5);
    assert.equal(topArtists[0]?.artist, 'Artist A');
    assert.equal(topArtists[0]?.plays, 3);
    assert.equal(topArtists[1]?.artist, 'Artist B');
    assert.equal(topArtists[1]?.plays, 1);
    assert.ok((topArtists[0]?.avgCompletion ?? 0) > (topArtists[1]?.avgCompletion ?? 0));
    store.close();
  } finally {
    cleanupDb(dbPath);
  }
});

test('HistoryStore exposes detailed recent plays, tag stats, and manual persona state', () => {
  const dbPath = getTempDbPath();
  try {
    const store = new HistoryStore(dbPath);
    recordPlay(store, {
      title: 'Focus Track',
      artist: 'Artist A',
      duration: 200,
      tags: ['ambient', 'focus'],
      playedSec: 150,
      skipped: true,
    });
    recordPlay(store, {
      title: 'Night Track',
      artist: 'Artist B',
      duration: 240,
      tags: ['ambient', 'night'],
      playedSec: 210,
    });
    store.savePersonaTasteText('Warm ambient and slow piano.');
    store.savePersonaTraits({ exploration: 0.8, variety: 0.35, loyalty: 0.6 });

    const recentDetailed = store.getRecentPlaysDetailed(5);
    const topTags = store.getTopTags(5);

    assert.equal(recentDetailed.length, 2);
    assert.deepEqual(recentDetailed[0]?.tags, ['ambient', 'night']);
    assert.equal(recentDetailed[1]?.skipped, true);
    assert.ok(topTags.some((tag) => tag.tag === 'ambient' && tag.frequency >= 2));
    assert.equal(store.getPersonaTasteText(), 'Warm ambient and slow piano.');
    assert.deepEqual(store.getPersonaTraits(), { exploration: 0.8, variety: 0.35, loyalty: 0.6 });
    store.close();
  } finally {
    cleanupDb(dbPath);
  }
});

test('HistoryStore migrates legacy schema to v2 and drops unused columns', () => {
  const dbPath = getTempDbPath();
  try {
    const legacyDb = new Database(dbPath);
    legacyDb.exec(`
      CREATE TABLE tracks (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        artist TEXT NOT NULL,
        duration_sec INTEGER DEFAULT 0,
        thumbnail TEXT DEFAULT '',
        tags_json TEXT DEFAULT '[]',
        similar_json TEXT DEFAULT '[]',
        yt_video_id TEXT DEFAULT '',
        first_played_at INTEGER NOT NULL,
        play_count INTEGER DEFAULT 0
      );
      CREATE TABLE plays (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        track_id TEXT NOT NULL REFERENCES tracks(id),
        started_at INTEGER NOT NULL,
        played_sec INTEGER DEFAULT 0,
        skipped INTEGER DEFAULT 0,
        context_json TEXT DEFAULT '{}',
        lane_id TEXT DEFAULT ''
      );
      CREATE TABLE preferences (
        key TEXT PRIMARY KEY,
        weight REAL DEFAULT 0,
        boredom REAL DEFAULT 0,
        last_seen_at INTEGER DEFAULT 0
      );
      CREATE TABLE session_state (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        lane_json TEXT DEFAULT '{}',
        taste_state_json TEXT DEFAULT '{}',
        agent_persona_json TEXT DEFAULT '{}',
        current_intent_json TEXT DEFAULT '{}',
        persona_taste_text TEXT DEFAULT '',
        persona_traits_json TEXT DEFAULT '{"exploration":0.2,"variety":0.9,"loyalty":0.4}'
      );
      CREATE TABLE provider_cache (
        cache_key TEXT PRIMARY KEY,
        response_json TEXT NOT NULL,
        fetched_at INTEGER NOT NULL
      );
      INSERT INTO tracks (id, title, artist, duration_sec, thumbnail, tags_json, similar_json, yt_video_id, first_played_at, play_count)
      VALUES ('artist::track', 'Track', 'Artist', 200, 'thumb', '["focus"]', '["other"]', 'vid1', 123, 1);
      INSERT INTO plays (track_id, started_at, played_sec, skipped, context_json, lane_id)
      VALUES ('artist::track', 123, 150, 0, '{"source":"legacy"}', 'legacy-lane');
      INSERT INTO session_state (id, lane_json, taste_state_json, agent_persona_json, current_intent_json, persona_taste_text, persona_traits_json)
      VALUES (1, '{}', '{}', '{}', '{}', 'Migrated taste', '{"exploration":0.2,"variety":0.9,"loyalty":0.4}');
      INSERT INTO provider_cache (cache_key, response_json, fetched_at)
      VALUES ('apple:test', '{}', 100);
    `);
    legacyDb.close();

    const store = new HistoryStore(dbPath);
    const db = store.getDatabase();
    const sessionColumns = db.prepare('PRAGMA table_info(session_state)').all() as Array<{ name: string }>;
    const playColumns = db.prepare('PRAGMA table_info(plays)').all() as Array<{ name: string }>;
    const trackColumns = db.prepare('PRAGMA table_info(tracks)').all() as Array<{ name: string }>;
    const preferencesTable = db.prepare(`
      SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'preferences'
    `).get() as { name: string } | undefined;

    assert.equal(db.pragma('user_version', { simple: true }), 2);
    assert.equal(store.getPersonaTasteText(), 'Migrated taste');
    assert.deepEqual(store.getPersonaTraits(), { exploration: 0.2, variety: 0.9, loyalty: 0.4 });
    assert.ok(!sessionColumns.some((column) => column.name === 'lane_json'));
    assert.ok(!playColumns.some((column) => column.name === 'lane_id'));
    assert.ok(!trackColumns.some((column) => column.name === 'similar_json'));
    assert.equal(preferencesTable, undefined);
    assert.equal(store.getRecent(5).length, 1);
    assert.equal(store.getDatabaseStats().counts.providerCache, 1);
    store.close();
  } finally {
    cleanupDb(dbPath);
  }
});
