import { spawnSync, spawn, type ChildProcess } from 'node:child_process';
import { unlinkSync } from 'node:fs';

const COMMAND_TIMEOUT_MS = 5_000;

export function isMpvInstalled(): boolean {
  return resolveInstalledMpvBinary() !== undefined;
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

  return resolveBinaryPath('where.exe', ['mpv.exe']);
}

export function resolveInstalledMpvBinary(): string | undefined {
  if (process.platform === 'win32') {
    return resolvePreferredMpvBinary();
  }

  return resolveBinaryPath('which', ['mpv']);
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

function resolveBinaryPath(command: string, args: string[]): string | undefined {
  try {
    const result = spawnSync(command, args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: COMMAND_TIMEOUT_MS,
      windowsHide: true,
    });

    if (result.error || result.status !== 0) {
      return undefined;
    }

    return firstResolvedExecutableFromWhere(result.stdout ?? '');
  } catch {
    return undefined;
  }
}
