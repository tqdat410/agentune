import assert from 'node:assert/strict';
import { EventEmitter } from 'events';
import fs from 'fs';
import os from 'os';
import path from 'path';
import test from 'node:test';
import WebSocket from 'ws';
import { HistoryStore } from '../history/history-store.js';
import { handleUpdatePersona } from '../mcp/tool-handlers.js';
import { QueueManager } from '../queue/queue-manager.js';
import { createTasteEngine } from '../taste/taste-engine.js';
import { createWebServer } from './web-server.js';

class FakeMpv extends EventEmitter {
  getState(): { currentTrack: null; isPlaying: false; volume: number; isMuted: boolean } {
    return { currentTrack: null, isPlaying: false, volume: 80, isMuted: false };
  }

  isReady(): boolean {
    return false;
  }

  async getPosition(): Promise<number> {
    return 0;
  }

  getVolume(): number {
    return 80;
  }

  getIsMuted(): boolean {
    return false;
  }
}

function getTempDbPath(): string {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sbotify-web-sync-'));
  return path.join(tmpDir, 'history.db');
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

async function waitForBufferedMessage(
  messages: Array<{ type?: string; data?: { taste?: string } }>,
  predicate: (payload: { type?: string; data?: { taste?: string } }) => boolean,
): Promise<{ type?: string; data?: { taste?: string } }> {
  return await new Promise((resolve, reject) => {
    const deadline = Date.now() + 5000;
    const check = () => {
      const match = messages.find((payload) => predicate(payload));
      if (match) {
        resolve(match);
        return;
      }

      if (Date.now() >= deadline) {
        reject(new Error('Timed out waiting for websocket message.'));
        return;
      }

      setTimeout(check, 25);
    };

    check();
  });
}

test('WebServer pushes persona on connect and after MCP update_persona', async () => {
  const dbPath = getTempDbPath();
  const store = new HistoryStore(dbPath);
  const tasteEngine = createTasteEngine(store);
  tasteEngine.saveTasteText('Initial taste');

  const webServer = createWebServer(new FakeMpv() as never, new QueueManager());
  await webServer.waitUntilReady();

  const socket = new WebSocket(`${webServer.getDashboardUrl().replace('http', 'ws')}/ws`);
  const messages: Array<{ type?: string; data?: { taste?: string } }> = [];
  socket.on('message', (raw) => {
    messages.push(JSON.parse(raw.toString()) as { type?: string; data?: { taste?: string } });
  });
  await new Promise<void>((resolve) => socket.once('open', () => resolve()));

  try {
    const initialPersona = await waitForBufferedMessage(
      messages,
      (payload) => payload.type === 'persona' && payload.data?.taste === 'Initial taste',
    );
    assert.equal(initialPersona.data?.taste, 'Initial taste');

    const updateResult = await handleUpdatePersona({ taste: 'Updated taste' });
    assert.equal(updateResult.isError, undefined);

    const updatedPersona = await waitForBufferedMessage(
      messages,
      (payload) => payload.type === 'persona' && payload.data?.taste === 'Updated taste',
    );
    assert.equal(updatedPersona.data?.taste, 'Updated taste');
  } finally {
    socket.close();
    await webServer.destroy();
    store.close();
    cleanupDb(dbPath);
  }
});
