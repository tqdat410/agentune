// PID file management for singleton daemon discovery
// Tracks running daemon process: location ~/.sbotify/daemon.pid

import { homedir } from 'os';
import { join } from 'path';
import { mkdirSync, writeFileSync, readFileSync, unlinkSync } from 'fs';

export interface DaemonInfo {
  pid: number;
  port: number;
  started: string;
}

/** Returns path to the PID file */
export function getPidFilePath(): string {
  return join(homedir(), '.sbotify', 'daemon.pid');
}

/** Write current PID + port + ISO timestamp to PID file */
export function writePidFile(port: number): void {
  const dir = join(homedir(), '.sbotify');
  mkdirSync(dir, { recursive: true });
  const info: DaemonInfo = {
    pid: process.pid,
    port,
    started: new Date().toISOString(),
  };
  writeFileSync(getPidFilePath(), JSON.stringify(info), 'utf8');
}

/** Read + parse PID file; returns null if missing or corrupt */
export function readPidFile(): DaemonInfo | null {
  try {
    const raw = readFileSync(getPidFilePath(), 'utf8');
    return JSON.parse(raw) as DaemonInfo;
  } catch {
    return null;
  }
}

/** Remove PID file; ignores ENOENT */
export function removePidFile(): void {
  try {
    unlinkSync(getPidFilePath());
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
}

/** Check if daemon is running by reading PID file and signaling process */
export function isDaemonRunning(): { running: boolean; info: DaemonInfo | null } {
  const info = readPidFile();
  if (!info) return { running: false, info: null };

  try {
    process.kill(info.pid, 0);
    return { running: true, info };
  } catch {
    // Process is dead — remove stale file
    removePidFile();
    return { running: false, info: null };
  }
}
