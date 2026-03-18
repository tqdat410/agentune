import assert from 'node:assert/strict';
import test from 'node:test';
import type { HistoryStore } from '../history/history-store.js';
import { CandidateGenerator } from './candidate-generator.js';

class FakeAppleSearchProvider {
  public genreCalls: string[] = [];

  async getArtistTracks(artist: string): Promise<Array<{ title: string; artist: string }>> {
    if (artist === 'Current Artist') {
      return [
        { title: 'Current Song', artist: 'Current Artist' },
        { title: 'Sibling Song', artist: 'Current Artist' },
      ];
    }

    if (artist === 'Wildcard Artist') {
      return [{ title: 'Wildcard Pick', artist: 'Wildcard Artist' }];
    }

    return [];
  }

  async searchByGenre(tag: string): Promise<Array<{ title: string; artist: string }>> {
    this.genreCalls.push(tag);
    return [{ title: `${tag} Mood`, artist: `${tag} Artist` }];
  }

  async searchTracks(query: string): Promise<Array<{ title: string; artist: string }>> {
    return [{ title: `${query} Fallback`, artist: 'Fallback Artist' }];
  }
}

class FakeSmartSearchProvider {
  async getRelatedTracks(): Promise<Array<{ title: string; artist: string }>> {
    return [{ title: 'Related Track', artist: 'Related Artist' }];
  }

  async searchByMood(tag: string): Promise<Array<{ title: string; artist: string }>> {
    return [{ title: `${tag} Search`, artist: 'Mood Artist' }];
  }

  async getArtistSuggestions(): Promise<string[]> {
    return ['Wildcard Artist'];
  }
}

function createHistoryStoreStub(): HistoryStore {
  return {
    getTopTracks: () => [
      {
        id: 'comfort-track',
        title: 'Comfort Track',
        artist: 'Comfort Artist',
        duration_sec: 180,
        thumbnail: 'thumb',
        tags_json: '["ambient"]',
        similar_json: '[]',
        yt_video_id: 'comfort',
        first_played_at: 0,
        play_count: 4,
      },
    ],
    getRecent: () => [
      {
        id: 'recent-track',
        title: 'Recent Track',
        artist: 'Recent Artist',
        duration_sec: 180,
        thumbnail: 'thumb',
        tags_json: '["ambient","focus"]',
        similar_json: '[]',
        yt_video_id: 'recent',
        first_played_at: 0,
        play_count: 1,
        started_at: Date.now(),
        played_sec: 160,
        skipped: 0,
      },
    ],
  } as unknown as HistoryStore;
}

test('CandidateGenerator.generate returns grouped lane results', async () => {
  const generator = new CandidateGenerator(
    new FakeSmartSearchProvider() as never,
    new FakeAppleSearchProvider() as never,
    createHistoryStoreStub(),
  );

  const grouped = await generator.generate(
    { title: 'Current Song', artist: 'Current Artist', duration: 180 },
    undefined,
    'balanced',
  );

  assert.ok(Array.isArray(grouped.continuation));
  assert.ok(Array.isArray(grouped.comfort));
  assert.ok(Array.isArray(grouped.contextFit));
  assert.ok(Array.isArray(grouped.wildcard));
  assert.equal(grouped.continuation[0]?.title, 'Sibling Song');
  assert.equal(grouped.continuation[0]?.provider, 'apple');
  assert.equal(grouped.comfort[0]?.title, 'Comfort Track');
  assert.equal(grouped.comfort[0]?.provider, 'history');
  assert.equal(grouped.wildcard[0]?.artist, 'Wildcard Artist');
  assert.equal(grouped.wildcard[0]?.provider, 'apple');
});

test('CandidateGenerator falls back to recent history tags for context-fit discovery', async () => {
  const apple = new FakeAppleSearchProvider();
  const generator = new CandidateGenerator(
    null,
    apple as never,
    createHistoryStoreStub(),
  );

  const grouped = await generator.generate(null, undefined, 'explore');

  assert.deepEqual(apple.genreCalls, ['ambient', 'focus']);
  assert.ok(grouped.contextFit.length > 0);
  assert.deepEqual(grouped.contextFit[0]?.tags, ['ambient']);
  assert.equal(grouped.contextFit[0]?.provider, 'apple');
});
