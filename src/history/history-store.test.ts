import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import test from 'node:test';
import { normalizeTrackId } from './history-schema.js';
import { HistoryStore } from './history-store.js';

function getTempDbPath(): string {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentune-history-store-'));
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

function createTrack(overrides?: Partial<Parameters<HistoryStore['recordPlay']>[0]>) {
  return {
    title: 'Nylon',
    artist: 'Nils Frahm',
    duration: 215,
    thumbnail: 'https://example.com/thumb.jpg',
    ytVideoId: 'dummyid123',
    ...overrides,
  };
}

test('normalizeTrackId formats deterministic ids', () => {
  assert.equal(normalizeTrackId('Nils  Frahm', 'Says'), 'nils frahm::says');
  assert.equal(normalizeTrackId('  The Beatles  ', '  HELP!  '), 'the beatles::help!');
  assert.equal(normalizeTrackId('', ''), '::');
});

test('HistoryStore records plays and returns recent rows', () => {
  const dbPath = getTempDbPath();
  try {
    const store = new HistoryStore(dbPath);
    const playId = store.recordPlay(createTrack(), { source: 'mcp' });

    assert.equal(typeof playId, 'number');
    const recent = store.getRecent(1);
    assert.equal(recent.length, 1);
    assert.equal(recent[0]?.id, 'nils frahm::nylon');
    assert.equal(recent[0]?.title, 'Nylon');
    assert.equal(recent[0]?.artist, 'Nils Frahm');
    assert.equal(recent[0]?.play_count, 1);
    store.close();
  } finally {
    cleanupDb(dbPath);
  }
});

test('HistoryStore increments play_count and honors canonical overrides', () => {
  const dbPath = getTempDbPath();
  try {
    const store = new HistoryStore(dbPath);
    store.recordPlay(createTrack({ title: 'says', artist: 'nils frahm' }), undefined, {
      artist: 'Nils Frahm',
      title: 'Says',
    });
    store.recordPlay(createTrack({ title: 'Says', artist: 'Nils Frahm' }));

    const recent = store.getRecent(2);
    assert.equal(recent[0]?.title, 'Says');
    assert.equal(recent[0]?.artist, 'Nils Frahm');
    assert.equal(recent[0]?.play_count, 2);
    store.close();
  } finally {
    cleanupDb(dbPath);
  }
});

test('HistoryStore updates play metrics and batch stats', () => {
  const dbPath = getTempDbPath();
  try {
    const store = new HistoryStore(dbPath);
    const play1 = store.recordPlay(createTrack({ title: 'Track A', artist: 'Artist A', duration: 300 }));
    const play2 = store.recordPlay(createTrack({ title: 'Track A', artist: 'Artist A', duration: 300 }));
    store.updatePlay(play1, { played_sec: 300, skipped: false });
    store.updatePlay(play2, { played_sec: 90, skipped: true });

    const stats = store.getTrackStats('artist a::track a');
    assert.equal(stats.playCount, 2);
    assert.equal(stats.skipRate, 0.5);
    assert.ok(stats.avgCompletion > 0.6 && stats.avgCompletion < 0.7);

    const batchStats = store.batchGetTrackStats(['artist a::track a', 'missing::track']);
    assert.equal(batchStats.get('artist a::track a')?.playCount, 2);
    assert.equal(batchStats.get('missing::track')?.playCount, 0);
    store.close();
  } finally {
    cleanupDb(dbPath);
  }
});

test('HistoryStore exposes ranking helpers and search', async () => {
  const dbPath = getTempDbPath();
  try {
    const store = new HistoryStore(dbPath);
    store.recordPlay(createTrack({ title: 'Nylon', artist: 'Nils Frahm', ytVideoId: 'vid-1' }));
    await new Promise((resolve) => setTimeout(resolve, 5));
    store.recordPlay(createTrack({ title: 'Unfinished', artist: 'Nils Frahm', ytVideoId: 'vid-2' }));

    const filtered = store.getRecent(10, 'Unfinished');
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0]?.title, 'Unfinished');
    assert.equal(store.getTrackPlayCount('Nils Frahm', 'Unfinished'), 1);
    assert.ok(store.hoursSinceLastPlay('Nils Frahm', 'Unfinished') < 1);
    assert.equal(store.getTopTracks(10)[0]?.play_count, 1);
    store.close();
  } finally {
    cleanupDb(dbPath);
  }
});

test('HistoryStore persists persona taste text', () => {
  const dbPath = getTempDbPath();
  try {
    const store = new HistoryStore(dbPath);
    store.savePersonaTasteText('Warm ambient and slow piano.');

    assert.equal(store.getPersonaTasteText(), 'Warm ambient and slow piano.');
    store.close();
  } finally {
    cleanupDb(dbPath);
  }
});

test('HistoryStore exposes stats and granular cleanup operations', () => {
  const dbPath = getTempDbPath();
  try {
    const store = new HistoryStore(dbPath);
    store.recordPlay(createTrack());
    store.recordPlay(createTrack({ title: 'Second', artist: 'Artist B', ytVideoId: 'vid-2' }));
    store.getDatabase().prepare(`
      INSERT INTO provider_cache (cache_key, response_json, fetched_at)
      VALUES ('apple:test', '{}', 123)
    `).run();

    assert.deepEqual(store.getDatabaseStats().counts, { plays: 2, tracks: 2, providerCache: 1 });

    const cacheCleanup = store.clearProviderCache();
    assert.equal(cacheCleanup.removed.providerCache, 1);
    assert.equal(cacheCleanup.stats.counts.providerCache, 0);
    assert.equal(cacheCleanup.stats.counts.plays, 2);

    const historyCleanup = store.clearHistory();
    assert.deepEqual(historyCleanup.removed, { plays: 2, tracks: 2, providerCache: 0 });
    assert.deepEqual(historyCleanup.stats.counts, { plays: 0, tracks: 0, providerCache: 0 });
    store.close();
  } finally {
    cleanupDb(dbPath);
  }
});

test('HistoryStore database stats include empty insights when no listening history exists', () => {
  const dbPath = getTempDbPath();
  try {
    const store = new HistoryStore(dbPath);
    const stats = store.getDatabaseStats();

    assert.deepEqual(stats, {
      dbPath,
      counts: { plays: 0, tracks: 0, providerCache: 0 },
      insights: {
        plays7d: 0,
        tracks7d: 0,
        skipRate: 0,
        activity7d: stats.insights.activity7d,
        topArtists: [],
        topKeywords: [],
      },
    });
    assert.equal(stats.insights.activity7d.length, 7);
    assert.ok(stats.insights.activity7d.every((bucket) => bucket.plays === 0));

    store.close();
  } finally {
    cleanupDb(dbPath);
  }
});

test('HistoryStore database stats expose dashboard insights from play history', () => {
  const dbPath = getTempDbPath();
  try {
    const store = new HistoryStore(dbPath);
    const now = Date.now();
    const twoDaysAgo = now - (2 * 24 * 60 * 60 * 1000);
    const yesterday = now - (24 * 60 * 60 * 1000);

    const ambientPlay = store.recordPlay(createTrack({ title: 'Says', artist: 'Nils Frahm', duration: 200, ytVideoId: 'vid-a' }));
    const secondAmbientPlay = store.recordPlay(createTrack({ title: 'Says', artist: 'Nils Frahm', duration: 200, ytVideoId: 'vid-a-2' }));
    const electronicPlay = store.recordPlay(createTrack({ title: 'A New Error', artist: 'Moderat', duration: 240, ytVideoId: 'vid-b' }));

    store.updatePlay(ambientPlay, { played_sec: 200, skipped: false });
    store.updatePlay(secondAmbientPlay, { played_sec: 100, skipped: true });
    store.updatePlay(electronicPlay, { played_sec: 180, skipped: false });

    store.getDatabase().prepare('UPDATE plays SET started_at = ? WHERE id = ?').run(twoDaysAgo, ambientPlay);
    store.getDatabase().prepare('UPDATE plays SET started_at = ? WHERE id = ?').run(yesterday, secondAmbientPlay);
    store.getDatabase().prepare('UPDATE plays SET started_at = ? WHERE id = ?').run(now, electronicPlay);
    store.updateTrackTags(normalizeTrackId('Nils Frahm', 'Says'), ['ambient', 'piano']);
    store.updateTrackTags(normalizeTrackId('Moderat', 'A New Error'), ['electronic']);

    const stats = store.getDatabaseStats();

    assert.deepEqual(stats.counts, { plays: 3, tracks: 2, providerCache: 0 });
    assert.equal(stats.insights.plays7d, 3);
    assert.equal(stats.insights.tracks7d, 2);
    assert.equal(stats.insights.activity7d.length, 7);
    assert.equal(stats.insights.activity7d.reduce((sum, bucket) => sum + bucket.plays, 0), 3);
    assert.equal(stats.insights.topArtists.length, 2);
    assert.equal(stats.insights.topArtists[0]?.artist, 'Nils Frahm');
    assert.equal(stats.insights.topArtists[0]?.plays, 2);
    assert.equal(stats.insights.topKeywords.length, 3);
    assert.equal(stats.insights.topKeywords[0]?.keyword, 'ambient');
    assert.equal(stats.insights.topKeywords[0]?.frequency, 2);
    assert.ok(stats.insights.skipRate > 0.32 && stats.insights.skipRate < 0.34);

    store.close();
  } finally {
    cleanupDb(dbPath);
  }
});

test('HistoryStore database stats cap artists to three and expose more tags for the two-row dashboard', () => {
  const dbPath = getTempDbPath();
  try {
    const store = new HistoryStore(dbPath);
    const tracks = [
      { title: 'One', artist: 'Artist A', ytVideoId: 'a', tags: ['ambient'], plays: 4 },
      { title: 'Two', artist: 'Artist B', ytVideoId: 'b', tags: ['piano'], plays: 3 },
      { title: 'Three', artist: 'Artist C', ytVideoId: 'c', tags: ['jazz'], plays: 2 },
      { title: 'Four', artist: 'Artist D', ytVideoId: 'd', tags: ['electronic'], plays: 1 },
    ];

    for (const track of tracks) {
      for (let index = 0; index < track.plays; index += 1) {
        store.recordPlay(createTrack({
          title: track.title,
          artist: track.artist,
          ytVideoId: track.ytVideoId,
        }));
      }
      store.updateTrackTags(normalizeTrackId(track.artist, track.title), track.tags);
    }

    const stats = store.getDatabaseStats();
    assert.equal(stats.insights.plays7d, 10);
    assert.equal(stats.insights.tracks7d, 4);
    assert.equal(stats.insights.topArtists.length, 3);
    assert.equal(stats.insights.topKeywords.length, 4);
    assert.deepEqual(stats.insights.topArtists.map((item) => item.artist), ['Artist A', 'Artist B', 'Artist C']);
    assert.deepEqual(stats.insights.topKeywords.map((item) => item.keyword), ['ambient', 'piano', 'jazz', 'electronic']);

    store.close();
  } finally {
    cleanupDb(dbPath);
  }
});

test('HistoryStore dashboard metrics only include the recent 7-day window', () => {
  const dbPath = getTempDbPath();
  try {
    const store = new HistoryStore(dbPath);
    const now = Date.now();
    const eightDaysAgo = now - (8 * 24 * 60 * 60 * 1000);
    const twoDaysAgo = now - (2 * 24 * 60 * 60 * 1000);
    const yesterday = now - (24 * 60 * 60 * 1000);

    const oldPlay = store.recordPlay(createTrack({ title: 'Old Track', artist: 'Old Artist', ytVideoId: 'old' }));
    const recentAmbient = store.recordPlay(createTrack({ title: 'Recent One', artist: 'Recent Artist', ytVideoId: 'recent-1' }));
    const recentAmbient2 = store.recordPlay(createTrack({ title: 'Recent One', artist: 'Recent Artist', ytVideoId: 'recent-2' }));
    const recentJazz = store.recordPlay(createTrack({ title: 'Recent Two', artist: 'Another Artist', ytVideoId: 'recent-3' }));

    store.getDatabase().prepare('UPDATE plays SET started_at = ? WHERE id = ?').run(eightDaysAgo, oldPlay);
    store.getDatabase().prepare('UPDATE plays SET started_at = ? WHERE id = ?').run(twoDaysAgo, recentAmbient);
    store.getDatabase().prepare('UPDATE plays SET started_at = ? WHERE id = ?').run(yesterday, recentAmbient2);
    store.getDatabase().prepare('UPDATE plays SET started_at = ? WHERE id = ?').run(now, recentJazz);

    store.updateTrackTags(normalizeTrackId('Old Artist', 'Old Track'), ['legacy']);
    store.updateTrackTags(normalizeTrackId('Recent Artist', 'Recent One'), ['ambient']);
    store.updateTrackTags(normalizeTrackId('Another Artist', 'Recent Two'), ['jazz']);

    const stats = store.getDatabaseStats();

    assert.deepEqual(stats.counts, { plays: 4, tracks: 3, providerCache: 0 });
    assert.equal(stats.insights.plays7d, 3);
    assert.equal(stats.insights.tracks7d, 2);
    assert.deepEqual(stats.insights.topArtists.map((item) => item.artist), ['Recent Artist', 'Another Artist']);
    assert.deepEqual(stats.insights.topKeywords.map((item) => item.keyword), ['ambient', 'jazz']);

    store.close();
  } finally {
    cleanupDb(dbPath);
  }
});

test('HistoryStore full reset preserves persona state', () => {
  const dbPath = getTempDbPath();
  try {
    const store = new HistoryStore(dbPath);
    store.recordPlay(createTrack());
    store.savePersonaTasteText('Keep me');
    store.getDatabase().prepare(`
      INSERT INTO provider_cache (cache_key, response_json, fetched_at)
      VALUES ('apple:test', '{}', 123)
    `).run();

    const reset = store.fullReset();
    assert.deepEqual(reset.removed, { plays: 1, tracks: 1, providerCache: 1 });
    assert.equal(store.getPersonaTasteText(), 'Keep me');
    assert.deepEqual(store.getDatabaseStats().counts, { plays: 0, tracks: 0, providerCache: 0 });
    store.close();
  } finally {
    cleanupDb(dbPath);
  }
});

test('HistoryStore throws after close', () => {
  const dbPath = getTempDbPath();
  try {
    const store = new HistoryStore(dbPath);
    store.recordPlay(createTrack());
    store.close();
    assert.throws(() => store.getRecent());
  } finally {
    cleanupDb(dbPath);
  }
});
