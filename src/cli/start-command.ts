// CLI start command — ensure the daemon is running in the background.

import { ensureDaemon } from '../proxy/daemon-launcher.js';

export async function runStart(): Promise<void> {
  const result = await ensureDaemon({ allowSpawn: true });
  if (result.started) {
    console.error(`[agentune] Daemon started on port ${result.port}`);
    return;
  }

  console.error(`[agentune] Daemon already running on port ${result.port}`);
}
