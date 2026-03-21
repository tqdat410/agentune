import type { ServerResponse } from 'http';
import { sendJson } from './web-server-helpers.js';

const FETCH_TIMEOUT_MS = 5000;
const PROXY_CACHE_CONTROL = 'public, max-age=300';

function getArtworkSource(url: URL): string | null {
  const source = url.searchParams.get('src');
  if (!source) {
    return null;
  }

  try {
    const parsed = new URL(source);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

export async function handleArtworkProxy(url: URL, response: ServerResponse): Promise<void> {
  const source = getArtworkSource(url);
  if (!source) {
    sendJson(response, { message: 'src must be a valid http or https URL' }, 400);
    return;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const upstream = await fetch(source, {
      signal: controller.signal,
      headers: { 'User-Agent': 'sbotify-dashboard/0.1' },
    });
    clearTimeout(timeout);

    if (!upstream.ok) {
      sendJson(response, { message: 'Artwork fetch failed.' }, 502);
      return;
    }

    const contentType = upstream.headers.get('content-type') ?? 'application/octet-stream';
    const buffer = Buffer.from(await upstream.arrayBuffer());
    response.writeHead(200, {
      'Cache-Control': PROXY_CACHE_CONTROL,
      'Content-Length': buffer.byteLength,
      'Content-Type': contentType,
      'Cross-Origin-Resource-Policy': 'same-origin',
    });
    response.end(buffer);
  } catch (error) {
    clearTimeout(timeout);
    console.error('[web-server] Artwork proxy failed', { error: (error as Error).message });
    sendJson(response, { message: 'Artwork fetch failed.' }, 502);
  }
}
