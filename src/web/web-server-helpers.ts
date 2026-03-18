import { exec } from 'child_process';
import type { IncomingMessage, ServerResponse } from 'http';
import { extname, join } from 'path';

export const DEFAULT_PORT = 3737;
export const MAX_PORT_ATTEMPTS = 10;

const MIME_TYPES: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
};

export function getStaticFilePath(publicDir: string, pathname: string): string {
  if (pathname === '/' || pathname === '') {
    return join(publicDir, 'index.html');
  }

  return join(publicDir, pathname.replace(/^\/+/, ''));
}

export function getMimeType(filePath: string): string {
  return MIME_TYPES[extname(filePath)] ?? 'application/octet-stream';
}

export function sendJson(response: ServerResponse, payload: unknown, statusCode = 200): void {
  response.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(payload));
}

export function openUrl(url: string): void {
  if (process.platform === 'win32') {
    exec(`start "" "${url}"`);
    return;
  }

  if (process.platform === 'darwin') {
    exec(`open "${url}"`);
    return;
  }

  exec(`xdg-open "${url}"`);
}

export async function readJsonBody(request: IncomingMessage): Promise<Record<string, unknown> | null> {
  try {
    const chunks: Buffer[] = [];
    for await (const chunk of request) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (typeof parsed !== 'object' || parsed === null) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

export async function readVolumeRequest(request: IncomingMessage): Promise<{ volume: number } | null> {
  try {
    const chunks: Buffer[] = [];
    for await (const chunk of request) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }

    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { volume?: number };
    if (typeof parsed.volume !== 'number') {
      return null;
    }

    return { volume: parsed.volume };
  } catch {
    return null;
  }
}
