import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import test from 'node:test';
import { loadRuntimeConfig, resetRuntimeConfigCache } from './runtime-config.js';

function createTempDataDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'agentune-runtime-config-'));
}

function cleanupDataDir(dataDir: string): void {
  try {
    fs.rmSync(dataDir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors in tests.
  }
}

test('loadRuntimeConfig creates default config when missing', () => {
  const previous = process.env.AGENTUNE_DATA_DIR;
  const dataDir = createTempDataDir();
  process.env.AGENTUNE_DATA_DIR = dataDir;
  resetRuntimeConfigCache();

  try {
    const config = loadRuntimeConfig();
    const configPath = path.join(dataDir, 'config.json');
    assert.deepEqual(config, {
      dashboardPort: 3737,
      daemonPort: 3747,
      defaultVolume: 80,
      autoStartDaemon: true,
      discoverRanking: { exploration: 0.35, variety: 0.55, loyalty: 0.65 },
      crossfade: {
        enabled: true,
        duration: 5,
        curve: 'exp',
        loudnessNorm: true,
        cacheMaxMB: 2000,
      },
    });
    assert.equal(fs.existsSync(configPath), true);
    assert.deepEqual(JSON.parse(fs.readFileSync(configPath, 'utf8')), config);
  } finally {
    if (previous === undefined) delete process.env.AGENTUNE_DATA_DIR;
    else process.env.AGENTUNE_DATA_DIR = previous;
    resetRuntimeConfigCache();
    cleanupDataDir(dataDir);
  }
});

test('loadRuntimeConfig rejects invalid port values', () => {
  const previous = process.env.AGENTUNE_DATA_DIR;
  const dataDir = createTempDataDir();
  process.env.AGENTUNE_DATA_DIR = dataDir;
  fs.writeFileSync(path.join(dataDir, 'config.json'), JSON.stringify({ dashboardPort: 0, daemonPort: 3747 }));
  resetRuntimeConfigCache();

  try {
    assert.throws(() => loadRuntimeConfig(), /dashboardPort must be an integer between 1 and 65535/i);
  } finally {
    if (previous === undefined) delete process.env.AGENTUNE_DATA_DIR;
    else process.env.AGENTUNE_DATA_DIR = previous;
    resetRuntimeConfigCache();
    cleanupDataDir(dataDir);
  }
});

test('loadRuntimeConfig rejects invalid auto-start values', () => {
  const previous = process.env.AGENTUNE_DATA_DIR;
  const dataDir = createTempDataDir();
  process.env.AGENTUNE_DATA_DIR = dataDir;
  fs.writeFileSync(path.join(dataDir, 'config.json'), JSON.stringify({
    dashboardPort: 3737,
    daemonPort: 3747,
    autoStartDaemon: 'yes',
  }));
  resetRuntimeConfigCache();

  try {
    assert.throws(() => loadRuntimeConfig(), /autoStartDaemon must be a boolean/i);
  } finally {
    if (previous === undefined) delete process.env.AGENTUNE_DATA_DIR;
    else process.env.AGENTUNE_DATA_DIR = previous;
    resetRuntimeConfigCache();
    cleanupDataDir(dataDir);
  }
});

test('loadRuntimeConfig merges missing config fields, writes them back, and rejects invalid ranking values', () => {
  const previous = process.env.AGENTUNE_DATA_DIR;
  const dataDir = createTempDataDir();
  const configPath = path.join(dataDir, 'config.json');
  process.env.AGENTUNE_DATA_DIR = dataDir;
  fs.writeFileSync(configPath, JSON.stringify({
    dashboardPort: 3838,
    daemonPort: 3848,
    discoverRanking: { exploration: 2 },
  }));
  resetRuntimeConfigCache();

  try {
    assert.throws(() => loadRuntimeConfig(), /discoverRanking\.exploration must be a number between 0 and 1/i);
    fs.writeFileSync(configPath, JSON.stringify({
      dashboardPort: 3838,
      daemonPort: 3848,
      defaultVolume: 60,
      discoverRanking: { variety: 0.75 },
    }));
    resetRuntimeConfigCache();

    const config = loadRuntimeConfig();
    assert.deepEqual(config, {
      dashboardPort: 3838,
      daemonPort: 3848,
      defaultVolume: 60,
      autoStartDaemon: true,
      discoverRanking: { exploration: 0.35, variety: 0.75, loyalty: 0.65 },
      crossfade: {
        enabled: true,
        duration: 5,
        curve: 'exp',
        loudnessNorm: true,
        cacheMaxMB: 2000,
      },
    });
    assert.deepEqual(JSON.parse(fs.readFileSync(configPath, 'utf8')), config);
  } finally {
    if (previous === undefined) delete process.env.AGENTUNE_DATA_DIR;
    else process.env.AGENTUNE_DATA_DIR = previous;
    resetRuntimeConfigCache();
    cleanupDataDir(dataDir);
  }
});

test('loadRuntimeConfig validates and merges crossfade config', () => {
  const previous = process.env.AGENTUNE_DATA_DIR;
  const dataDir = createTempDataDir();
  const configPath = path.join(dataDir, 'config.json');
  process.env.AGENTUNE_DATA_DIR = dataDir;
  fs.writeFileSync(configPath, JSON.stringify({
    dashboardPort: 3737,
    daemonPort: 3747,
    crossfade: { duration: 0 },
  }));
  resetRuntimeConfigCache();

  try {
    assert.throws(() => loadRuntimeConfig(), /crossfade\.duration must be an integer between 1 and 12/i);

    fs.writeFileSync(configPath, JSON.stringify({
      dashboardPort: 3737,
      daemonPort: 3747,
      crossfade: { curve: 'lin', duration: 8 },
    }));
    resetRuntimeConfigCache();

    const config = loadRuntimeConfig();
    assert.deepEqual(config.crossfade, {
      enabled: true,
      duration: 8,
      curve: 'lin',
      loudnessNorm: true,
      cacheMaxMB: 2000,
    });
    assert.equal(JSON.parse(fs.readFileSync(configPath, 'utf8')).crossfade.cacheMaxMB, 2000);
  } finally {
    if (previous === undefined) delete process.env.AGENTUNE_DATA_DIR;
    else process.env.AGENTUNE_DATA_DIR = previous;
    resetRuntimeConfigCache();
    cleanupDataDir(dataDir);
  }
});
