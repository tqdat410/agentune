import process from 'node:process';
import { NPM, ensure, run, runText } from './publish-utils.mjs';

const mode = process.argv[2];
const args = process.argv.slice(3);
const ALLOWED_BUMPS = {
  alpha: new Set(['prerelease', 'prepatch', 'preminor', 'premajor']),
  stable: new Set(['patch', 'minor', 'major']),
};

function parseBump(argv) {
  const bumpFlagIndex = argv.indexOf('--bump');
  ensure(bumpFlagIndex >= 0, 'Release command requires --bump <value>.');
  const bump = argv[bumpFlagIndex + 1];
  ensure(Boolean(bump), 'Release command requires --bump <value>.');
  return bump;
}

function getBranchName() {
  return runText('git', ['branch', '--show-current']);
}

function ensureRemoteBranchIsSynced(branch) {
  run('git', ['fetch', 'origin', '--tags']);

  try {
    runText('git', ['rev-parse', '--verify', `origin/${branch}`]);
  } catch {
    throw new Error(`Remote branch origin/${branch} does not exist. Push the branch before releasing.`);
  }

  const [behindText, aheadText] = runText('git', ['rev-list', '--left-right', '--count', `origin/${branch}...HEAD`])
    .split(/\s+/u);
  const behind = Number(behindText);
  const ahead = Number(aheadText);

  ensure(Number.isFinite(behind) && Number.isFinite(ahead), 'Could not determine branch sync status.');
  ensure(
    behind === 0 && ahead === 0,
    `Branch ${branch} must match origin/${branch} before release (behind=${behind}, ahead=${ahead}).`,
  );
}

function bumpVersion(currentMode, bump) {
  const versionArgs = ['version', bump];

  if (currentMode === 'alpha') {
    versionArgs.push('--preid', 'alpha');
  }

  versionArgs.push('--message', 'chore(release): %s');
  const versionTag = runText(NPM, versionArgs).split(/\r?\n/u).filter(Boolean).at(-1);

  ensure(Boolean(versionTag) && versionTag.startsWith('v'), 'npm version did not return a git tag.');
  return { tag: versionTag, version: versionTag.slice(1) };
}

function publishRelease(currentMode) {
  const publishArgs = ['publish', '--access', 'public'];
  if (currentMode === 'alpha') {
    publishArgs.splice(1, 0, '--tag', 'alpha');
  }

  run(NPM, publishArgs, { env: { AGENTUNE_RELEASE_MODE: currentMode } });
}

const bump = parseBump(args);
ensure(mode in ALLOWED_BUMPS, 'Release mode must be "alpha" or "stable".');
ensure(ALLOWED_BUMPS[mode].has(bump), `Unsupported ${mode} bump "${bump}".`);

const releaseState = {
  branch: '',
  mode,
  bump,
  stage: 'initialization',
  tag: '',
};

try {
  releaseState.stage = 'npm login check';
  runText(NPM, ['whoami']);

  releaseState.stage = 'git cleanliness check';
  ensure(runText('git', ['status', '--porcelain']) === '', 'Git working tree must be clean before release.');

  releaseState.stage = 'branch policy check';
  releaseState.branch = getBranchName();
  if (mode === 'stable') {
    ensure(releaseState.branch === 'main', 'Stable releases are only allowed from main.');
  }
  ensureRemoteBranchIsSynced(releaseState.branch);

  releaseState.stage = 'publish verification';
  run(NPM, ['run', 'verify:publish']);

  releaseState.stage = 'version bump';
  const { tag, version } = bumpVersion(mode, bump);
  releaseState.tag = tag;
  console.error(`[agentune] Prepared release ${version}.`);

  releaseState.stage = 'git push';
  run('git', ['push', 'origin', `HEAD:${releaseState.branch}`]);
  run('git', ['push', 'origin', releaseState.tag]);

  releaseState.stage = 'npm publish';
  publishRelease(mode);

  console.error(
    `[agentune] Release ${releaseState.tag} published to npm dist-tag ${mode === 'alpha' ? 'alpha' : 'latest'}.`,
  );
} catch (error) {
  console.error(`[agentune] Release failed during ${releaseState.stage}: ${(error).message}`);

  if (releaseState.tag) {
    console.error('[agentune] Recovery notes:');

    if (releaseState.stage === 'version bump') {
      console.error(`- Local release commit/tag ${releaseState.tag} may already exist.`);
      console.error('- If you want to retry cleanly, inspect git log/tag state before creating another version.');
    } else if (releaseState.stage === 'git push') {
      console.error(`- Local release tag ${releaseState.tag} exists, but remote push may be partial.`);
      console.error('- Check origin branch/tag state before retrying the release command.');
    } else {
      console.error(`- Release tag ${releaseState.tag} was created and may already be on origin.`);
      console.error(`- Fix the publish issue, then retry npm publish for ${releaseState.tag} without bumping again.`);
    }
  }

  process.exit(1);
}
