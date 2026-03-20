import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import test from 'node:test';
import { normalizeTrackId } from './history-schema.js';
import { HistoryStore } from './history-store.js';

function getTempDbPath(): string {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sbotify-history-store-'));
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

test('HistoryStore persists persona taste and traits and rejects invalid traits', () => {
  const dbPath = getTempDbPath();
  try {
    const store = new HistoryStore(dbPath);
    store.savePersonaTasteText('Warm ambient and slow piano.');
    store.savePersonaTraits({ exploration: 0.8, variety: 0.35, loyalty: 0.6 });

    assert.equal(store.getPersonaTasteText(), 'Warm ambient and slow piano.');
    assert.deepEqual(store.getPersonaTraits(), { exploration: 0.8, variety: 0.35, loyalty: 0.6 });

    assert.throws(() => {
      store.savePersonaTraits({ exploration: -0.1, variety: 0.5, loyalty: 0.5 });
    });
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

test('HistoryStore full reset preserves persona state', () => {
  const dbPath = getTempDbPath();
  try {
    const store = new HistoryStore(dbPath);
    store.recordPlay(createTrack());
    store.savePersonaTasteText('Keep me');
    store.savePersonaTraits({ exploration: 0.4, variety: 0.6, loyalty: 0.3 });
    store.getDatabase().prepare(`
      INSERT INTO provider_cache (cache_key, response_json, fetched_at)
      VALUES ('apple:test', '{}', 123)
    `).run();

    const reset = store.fullReset();
    assert.deepEqual(reset.removed, { plays: 1, tracks: 1, providerCache: 1 });
    assert.equal(store.getPersonaTasteText(), 'Keep me');
    assert.deepEqual(store.getPersonaTraits(), { exploration: 0.4, variety: 0.6, loyalty: 0.3 });
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
