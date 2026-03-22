import assert from 'node:assert/strict';
import test from 'node:test';
import { collectDoctorReport, type DoctorReportDependencies } from './doctor-report.js';

function createDependencies(
  overrides: Partial<DoctorReportDependencies> = {},
): DoctorReportDependencies {
  return {
    executableExists: () => true,
    fetchHealth: async () => ({ ok: false }),
    getDaemonLogPath: () => 'C:/Users/Admin/.agentune/daemon.log',
    getDataDir: () => 'C:/Users/Admin/.agentune',
    getHistoryDbPath: () => 'C:/Users/Admin/.agentune/history.db',
    getPidFilePath: () => 'C:/Users/Admin/.agentune/daemon.pid',
    getRuntimeConfigPath: () => 'C:/Users/Admin/.agentune/config.json',
    isProcessAlive: () => false,
    loadRuntimeConfig: () => ({
      autoStartDaemon: true,
      daemonPort: 3747,
      dashboardPort: 3737,
      defaultVolume: 80,
      discoverRanking: {
        exploration: 0.35,
        loyalty: 0.65,
        variety: 0.55,
      },
    }),
    nodeVersion: 'v25.7.0',
    readPackageMetadata: () => ({
      description: 'Music Player for Agent',
      engines: { node: '>=20' },
      version: '0.1.1-alpha.3',
    }),
    readPidFile: () => null,
    readVersionLine: (command) => command.includes('mpv') ? 'mpv v0.41.0' : '2026.03.13',
    resolveBundledYtDlpBinary: () => 'C:/repo/node_modules/youtube-dl-exec/bin/yt-dlp.exe',
    resolveCommandFromPath: () => undefined,
    resolveInstalledMpvBinary: () => 'C:/Tools/mpv.exe',
    ...overrides,
  };
}

test('collectDoctorReport keeps advisory warnings non-fatal when required checks pass', async () => {
  const report = await collectDoctorReport(createDependencies());

  assert.equal(report.summary, 'OK');
  assert.equal(report.exitCode, 0);
  assert.deepEqual(
    report.checks
      .filter((check) => check.status === 'WARN')
      .map((check) => check.name),
    ['yt-dlp system', 'status'],
  );
});

test('collectDoctorReport fails when Node.js does not satisfy package engine', async () => {
  const report = await collectDoctorReport(createDependencies({ nodeVersion: 'v18.19.0' }));

  assert.equal(report.summary, 'FAIL');
  assert.equal(report.exitCode, 1);
  assert.equal(report.checks.find((check) => check.name === 'node')?.status, 'FAIL');
});

test('collectDoctorReport fails when runtime config validation throws', async () => {
  const report = await collectDoctorReport(createDependencies({
    loadRuntimeConfig: () => {
      throw new Error('Invalid runtime config: defaultVolume must be an integer between 0 and 100.');
    },
  }));

  assert.equal(report.summary, 'FAIL');
  assert.equal(report.exitCode, 1);
  assert.match(
    report.checks.find((check) => check.name === 'config')?.detail ?? '',
    /defaultVolume must be an integer between 0 and 100/i,
  );
});

test('collectDoctorReport fails when bundled yt-dlp is missing', async () => {
  const report = await collectDoctorReport(createDependencies({
    executableExists: () => false,
  }));

  assert.equal(report.summary, 'FAIL');
  assert.equal(report.exitCode, 1);
  assert.equal(report.checks.find((check) => check.name === 'yt-dlp bundled')?.status, 'FAIL');
});

test('collectDoctorReport reports daemon as healthy when pid and health endpoint are both good', async () => {
  const report = await collectDoctorReport(createDependencies({
    fetchHealth: async () => ({ ok: true, uptime: 42 }),
    isProcessAlive: () => true,
    readPidFile: () => ({
      controlToken: 'doctor-token',
      pid: 321,
      port: 3747,
      started: '2026-03-22T00:00:00.000Z',
    }),
  }));

  assert.equal(report.checks.find((check) => check.section === 'Daemon')?.status, 'OK');
  assert.match(report.checks.find((check) => check.section === 'Daemon')?.detail ?? '', /uptime=42s/);
});

test('collectDoctorReport reports stale daemon pid files as warnings', async () => {
  const report = await collectDoctorReport(createDependencies({
    isProcessAlive: () => false,
    readPidFile: () => ({
      controlToken: 'doctor-token',
      pid: 999,
      port: 3747,
      started: '2026-03-22T00:00:00.000Z',
    }),
  }));

  assert.equal(report.exitCode, 0);
  assert.equal(report.checks.find((check) => check.section === 'Daemon')?.status, 'WARN');
  assert.match(report.checks.find((check) => check.section === 'Daemon')?.detail ?? '', /stale pid file/i);
});
