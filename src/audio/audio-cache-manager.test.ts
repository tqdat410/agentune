import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { ChildProcess, spawn } from 'node:child_process';
import { AudioCacheManager } from './audio-cache-manager.js';

function createTempDataDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'agentune-audio-cache-'));
}

function cleanupDataDir(dataDir: string): void {
  try {
    fs.rmSync(dataDir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup issues in tests.
  }
}

function createFakeChildProcess(): ChildProcess {
  const emitter = new EventEmitter() as unknown as ChildProcess & EventEmitter;
  const stderr = new EventEmitter() as unknown as NodeJS.ReadableStream & EventEmitter;
  (stderr as unknown as { setEncoding: (encoding: BufferEncoding) => void }).setEncoding = () => {};
  (emitter as unknown as { stderr: NodeJS.ReadableStream & EventEmitter }).stderr = stderr;
  emitter.kill = () => {
    emitter.emit('close', null, 'SIGTERM');
    return true;
  };
  return emitter as ChildProcess;
}

test('AudioCacheManager downloads, normalizes, and reuses cached normalized audio', async () => {
  const previousDataDir = process.env.AGENTUNE_DATA_DIR;
  const dataDir = createTempDataDir();
  process.env.AGENTUNE_DATA_DIR = dataDir;

  let metadataCalls = 0;
  let downloadCalls = 0;
  let ffmpegCalls = 0;

  const manager = new AudioCacheManager({
    resolveCacheMaxMB: () => 2000,
    youtubeDlFn: (async (_url: string, options: Record<string, unknown>) => {
      if (options.dumpSingleJson) {
        metadataCalls += 1;
        return { duration: 187 };
      }
      downloadCalls += 1;
      const outputTemplate = options.output as string;
      fs.writeFileSync(outputTemplate.replace('%(ext)s', 'm4a'), 'downloaded-audio', 'utf8');
      return {};
    }) as unknown as typeof import('youtube-dl-exec').youtubeDl,
    spawnProcess: ((command: string, args: string[]) => {
      ffmpegCalls += 1;
      assert.equal(command, 'ffmpeg');
      const fake = createFakeChildProcess();
      setImmediate(() => {
        fs.writeFileSync(args.at(-1)!, 'normalized-audio', 'utf8');
        fake.emit('close', 0, null);
      });
      return fake;
    }) as unknown as typeof spawn,
  });

  try {
    const first = await manager.getOrPrepare('track-a');
    const second = await manager.getOrPrepare('track-a');
    assert.equal(first.normalizedPath.endsWith('track-a.wav'), true);
    assert.equal(second.normalizedPath, first.normalizedPath);
    assert.equal(first.duration, 187);
    assert.equal(metadataCalls, 1);
    assert.equal(downloadCalls, 1);
    assert.equal(ffmpegCalls, 1);
  } finally {
    if (previousDataDir === undefined) delete process.env.AGENTUNE_DATA_DIR;
    else process.env.AGENTUNE_DATA_DIR = previousDataDir;
    cleanupDataDir(dataDir);
  }
});

test('AudioCacheManager coalesces concurrent prepare requests for the same video', async () => {
  const previousDataDir = process.env.AGENTUNE_DATA_DIR;
  const dataDir = createTempDataDir();
  process.env.AGENTUNE_DATA_DIR = dataDir;

  let downloadCalls = 0;
  let ffmpegCalls = 0;

  const manager = new AudioCacheManager({
    resolveCacheMaxMB: () => 2000,
    youtubeDlFn: (async (_url: string, options: Record<string, unknown>) => {
      if (options.dumpSingleJson) {
        return { duration: 90 };
      }
      downloadCalls += 1;
      const outputTemplate = options.output as string;
      await new Promise((resolve) => setTimeout(resolve, 30));
      fs.writeFileSync(outputTemplate.replace('%(ext)s', 'm4a'), 'downloaded-audio', 'utf8');
      return {};
    }) as unknown as typeof import('youtube-dl-exec').youtubeDl,
    spawnProcess: ((_command: string, args: string[]) => {
      ffmpegCalls += 1;
      const fake = createFakeChildProcess();
      setImmediate(() => {
        fs.writeFileSync(args.at(-1)!, 'normalized-audio', 'utf8');
        fake.emit('close', 0, null);
      });
      return fake;
    }) as unknown as typeof spawn,
  });

  try {
    const [first, second] = await Promise.all([
      manager.getOrPrepare('same-track'),
      manager.getOrPrepare('same-track'),
    ]);
    assert.equal(first.normalizedPath, second.normalizedPath);
    assert.equal(downloadCalls, 1);
    assert.equal(ffmpegCalls, 1);
  } finally {
    if (previousDataDir === undefined) delete process.env.AGENTUNE_DATA_DIR;
    else process.env.AGENTUNE_DATA_DIR = previousDataDir;
    cleanupDataDir(dataDir);
  }
});

test('AudioCacheManager falls back to raw download path when ffmpeg is unavailable', async () => {
  const previousDataDir = process.env.AGENTUNE_DATA_DIR;
  const dataDir = createTempDataDir();
  process.env.AGENTUNE_DATA_DIR = dataDir;

  let ffmpegCalls = 0;
  const manager = new AudioCacheManager({
    resolveCacheMaxMB: () => 2000,
    youtubeDlFn: (async (_url: string, options: Record<string, unknown>) => {
      if (options.dumpSingleJson) {
        return { duration: 44 };
      }
      const outputTemplate = options.output as string;
      fs.writeFileSync(outputTemplate.replace('%(ext)s', 'm4a'), 'downloaded-audio', 'utf8');
      return {};
    }) as unknown as typeof import('youtube-dl-exec').youtubeDl,
    spawnProcess: (() => {
      ffmpegCalls += 1;
      const fake = createFakeChildProcess();
      setImmediate(() => {
        const spawnError = Object.assign(new Error('ffmpeg missing'), { code: 'ENOENT' });
        fake.emit('error', spawnError);
      });
      return fake;
    }) as unknown as typeof spawn,
  });

  try {
    const first = await manager.getOrPrepare('no-ffmpeg');
    const second = await manager.getOrPrepare('no-ffmpeg');
    assert.equal(first.normalizedPath.endsWith('.m4a'), true);
    assert.equal(second.normalizedPath, first.normalizedPath);
    assert.equal(ffmpegCalls, 1);
  } finally {
    if (previousDataDir === undefined) delete process.env.AGENTUNE_DATA_DIR;
    else process.env.AGENTUNE_DATA_DIR = previousDataDir;
    cleanupDataDir(dataDir);
  }
});

test('AudioCacheManager eviction skips in-use files while applying LRU order', async () => {
  const previousDataDir = process.env.AGENTUNE_DATA_DIR;
  const dataDir = createTempDataDir();
  process.env.AGENTUNE_DATA_DIR = dataDir;
  const manager = new AudioCacheManager({
    resolveCacheMaxMB: () => 0,
    youtubeDlFn: (async () => ({})) as unknown as typeof import('youtube-dl-exec').youtubeDl,
    spawnProcess: (() => createFakeChildProcess()) as unknown as typeof spawn,
  });

  try {
    fs.mkdirSync(manager.getDownloadsDir(), { recursive: true });
    const inUseFile = path.join(manager.getDownloadsDir(), 'keep.m4a');
    const evictableFile = path.join(manager.getDownloadsDir(), 'drop.m4a');
    fs.writeFileSync(inUseFile, '111111', 'utf8');
    fs.writeFileSync(evictableFile, '222222', 'utf8');
    fs.utimesSync(inUseFile, new Date(1000), new Date(1000));
    fs.utimesSync(evictableFile, new Date(2000), new Date(2000));

    manager.markInUse(inUseFile);
    await manager.evictIfNeeded(0);

    assert.equal(fs.existsSync(inUseFile), true);
    assert.equal(fs.existsSync(evictableFile), false);
    manager.releaseInUse(inUseFile);
  } finally {
    if (previousDataDir === undefined) delete process.env.AGENTUNE_DATA_DIR;
    else process.env.AGENTUNE_DATA_DIR = previousDataDir;
    cleanupDataDir(dataDir);
  }
});

test('AudioCacheManager defers eviction until callers can mark freshly prepared files in use', async () => {
  const previousDataDir = process.env.AGENTUNE_DATA_DIR;
  const dataDir = createTempDataDir();
  process.env.AGENTUNE_DATA_DIR = dataDir;

  const manager = new AudioCacheManager({
    resolveCacheMaxMB: () => 0,
    youtubeDlFn: (async (_url: string, options: Record<string, unknown>) => {
      if (options.dumpSingleJson) {
        return { duration: 120 };
      }
      const outputTemplate = options.output as string;
      fs.writeFileSync(outputTemplate.replace('%(ext)s', 'm4a'), 'downloaded-audio', 'utf8');
      return {};
    }) as unknown as typeof import('youtube-dl-exec').youtubeDl,
    spawnProcess: ((_command: string, args: string[]) => {
      const fake = createFakeChildProcess();
      setImmediate(() => {
        fs.writeFileSync(args.at(-1)!, 'normalized-audio', 'utf8');
        fake.emit('close', 0, null);
      });
      return fake;
    }) as unknown as typeof spawn,
  });

  try {
    const prepared = await manager.getOrPrepare('track-a');
    manager.markInUse(prepared.normalizedPath);
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(fs.existsSync(prepared.normalizedPath), true);
    manager.releaseInUse(prepared.normalizedPath);
  } finally {
    if (previousDataDir === undefined) delete process.env.AGENTUNE_DATA_DIR;
    else process.env.AGENTUNE_DATA_DIR = previousDataDir;
    cleanupDataDir(dataDir);
  }
});
