import assert from 'node:assert/strict';
import process from 'node:process';
import test from 'node:test';
import { MpvProcessSession } from './mpv-process-session.js';

test('MpvProcessSession observes playlist-pos on start', async () => {
  const observed: Array<{ id: number; name: string }> = [];
  const fakeClient = {
    command: async () => undefined,
    connect: async () => undefined,
    destroy: () => undefined,
    getProperty: async () => 0,
    notify: () => undefined,
    observeProperty: async (id: number, name: string) => {
      observed.push({ id, name });
    },
  };

  const session = new MpvProcessSession({
    binary: process.execPath,
    ipcPath: process.platform === 'win32'
      ? `\\\\.\\pipe\\agentune-test-${process.pid}-${Date.now()}`
      : `/tmp/agentune-test-${process.pid}-${Date.now()}.sock`,
  });
  (session as unknown as { client: typeof fakeClient }).client = fakeClient;

  session.start();
  await (session as unknown as { readyPromise: Promise<void> }).readyPromise;
  session.destroy();

  assert.deepEqual(observed, [
    { id: 1, name: 'pause' },
    { id: 2, name: 'idle-active' },
    { id: 3, name: 'playlist-pos' },
  ]);
});

test('MpvProcessSession appends, clears, and reads playlist count', async () => {
  const commands: unknown[][] = [];
  let requestedProperty = '';
  const fakeClient = {
    command: async (...args: unknown[]) => {
      commands.push(args);
      return undefined;
    },
    getProperty: async (name: string) => {
      requestedProperty = name;
      return 4;
    },
  };

  const session = new MpvProcessSession({
    ipcPath: process.platform === 'win32'
      ? `\\\\.\\pipe\\agentune-test-${process.pid}-${Date.now()}`
      : `/tmp/agentune-test-${process.pid}-${Date.now()}.sock`,
  });
  (session as unknown as { client: typeof fakeClient }).client = fakeClient;
  (session as unknown as { readyPromise: Promise<void> }).readyPromise = Promise.resolve();

  await session.appendToPlaylist('/tmp/a.wav');
  await session.clearPlaylist();
  const count = await session.getPlaylistCount();

  assert.deepEqual(commands, [
    ['loadfile', '/tmp/a.wav', 'append'],
    ['playlist-clear'],
  ]);
  assert.equal(requestedProperty, 'playlist-count');
  assert.equal(count, 4);
});

test('MpvProcessSession returns zero playlist count for non-number property values', async () => {
  const session = new MpvProcessSession({
    ipcPath: process.platform === 'win32'
      ? `\\\\.\\pipe\\agentune-test-${process.pid}-${Date.now()}`
      : `/tmp/agentune-test-${process.pid}-${Date.now()}.sock`,
  });
  (session as unknown as { client: { getProperty: (name: string) => Promise<unknown> } }).client = {
    getProperty: async () => 'not-a-number',
  };
  (session as unknown as { readyPromise: Promise<void> }).readyPromise = Promise.resolve();

  const count = await session.getPlaylistCount();
  assert.equal(count, 0);
});
