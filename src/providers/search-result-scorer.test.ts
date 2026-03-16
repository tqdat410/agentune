// Unit tests for search-result-scorer.ts scoring logic

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scoreSearchResults, type ScoredResult } from './search-result-scorer.js';
import type { SearchResult } from './youtube-provider.js';

// Helper to create a SearchResult with defaults
function createResult(overrides: Partial<SearchResult> = {}): SearchResult {
  return {
    id: 'test-id',
    title: 'Test Song',
    artist: 'Test Artist',
    duration: '3:45',
    durationMs: 225000, // 3:45
    thumbnail: 'https://example.com/thumb.jpg',
    url: 'https://youtube.com/watch?v=test',
    ...overrides,
  };
}

test('Exact title match scores highest', () => {
  const results = [
    createResult({ title: 'Shape of You', artist: 'Unknown Channel' }),
    createResult({ title: 'Shape of You Acoustic Cover', artist: 'Unknown Channel' }),
    createResult({ title: 'Another Song', artist: 'Unknown Channel' }),
  ];

  const scored = scoreSearchResults(results, 'Shape of You');
  assert(scored[0].reasons.some(r => r.includes('exact title match')), 'Should mention exact match');
  assert(scored[0].score > scored[1].score, 'Exact match should score higher than variant');
  assert(scored[1].score > scored[2].score, 'Variant should score higher than unrelated');
});

test('Title startswith scores 0.8', () => {
  const results = [
    createResult({ title: 'Shape of You Acoustic Version' }),
  ];

  const scored = scoreSearchResults(results, 'Shape of You');
  // Title starts with query -> 0.8
  assert(scored[0].score >= 0.8, 'Title startswith should score >= 0.8');
  assert(scored[0].reasons.some(r => r.includes('starts with')), 'Should mention starts with');
});

test('Title contains scores 0.6', () => {
  const results = [
    createResult({ title: 'Ed Sheeran - Shape of You (Official)' }),
  ];

  const scored = scoreSearchResults(results, 'Shape of You');
  assert(scored[0].score >= 0.6, 'Title contains should score >= 0.6');
});

test('Artist match bonus adds +0.3', () => {
  const results = [
    createResult({ title: 'Shape of You', artist: 'Ed Sheeran' }),
  ];

  const scored = scoreSearchResults(results, 'Shape of You', 'Ed Sheeran');
  assert(scored[0].score >= 1.3, 'Exact match + artist should be >= 1.3');
  assert(scored[0].reasons.some(r => r.includes('artist match')), 'Should mention artist match');
});

test('Partial artist match still grants bonus', () => {
  const results = [
    createResult({ title: 'Shape of You', artist: 'Ed Sheeran Official' }),
  ];

  const scored = scoreSearchResults(results, 'Shape of You', 'Ed Sheeran');
  assert(scored[0].score >= 1.3, 'Partial artist match should still grant bonus');
});

test('Quality penalty: "live" reduces score when not in query', () => {
  const withoutLive = scoreSearchResults(
    [createResult({ title: 'Shape of You' })],
    'Shape of You',
  );
  const withLive = scoreSearchResults(
    [createResult({ title: 'Shape of You Live' })],
    'Shape of You',
  );

  assert(withLive[0].score < withoutLive[0].score, 'Live version should score lower');
  assert(withLive[0].reasons.some(r => r.includes('live')), 'Should mention live penalty');
});

test('Quality penalty: "remix" reduces score when not in query', () => {
  const withoutRemix = scoreSearchResults(
    [createResult({ title: 'Shape of You' })],
    'Shape of You',
  );
  const withRemix = scoreSearchResults(
    [createResult({ title: 'Shape of You Remix' })],
    'Shape of You',
  );

  assert(withRemix[0].score < withoutRemix[0].score, 'Remix version should score lower');
  assert(withRemix[0].reasons.some(r => r.includes('remix')), 'Should mention remix penalty');
});

test('Quality penalty: "slowed" reduces score', () => {
  const normal = scoreSearchResults(
    [createResult({ title: 'Shape of You' })],
    'Shape of You',
  );
  const slowed = scoreSearchResults(
    [createResult({ title: 'Shape of You Slowed' })],
    'Shape of You',
  );

  assert(slowed[0].score < normal[0].score, 'Slowed version should score lower');
  assert(slowed[0].reasons.some(r => r.includes('slowed')), 'Should mention slowed penalty');
});

test('Quality penalty: "8d" reduces score', () => {
  const normal = scoreSearchResults(
    [createResult({ title: 'Shape of You' })],
    'Shape of You',
  );
  const eightd = scoreSearchResults(
    [createResult({ title: 'Shape of You 8D' })],
    'Shape of You',
  );

  assert(eightd[0].score < normal[0].score, '8D version should score lower');
  assert(eightd[0].reasons.some(r => r.includes('8d')), 'Should mention 8d penalty');
});

test('Quality penalty: "reverb" reduces score', () => {
  const normal = scoreSearchResults(
    [createResult({ title: 'Shape of You' })],
    'Shape of You',
  );
  const reverb = scoreSearchResults(
    [createResult({ title: 'Shape of You Reverb' })],
    'Shape of You',
  );

  assert(reverb[0].score < normal[0].score, 'Reverb version should score lower');
  assert(reverb[0].reasons.some(r => r.includes('reverb')), 'Should mention reverb penalty');
});

test('No penalty for "live" when present in query', () => {
  const scored = scoreSearchResults(
    [createResult({ title: 'Shape of You Live' })],
    'Shape of You Live',
  );

  assert(!scored[0].reasons.some(r => r.includes('live')), 'Should not penalize live when in query');
});

test('No penalty for "remix" when present in query', () => {
  const scored = scoreSearchResults(
    [createResult({ title: 'Shape of You Remix' })],
    'Shape of You Remix',
  );

  assert(!scored[0].reasons.some(r => r.includes('remix')), 'Should not penalize remix when in query');
});

test('No penalty for "remix" when present in artist query', () => {
  const scored = scoreSearchResults(
    [createResult({ title: 'Shape of You Remix' })],
    'Shape of You',
    'remix artist',
  );

  assert(!scored[0].reasons.some(r => r.includes('remix')), 'Should not penalize remix when in full query');
});

test('Duration penalty: >600s reduces score', () => {
  const normal = scoreSearchResults(
    [createResult({ durationMs: 240000 })], // 4 min
    'Shape of You',
  );
  const long = scoreSearchResults(
    [createResult({ durationMs: 700000 })], // 11:40
    'Shape of You',
  );

  assert(long[0].score < normal[0].score, 'Long duration should score lower');
  assert(long[0].reasons.some(r => r.includes('long duration')), 'Should mention long duration penalty');
});

test('Duration bonus: 120-420s grants +0.05', () => {
  const tooShort = scoreSearchResults(
    [createResult({ durationMs: 60000 })], // 1 min
    'Shape of You',
  );
  const ideal = scoreSearchResults(
    [createResult({ durationMs: 240000 })], // 4 min
    'Shape of You',
  );
  const tooLong = scoreSearchResults(
    [createResult({ durationMs: 600000 })], // 10 min
    'Shape of You',
  );

  assert(ideal[0].score > tooShort[0].score, 'Ideal duration should score higher than too short');
  assert(ideal[0].score > tooLong[0].score, 'Ideal duration should score higher than too long');
  assert(ideal[0].reasons.some(r => r.includes('typical song length')), 'Should mention song length bonus');
});

test('Bonus: "official audio" grants +0.15', () => {
  // Test with a query that includes the bonus keywords
  const results = [
    createResult({ title: 'test official audio', artist: 'Unknown Channel', durationMs: 50000 }),
  ];

  const scored = scoreSearchResults(results, 'test');
  assert(scored[0].reasons.some(r => r.includes('official audio')), 'Should mention official audio bonus');
  assert(scored[0].score > 0, 'Should have positive score with official audio bonus');
});

test('Bonus: Topic channel grants +0.1', () => {
  const regular = scoreSearchResults(
    [createResult({ title: 'Shape of You', artist: 'Ed Sheeran' })],
    'Shape of You',
  );
  const topic = scoreSearchResults(
    [createResult({ title: 'Shape of You', artist: 'Topic' })],
    'Shape of You',
  );

  assert(topic[0].score > regular[0].score, 'Topic channel should score higher');
  assert(topic[0].reasons.some(r => r.includes('topic')), 'Should mention topic bonus');
});

test('Bonus: "provided to youtube" grants +0.1', () => {
  const results = [
    createResult({ title: 'test provided to youtube', artist: 'Unknown Channel', durationMs: 50000 }),
  ];

  const scored = scoreSearchResults(results, 'test');
  assert(scored[0].reasons.some(r => r.includes('topic')), 'Should mention topic/auto-generated bonus');
  assert(scored[0].score > 0, 'Should have positive score with provided to youtube bonus');
});

test('Empty results returns empty array', () => {
  const scored = scoreSearchResults([], 'Shape of You');
  assert.deepEqual(scored, [], 'Empty input should return empty array');
});

test('Poor matches score below 0.2', () => {
  const results = [
    createResult({ title: 'Completely Different Song' }),
  ];

  const scored = scoreSearchResults(results, 'Shape of You');
  assert(scored[0].score < 0.2, 'Poor match should score < 0.2');
});

test('Results sorted by score descending', () => {
  const results = [
    createResult({ title: 'Another Song' }),
    createResult({ title: 'Shape of You' }), // exact match
    createResult({ title: 'Shape of You Live' }), // has penalty
  ];

  const scored = scoreSearchResults(results, 'Shape of You');

  assert(scored[0].score >= scored[1].score, 'Should be sorted descending');
  assert(scored[1].score >= scored[2].score, 'Should be sorted descending');
});

test('Multiple penalties stack', () => {
  const normal = scoreSearchResults(
    [createResult({ title: 'Shape of You' })],
    'Shape of You',
  );
  const multiple = scoreSearchResults(
    [createResult({ title: 'Shape of You Live Remix 8D' })],
    'Shape of You',
  );

  assert(multiple[0].score < normal[0].score, 'Multiple penalties should compound');
  assert(
    multiple[0].reasons.filter(r => r.includes('penalty')).length >= 3,
    'Should have multiple penalty reasons',
  );
});

test('Case insensitivity in matching', () => {
  const results = [
    createResult({ title: 'SHAPE OF YOU', artist: 'ED SHEERAN', durationMs: 70000 }), // short duration
  ];

  const scored = scoreSearchResults(results, 'Shape of You', 'Ed Sheeran');
  assert(scored[0].score >= 1.3, 'Case insensitive match should work');
  assert(scored[0].reasons.some(r => r.includes('exact')), 'Should match case-insensitively');
});

test('Punctuation ignored in matching', () => {
  const results = [
    createResult({ title: 'Shape... Of... You!!!', artist: 'Unknown Channel', durationMs: 70000 }),
  ];

  const scored = scoreSearchResults(results, 'Shape of You');
  assert(scored[0].score >= 1.0, 'Punctuation should be ignored for exact match');
  assert(scored[0].reasons.some(r => r.includes('exact')), 'Should match despite punctuation');
});

test('Word overlap scoring for partial matches', () => {
  const results = [
    createResult({ title: 'Shape of You' }),
    createResult({ title: 'Shape of You and More Words' }),
    createResult({ title: 'Song About Shape' }),
  ];

  const scored = scoreSearchResults(results, 'Shape of You');
  assert(scored[0].score >= scored[1].score, 'Exact match should score >= partial match');
  assert(scored[1].score > scored[2].score, 'More words matching should score higher');
});

test('Score capped at reasonable maximum', () => {
  const results = [
    createResult({
      title: 'Shape of You Official Audio',
      artist: 'Topic',
      durationMs: 240000, // ideal duration
    }),
  ];

  const scored = scoreSearchResults(results, 'Shape of You', 'Ed Sheeran');
  // even with all bonuses, should be reasonable
  assert(scored[0].score <= 2.0, 'Score should be reasonable even with all bonuses');
});

test('Scoring without artist parameter', () => {
  const results = [
    createResult({ title: 'Shape of You', artist: 'Unknown Channel', durationMs: 70000 }),
  ];

  const scored = scoreSearchResults(results, 'Shape of You');
  assert(scored[0].score >= 1.0, 'Should score without artist parameter');
  assert(!scored[0].reasons.some(r => r.includes('artist match')), 'Should not have artist bonus without artist param');
});

test('Scoring with empty artist parameter', () => {
  const results = [
    createResult({ title: 'Shape of You', artist: 'Ed Sheeran', durationMs: 70000 }),
  ];

  const scored = scoreSearchResults(results, 'Shape of You', '');
  assert(scored[0].score >= 1.0, 'Empty artist should be treated as no artist');
  assert(!scored[0].reasons.some(r => r.includes('artist match')), 'Should not grant artist bonus for empty string');
});

test('Reason array populated with explanations', () => {
  const results = [
    createResult({
      title: 'Shape of You Official Audio',
      artist: 'Ed Sheeran',
      durationMs: 240000,
    }),
  ];

  const scored = scoreSearchResults(results, 'Shape of You', 'Ed Sheeran');

  assert(scored[0].reasons.length > 0, 'Should have reason explanations');
  assert(scored[0].reasons.some(r => r.includes('title')), 'Should explain title match');
  assert(scored[0].reasons.some(r => r.includes('artist')), 'Should explain artist bonus');
  assert(scored[0].reasons.some(r => r.includes('official')), 'Should explain official bonus');
  assert(scored[0].reasons.some(r => r.includes('song length')), 'Should explain duration bonus');
});

test('Result object included in scored result', () => {
  const original = createResult({ title: 'Test Song' });
  const results = [original];

  const scored = scoreSearchResults(results, 'Test Song');
  assert.deepEqual(scored[0].result, original, 'Should include original result object');
});

test('Score values are rounded to 2 decimals', () => {
  const results = [
    createResult({ title: 'Shape of You Official Audio', artist: 'Ed Sheeran', durationMs: 240000 }),
  ];

  const scored = scoreSearchResults(results, 'Shape of You', 'Ed Sheeran');
  // Score should be rounded to 2 decimals
  const rounded = Math.round(scored[0].score * 100) / 100;
  assert.equal(scored[0].score, rounded, 'Score should be rounded to 2 decimals');
});

test('Whitespace normalized in matching', () => {
  // After whitespace normalization, double-space titles should match exactly like single-space
  const results = [
    createResult({ title: 'Song Name', artist: 'Unknown Channel', durationMs: 225000 }),
    createResult({ title: 'Song  Name', artist: 'Unknown Channel', durationMs: 225000 }), // double space
  ];

  const scoredNormal = scoreSearchResults([results[0]], 'Song Name')[0];
  const scoredExtra = scoreSearchResults([results[1]], 'Song Name')[0];

  // Both should get exact match (1.0) + duration bonus (0.05) = 1.05 after whitespace normalization
  assert.equal(scoredNormal.score, 1.05, 'Normal title should score as exact match + duration bonus');
  assert.equal(scoredExtra.score, 1.05, 'Double space title should also exact match after normalization');
});
