import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

export const ROOT_DIR = process.cwd();
export const NPM = process.platform === 'win32' ? 'npm.cmd' : 'npm';

export function ensure(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

export function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

export function readPackageJson(cwd = ROOT_DIR) {
  return readJson(path.join(cwd, 'package.json'));
}

function resolveCommand(command, args) {
  if (process.platform === 'win32' && /\.cmd$/iu.test(command)) {
    return {
      command: 'cmd.exe',
      args: ['/d', '/s', '/c', command, ...args],
    };
  }

  return { command, args };
}

export function run(command, args, options = {}) {
  const resolved = resolveCommand(command, args);
  execFileSync(resolved.command, resolved.args, {
    cwd: options.cwd ?? ROOT_DIR,
    env: { ...process.env, ...(options.env ?? {}) },
    stdio: 'inherit',
  });
}

export function runText(command, args, options = {}) {
  try {
    const resolved = resolveCommand(command, args);
    return execFileSync(resolved.command, resolved.args, {
      cwd: options.cwd ?? ROOT_DIR,
      env: { ...process.env, ...(options.env ?? {}) },
      encoding: 'utf8',
    }).trim();
  } catch (error) {
    const stdout = error.stdout ? String(error.stdout).trim() : '';
    const stderr = error.stderr ? String(error.stderr).trim() : '';
    const details = [stdout, stderr].filter(Boolean).join('\n');
    throw new Error(details ? `${error.message}\n${details}` : error.message);
  }
}

export function runResult(command, args, options = {}) {
  const resolved = resolveCommand(command, args);
  return spawnSync(resolved.command, resolved.args, {
    cwd: options.cwd ?? ROOT_DIR,
    env: { ...process.env, ...(options.env ?? {}) },
    encoding: 'utf8',
    timeout: options.timeout ?? 0,
  });
}

export function parseJsonOutput(output) {
  const arrayStart = output.indexOf('[');
  const objectStart = output.indexOf('{');
  const startIndexes = [arrayStart, objectStart].filter((index) => index >= 0);
  ensure(startIndexes.length > 0, `Expected JSON output but received:\n${output}`);
  const start = Math.min(...startIndexes);
  const end = Math.max(output.lastIndexOf(']'), output.lastIndexOf('}'));
  ensure(end >= start, `Expected JSON output but received:\n${output}`);
  return JSON.parse(output.slice(start, end + 1));
}

export function removeDir(directoryPath) {
  fs.rmSync(directoryPath, { recursive: true, force: true });
}
