import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const COMMAND_TIMEOUT_MS = 5_000;

export function executableExists(filePath: string): boolean {
  return existsSync(filePath);
}

export function firstResolvedExecutableLine(output: string): string | undefined {
  return output
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .find(Boolean);
}

export function readVersionLine(
  command: string,
  args: string[] = ['--version'],
  options: { timeoutMs?: number } = {},
): string {
  const output = runCommand(command, args, options.timeoutMs ?? COMMAND_TIMEOUT_MS);
  return firstResolvedExecutableLine(output) ?? 'version unavailable';
}

export function resolveBundledYtDlpBinary(env: NodeJS.ProcessEnv = process.env): string {
  const packageEntryPath = require.resolve('youtube-dl-exec');
  const packageRoot = path.dirname(path.dirname(packageEntryPath));
  const binaryDir = env.YOUTUBE_DL_DIR ?? path.join(packageRoot, 'bin');
  const filename = env.YOUTUBE_DL_FILENAME || 'yt-dlp';
  const platform = env.YOUTUBE_DL_PLATFORM ?? (process.platform === 'win32' ? 'win32' : 'unix');
  const binaryName = !filename.endsWith('.exe') && platform === 'win32'
    ? `${filename}.exe`
    : filename;

  return path.join(binaryDir, binaryName);
}

export function resolveCommandFromPath(command: string): string | undefined {
  try {
    const output = runCommand(process.platform === 'win32' ? 'where.exe' : 'which', [command], COMMAND_TIMEOUT_MS);
    return firstResolvedExecutableLine(output);
  } catch {
    return undefined;
  }
}

function runCommand(command: string, args: string[], timeoutMs: number): string {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: timeoutMs,
    windowsHide: true,
  });

  if (result.error) {
    const error = result.error as NodeJS.ErrnoException;
    if (error.code === 'ETIMEDOUT') {
      throw new Error(`Command timed out after ${timeoutMs}ms: ${command}`);
    }

    throw error;
  }

  if (result.status !== 0) {
    const detail = firstResolvedExecutableLine(`${result.stderr ?? ''}\n${result.stdout ?? ''}`)
      ?? `exit code ${result.status ?? 'unknown'}`;
    throw new Error(`Command failed for ${command}: ${detail}`);
  }

  return result.stdout ?? '';
}
