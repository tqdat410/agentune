// CLI stop command — gracefully stop the running daemon
// Falls back to SIGTERM if HTTP shutdown endpoint fails

import { readPidFile, removePidFile } from '../daemon/pid-manager.js';

export async function runStop(): Promise<void> {
  const info = readPidFile();
  if (!info) {
    console.error('[sbotify] Daemon is not running');
    return;
  }

  try {
    await fetch(`http://127.0.0.1:${info.port}/shutdown`, {
      method: 'POST',
      signal: AbortSignal.timeout(5000),
    });
    console.error('[sbotify] Daemon stopped');
  } catch {
    console.error('[sbotify] Failed to stop daemon via HTTP, killing process');
    try { process.kill(info.pid, 'SIGTERM'); } catch { /* ignore if already dead */ }
    removePidFile();
  }
}
