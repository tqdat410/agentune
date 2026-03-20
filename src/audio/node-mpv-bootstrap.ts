import { execFileSync } from 'child_process';
import type { SpawnOptions } from 'child_process';
import { createRequire } from 'module';
import type MPV from 'node-mpv';

const require = createRequire(import.meta.url);

type MpvConstructor = typeof MPV;
type MutableChildProcessModule = typeof import('child_process') & {
  spawn: (command: string, args?: readonly string[], options?: SpawnOptions) => unknown;
};

let cachedConstructor: MpvConstructor | null = null;

export function loadNodeMpvApi(): MpvConstructor {
  if (cachedConstructor) {
    return cachedConstructor;
  }

  const childProcess = require('node:child_process') as MutableChildProcessModule;
  const originalSpawn = childProcess.spawn;

  try {
    if (process.platform === 'win32') {
      childProcess.spawn = ((command, args, options) => {
        const nextOptions = shouldHideWindowsConsoleForCommand(command)
          ? { ...(options ?? {}), windowsHide: true }
          : options;
        return originalSpawn(command, args ?? [], nextOptions);
      }) as MutableChildProcessModule['spawn'];
    }

    const loaded = require('node-mpv') as { default?: MpvConstructor };
    cachedConstructor = loaded.default ?? (loaded as unknown as MpvConstructor);
    return cachedConstructor;
  } finally {
    childProcess.spawn = originalSpawn;
  }
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
