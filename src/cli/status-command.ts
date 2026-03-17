// CLI status command — report daemon running state and uptime
// Exits 1 if daemon is not running or not responding

import { readPidFile, removePidFile } from '../daemon/pid-manager.js';

export async function runStatus(): Promise<void> {
  const info = readPidFile();
  if (!info) {
    console.error('[sbotify] Daemon is not running');
    process.exit(1);
  }

  try {
    const res = await fetch(`http://127.0.0.1:${info.port}/health`, {
      signal: AbortSignal.timeout(2000),
    });
    if (!res.ok) throw new Error('unhealthy');
    const data = await res.json() as { uptime: number };
    console.error(
      `[sbotify] Daemon running — PID: ${info.pid}, Port: ${info.port}, Uptime: ${Math.floor(data.uptime)}s`
    );
  } catch {
    console.error('[sbotify] Daemon PID file exists but not responding (stale)');
    removePidFile();
    process.exit(1);
  }
}
