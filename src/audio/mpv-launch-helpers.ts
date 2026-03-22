import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { unlinkSync } from 'node:fs';

export function isMpvInstalled(): boolean {
  try {
    if (process.platform === 'win32') {
      execFileSync('where.exe', ['mpv.exe'], { stdio: ['ignore', 'ignore', 'ignore'] });
      return true;
    }

    execFileSync('which', ['mpv'], { stdio: ['ignore', 'ignore', 'ignore'] });
    return true;
  } catch {
    return false;
  }
}

export function cleanupStaleIpcPath(ipcPath: string): void {
  if (process.platform === 'win32') {
    return;
  }

  try {
    unlinkSync(ipcPath);
  } catch {
    // No stale socket to remove.
  }
}

export function spawnMpvProcess(ipcPath: string, preferredBinary?: string): ChildProcess {
  const binary = preferredBinary ?? resolvePreferredMpvBinary() ?? 'mpv';
  return spawn(binary, [
    `--input-ipc-server=${ipcPath}`,
    '--no-video',
    '--idle',
    '--no-config',
    '--terminal=no',
  ], {
    stdio: ['ignore', 'ignore', 'ignore'],
    windowsHide: shouldHideWindowsConsoleForCommand(binary),
  });
}

export function resolvePreferredMpvBinary(): string | undefined {
  if (process.platform !== 'win32') {
    return undefined;
  }

  try {
    const output = execFileSync('where.exe', ['mpv.exe'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return firstResolvedExecutableFromWhere(output);
  } catch {
    return undefined;
  }
}

export function firstResolvedExecutableFromWhere(output: string): string | undefined {
  return output
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .find(Boolean);
}

export function shouldHideWindowsConsoleForCommand(command: string): boolean {
  const normalized = command.replaceAll('"', '').trim().toLowerCase();
  return normalized.endsWith('mpv')
    || normalized.endsWith('mpv.exe')
    || normalized.endsWith('mpv.com');
}
