// Health check HTTP handler for daemon discovery
// Responds to GET /health with daemon status JSON

import { type IncomingMessage, type ServerResponse } from 'http';

const startedAt = Date.now();

/** Write JSON response with 200 status */
function sendJson(res: ServerResponse, data: unknown): void {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

/** Handle GET /health — returns daemon status */
export function handleHealthRequest(
  req: IncomingMessage,
  res: ServerResponse,
  port: number,
): void {
  if (req.method !== 'GET') {
    res.writeHead(405);
    res.end('Method Not Allowed');
    return;
  }

  sendJson(res, {
    status: 'ok',
    pid: process.pid,
    port,
    uptime: Math.floor((Date.now() - startedAt) / 1000),
  });
}
