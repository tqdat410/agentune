import fs from 'fs';
import os from 'os';
import path from 'path';

const DATA_DIR_ENV = 'SBOTIFY_DATA_DIR';
const DEFAULT_DATA_DIR_NAME = '.sbotify';

export function getDataDir(): string {
  return process.env[DATA_DIR_ENV] || path.join(os.homedir(), DEFAULT_DATA_DIR_NAME);
}

export function ensureDataDir(): string {
  const dataDir = getDataDir();
  fs.mkdirSync(dataDir, { recursive: true });
  return dataDir;
}

export function getRuntimeConfigPath(): string {
  return path.join(ensureDataDir(), 'config.json');
}

export function getHistoryDbPath(): string {
  return path.join(ensureDataDir(), 'history.db');
}

export function getDaemonLogPath(): string {
  return path.join(ensureDataDir(), 'daemon.log');
}

export function getPidFilePath(): string {
  return path.join(ensureDataDir(), 'daemon.pid');
}
