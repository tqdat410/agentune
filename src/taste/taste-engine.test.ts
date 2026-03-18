import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import test from 'node:test';
import { HistoryStore } from '../history/history-store.js';
import { TasteEngine } from './taste-engine.js';

function getTempDbPath(): string {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sbotify-taste-'));
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

test('TasteEngine.computeTraits defaults to neutral when history is too small', () => {
  const dbPath = getTempDbPath();
  try {
    const store = new HistoryStore(dbPath);
    seedPlay(store, {
      title: 'Small Sample',
      artist: 'Only Artist',
      duration: 200,
      tags: ['ambient'],
      playedSec: 150,
    });

    const engine = new TasteEngine(store);
    assert.deepEqual(engine.computeTraits(), {
      exploration: 0.5,
      variety: 0.5,
      loyalty: 0.5,
    });
    store.close();
  } finally {
    cleanupDb(dbPath);
  }
});

test('TasteEngine.computeTraits returns bounded values from populated history', () => {
  const dbPath = getTempDbPath();
    try {
      const store = new HistoryStore(dbPath);
      const plays = [
      ['Shared Track A', 'Artist A', ['ambient', 'piano'], 190],
      ['Shared Track A', 'Artist A', ['ambient', 'piano'], 195],
      ['Shared Track B', 'Artist B', ['post-rock', 'ambient'], 185],
      ['Shared Track B', 'Artist B', ['post-rock', 'ambient'], 188],
      ['Track 5', 'Artist C', ['jazz'], 160],
      ['Track 6', 'Artist D', ['jazz', 'night'], 175],
      ['Track 7', 'Artist E', ['electronic'], 120],
      ['Track 8', 'Artist F', ['electronic', 'focus'], 150],
      ['Track 9', 'Artist G', ['classical'], 180],
      ['Track 10', 'Artist H', ['focus', 'instrumental'], 170],
    ] as const;

    for (const [title, artist, tags, playedSec] of plays) {
      seedPlay(store, { title, artist, duration: 200, tags: [...tags], playedSec });
    }

    const engine = new TasteEngine(store);
    const traits = engine.computeTraits();

    assert.ok(traits.exploration > 0.7 && traits.exploration <= 1);
    assert.ok(traits.variety > 0 && traits.variety <= 1);
    assert.ok(traits.loyalty > 0.3 && traits.loyalty < 0.5);
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
    assert.equal(summary.persona.taste, 'Ambient nights, piano, and patient post-rock builds.');
    assert.equal(summary.history.recent.length, 5);
    assert.ok(summary.history.stats.topArtists.length > 0);
    assert.ok(summary.history.stats.topTags.length > 0);
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
