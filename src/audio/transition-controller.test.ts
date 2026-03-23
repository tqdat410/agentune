import assert from 'node:assert/strict';
import { EventEmitter, once } from 'node:events';
import test from 'node:test';
import { TransitionController } from './transition-controller.js';

class FakeMpv extends EventEmitter {
  public readonly appendedPaths: string[] = [];

  appendToPlaylist(filePath: string): void {
    this.appendedPaths.push(filePath);
  }
}

class FakeAudioCacheManager {
  public readonly inUse = new Set<string>();

  constructor(private readonly tracks: Record<string, { duration: number; normalizedPath: string }>) {}

  async getOrPrepare(videoId: string): Promise<{ duration: number; normalizedPath: string; videoId: string }> {
    const track = this.tracks[videoId];
    if (!track) {
      throw new Error(`Missing fake track: ${videoId}`);
    }
    return { ...track, videoId };
  }

  markInUse(filePath: string): void {
    this.inUse.add(filePath);
  }

  releaseInUse(filePath: string): void {
    this.inUse.delete(filePath);
  }
}

class FakeCrossfadePreMixer {
  public cancelCalls = 0;
  public shouldThrow = false;

  constructor(private readonly result: {
    aBodyDuration: number;
    aBodyPath: string;
    bBodyDuration: number;
    bBodyPath: string;
    crossfadeDuration: number;
    crossfadePath: string;
    skipped: boolean;
  }) {}

  async createCrossfade(): Promise<typeof this.result> {
    if (this.shouldThrow) {
      throw new Error('boom');
    }
    return this.result;
  }

  cancel(): void {
    this.cancelCalls += 1;
  }
}

const CURRENT_ITEM = { artist: 'Artist A', duration: 200, id: 'current', thumbnail: 'thumb-a', title: 'Current', url: 'a' };
const NEXT_ITEM = { artist: 'Artist B', duration: 180, id: 'next', thumbnail: 'thumb-b', title: 'Next', url: 'b' };

test('TransitionController starts direct then upgrades to crossfade via async preparation', async () => {
  const mpv = new FakeMpv();
  const audioCacheManager = new FakeAudioCacheManager({
    current: { duration: 200, normalizedPath: 'current.wav' },
    next: { duration: 180, normalizedPath: 'next.wav' },
  });
  const crossfadePreMixer = new FakeCrossfadePreMixer({
    aBodyDuration: 195,
    aBodyPath: 'current-body.wav',
    bBodyDuration: 175,
    bBodyPath: 'next-tail.wav',
    crossfadeDuration: 5,
    crossfadePath: 'xfade.wav',
    skipped: false,
  });
  const controller = new TransitionController(mpv as never, {
    audioCacheManager: audioCacheManager as never,
    config: { cacheMaxMB: 2000, curve: 'exp', duration: 5, enabled: true, loudnessNorm: true },
    crossfadePreMixer: crossfadePreMixer as never,
  });

  // startPlayback always returns direct immediately
  const start = await controller.startPlayback(CURRENT_ITEM, NEXT_ITEM);
  assert.equal(start.mode, 'direct');
  assert.equal(start.entryPath, 'current.wav');
  assert.deepEqual(start.appendPaths, []);

  // Await the deduped async upgrade (startPlayback already fired it internally)
  const upgraded = await controller.prepareTransitionAsync(NEXT_ITEM);
  assert.equal(upgraded, true);

  // mpv playlist was extended with crossfade + next body
  assert.deepEqual(mpv.appendedPaths, ['xfade.wav', 'next-tail.wav']);

  // Logical track is still current
  assert.equal(controller.getCurrentLogicalTrack()?.id, 'current');
  assert.equal(controller.getLogicalPosition(24)?.position, 24);
  assert.deepEqual([...audioCacheManager.inUse], ['current-body.wav', 'xfade.wav', 'next-tail.wav']);

  // Crossfade segment
  mpv.emit('segment-changed', 1);
  assert.equal(controller.isInCrossfade(), true);
  assert.equal(controller.getLogicalPosition(3)?.position, 198);

  // Handoff to next track
  const handoffPromise = once(controller, 'logical-track-changed');
  mpv.emit('segment-changed', 2);
  const [handoff] = await handoffPromise as [{ previousTrack: { id: string }; track: { id: string } }];
  assert.equal(handoff.previousTrack.id, 'current');
  assert.equal(handoff.track.id, 'next');
  assert.equal(controller.getCurrentLogicalTrack()?.id, 'next');
  assert.equal(controller.getLogicalPosition(7)?.position, 12);

  controller.cancel();
  assert.equal(audioCacheManager.inUse.size, 0);
});

test('TransitionController upgrades via prepareTransitionAsync when next track is queued later', async () => {
  const mpv = new FakeMpv();
  const audioCacheManager = new FakeAudioCacheManager({
    current: { duration: 200, normalizedPath: 'current.wav' },
    next: { duration: 180, normalizedPath: 'next.wav' },
  });
  const crossfadePreMixer = new FakeCrossfadePreMixer({
    aBodyDuration: 195,
    aBodyPath: 'current-body.wav',
    bBodyDuration: 175,
    bBodyPath: 'next-tail.wav',
    crossfadeDuration: 5,
    crossfadePath: 'xfade.wav',
    skipped: false,
  });
  const controller = new TransitionController(mpv as never, {
    audioCacheManager: audioCacheManager as never,
    config: { cacheMaxMB: 2000, curve: 'exp', duration: 5, enabled: true, loudnessNorm: true },
    crossfadePreMixer: crossfadePreMixer as never,
  });

  // Start with no next track — pure direct
  const start = await controller.startPlayback(CURRENT_ITEM, null);
  assert.equal(start.mode, 'direct');
  assert.equal(start.entryPath, 'current.wav');
  assert.deepEqual(mpv.appendedPaths, []);

  // Later, next track is queued — call prepareTransitionAsync
  const upgraded = await controller.prepareTransitionAsync(NEXT_ITEM);
  assert.equal(upgraded, true);
  assert.deepEqual(mpv.appendedPaths, ['xfade.wav', 'next-tail.wav']);
  assert.deepEqual([...audioCacheManager.inUse], ['current-body.wav', 'xfade.wav', 'next-tail.wav']);
});

test('TransitionController reports skip mode based on the active segment', async () => {
  const mpv = new FakeMpv();
  const crossfadePreMixer = new FakeCrossfadePreMixer({
    aBodyDuration: 115,
    aBodyPath: 'current-body.wav',
    bBodyDuration: 135,
    bBodyPath: 'next-tail.wav',
    crossfadeDuration: 5,
    crossfadePath: 'xfade.wav',
    skipped: false,
  });
  const controller = new TransitionController(mpv as never, {
    audioCacheManager: new FakeAudioCacheManager({
      current: { duration: 120, normalizedPath: 'current.wav' },
      next: { duration: 140, normalizedPath: 'next.wav' },
    }) as never,
    config: { cacheMaxMB: 2000, curve: 'exp', duration: 5, enabled: true, loudnessNorm: true },
    crossfadePreMixer: crossfadePreMixer as never,
  });

  await controller.startPlayback(
    { artist: 'Artist A', duration: 120, id: 'current', thumbnail: 'thumb-a', title: 'Current', url: 'a' },
    { artist: 'Artist B', duration: 140, id: 'next', thumbnail: 'thumb-b', title: 'Next', url: 'b' },
  );
  // Await async upgrade so plan is in crossfade mode
  await controller.prepareTransitionAsync(
    { artist: 'Artist B', duration: 140, id: 'next', thumbnail: 'thumb-b', title: 'Next', url: 'b' },
  );
  assert.equal(controller.handleSkip(), 'clean-skip');

  await controller.startPlayback(
    { artist: 'Artist A', duration: 120, id: 'current', thumbnail: 'thumb-a', title: 'Current', url: 'a' },
    { artist: 'Artist B', duration: 140, id: 'next', thumbnail: 'thumb-b', title: 'Next', url: 'b' },
  );
  await controller.prepareTransitionAsync(
    { artist: 'Artist B', duration: 140, id: 'next', thumbnail: 'thumb-b', title: 'Next', url: 'b' },
  );
  mpv.emit('segment-changed', 1);
  assert.equal(controller.handleSkip(), 'hard-cut');
});

test('TransitionController stays direct when pre-mix fails and async upgrade returns false', async () => {
  const mpv = new FakeMpv();
  const audioCacheManager = new FakeAudioCacheManager({
    current: { duration: 210, normalizedPath: 'current.wav' },
    next: { duration: 160, normalizedPath: 'next.wav' },
  });
  const crossfadePreMixer = new FakeCrossfadePreMixer({
    aBodyDuration: 205,
    aBodyPath: 'current-body.wav',
    bBodyDuration: 155,
    bBodyPath: 'next-tail.wav',
    crossfadeDuration: 5,
    crossfadePath: 'xfade.wav',
    skipped: false,
  });
  crossfadePreMixer.shouldThrow = true;
  const controller = new TransitionController(mpv as never, {
    audioCacheManager: audioCacheManager as never,
    config: { cacheMaxMB: 2000, curve: 'exp', duration: 5, enabled: true, loudnessNorm: true },
    crossfadePreMixer: crossfadePreMixer as never,
  });

  const start = await controller.startPlayback(
    { artist: 'Artist A', duration: 210, id: 'current', thumbnail: 'thumb-a', title: 'Current', url: 'a' },
    { artist: 'Artist B', duration: 160, id: 'next', thumbnail: 'thumb-b', title: 'Next', url: 'b' },
  );

  assert.equal(start.mode, 'direct');
  assert.equal(start.entryPath, 'current.wav');
  assert.deepEqual(start.appendPaths, []);

  // Async upgrade should fail gracefully
  const upgraded = await controller.prepareTransitionAsync(
    { artist: 'Artist B', duration: 160, id: 'next', thumbnail: 'thumb-b', title: 'Next', url: 'b' },
  );
  assert.equal(upgraded, false);
  assert.deepEqual(mpv.appendedPaths, []);
});

test('TransitionController prepareTransitionAsync skips upgrade when plan is already crossfade', async () => {
  const mpv = new FakeMpv();
  const controller = new TransitionController(mpv as never, {
    audioCacheManager: new FakeAudioCacheManager({
      current: { duration: 200, normalizedPath: 'current.wav' },
      next: { duration: 180, normalizedPath: 'next.wav' },
      third: { duration: 150, normalizedPath: 'third.wav' },
    }) as never,
    config: { cacheMaxMB: 2000, curve: 'exp', duration: 5, enabled: true, loudnessNorm: true },
    crossfadePreMixer: new FakeCrossfadePreMixer({
      aBodyDuration: 195,
      aBodyPath: 'current-body.wav',
      bBodyDuration: 175,
      bBodyPath: 'next-tail.wav',
      crossfadeDuration: 5,
      crossfadePath: 'xfade.wav',
      skipped: false,
    }) as never,
  });

  // Start and upgrade to crossfade
  await controller.startPlayback(CURRENT_ITEM, NEXT_ITEM);
  await controller.prepareTransitionAsync(NEXT_ITEM);

  // Trying to prepare a third track should return false (plan is crossfade, not direct)
  const upgraded = await controller.prepareTransitionAsync(
    { artist: 'Artist C', duration: 150, id: 'third', thumbnail: 'thumb-c', title: 'Third', url: 'c' },
  );
  assert.equal(upgraded, false);
});

test('TransitionController deduplicates concurrent prepareTransitionAsync calls', async () => {
  const mpv = new FakeMpv();
  const controller = new TransitionController(mpv as never, {
    audioCacheManager: new FakeAudioCacheManager({
      current: { duration: 200, normalizedPath: 'current.wav' },
      next: { duration: 180, normalizedPath: 'next.wav' },
    }) as never,
    config: { cacheMaxMB: 2000, curve: 'exp', duration: 5, enabled: true, loudnessNorm: true },
    crossfadePreMixer: new FakeCrossfadePreMixer({
      aBodyDuration: 195,
      aBodyPath: 'current-body.wav',
      bBodyDuration: 175,
      bBodyPath: 'next-tail.wav',
      crossfadeDuration: 5,
      crossfadePath: 'xfade.wav',
      skipped: false,
    }) as never,
  });

  await controller.startPlayback(CURRENT_ITEM, null);

  // Fire two concurrent calls — should dedup
  const [result1, result2] = await Promise.all([
    controller.prepareTransitionAsync(NEXT_ITEM),
    controller.prepareTransitionAsync(NEXT_ITEM),
  ]);
  assert.equal(result1, true);
  assert.equal(result2, true);

  // mpv should only get one set of appends (not doubled)
  assert.deepEqual(mpv.appendedPaths, ['xfade.wav', 'next-tail.wav']);
});
