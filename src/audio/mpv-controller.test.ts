import assert from 'node:assert/strict';
import { EventEmitter, once } from 'node:events';
import test from 'node:test';
import { MpvController, type TrackMeta } from './mpv-controller.js';

class FakeSession extends EventEmitter {
  public appendCalls: string[] = [];
  public clearCalls = 0;
  public loadCalls: string[] = [];
  public playlistCount = 0;

  async appendToPlaylist(filePath: string): Promise<void> {
    this.appendCalls.push(filePath);
  }

  async clearPlaylist(): Promise<void> {
    this.clearCalls += 1;
  }

  async getPlaylistCount(): Promise<number> {
    return this.playlistCount;
  }

  async loadFile(url: string): Promise<void> {
    this.loadCalls.push(url);
  }

  async setPause(): Promise<void> {
    return undefined;
  }

  async stop(): Promise<void> {
    return undefined;
  }

  async setVolume(): Promise<void> {
    return undefined;
  }

  async setMute(): Promise<void> {
    return undefined;
  }

  async getProperty(): Promise<number> {
    return 0;
  }

  destroy(): void {
    // No-op for test fake.
  }
}

function prepareControllerWithSession(session: FakeSession): MpvController {
  const controller = new MpvController();
  (controller as unknown as { initialized: boolean }).initialized = true;
  (controller as unknown as { session: FakeSession }).session = session;
  return controller;
}

test('MpvController forwards playlist append/clear and keeps play behavior intact', async () => {
  const session = new FakeSession();
  const controller = prepareControllerWithSession(session);
  const track: TrackMeta = { id: '1', title: 'Track A' };

  controller.play('/tmp/track-a.wav', track);
  controller.appendToPlaylist('/tmp/track-b.wav');
  controller.clearPlaylist();
  await (controller as unknown as { commandQueue: Promise<void> }).commandQueue;

  assert.deepEqual(session.loadCalls, ['/tmp/track-a.wav']);
  assert.deepEqual(session.appendCalls, ['/tmp/track-b.wav']);
  assert.equal(session.clearCalls, 1);
});

test('MpvController emits segment-changed from playlist-pos property events', async () => {
  const session = new FakeSession();
  const controller = prepareControllerWithSession(session);
  (controller as unknown as { attachSessionEvents: (input: FakeSession) => void }).attachSessionEvents(session);

  const eventPromise = once(controller, 'segment-changed');
  session.emit('property-change', { data: 2, name: 'playlist-pos' });

  const [segmentIndex] = await eventPromise;
  assert.equal(segmentIndex, 2);
});

test('MpvController exposes playlist count with safe fallback', async () => {
  const session = new FakeSession();
  session.playlistCount = 3;
  const controller = prepareControllerWithSession(session);

  assert.equal(await controller.getPlaylistCount(), 3);

  session.getPlaylistCount = async () => {
    throw new Error('unavailable');
  };
  assert.equal(await controller.getPlaylistCount(), 0);
});
