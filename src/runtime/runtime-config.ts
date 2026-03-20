import fs from 'fs';
import { getRuntimeConfigPath } from './runtime-data-paths.js';

export interface RuntimeConfig {
  dashboardPort: number;
  daemonPort: number;
}

export const DEFAULT_RUNTIME_CONFIG: RuntimeConfig = {
  dashboardPort: 3737,
  daemonPort: 3747,
};

let runtimeConfigCache: RuntimeConfig | null = null;

export function loadRuntimeConfig(): RuntimeConfig {
  if (runtimeConfigCache) {
    return runtimeConfigCache;
  }

  const configPath = getRuntimeConfigPath();
  if (!fs.existsSync(configPath)) {
    fs.writeFileSync(configPath, `${JSON.stringify(DEFAULT_RUNTIME_CONFIG, null, 2)}\n`, 'utf8');
    runtimeConfigCache = { ...DEFAULT_RUNTIME_CONFIG };
    return runtimeConfigCache;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(configPath, 'utf8'));
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
  };
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
