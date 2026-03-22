import { getDataDir, getDaemonLogPath, getHistoryDbPath, getPidFilePath, getRuntimeConfigPath } from '../runtime/runtime-data-paths.js';
import { loadRuntimeConfig, type RuntimeConfig } from '../runtime/runtime-config.js';
import { readPidFile, type DaemonInfo } from '../daemon/pid-manager.js';
import { readPackageMetadata, type PackageMetadata } from '../package-metadata.js';
import { resolveInstalledMpvBinary } from '../audio/mpv-launch-helpers.js';
import { executableExists, readVersionLine, resolveBundledYtDlpBinary, resolveCommandFromPath } from './doctor-runtime-support.js';

export type DoctorStatus = 'OK' | 'WARN' | 'FAIL';

export interface DoctorCheck {
  detail: string;
  name: string;
  required?: boolean;
  section: 'Runtime' | 'Dependencies' | 'Daemon' | 'Paths';
  status: DoctorStatus;
}

export interface DoctorReport {
  checks: DoctorCheck[];
  exitCode: number;
  summary: 'OK' | 'FAIL';
}

interface HealthCheckResult {
  ok: boolean;
  uptime?: number;
}

export interface DoctorReportDependencies {
  executableExists: (filePath: string) => boolean;
  fetchHealth: (port: number) => Promise<HealthCheckResult>;
  getDaemonLogPath: () => string;
  getDataDir: () => string;
  getHistoryDbPath: () => string;
  getPidFilePath: () => string;
  getRuntimeConfigPath: () => string;
  isProcessAlive: (pid: number) => boolean;
  loadRuntimeConfig: () => RuntimeConfig;
  nodeVersion: string;
  readPackageMetadata: () => PackageMetadata;
  readPidFile: () => DaemonInfo | null;
  readVersionLine: (command: string, args?: string[]) => string;
  resolveBundledYtDlpBinary: () => string;
  resolveCommandFromPath: (command: string) => string | undefined;
  resolveInstalledMpvBinary: () => string | undefined;
}

export async function collectDoctorReport(
  dependencies: DoctorReportDependencies = createDoctorReportDependencies(),
): Promise<DoctorReport> {
  const checks: DoctorCheck[] = [];

  checks.push(checkNodeRuntime(dependencies));
  checks.push(checkRuntimeConfig(dependencies));
  checks.push(...createPathChecks(dependencies));
  checks.push(checkMpvDependency(dependencies));
  checks.push(checkBundledYtDlpDependency(dependencies));
  checks.push(checkSystemYtDlpDependency(dependencies));
  checks.push(await checkDaemonState(dependencies));

  const exitCode = checks.some((check) => check.required && check.status === 'FAIL') ? 1 : 0;
  return { checks, exitCode, summary: exitCode === 0 ? 'OK' : 'FAIL' };
}

export function createDoctorReportDependencies(): DoctorReportDependencies {
  return {
    executableExists,
    fetchHealth: async (port) => {
      try {
        const response = await fetch(`http://127.0.0.1:${port}/health`, {
          signal: AbortSignal.timeout(2_000),
        });
        if (!response.ok) {
          return { ok: false };
        }

        const payload = await response.json() as { uptime?: unknown };
        return {
          ok: true,
          uptime: typeof payload.uptime === 'number' ? payload.uptime : undefined,
        };
      } catch {
        return { ok: false };
      }
    },
    getDaemonLogPath,
    getDataDir,
    getHistoryDbPath,
    getPidFilePath,
    getRuntimeConfigPath,
    isProcessAlive: (pid) => {
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    },
    loadRuntimeConfig,
    nodeVersion: process.version,
    readPackageMetadata,
    readPidFile,
    readVersionLine,
    resolveBundledYtDlpBinary: () => resolveBundledYtDlpBinary(process.env),
    resolveCommandFromPath,
    resolveInstalledMpvBinary,
  };
}

function checkNodeRuntime(dependencies: DoctorReportDependencies): DoctorCheck {
  const requiredRange = dependencies.readPackageMetadata().engines?.node;
  const minimumMajor = requiredRange ? parseMinimumNodeMajor(requiredRange) : null;
  const actualMajor = parseVersionMajor(dependencies.nodeVersion);
  if (!requiredRange || minimumMajor === null || actualMajor === null) {
    return createCheck('Runtime', 'node', 'FAIL', `Could not validate Node.js against package.json engine "${requiredRange ?? 'missing'}"`, true);
  }

  if (actualMajor < minimumMajor) {
    return createCheck('Runtime', 'node', 'FAIL', `Found ${dependencies.nodeVersion}; requires ${requiredRange}`, true);
  }

  return createCheck('Runtime', 'node', 'OK', `Found ${dependencies.nodeVersion}; satisfies ${requiredRange}`, true);
}

function checkRuntimeConfig(dependencies: DoctorReportDependencies): DoctorCheck {
  try {
    const config = dependencies.loadRuntimeConfig();
    return createCheck(
      'Runtime',
      'config',
      'OK',
      `${dependencies.getRuntimeConfigPath()} (dashboard=${config.dashboardPort}, daemon=${config.daemonPort}, volume=${config.defaultVolume}, autoStart=${config.autoStartDaemon})`,
      true,
    );
  } catch (error) {
    return createCheck('Runtime', 'config', 'FAIL', (error as Error).message, true);
  }
}

function createPathChecks(dependencies: DoctorReportDependencies): DoctorCheck[] {
  return [
    createCheck('Paths', 'dataDir', 'OK', dependencies.getDataDir()),
    createCheck('Paths', 'configPath', 'OK', dependencies.getRuntimeConfigPath()),
    createCheck('Paths', 'historyDbPath', 'OK', dependencies.getHistoryDbPath()),
    createCheck('Paths', 'pidFilePath', 'OK', dependencies.getPidFilePath()),
    createCheck('Paths', 'daemonLogPath', 'OK', dependencies.getDaemonLogPath()),
  ];
}

function checkMpvDependency(dependencies: DoctorReportDependencies): DoctorCheck {
  const binaryPath = dependencies.resolveInstalledMpvBinary();
  if (!binaryPath) {
    return createCheck('Dependencies', 'mpv', 'FAIL', 'Not found in PATH', true);
  }

  return createVersionedCheck(dependencies, 'Dependencies', 'mpv', binaryPath, true);
}

function checkBundledYtDlpDependency(dependencies: DoctorReportDependencies): DoctorCheck {
  const binaryPath = dependencies.resolveBundledYtDlpBinary();
  if (!dependencies.executableExists(binaryPath)) {
    return createCheck('Dependencies', 'yt-dlp bundled', 'FAIL', `Missing bundled binary at ${binaryPath}`, true);
  }

  return createVersionedCheck(dependencies, 'Dependencies', 'yt-dlp bundled', binaryPath, true);
}

function checkSystemYtDlpDependency(dependencies: DoctorReportDependencies): DoctorCheck {
  const binaryPath = dependencies.resolveCommandFromPath('yt-dlp');
  if (!binaryPath) {
    return createCheck('Dependencies', 'yt-dlp system', 'WARN', 'Not found in PATH');
  }

  return createVersionedCheck(dependencies, 'Dependencies', 'yt-dlp system', binaryPath, false);
}

async function checkDaemonState(dependencies: DoctorReportDependencies): Promise<DoctorCheck> {
  const info = dependencies.readPidFile();
  if (!info) {
    return createCheck('Daemon', 'status', 'WARN', 'Daemon is not running');
  }
  if (!dependencies.isProcessAlive(info.pid)) {
    return createCheck('Daemon', 'status', 'WARN', `Stale PID file for pid=${info.pid}, port=${info.port}`);
  }

  const health = await dependencies.fetchHealth(info.port);
  if (!health.ok) {
    return createCheck('Daemon', 'status', 'WARN', `pid=${info.pid}, port=${info.port} is running but /health did not respond`);
  }

  const uptime = typeof health.uptime === 'number' ? `${Math.floor(health.uptime)}s` : 'unknown';
  return createCheck('Daemon', 'status', 'OK', `pid=${info.pid}, port=${info.port}, uptime=${uptime}`);
}

function createVersionedCheck(
  dependencies: DoctorReportDependencies,
  section: DoctorCheck['section'],
  name: string,
  binaryPath: string,
  required: boolean,
): DoctorCheck {
  try {
    const version = dependencies.readVersionLine(binaryPath);
    return createCheck(section, name, 'OK', `${version} (${binaryPath})`, required);
  } catch (error) {
    return createCheck(section, name, required ? 'FAIL' : 'WARN', `${(error as Error).message} (${binaryPath})`, required);
  }
}

function createCheck(
  section: DoctorCheck['section'],
  name: string,
  status: DoctorStatus,
  detail: string,
  required = false,
): DoctorCheck {
  return { detail, name, required, section, status };
}

function parseMinimumNodeMajor(engineRange: string): number | null {
  const match = engineRange.match(/>=\s*(\d+)/u);
  return match ? Number(match[1]) : null;
}

function parseVersionMajor(version: string): number | null {
  const match = version.match(/^v?(\d+)/u);
  return match ? Number(match[1]) : null;
}
