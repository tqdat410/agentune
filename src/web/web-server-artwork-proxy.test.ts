import assert from 'node:assert/strict';
import { EventEmitter } from 'events';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'http';
import test from 'node:test';
import { QueueManager } from '../queue/queue-manager.js';
import { createWebServer } from './web-server.js';

class ArtworkFakeMpv extends EventEmitter {
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

async function getAvailablePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close(() => reject(new Error('Failed to allocate port.')));
        return;
      }
      const { port } = address;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(port);
      });
    });
  });
}

async function startUpstreamServer(
  handler: (request: IncomingMessage, response: ServerResponse) => void,
): Promise<{ port: number; server: Server }> {
  const server = createServer(handler);
  const port = await getAvailablePort();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve());
  });
  return { port, server };
}

test('WebServer artwork proxy streams remote artwork with safe headers', async () => {
  const upstream = await startUpstreamServer((request, response) => {
    if (request.url === '/art.png') {
      response.writeHead(200, { 'Content-Type': 'image/png' });
      response.end('proxy-image');
      return;
    }
    response.writeHead(404);
    response.end();
  });

  const webServer = createWebServer(new ArtworkFakeMpv() as never, new QueueManager(), {
    port: await getAvailablePort(),
  });
  await webServer.waitUntilReady();

  try {
    const source = `http://127.0.0.1:${upstream.port}/art.png`;
    const response = await fetch(`${webServer.getDashboardUrl()}/api/artwork?src=${encodeURIComponent(source)}`);
    const body = await response.text();

    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'image/png');
    assert.equal(response.headers.get('cache-control'), 'public, max-age=300');
    assert.equal(body, 'proxy-image');
  } finally {
    await new Promise<void>((resolve) => upstream.server.close(() => resolve()));
    await webServer.destroy();
  }
});

test('WebServer artwork proxy rejects invalid URLs', async () => {
  const webServer = createWebServer(new ArtworkFakeMpv() as never, new QueueManager(), {
    port: await getAvailablePort(),
  });
  await webServer.waitUntilReady();

  try {
    const response = await fetch(`${webServer.getDashboardUrl()}/api/artwork?src=${encodeURIComponent('file:///etc/passwd')}`);
    const payload = await response.json() as { message: string };

    assert.equal(response.status, 400);
    assert.match(payload.message, /http or https/i);
  } finally {
    await webServer.destroy();
  }
});

test('WebServer artwork proxy reports upstream failures safely', async () => {
  const upstream = await startUpstreamServer((_request, response) => {
    response.writeHead(404);
    response.end('missing');
  });

  const webServer = createWebServer(new ArtworkFakeMpv() as never, new QueueManager(), {
    port: await getAvailablePort(),
  });
  await webServer.waitUntilReady();

  try {
    const source = `http://127.0.0.1:${upstream.port}/missing.png`;
    const response = await fetch(`${webServer.getDashboardUrl()}/api/artwork?src=${encodeURIComponent(source)}`);
    const payload = await response.json() as { message: string };

    assert.equal(response.status, 502);
    assert.match(payload.message, /artwork fetch failed/i);
  } finally {
    await new Promise<void>((resolve) => upstream.server.close(() => resolve()));
    await webServer.destroy();
  }
});
