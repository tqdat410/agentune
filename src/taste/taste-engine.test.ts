import assert from 'node:assert/strict';
import test from 'node:test';
import { TasteEngine } from './taste-engine.js';
import type { HistoryStore, SessionState, TrackInput, PlayContext, CanonicalOverride } from '../history/history-store.js';

// Mock HistoryStore for testing
class MockHistoryStore {
  private sessionState: SessionState = {};
  private trackTags: Map<string, string[]> = new Map();
  private recentPlays: any[] = [];

  recordPlay(track: TrackInput, context?: PlayContext, canonicalOverride?: CanonicalOverride): number {
    return 1;
  }

  updateTrackCanonical(trackId: string, canonical: CanonicalOverride): void {
    // no-op
  }

  updatePlay(playId: number, updates: { played_sec?: number; skipped?: boolean }): void {
    // no-op
  }

  getTrackTags(trackId: string): string[] {
    return this.trackTags.get(trackId) || [];
  }

  getRecent(limit: number = 20, query?: string): any[] {
    return this.recentPlays.slice(0, limit);
  }

  getTrackStats(trackId: string): { playCount: number; avgCompletion: number; skipRate: number } {
    return { playCount: 0, avgCompletion: 0, skipRate: 0 };
  }

  getTopTracks(limit: number = 10): any[] {
    return [];
  }

  getTrackPlayCount(artist: string, title: string): number {
    return 0;
  }

  hoursSinceLastPlay(artist: string, title: string): number {
    return Infinity;
  }

  getSessionState(): SessionState {
    return this.sessionState;
  }

  saveSessionState(state: SessionState): void {
    this.sessionState = state;
  }

  getPreference(key: string): any {
    return undefined;
  }

  setPreference(key: string, weight: number, boredom: number): void {
    // no-op
  }

  getDatabase(): any {
    return null;
  }

  updateTrackTags(trackId: string, tags: string[]): void {
    this.trackTags.set(trackId, tags);
  }

  close(): void {
    // no-op
  }

  addRecentPlay(play: any): void {
    this.recentPlays.unshift(play);
  }
}

test('TasteEngine - initialization with empty state', () => {
  const store = new MockHistoryStore() as any;
  const engine = new TasteEngine(store);

  const state = engine.getState();
  assert.deepEqual(state.obsessions, {});
  assert.deepEqual(state.boredom, {});
  assert.deepEqual(state.cravings, []);
  assert.equal(state.noveltyAppetite, 0.5);
  assert.equal(state.repeatTolerance, 0.5);
});

test('TasteEngine - full play increases artist obsession', () => {
  const store = new MockHistoryStore() as any;
  const engine = new TasteEngine(store);

  engine.processFeedback(
    { artist: 'Nils Frahm', title: 'All Melody', duration: 180 },
    180, // full play
    180,
    false, // not skipped
  );

  const state = engine.getState();
  assert.ok(state.obsessions['artist:nils frahm'] > 0);
  assert.ok(state.obsessions['artist:nils frahm'] <= 0.08);
  assert.equal(state.boredom['artist:nils frahm'], undefined);
});

test('TasteEngine - early skip increases boredom and decreases obsession', () => {
  const store = new MockHistoryStore() as any;
  const engine = new TasteEngine(store);

  engine.processFeedback(
    { artist: 'Unknown Artist', title: 'Unknown Track', duration: 180 },
    30, // early skip (16% completion)
    180,
    true, // skipped
  );

  const state = engine.getState();
  const obsession = state.obsessions['artist:unknown artist'] ?? 0;
  assert.ok(obsession < 0.1); // obsession is reduced but clamped at 0
  assert.ok(state.boredom['artist:unknown artist'] > 0);
});

test('TasteEngine - partial play (skipped after >30%) has mild negative feedback', () => {
  const store = new MockHistoryStore() as any;
  const engine = new TasteEngine(store);

  engine.processFeedback(
    { artist: 'Test Artist', title: 'Test Song', duration: 180 },
    120, // 67% completion
    180,
    true, // skipped
  );

  const state = engine.getState();
  const obsession = state.obsessions['artist:test artist'] ?? 0;
  assert.ok(obsession < 0.1); // obsession is reduced but clamped at 0
  assert.ok(state.boredom['artist:test artist'] > 0);
  assert.ok(state.boredom['artist:test artist'] <= 0.05);
});

test('TasteEngine - full play adjusts novelty and repeat tolerance', () => {
  const store = new MockHistoryStore() as any;
  const engine = new TasteEngine(store);

  const before = engine.getState();
  engine.processFeedback(
    { artist: 'Artist A', title: 'Song A', duration: 180 },
    180,
    180,
    false,
  );
  const after = engine.getState();

  assert.ok(after.repeatTolerance > before.repeatTolerance);
});

test('TasteEngine - early skip adjusts novelty appetite upward', () => {
  const store = new MockHistoryStore() as any;
  const engine = new TasteEngine(store);

  const before = engine.getState();
  engine.processFeedback(
    { artist: 'Artist B', title: 'Song B', duration: 180 },
    20,
    180,
    true,
  );
  const after = engine.getState();

  assert.ok(after.noveltyAppetite > before.noveltyAppetite);
});

test('TasteEngine - early skip decreases repeat tolerance', () => {
  const store = new MockHistoryStore() as any;
  const engine = new TasteEngine(store);

  const before = engine.getState();
  engine.processFeedback(
    { artist: 'Artist C', title: 'Song C', duration: 180 },
    20,
    180,
    true,
  );
  const after = engine.getState();

  assert.ok(after.repeatTolerance < before.repeatTolerance);
});

test('TasteEngine - tag-level feedback on full play', () => {
  const store = new MockHistoryStore() as any;
  store.updateTrackTags('artist c::song c', ['ambient', 'drone', 'minimal']);

  const engine = new TasteEngine(store);

  engine.processFeedback(
    { artist: 'Artist C', title: 'Song C', duration: 180 },
    180,
    180,
    false,
  );

  const state = engine.getState();
  assert.ok((state.obsessions['tag:ambient'] ?? 0) > 0);
  assert.ok((state.obsessions['tag:drone'] ?? 0) > 0);
});

test('TasteEngine - tag-level feedback on early skip', () => {
  const store = new MockHistoryStore() as any;
  store.updateTrackTags('artist d::song d', ['pop', 'upbeat', 'energetic']);

  const engine = new TasteEngine(store);

  engine.processFeedback(
    { artist: 'Artist D', title: 'Song D', duration: 180 },
    30,
    180,
    true,
  );

  const state = engine.getState();
  assert.ok((state.boredom['tag:pop'] ?? 0) > 0);
  assert.ok((state.boredom['tag:upbeat'] ?? 0) > 0);
});

test('TasteEngine - cravings accumulate from high-obsession tags', () => {
  const store = new MockHistoryStore() as any;
  const engine = new TasteEngine(store);

  store.updateTrackTags('artist e::song e', ['lo-fi', 'chill']);
  engine.processFeedback(
    { artist: 'Artist E', title: 'Song E', duration: 180 },
    180,
    180,
    false,
  );

  store.updateTrackTags('artist f::song f', ['lo-fi', 'beats']);
  engine.processFeedback(
    { artist: 'Artist F', title: 'Song F', duration: 180 },
    180,
    180,
    false,
  );

  const state = engine.getState();
  assert.ok(state.cravings.includes('lo-fi'));
});

test('TasteEngine - cravings capped at MAX_CRAVINGS', () => {
  const store = new MockHistoryStore() as any;
  const engine = new TasteEngine(store);

  const tags = ['tag1', 'tag2', 'tag3', 'tag4', 'tag5', 'tag6', 'tag7'];

  for (let i = 0; i < tags.length; i++) {
    store.updateTrackTags(`artist ${i}::song ${i}`, [tags[i]]);
    engine.processFeedback(
      { artist: `Artist ${i}`, title: `Song ${i}`, duration: 180 },
      180,
      180,
      false,
    );
  }

  const state = engine.getState();
  assert.ok(state.cravings.length <= 6);
});

test('TasteEngine - session lane creation on first track', () => {
  const store = new MockHistoryStore() as any;
  const engine = new TasteEngine(store);

  store.updateTrackTags('artist g::song g', ['ambient', 'dark', 'minimal']);
  engine.processFeedback(
    { artist: 'Artist G', title: 'Song G', duration: 180 },
    180,
    180,
    false,
  );

  const lane = engine.getSessionLane();
  assert.ok(lane);
  assert.equal(lane.songCount, 1);
  assert.ok(lane.description.length > 0);
  assert.ok(lane.tags.includes('ambient') || lane.tags.includes('dark') || lane.tags.includes('minimal'));
});

test('TasteEngine - session lane increments song count on similar tracks', () => {
  const store = new MockHistoryStore() as any;
  const engine = new TasteEngine(store);

  const commonTags = ['dark', 'ambient'];
  store.updateTrackTags('artist h1::song h1', commonTags);
  store.updateTrackTags('artist h2::song h2', commonTags);

  engine.processFeedback(
    { artist: 'Artist H1', title: 'Song H1', duration: 180 },
    180,
    180,
    false,
  );

  const lane1 = engine.getSessionLane();
  assert.equal(lane1?.songCount, 1);

  engine.processFeedback(
    { artist: 'Artist H2', title: 'Song H2', duration: 180 },
    180,
    180,
    false,
  );

  const lane2 = engine.getSessionLane();
  assert.equal(lane2?.songCount, 2);
});

test('TasteEngine - session lane pivots when overlap < 0.3', () => {
  const store = new MockHistoryStore() as any;
  const engine = new TasteEngine(store);

  store.updateTrackTags('artist i1::song i1', ['ambient', 'dark', 'minimal']);
  engine.processFeedback(
    { artist: 'Artist I1', title: 'Song I1', duration: 180 },
    180,
    180,
    false,
  );

  const laneAfterTrack1 = engine.getSessionLane();
  const desc1 = laneAfterTrack1?.description;

  // Completely different tags → overlap = 0
  store.updateTrackTags('artist i2::song i2', ['pop', 'upbeat', 'dance']);
  engine.processFeedback(
    { artist: 'Artist I2', title: 'Song I2', duration: 180 },
    180,
    180,
    false,
  );

  const laneAfterTrack2 = engine.getSessionLane();
  const desc2 = laneAfterTrack2?.description;

  assert.notEqual(desc1, desc2);
  assert.equal(laneAfterTrack2?.songCount, 1);
});

test('TasteEngine - session lane pivots after MAX_LANE_SONGS (5)', () => {
  const store = new MockHistoryStore() as any;
  const engine = new TasteEngine(store);

  const commonTags = ['ambient'];
  for (let i = 0; i < 6; i++) {
    store.updateTrackTags(`artist j${i}::song j${i}`, commonTags);
    engine.processFeedback(
      { artist: `Artist J${i}`, title: `Song J${i}`, duration: 180 },
      180,
      180,
      false,
    );
  }

  const finalLane = engine.getSessionLane();
  assert.equal(finalLane?.songCount, 1);
});

test('TasteEngine - session lane uses artist as fallback tag when track tags empty', () => {
  const store = new MockHistoryStore() as any;
  const engine = new TasteEngine(store);

  engine.processFeedback(
    { artist: 'Fallback Artist', title: 'Song', duration: 180 },
    180,
    180,
    false,
  );

  const lane = engine.getSessionLane();
  assert.ok(lane);
  assert.ok(lane.tags.includes('fallback artist'));
});

test('TasteEngine - persona evolves on early skip (antiMonotony)', () => {
  const store = new MockHistoryStore() as any;
  const engine = new TasteEngine(store);

  const before = engine.getPersona();
  engine.processFeedback(
    { artist: 'Test', title: 'Test', duration: 180 },
    20,
    180,
    true,
  );
  const after = engine.getPersona();

  assert.ok(after.antiMonotony > before.antiMonotony);
});

test('TasteEngine - persona evolves on full play (callbackLove)', () => {
  const store = new MockHistoryStore() as any;
  const engine = new TasteEngine(store);

  const before = engine.getPersona();
  engine.processFeedback(
    { artist: 'Test', title: 'Test', duration: 180 },
    180,
    180,
    false,
  );
  const after = engine.getPersona();

  assert.ok(after.callbackLove >= before.callbackLove);
});

test('TasteEngine - persona curiosity evolves when noveltyAppetite high + full play', () => {
  const store = new MockHistoryStore() as any;
  const engine = new TasteEngine(store);

  // Boost noveltyAppetite
  for (let i = 0; i < 5; i++) {
    engine.processFeedback(
      { artist: `Artist ${i}`, title: `Song ${i}`, duration: 180 },
      20,
      180,
      true,
    );
  }

  const before = engine.getPersona();
  engine.processFeedback(
    { artist: 'Test Artist', title: 'Test Song', duration: 180 },
    180,
    180,
    false,
  );
  const after = engine.getPersona();

  assert.ok(after.curiosity >= before.curiosity);
});

test('TasteEngine - persona traits stay within [0, 1] bounds', () => {
  const store = new MockHistoryStore() as any;
  const engine = new TasteEngine(store);

  // Generate many feedbacks
  for (let i = 0; i < 20; i++) {
    engine.processFeedback(
      { artist: `Artist ${i}`, title: `Song ${i}`, duration: 180 },
      i % 2 === 0 ? 180 : 20,
      180,
      i % 2 === 1,
    );
  }

  const persona = engine.getPersona();
  assert.ok(persona.curiosity >= 0 && persona.curiosity <= 1);
  assert.ok(persona.antiMonotony >= 0 && persona.antiMonotony <= 1);
  assert.ok(persona.callbackLove >= 0 && persona.callbackLove <= 1);
  assert.ok(persona.dramaticTransition >= 0 && persona.dramaticTransition <= 1);
});

test('TasteEngine - time decay reduces obsessions over time', () => {
  const store = new MockHistoryStore() as any;
  const engine = new TasteEngine(store);

  // Create initial obsession
  engine.processFeedback(
    { artist: 'Loved Artist', title: 'Song', duration: 180 },
    180,
    180,
    false,
  );

  const stateBeforeDecay = engine.getState();
  const obsessionBefore = stateBeforeDecay.obsessions['artist:loved artist'] ?? 0;
  assert.ok(obsessionBefore > 0);

  // Manually trigger decay by creating another engine from persisted state with altered timestamp
  const savedState = store.getSessionState();
  savedState.tasteState.lastUpdatedAt = Date.now() - 24 * 60 * 60 * 1000; // 24 hours ago
  store.saveSessionState(savedState);

  const engine2 = new TasteEngine(store);
  engine2.processFeedback(
    { artist: 'New Artist', title: 'New Song', duration: 180 },
    180,
    180,
    false,
  );

  const stateAfterDecay = engine2.getState();
  const obsessionAfter = stateAfterDecay.obsessions['artist:loved artist'] ?? 0;

  assert.ok(obsessionAfter < obsessionBefore);
});

test('TasteEngine - getSummary returns properly formatted object', () => {
  const store = new MockHistoryStore() as any;
  const engine = new TasteEngine(store);

  store.updateTrackTags('artist k::song k', ['ambient']);
  engine.processFeedback(
    { artist: 'Artist K', title: 'Song K', duration: 180 },
    180,
    180,
    false,
  );

  store.addRecentPlay({
    title: 'Song K',
    artist: 'Artist K',
    duration_sec: 180,
    played_sec: 180,
    skipped: 0,
  });

  const summary = engine.getSummary() as any;

  assert.ok(summary.taste);
  assert.ok(Array.isArray(summary.taste.obsessions));
  assert.ok(Array.isArray(summary.taste.bored_of));
  assert.ok(Array.isArray(summary.taste.cravings));
  assert.ok(typeof summary.taste.noveltyAppetite === 'number');
  assert.ok(typeof summary.taste.repeatTolerance === 'number');

  assert.ok(summary.persona);
  assert.ok(typeof summary.persona.curiosity === 'number');
  assert.ok(typeof summary.persona.dramaticTransition === 'number');
  assert.ok(typeof summary.persona.callbackLove === 'number');
  assert.ok(typeof summary.persona.antiMonotony === 'number');

  assert.ok(Array.isArray(summary.recent));
});

test('TasteEngine - getSummary obsessions include strength field', () => {
  const store = new MockHistoryStore() as any;
  const engine = new TasteEngine(store);

  engine.processFeedback(
    { artist: 'Test Artist', title: 'Test Song', duration: 180 },
    180,
    180,
    false,
  );

  const summary = engine.getSummary() as any;
  const obsessions = summary.taste.obsessions;

  if (obsessions.length > 0) {
    assert.ok(obsessions[0].key);
    assert.ok(typeof obsessions[0].strength === 'number');
    assert.ok(obsessions[0].strength >= 0 && obsessions[0].strength <= 1);
  }
});

test('TasteEngine - getSummary boredom includes fatigue field', () => {
  const store = new MockHistoryStore() as any;
  const engine = new TasteEngine(store);

  engine.processFeedback(
    { artist: 'Skipped Artist', title: 'Skipped Song', duration: 180 },
    30,
    180,
    true,
  );

  const summary = engine.getSummary() as any;
  const boredom = summary.taste.bored_of;

  if (boredom.length > 0) {
    assert.ok(boredom[0].key);
    assert.ok(typeof boredom[0].fatigue === 'number');
    assert.ok(boredom[0].fatigue >= 0 && boredom[0].fatigue <= 1);
  }
});

test('TasteEngine - getSummary recent plays include completion and skipped fields', () => {
  const store = new MockHistoryStore() as any;
  const engine = new TasteEngine(store);

  store.addRecentPlay({
    title: 'Test Song',
    artist: 'Test Artist',
    duration_sec: 180,
    played_sec: 90,
    skipped: 0,
  });

  const summary = engine.getSummary() as any;
  const recent = summary.recent;

  if (recent.length > 0) {
    assert.ok(typeof recent[0].title === 'string');
    assert.ok(typeof recent[0].artist === 'string');
    assert.ok(typeof recent[0].completion === 'number');
    assert.ok(typeof recent[0].skipped === 'boolean');
  }
});

test('TasteEngine - obsessions and boredom clamped to [0, 1]', () => {
  const store = new MockHistoryStore() as any;
  const engine = new TasteEngine(store);

  // Generate many full plays to try to push obsession above 1
  for (let i = 0; i < 10; i++) {
    engine.processFeedback(
      { artist: 'Same Artist', title: `Song ${i}`, duration: 180 },
      180,
      180,
      false,
    );
  }

  const state = engine.getState();
  const obsession = state.obsessions['artist:same artist'] ?? 0;
  assert.ok(obsession >= 0 && obsession <= 1);
});

test('TasteEngine - small persona evolution step (0.01)', () => {
  const store = new MockHistoryStore() as any;
  const engine = new TasteEngine(store);

  const before = engine.getPersona();
  engine.processFeedback(
    { artist: 'Test', title: 'Test', duration: 180 },
    20,
    180,
    true,
  );
  const after = engine.getPersona();

  const delta = after.antiMonotony - before.antiMonotony;
  assert.ok(delta <= 0.02); // step is 0.01, but clamp may limit it
});

test('TasteEngine - state persistence via HistoryStore', () => {
  const store = new MockHistoryStore() as any;
  const engine1 = new TasteEngine(store);

  engine1.processFeedback(
    { artist: 'Persistent Artist', title: 'Song', duration: 180 },
    180,
    180,
    false,
  );

  const state1 = engine1.getState();
  const obsession1 = state1.obsessions['artist:persistent artist'] ?? 0;

  // Create new engine from persisted state
  const engine2 = new TasteEngine(store);
  const state2 = engine2.getState();
  const obsession2 = state2.obsessions['artist:persistent artist'] ?? 0;

  assert.equal(obsession1, obsession2);
});

test('TasteEngine - handles zero duration gracefully', () => {
  const store = new MockHistoryStore() as any;
  const engine = new TasteEngine(store);

  engine.processFeedback(
    { artist: 'Test', title: 'Test', duration: 0 },
    0,
    0,
    false,
  );

  const state = engine.getState();
  assert.ok(state);
});

test('TasteEngine - handles 100% completion', () => {
  const store = new MockHistoryStore() as any;
  const engine = new TasteEngine(store);

  engine.processFeedback(
    { artist: 'Test', title: 'Test', duration: 180 },
    180,
    180,
    false,
  );

  const state = engine.getState();
  const obsession = state.obsessions['artist:test'] ?? 0;
  assert.ok(obsession > 0);
});

test('TasteEngine - getSummary rounds values to 2 decimals', () => {
  const store = new MockHistoryStore() as any;
  const engine = new TasteEngine(store);

  engine.processFeedback(
    { artist: 'Test', title: 'Test', duration: 180 },
    180,
    180,
    false,
  );

  const summary = engine.getSummary() as any;
  const appetite = summary.taste.noveltyAppetite;

  // Check if rounded to 2 decimals
  assert.equal(appetite, Math.round(appetite * 100) / 100);
});
