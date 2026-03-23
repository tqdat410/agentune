import fs from 'fs';
import { getRuntimeConfigPath } from './runtime-data-paths.js';

export interface DiscoverRankingConfig {
  exploration: number;
  variety: number;
  loyalty: number;
}

export type CrossfadeCurve = 'exp' | 'log' | 'lin';

export interface CrossfadeConfig {
  enabled: boolean;
  duration: number;
  curve: CrossfadeCurve;
  loudnessNorm: boolean;
  cacheMaxMB: number;
}

export interface RuntimeConfig {
  dashboardPort: number;
  daemonPort: number;
  defaultVolume: number;
  autoStartDaemon: boolean;
  discoverRanking: DiscoverRankingConfig;
  // Optional for backwards compatibility in typed tests/mocks.
  crossfade?: CrossfadeConfig;
}

export const DEFAULT_DISCOVER_RANKING_CONFIG: DiscoverRankingConfig = {
  exploration: 0.35,
  variety: 0.55,
  loyalty: 0.65,
};

export const DEFAULT_CROSSFADE_CONFIG: CrossfadeConfig = {
  enabled: true,
  duration: 5,
  curve: 'exp',
  loudnessNorm: true,
  cacheMaxMB: 2_000,
};

export const DEFAULT_RUNTIME_CONFIG: RuntimeConfig = {
  dashboardPort: 3737,
  daemonPort: 3747,
  defaultVolume: 80,
  autoStartDaemon: true,
  discoverRanking: { ...DEFAULT_DISCOVER_RANKING_CONFIG },
  crossfade: { ...DEFAULT_CROSSFADE_CONFIG },
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
    crossfade: validateCrossfadeConfig(config.crossfade),
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

function validateBoolean(value: unknown, key: string): boolean {
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

function validateCrossfadeConfig(value: unknown): CrossfadeConfig {
  if (value === undefined) {
    return { ...DEFAULT_CROSSFADE_CONFIG };
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid runtime config: crossfade must be an object.');
  }

  const crossfade = value as Partial<Record<keyof CrossfadeConfig, unknown>>;
  const curve = crossfade.curve ?? DEFAULT_CROSSFADE_CONFIG.curve;
  if (curve !== 'exp' && curve !== 'log' && curve !== 'lin') {
    throw new Error('Invalid runtime config: crossfade.curve must be one of exp, log, lin.');
  }

  return {
    enabled: validateBoolean(crossfade.enabled ?? DEFAULT_CROSSFADE_CONFIG.enabled, 'crossfade.enabled'),
    duration: validateIntegerInRange(crossfade.duration ?? DEFAULT_CROSSFADE_CONFIG.duration, 1, 12, 'crossfade.duration'),
    curve,
    loudnessNorm: validateBoolean(
      crossfade.loudnessNorm ?? DEFAULT_CROSSFADE_CONFIG.loudnessNorm,
      'crossfade.loudnessNorm',
    ),
    cacheMaxMB: validateIntegerInRange(
      crossfade.cacheMaxMB ?? DEFAULT_CROSSFADE_CONFIG.cacheMaxMB,
      100,
      10_000,
      'crossfade.cacheMaxMB',
    ),
  };
}

function validateIntegerInRange(value: unknown, min: number, max: number, key: string): number {
  if (!Number.isInteger(value) || (value as number) < min || (value as number) > max) {
    throw new Error(`Invalid runtime config: ${key} must be an integer between ${min} and ${max}.`);
  }
  return value as number;
}

function writeRuntimeConfig(configPath: string, config: RuntimeConfig): void {
  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
}

function shouldWriteRuntimeConfig(rawConfig: string, config: RuntimeConfig): boolean {
  return rawConfig !== `${JSON.stringify(config, null, 2)}\n`;
}
