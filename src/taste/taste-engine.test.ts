import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import test from 'node:test';
import { HistoryStore } from '../history/history-store.js';
import { TasteEngine, createTasteEngine } from './taste-engine.js';

function getTempDbPath(): string {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentune-taste-'));
  return path.join(tmpDir, 'taste.db');
}

function cleanupDb(dbPath: string): void {
  const dir = path.dirname(dbPath);
  try {
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
    if (fs.existsSync(dbPath + '-wal')) fs.unlinkSync(dbPath + '-wal');
    if (fs.existsSync(dbPath + '-shm')) fs.unlinkSync(dbPath + '-shm');
    if (fs.existsSync(dir)) fs.rmdirSync(dir);
  } catch {
    // ignore cleanup errors in tests
  }
}

function seedPlay(
  store: HistoryStore,
  track: { title: string; artist: string; duration: number; tags: string[]; playedSec: number; skipped?: boolean },
): void {
  const playId = store.recordPlay({
    title: track.title,
    artist: track.artist,
    duration: track.duration,
    thumbnail: 'thumb',
    ytVideoId: `${track.artist}-${track.title}`.replace(/\s+/g, '-').toLowerCase(),
  });
  store.updateTrackTags(`${track.artist.toLowerCase()}::${track.title.toLowerCase()}`, track.tags);
  store.updatePlay(playId, { played_sec: track.playedSec, skipped: track.skipped ?? false });
}

test('TasteEngine defaults persona taste to an empty string', () => {
  const dbPath = getTempDbPath();
  try {
    const store = new HistoryStore(dbPath);
    const engine = new TasteEngine(store);

    assert.deepEqual(engine.getPersona(), { taste: '' });
    assert.equal(engine.getSummary().persona.Preferences, '');
    store.close();
  } finally {
    cleanupDb(dbPath);
  }
});

test('TasteEngine taste text round-trips and appears in summary', () => {
  const dbPath = getTempDbPath();
  try {
    const store = new HistoryStore(dbPath);
    for (let index = 0; index < 10; index += 1) {
      seedPlay(store, {
        title: `Track ${index}`,
        artist: `Artist ${index}`,
        duration: 240,
        tags: ['ambient', index % 2 === 0 ? 'focus' : 'night'],
        playedSec: 200,
      });
    }

    const engine = new TasteEngine(store);
    engine.saveTasteText('Ambient nights, piano, and patient post-rock builds.');

    assert.equal(engine.getTasteText(), 'Ambient nights, piano, and patient post-rock builds.');
    const summary = engine.getSummary();
    assert.equal(summary.persona.Preferences, 'Ambient nights, piano, and patient post-rock builds.');
    assert.equal(summary.history.recent.length, 5);
    assert.ok(summary.history.stats.topArtists.length > 0);
    assert.ok(summary.history.stats.topKeywords.length > 0);
    store.close();
  } finally {
    cleanupDb(dbPath);
  }
});

test('TasteEngine truncates saved taste text to 1000 characters', () => {
  const dbPath = getTempDbPath();
  try {
    const store = new HistoryStore(dbPath);
    const engine = new TasteEngine(store);
    engine.saveTasteText('x'.repeat(1200));

    assert.equal(engine.getTasteText().length, 1000);
    store.close();
  } finally {
    cleanupDb(dbPath);
  }
});

test('TasteEngine.getTimeContext returns a valid calendar snapshot', () => {
  const dbPath = getTempDbPath();
  try {
    const store = new HistoryStore(dbPath);
    const engine = new TasteEngine(store);
    const context = engine.getTimeContext();

    assert.ok(context.hour >= 0 && context.hour <= 23);
    assert.ok(['morning', 'afternoon', 'evening', 'night'].includes(context.period));
    assert.ok(context.dayOfWeek.length > 0);
    store.close();
  } finally {
    cleanupDb(dbPath);
  }
});

test('createTasteEngine rebinds to a new store instead of keeping a closed singleton', () => {
  const firstDbPath = getTempDbPath();
  const secondDbPath = getTempDbPath();
  try {
    const firstStore = new HistoryStore(firstDbPath);
    const firstEngine = createTasteEngine(firstStore);
    firstStore.close();

    const secondStore = new HistoryStore(secondDbPath);
    secondStore.savePersonaTasteText('Second store taste');

    const secondEngine = createTasteEngine(secondStore);
    assert.notStrictEqual(firstEngine, secondEngine);
    assert.deepEqual(secondEngine.getPersona(), { taste: 'Second store taste' });
    secondStore.close();
  } finally {
    cleanupDb(firstDbPath);
    cleanupDb(secondDbPath);
  }
});
