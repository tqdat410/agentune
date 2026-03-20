import test from 'node:test';
import assert from 'node:assert/strict';
import { firstResolvedExecutableFromWhere, shouldHideWindowsConsoleForCommand } from './node-mpv-bootstrap.js';

test('firstResolvedExecutableFromWhere returns the first non-empty line', () => {
  const output = '\r\nC:\\Users\\Admin\\scoop\\apps\\mpv\\current\\mpv.exe\r\nC:\\Other\\mpv.exe\r\n';
  assert.equal(firstResolvedExecutableFromWhere(output), 'C:\\Users\\Admin\\scoop\\apps\\mpv\\current\\mpv.exe');
});

test('shouldHideWindowsConsoleForCommand matches mpv launch targets', () => {
  assert.equal(shouldHideWindowsConsoleForCommand('mpv'), true);
  assert.equal(shouldHideWindowsConsoleForCommand('"C:\\Tools\\mpv.exe"'), true);
  assert.equal(shouldHideWindowsConsoleForCommand('C:\\Tools\\mpv.com'), true);
  assert.equal(shouldHideWindowsConsoleForCommand('node'), false);
});
