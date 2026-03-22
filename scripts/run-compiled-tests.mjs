import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const ROOT_DIR = fileURLToPath(new URL('..', import.meta.url));
const DIST_DIR = path.join(ROOT_DIR, 'dist');

function collectCompiledTestFiles(directoryPath) {
  const testFiles = [];

  for (const entry of readdirSync(directoryPath, { withFileTypes: true })) {
    const entryPath = path.join(directoryPath, entry.name);

    if (entry.isDirectory()) {
      testFiles.push(...collectCompiledTestFiles(entryPath));
      continue;
    }

    if (entry.isFile() && entry.name.endsWith('.test.js')) {
      testFiles.push(entryPath);
    }
  }

  return testFiles;
}

if (!existsSync(DIST_DIR)) {
  console.error(`[agentune] Compiled test directory not found: ${DIST_DIR}`);
  process.exit(1);
}

const compiledTestFiles = collectCompiledTestFiles(DIST_DIR).sort((left, right) => {
  return left.localeCompare(right);
});

if (compiledTestFiles.length === 0) {
  console.error(`[agentune] No compiled test files found under ${DIST_DIR}`);
  process.exit(1);
}

const result = spawnSync(process.execPath, ['--test', ...compiledTestFiles], {
  stdio: 'inherit',
});

if (result.error) {
  throw result.error;
}

if (typeof result.status === 'number') {
  process.exit(result.status);
}

process.exit(1);
