import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import test from 'node:test';
import { loadRuntimeConfig, resetRuntimeConfigCache } from './runtime-config.js';

function createTempDataDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sbotify-runtime-config-'));
}

function cleanupDataDir(dataDir: string): void {
  try {
    fs.rmSync(dataDir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors in tests.
  }
}

test('loadRuntimeConfig creates default config when missing', () => {
  const previous = process.env.SBOTIFY_DATA_DIR;
  const dataDir = createTempDataDir();
  process.env.SBOTIFY_DATA_DIR = dataDir;
  resetRuntimeConfigCache();

  try {
    const config = loadRuntimeConfig();
    const configPath = path.join(dataDir, 'config.json');
    assert.deepEqual(config, { dashboardPort: 3737, daemonPort: 3747 });
    assert.equal(fs.existsSync(configPath), true);
    assert.deepEqual(JSON.parse(fs.readFileSync(configPath, 'utf8')), config);
  } finally {
    if (previous === undefined) delete process.env.SBOTIFY_DATA_DIR;
    else process.env.SBOTIFY_DATA_DIR = previous;
    resetRuntimeConfigCache();
    cleanupDataDir(dataDir);
  }
});

test('loadRuntimeConfig rejects invalid port values', () => {
  const previous = process.env.SBOTIFY_DATA_DIR;
  const dataDir = createTempDataDir();
  process.env.SBOTIFY_DATA_DIR = dataDir;
  fs.writeFileSync(path.join(dataDir, 'config.json'), JSON.stringify({ dashboardPort: 0, daemonPort: 3747 }));
  resetRuntimeConfigCache();

  try {
    assert.throws(() => loadRuntimeConfig(), /dashboardPort must be an integer between 1 and 65535/i);
  } finally {
    if (previous === undefined) delete process.env.SBOTIFY_DATA_DIR;
    else process.env.SBOTIFY_DATA_DIR = previous;
    resetRuntimeConfigCache();
    cleanupDataDir(dataDir);
  }
});
