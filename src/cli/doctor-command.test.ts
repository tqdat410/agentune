import assert from 'node:assert/strict';
import test from 'node:test';
import { renderDoctorReport, runDoctor } from './doctor-command.js';
import type { DoctorReport } from './doctor-report.js';

const sampleReport: DoctorReport = {
  checks: [
    { detail: 'Found v25.7.0; satisfies >=20', name: 'node', required: true, section: 'Runtime', status: 'OK' },
    { detail: 'Missing bundled binary', name: 'yt-dlp bundled', required: true, section: 'Dependencies', status: 'FAIL' },
    { detail: 'Daemon is not running', name: 'status', section: 'Daemon', status: 'WARN' },
    { detail: 'C:/Users/Admin/.agentune', name: 'dataDir', section: 'Paths', status: 'OK' },
  ],
  exitCode: 1,
  summary: 'FAIL',
};

test('renderDoctorReport prints sections in stable order', () => {
  const lines = renderDoctorReport(sampleReport);

  assert.deepEqual(lines, [
    '[agentune] Doctor summary: FAIL',
    '[agentune] Runtime',
    '[agentune]   OK   node: Found v25.7.0; satisfies >=20',
    '[agentune] Dependencies',
    '[agentune]   FAIL yt-dlp bundled: Missing bundled binary',
    '[agentune] Daemon',
    '[agentune]   WARN status: Daemon is not running',
    '[agentune] Paths',
    '[agentune]   OK   dataDir: C:/Users/Admin/.agentune',
  ]);
});

test('runDoctor logs the rendered report and applies the exit code', async () => {
  const logs: string[] = [];
  let exitCode = 0;

  const result = await runDoctor({
    collectDoctorReport: async () => sampleReport,
    log: (message) => {
      logs.push(message);
    },
    setExitCode: (code) => {
      exitCode = code;
    },
  });

  assert.equal(result, 1);
  assert.equal(exitCode, 1);
  assert.deepEqual(logs, renderDoctorReport(sampleReport));
});
