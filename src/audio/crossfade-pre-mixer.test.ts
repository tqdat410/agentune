import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { ChildProcess, spawn } from 'node:child_process';
import { CrossfadePreMixer, mapRuntimeCrossfadeConfigToPreMixerConfig, shouldSkipCrossfade } from './crossfade-pre-mixer.js';

function createTempDataDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'agentune-crossfade-'));
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

test('CrossfadePreMixer creates and caches crossfade/body segments and exposes arbitrary body trims', async () => {
  const previousDataDir = process.env.AGENTUNE_DATA_DIR;
  const dataDir = createTempDataDir();
  process.env.AGENTUNE_DATA_DIR = dataDir;

  let ffmpegCalls = 0;
  const ffmpegArgs: string[][] = [];
  const preMixer = new CrossfadePreMixer({
    resolveConfig: () => ({
      enabled: true,
      durationSeconds: 5,
      curve: 'lin',
      loudnessNorm: true,
    }),
    spawnProcess: ((_command: string, args: string[]) => {
      ffmpegCalls += 1;
      ffmpegArgs.push(args);
      const fake = createFakeChildProcess();
      setImmediate(() => {
        fs.mkdirSync(path.dirname(args.at(-1)!), { recursive: true });
        fs.writeFileSync(args.at(-1)!, `audio-${ffmpegCalls}`, 'utf8');
        fake.emit('close', 0, null);
      });
      return fake;
    }) as unknown as typeof spawn,
  });

  try {
    const normalizedA = path.join(dataDir, 'track-a.wav');
    const normalizedB = path.join(dataDir, 'track-b.wav');
    fs.writeFileSync(normalizedA, 'A', 'utf8');
    fs.writeFileSync(normalizedB, 'B', 'utf8');

    const first = await preMixer.createCrossfade(
      { videoId: 'a', normalizedPath: normalizedA, duration: 40 },
      { videoId: 'b', normalizedPath: normalizedB, duration: 30 },
    );
    assert.equal(first.skipped, false);
    assert.equal(first.aBodyDuration, 35);
    assert.equal(first.bBodyDuration, 25);
    assert.equal(first.crossfadeDuration, 5);
    assert.equal(fs.existsSync(first.aBodyPath), true);
    assert.equal(fs.existsSync(first.bBodyPath), true);
    assert.equal(fs.existsSync(first.crossfadePath), true);
    assert.equal(
      ffmpegArgs.some((args) => args.some((arg) => arg.includes('acrossfade=d=5:c1=tri:c2=tri'))),
      true,
    );

    const ffmpegCallsAfterFirst = ffmpegCalls;
    const second = await preMixer.createCrossfade(
      { videoId: 'a', normalizedPath: normalizedA, duration: 40 },
      { videoId: 'b', normalizedPath: normalizedB, duration: 30 },
    );
    assert.equal(second.crossfadePath, first.crossfadePath);
    assert.equal(ffmpegCalls, ffmpegCallsAfterFirst);

    const middleBodyPath = await preMixer.createBodySegment(
      { videoId: 'b', normalizedPath: normalizedB, duration: 30 },
      { startSeconds: 5, durationSeconds: 12, keyTag: 'middle' },
    );
    assert.equal(fs.existsSync(middleBodyPath), true);
  } finally {
    if (previousDataDir === undefined) delete process.env.AGENTUNE_DATA_DIR;
    else process.env.AGENTUNE_DATA_DIR = previousDataDir;
    cleanupDataDir(dataDir);
  }
});

test('CrossfadePreMixer skips short tracks and avoids ffmpeg work', async () => {
  const preMixer = new CrossfadePreMixer({
    resolveConfig: () => ({
      enabled: true,
      durationSeconds: 5,
      curve: 'exp',
      loudnessNorm: true,
    }),
    spawnProcess: (() => {
      throw new Error('spawn should not run for short-track skip');
    }) as unknown as typeof spawn,
  });

  const result = await preMixer.createCrossfade(
    { videoId: 'short-a', normalizedPath: '/tmp/a.wav', duration: 9 },
    { videoId: 'long-b', normalizedPath: '/tmp/b.wav', duration: 60 },
  );
  assert.equal(result.skipped, true);
  assert.equal(result.crossfadePath, '');
  assert.equal(shouldSkipCrossfade(9, 60, 5), true);
});

test('mapRuntimeCrossfadeConfigToPreMixerConfig maps runtime duration to durationSeconds', () => {
  const config = mapRuntimeCrossfadeConfigToPreMixerConfig({
    curve: 'log',
    duration: 7,
    enabled: true,
    loudnessNorm: false,
  });

  assert.deepEqual(config, {
    curve: 'log',
    durationSeconds: 7,
    enabled: true,
    loudnessNorm: false,
  });
});

test('CrossfadePreMixer supports cancellation and removes partial outputs', async () => {
  const previousDataDir = process.env.AGENTUNE_DATA_DIR;
  const dataDir = createTempDataDir();
  process.env.AGENTUNE_DATA_DIR = dataDir;

  const preMixer = new CrossfadePreMixer({
    resolveConfig: () => ({
      enabled: true,
      durationSeconds: 5,
      curve: 'exp',
      loudnessNorm: true,
    }),
    spawnProcess: (() => {
      const fake = createFakeChildProcess();
      return fake;
    }) as unknown as typeof spawn,
  });

  try {
    const normalizedA = path.join(dataDir, 'track-a.wav');
    const normalizedB = path.join(dataDir, 'track-b.wav');
    fs.writeFileSync(normalizedA, 'A', 'utf8');
    fs.writeFileSync(normalizedB, 'B', 'utf8');

    const pending = preMixer.createCrossfade(
      { videoId: 'a', normalizedPath: normalizedA, duration: 40 },
      { videoId: 'b', normalizedPath: normalizedB, duration: 40 },
    );
    await new Promise((resolve) => setTimeout(resolve, 5));
    preMixer.cancel();

    await assert.rejects(() => pending, /cancelled/i);
    const crossfadesDir = preMixer.getCrossfadesDir();
    const bodiesDir = preMixer.getBodiesDir();
    const crossfadeFiles = fs.existsSync(crossfadesDir) ? fs.readdirSync(crossfadesDir) : [];
    const bodyFiles = fs.existsSync(bodiesDir) ? fs.readdirSync(bodiesDir) : [];
    assert.equal(crossfadeFiles.length, 0);
    assert.equal(bodyFiles.length, 0);
  } finally {
    if (previousDataDir === undefined) delete process.env.AGENTUNE_DATA_DIR;
    else process.env.AGENTUNE_DATA_DIR = previousDataDir;
    cleanupDataDir(dataDir);
  }
});

test('CrossfadePreMixer cleanup removes cached pair assets', async () => {
  const previousDataDir = process.env.AGENTUNE_DATA_DIR;
  const dataDir = createTempDataDir();
  process.env.AGENTUNE_DATA_DIR = dataDir;

  const preMixer = new CrossfadePreMixer({
    resolveConfig: () => ({
      enabled: true,
      durationSeconds: 4,
      curve: 'log',
      loudnessNorm: true,
    }),
    spawnProcess: ((_command: string, args: string[]) => {
      const fake = createFakeChildProcess();
      setImmediate(() => {
        fs.mkdirSync(path.dirname(args.at(-1)!), { recursive: true });
        fs.writeFileSync(args.at(-1)!, 'segment', 'utf8');
        fake.emit('close', 0, null);
      });
      return fake;
    }) as unknown as typeof spawn,
  });

  try {
    const normalizedA = path.join(dataDir, 'track-a.wav');
    const normalizedB = path.join(dataDir, 'track-b.wav');
    fs.writeFileSync(normalizedA, 'A', 'utf8');
    fs.writeFileSync(normalizedB, 'B', 'utf8');
    const result = await preMixer.createCrossfade(
      { videoId: 'a', normalizedPath: normalizedA, duration: 30 },
      { videoId: 'b', normalizedPath: normalizedB, duration: 30 },
    );
    assert.equal(fs.existsSync(result.crossfadePath), true);
    preMixer.cleanup('a', 'b');
    assert.equal(fs.existsSync(result.crossfadePath), false);
    assert.equal(fs.existsSync(result.aBodyPath), false);
    assert.equal(fs.existsSync(result.bBodyPath), false);
  } finally {
    if (previousDataDir === undefined) delete process.env.AGENTUNE_DATA_DIR;
    else process.env.AGENTUNE_DATA_DIR = previousDataDir;
    cleanupDataDir(dataDir);
  }
});
