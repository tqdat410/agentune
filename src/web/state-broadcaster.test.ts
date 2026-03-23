import assert from 'node:assert/strict';
import { EventEmitter } from 'events';
import test from 'node:test';
import { QueueManager } from '../queue/queue-manager.js';
import { StateBroadcaster } from './state-broadcaster.js';

class StateBroadcasterFakeMpv extends EventEmitter {
  private readonly pendingPositionResolvers: Array<(value: number) => void> = [];
  private readonly state = {
    currentTrack: {
      id: 'current-track',
      title: 'Current Track',
      artist: 'Current Artist',
      duration: 180,
      thumbnail: 'thumb-current',
    },
    isPlaying: true,
    isMuted: false,
    volume: 80,
  };

  getState(): typeof this.state {
    return this.state;
  }

  getVolume(): number {
    return this.state.volume;
  }

  getIsMuted(): boolean {
    return this.state.isMuted;
  }

  isReady(): boolean {
    return true;
  }

  async getPosition(): Promise<number> {
    return await new Promise((resolve) => {
      this.pendingPositionResolvers.push(resolve);
    });
  }

  pause(): void {
    this.state.isPlaying = false;
    this.emit('state-change', this.state);
  }

  releaseNextPosition(position: number): void {
    const resolve = this.pendingPositionResolvers.shift();
    if (!resolve) {
      throw new Error('No pending getPosition call to resolve.');
    }
    resolve(position);
  }

  releaseLatestPosition(position: number): void {
    const resolve = this.pendingPositionResolvers.pop();
    if (!resolve) {
      throw new Error('No pending getPosition call to resolve.');
    }
    resolve(position);
  }

  getPendingPositionCount(): number {
    return this.pendingPositionResolvers.length;
  }
}

async function waitFor(check: () => boolean): Promise<void> {
  const timeoutAt = Date.now() + 5000;

  while (Date.now() < timeoutAt) {
    if (check()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  throw new Error('Timed out waiting for broadcaster state.');
}

test('StateBroadcaster keeps the latest playback state when refresh calls overlap', async () => {
  const queueManager = new QueueManager();
  const mpv = new StateBroadcasterFakeMpv();
  const broadcaster = new StateBroadcaster(mpv as never, queueManager);

  try {
    const firstRefresh = broadcaster.refresh();
    await waitFor(() => mpv.getPendingPositionCount() === 1);

    mpv.pause();
    await waitFor(() => mpv.getPendingPositionCount() === 2);

    mpv.releaseLatestPosition(24);
    await waitFor(() => broadcaster.getState().playing === false && broadcaster.getState().position === 24);

    mpv.releaseNextPosition(12);
    await firstRefresh;

    assert.equal(broadcaster.getState().playing, false);
    assert.equal(broadcaster.getState().position, 24);
    assert.equal(broadcaster.getState().title, 'Current Track');
  } finally {
    broadcaster.destroy();
  }
});

test('StateBroadcaster prefers logical transition state when provided', async () => {
  const queueManager = new QueueManager();
  const mpv = new StateBroadcasterFakeMpv();
  const broadcaster = new StateBroadcaster(mpv as never, queueManager, {
    getCurrentLogicalTrack: () => ({
      artist: 'Logical Artist',
      duration: 180,
      id: 'logical-track',
      thumbnail: 'logical-thumb',
      title: 'Logical Track',
      url: 'logical-url',
    }),
    getLogicalPosition: () => ({
      duration: 180,
      position: 42,
      track: {
        artist: 'Logical Artist',
        duration: 180,
        id: 'logical-track',
        thumbnail: 'logical-thumb',
        title: 'Logical Track',
        url: 'logical-url',
      },
    }),
  } as never);

  try {
    const refresh = broadcaster.refresh();
    mpv.releaseNextPosition(12);
    await refresh;
    await waitFor(() => broadcaster.getState().position === 42);

    assert.equal(broadcaster.getState().title, 'Logical Track');
    assert.equal(broadcaster.getState().artist, 'Logical Artist');
    assert.equal(broadcaster.getState().duration, 180);
  } finally {
    broadcaster.destroy();
  }
});
