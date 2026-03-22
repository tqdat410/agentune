import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { MpvIpcClient } from './mpv-ipc-client.js';

function createTestSocketPath(name: string): string {
  if (process.platform === 'win32') {
    return `\\\\.\\pipe\\${name}-${process.pid}-${Date.now()}`;
  }

  return path.join(os.tmpdir(), `${name}-${process.pid}-${Date.now()}.sock`);
}

test('MpvIpcClient resolves out-of-order responses by request id', async () => {
  const socketPath = createTestSocketPath('agentune-mpv-ipc-order');
  const server = createServer();
  const requests: Array<{ requestId: number; socket: import('node:net').Socket }> = [];

  server.on('connection', (socket) => {
    socket.setEncoding('utf8');
    let buffer = '';
    socket.on('data', (chunk) => {
      buffer += chunk;
      while (true) {
        const newlineIndex = buffer.indexOf('\n');
        if (newlineIndex === -1) {
          return;
        }

        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);
        if (!line) {
          continue;
        }

        const message = JSON.parse(line) as { request_id: number };
        requests.push({ requestId: message.request_id, socket });
        if (requests.length === 2) {
          requests[1].socket.write(JSON.stringify({
            data: 'second',
            error: 'success',
            request_id: requests[1].requestId,
          }) + '\n');
          requests[0].socket.write(JSON.stringify({
            data: 'first',
            error: 'success',
            request_id: requests[0].requestId,
          }) + '\n');
        }
      }
    });
  });

  await new Promise<void>((resolve) => server.listen(socketPath, resolve));
  const client = new MpvIpcClient();

  try {
    await client.connect(socketPath);
    const [firstResult, secondResult] = await Promise.all([
      client.command('get_property', 'time-pos'),
      client.command('get_property', 'duration'),
    ]);

    assert.equal(firstResult, 'first');
    assert.equal(secondResult, 'second');
  } finally {
    client.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    if (process.platform !== 'win32') {
      rmSync(socketPath, { force: true });
    }
  }
});

test('MpvIpcClient emits property-change events and rejects non-success replies', async () => {
  const socketPath = createTestSocketPath('agentune-mpv-ipc-events');
  const server = createServer();

  server.on('connection', (socket) => {
    socket.setEncoding('utf8');
    let buffer = '';
    socket.on('data', (chunk) => {
      buffer += chunk;
      while (true) {
        const newlineIndex = buffer.indexOf('\n');
        if (newlineIndex === -1) {
          return;
        }

        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);
        if (!line) {
          continue;
        }

        const message = JSON.parse(line) as { command: unknown[]; request_id: number };
        const [command, , propertyName] = message.command;
        if (command === 'observe_property') {
          socket.write(JSON.stringify({
            error: 'success',
            request_id: message.request_id,
          }) + '\n');
          socket.write(JSON.stringify({
            data: false,
            event: 'property-change',
            name: String(propertyName),
          }) + '\n');
          continue;
        }

        socket.write(JSON.stringify({
          error: 'property unavailable',
          request_id: message.request_id,
        }) + '\n');
      }
    });
  });

  await new Promise<void>((resolve) => server.listen(socketPath, resolve));
  const client = new MpvIpcClient();

  try {
    await client.connect(socketPath);
    const propertyChangePromise = once(client, 'property-change');
    await client.observeProperty(1, 'pause');

    const [event] = await propertyChangePromise;
    assert.deepEqual(event, { data: false, id: undefined, name: 'pause' });
    await assert.rejects(() => client.getProperty('missing'), /property unavailable/i);
  } finally {
    client.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    if (process.platform !== 'win32') {
      rmSync(socketPath, { force: true });
    }
  }
});
