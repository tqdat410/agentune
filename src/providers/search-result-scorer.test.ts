// Unit tests for search-result-scorer.ts scoring and variant filtering logic

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { scoreSearchResults } from './search-result-scorer.js';
import type { SearchResult } from './youtube-provider.js';

function createResult(overrides: Partial<SearchResult> = {}): SearchResult {
  return {
    id: 'test-id',
    title: 'Test Song',
    artist: 'Test Artist',
    duration: '3:45',
    durationMs: 225000,
    thumbnail: 'https://example.com/thumb.jpg',
    url: 'https://youtube.com/watch?v=test',
    ...overrides,
  };
}

test('Exact title match scores highest among eligible results', () => {
  const results = [
    createResult({ id: 'exact', title: 'Shape of You' }),
    createResult({ id: 'contains', title: 'Ed Sheeran - Shape of You (Official)' }),
    createResult({ id: 'other', title: 'Another Song' }),
  ];

  const scored = scoreSearchResults(results, 'Shape of You');

  assert.equal(scored[0].result.id, 'exact');
  assert(scored[0].reasons.some((reason) => reason.includes('exact title match')));
  assert(scored[0].score > scored[1].score);
  assert(scored[1].score > scored[2].score);
});

test('Title startswith scores higher than a loose contains match', () => {
  const results = [
    createResult({ id: 'startswith', title: 'Shape of You Extended Version' }),
    createResult({ id: 'contains', title: 'Ed Sheeran - Shape of You' }),
  ];

  const scored = scoreSearchResults(results, 'Shape of You');

  assert.equal(scored[0].result.id, 'startswith');
  assert(scored[0].reasons.some((reason) => reason.includes('starts with')));
});

test('Artist match bonus adds +0.3', () => {
  const scored = scoreSearchResults(
    [createResult({ title: 'Shape of You', artist: 'Ed Sheeran' })],
    'Shape of You',
    'Ed Sheeran',
  );

  assert(scored[0].score >= 1.3);
  assert(scored[0].reasons.some((reason) => reason.includes('artist match')));
});

test('Hard-block keywords remove obvious non-original variants', () => {
  const blockedKeywords = ['cover', 'karaoke', 'instrumental', 'tribute', 'acoustic', 'piano', 'remake', 'fanmade'];

  for (const keyword of blockedKeywords) {
    const scored = scoreSearchResults(
      [createResult({ title: `Shape of You ${keyword}` })],
      'Shape of You',
    );
    assert.deepEqual(scored, [], `"${keyword}" result should be removed`);
  }
});

test('Hard-block multi-word phrases remove candidates', () => {
  const scored = scoreSearchResults(
    [
      createResult({ id: 'sped-up', title: 'Shape of You Sped Up' }),
      createResult({ id: 'album', title: 'Shape of You Full Album' }),
    ],
    'Shape of You',
  );

  assert.deepEqual(scored, []);
});

test('Hard-blocking checks channel names, not only titles', () => {
  const scored = scoreSearchResults(
    [createResult({ title: 'Shape of You', artist: 'Best Karaoke Channel' })],
    'Shape of You',
    'Ed Sheeran',
  );

  assert.deepEqual(scored, []);
});

test('Explicit variant queries keep matching variant candidates eligible', () => {
  const cover = scoreSearchResults(
    [createResult({ id: 'cover', title: 'Shape of You Cover', artist: 'Studio Duo' })],
    'Shape of You Cover',
  );
  const live = scoreSearchResults(
    [createResult({ id: 'live', title: 'Shape of You Live', artist: 'Ed Sheeran Live' })],
    'Shape of You Live',
    'Ed Sheeran',
  );

  assert.equal(cover.length, 1);
  assert.equal(cover[0].result.id, 'cover');
  assert(!cover[0].reasons.some((reason) => reason.includes('cover penalty')));
  assert.equal(live.length, 1);
  assert.equal(live[0].result.id, 'live');
  assert(!live[0].reasons.some((reason) => reason.includes('live')));
});

test('Mixed pools keep originals and remove blocked variants before sorting', () => {
  const results = [
    createResult({ id: 'original', title: 'Shape of You', artist: 'Ed Sheeran' }),
    createResult({ id: 'cover', title: 'Shape of You Cover', artist: 'Cover Singer' }),
    createResult({ id: 'karaoke', title: 'Shape of You', artist: 'Karaoke Hits' }),
    createResult({ id: 'contains', title: 'Ed Sheeran - Shape of You', artist: 'Ed Sheeran' }),
  ];

  const scored = scoreSearchResults(results, 'Shape of You', 'Ed Sheeran');

  assert.deepEqual(scored.map((item) => item.result.id), ['original', 'contains']);
});

test('Duration penalty: >600s reduces score', () => {
  const normal = scoreSearchResults([createResult({ durationMs: 240000 })], 'Shape of You');
  const long = scoreSearchResults([createResult({ durationMs: 700000 })], 'Shape of You');

  assert(long[0].score < normal[0].score);
  assert(long[0].reasons.some((reason) => reason.includes('long duration')));
});

test('Duration bonus: 120-420s grants +0.05', () => {
  const tooShort = scoreSearchResults([createResult({ durationMs: 60000 })], 'Shape of You');
  const ideal = scoreSearchResults([createResult({ durationMs: 240000 })], 'Shape of You');
  const tooLong = scoreSearchResults([createResult({ durationMs: 600000 })], 'Shape of You');

  assert(ideal[0].score > tooShort[0].score);
  assert(ideal[0].score > tooLong[0].score);
  assert(ideal[0].reasons.some((reason) => reason.includes('typical song length')));
});

test('Official audio and topic bonuses still apply to eligible results', () => {
  const official = scoreSearchResults(
    [createResult({ title: 'test official audio', artist: 'Unknown Channel', durationMs: 50000 })],
    'test',
  );
  const topic = scoreSearchResults(
    [createResult({ title: 'Shape of You', artist: 'Topic' })],
    'Shape of You',
  );

  assert(official[0].reasons.some((reason) => reason.includes('official audio')));
  assert(topic[0].reasons.some((reason) => reason.includes('topic')));
});

test('Empty results returns empty array', () => {
  assert.deepEqual(scoreSearchResults([], 'Shape of You'), []);
});

test('Poor matches score below 0.2', () => {
  const scored = scoreSearchResults(
    [createResult({ title: 'Completely Different Song' })],
    'Shape of You',
  );

  assert(scored[0].score < 0.2);
});

test('Case, punctuation, and whitespace are normalized in matching', () => {
  const uppercase = scoreSearchResults(
    [createResult({ title: 'SHAPE OF YOU', artist: 'ED SHEERAN', durationMs: 70000 })],
    'Shape of You',
    'Ed Sheeran',
  );
  const punctuated = scoreSearchResults(
    [createResult({ title: 'Shape... Of... You!!!', durationMs: 70000 })],
    'Shape of You',
  );
  const spaced = scoreSearchResults(
    [createResult({ title: 'Song  Name', durationMs: 225000 })],
    'Song Name',
  );

  assert(uppercase[0].score >= 1.3);
  assert(uppercase[0].reasons.some((reason) => reason.includes('exact')));
  assert(punctuated[0].score >= 1.0);
  assert(spaced[0].score === 1.05);
});

test('Word overlap scoring still works for partial matches', () => {
  const results = [
    createResult({ id: 'exact', title: 'Shape of You' }),
    createResult({ id: 'partial', title: 'Shape of You and More Words' }),
    createResult({ id: 'loose', title: 'Song About Shape' }),
  ];

  const scored = scoreSearchResults(results, 'Shape of You');

  assert.equal(scored[0].result.id, 'exact');
  assert.equal(scored[1].result.id, 'partial');
  assert.equal(scored[2].result.id, 'loose');
});

test('Scores stay rounded and keep original result references', () => {
  const original = createResult({
    title: 'Shape of You Official Audio',
    artist: 'Ed Sheeran',
    durationMs: 240000,
  });

  const scored = scoreSearchResults([original], 'Shape of You', 'Ed Sheeran');

  assert.equal(scored[0].result, original);
  assert.equal(scored[0].score, Math.round(scored[0].score * 100) / 100);
  assert(scored[0].score <= 2.0);
});

test('Scoring without artist or with empty artist still works', () => {
  const withoutArtist = scoreSearchResults(
    [createResult({ title: 'Shape of You', artist: 'Unknown Channel', durationMs: 70000 })],
    'Shape of You',
  );
  const emptyArtist = scoreSearchResults(
    [createResult({ title: 'Shape of You', artist: 'Ed Sheeran', durationMs: 70000 })],
    'Shape of You',
    '',
  );

  assert(withoutArtist[0].score >= 1.0);
  assert(!withoutArtist[0].reasons.some((reason) => reason.includes('artist match')));
  assert(emptyArtist[0].score >= 1.0);
  assert(!emptyArtist[0].reasons.some((reason) => reason.includes('artist match')));
});

test('Reason arrays stay populated with scoring explanations', () => {
  const scored = scoreSearchResults(
    [createResult({ title: 'Shape of You Official Audio', artist: 'Ed Sheeran', durationMs: 240000 })],
    'Shape of You',
    'Ed Sheeran',
  );

  assert(scored[0].reasons.length > 0);
  assert(scored[0].reasons.some((reason) => reason.includes('title')));
  assert(scored[0].reasons.some((reason) => reason.includes('artist')));
  assert(scored[0].reasons.some((reason) => reason.includes('official')));
  assert(scored[0].reasons.some((reason) => reason.includes('song length')));
});
