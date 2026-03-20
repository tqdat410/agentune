import fs from 'fs';
import { getRuntimeConfigPath } from './runtime-data-paths.js';

export interface DiscoverRankingConfig {
  exploration: number;
  variety: number;
  loyalty: number;
}

export interface RuntimeConfig {
  dashboardPort: number;
  daemonPort: number;
  defaultVolume: number;
  autoStartDaemon: boolean;
  discoverRanking: DiscoverRankingConfig;
}

export const DEFAULT_DISCOVER_RANKING_CONFIG: DiscoverRankingConfig = {
  exploration: 0.35,
  variety: 0.55,
  loyalty: 0.65,
};

export const DEFAULT_RUNTIME_CONFIG: RuntimeConfig = {
  dashboardPort: 3737,
  daemonPort: 3747,
  defaultVolume: 80,
  autoStartDaemon: true,
  discoverRanking: { ...DEFAULT_DISCOVER_RANKING_CONFIG },
};

let runtimeConfigCache: RuntimeConfig | null = null;

export function loadRuntimeConfig(): RuntimeConfig {
  if (runtimeConfigCache) {
    return runtimeConfigCache;
  }

  const configPath = getRuntimeConfigPath();
  if (!fs.existsSync(configPath)) {
    writeRuntimeConfig(configPath, DEFAULT_RUNTIME_CONFIG);
    runtimeConfigCache = { ...DEFAULT_RUNTIME_CONFIG };
    return runtimeConfigCache;
  }

  const rawConfig = fs.readFileSync(configPath, 'utf8');
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawConfig);
  } catch (error) {
    throw new Error(`Invalid runtime config at ${configPath}: ${(error as Error).message}`);
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`Invalid runtime config at ${configPath}: expected a JSON object.`);
  }

  const config = parsed as Partial<Record<keyof RuntimeConfig, unknown>>;
  runtimeConfigCache = {
    dashboardPort: validatePort(config.dashboardPort ?? DEFAULT_RUNTIME_CONFIG.dashboardPort, 'dashboardPort'),
    daemonPort: validatePort(config.daemonPort ?? DEFAULT_RUNTIME_CONFIG.daemonPort, 'daemonPort'),
    defaultVolume: validateVolume(config.defaultVolume ?? DEFAULT_RUNTIME_CONFIG.defaultVolume, 'defaultVolume'),
    autoStartDaemon: validateBoolean(
      config.autoStartDaemon ?? DEFAULT_RUNTIME_CONFIG.autoStartDaemon,
      'autoStartDaemon',
    ),
    discoverRanking: validateDiscoverRanking(config.discoverRanking),
  };

  if (shouldWriteRuntimeConfig(rawConfig, runtimeConfigCache)) {
    writeRuntimeConfig(configPath, runtimeConfigCache);
  }
  return runtimeConfigCache;
}

export function resetRuntimeConfigCache(): void {
  runtimeConfigCache = null;
}

function validatePort(value: unknown, key: keyof RuntimeConfig): number {
  if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > 65535) {
    throw new Error(`Invalid runtime config: ${key} must be an integer between 1 and 65535.`);
  }
  return value as number;
}

function validateVolume(value: unknown, key: 'defaultVolume'): number {
  if (!Number.isInteger(value) || (value as number) < 0 || (value as number) > 100) {
    throw new Error(`Invalid runtime config: ${key} must be an integer between 0 and 100.`);
  }
  return value as number;
}

function validateBoolean(value: unknown, key: 'autoStartDaemon'): boolean {
  if (typeof value !== 'boolean') {
    throw new Error(`Invalid runtime config: ${key} must be a boolean.`);
  }
  return value;
}

function validateDiscoverRanking(value: unknown): DiscoverRankingConfig {
  if (value === undefined) {
    return { ...DEFAULT_DISCOVER_RANKING_CONFIG };
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid runtime config: discoverRanking must be an object.');
  }

  const ranking = value as Partial<Record<keyof DiscoverRankingConfig, unknown>>;
  return {
    exploration: validateUnitInterval(
      ranking.exploration ?? DEFAULT_DISCOVER_RANKING_CONFIG.exploration,
      'discoverRanking.exploration',
    ),
    variety: validateUnitInterval(
      ranking.variety ?? DEFAULT_DISCOVER_RANKING_CONFIG.variety,
      'discoverRanking.variety',
    ),
    loyalty: validateUnitInterval(
      ranking.loyalty ?? DEFAULT_DISCOVER_RANKING_CONFIG.loyalty,
      'discoverRanking.loyalty',
    ),
  };
}

function validateUnitInterval(value: unknown, key: string): number {
  if (typeof value !== 'number' || Number.isNaN(value) || value < 0 || value > 1) {
    throw new Error(`Invalid runtime config: ${key} must be a number between 0 and 1.`);
  }
  return value;
}

function writeRuntimeConfig(configPath: string, config: RuntimeConfig): void {
  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
}

function shouldWriteRuntimeConfig(rawConfig: string, config: RuntimeConfig): boolean {
  return rawConfig !== `${JSON.stringify(config, null, 2)}\n`;
}
