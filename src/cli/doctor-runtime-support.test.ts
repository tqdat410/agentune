import assert from 'node:assert/strict';
import test from 'node:test';
import { firstResolvedExecutableLine, readVersionLine } from './doctor-runtime-support.js';

test('firstResolvedExecutableLine returns the first non-empty line', () => {
  const output = '\r\nC:\\Tools\\yt-dlp.exe\r\nC:\\Backup\\yt-dlp.exe\r\n';
  assert.equal(firstResolvedExecutableLine(output), 'C:\\Tools\\yt-dlp.exe');
});

test('readVersionLine aborts hung subprocesses', () => {
  assert.throws(
    () => readVersionLine(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { timeoutMs: 50 }),
    /timed out/i,
  );
});
