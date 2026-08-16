import { execFileSync, spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { createCommandInvocation } from './command-invocation.mjs';
import { createProfileManifest, validateProfileManifest } from './profile-manifest.mjs';
import { createSupervisor } from './supervisor-runtime.mjs';

export function createPromotionPlan({ hasLiveDatabase }) {
  return [
    'build',
    ...(hasLiveDatabase ? ['backup-live', 'verify-backup', 'dry-run-backup'] : []),
    'stage-release',
    'activate',
    'restart-live',
    'verify-live',
  ];
}

export function buildLiveBackupCommand(source, destination, previousRelease) {
  return [
    'node', 'node_modules/tsx/dist/cli.mjs', 'src/maintenance/database-operations-cli.ts', 'backup', source, destination,
    ...(previousRelease ? ['--lane', 'live', '--instance', 'family-live'] : []),
  ];
}

export async function runPromotionPlan(plan, actions) {
  let activated = false;
  try {
    for (const step of plan) {
      await actions[step]();
      if (step === 'activate') activated = true;
    }
  } catch (error) {
    if (activated) await actions.rollback();
    throw error;
  }
}

export function activeReleaseMarkerPath(operationalRoot) {
  return join(resolve(operationalRoot), 'config', 'active-release.json');
}

export function readActiveRelease(operationalRoot) {
  const path = activeReleaseMarkerPath(operationalRoot);
  if (!existsSync(path)) return null;
  const value = JSON.parse(readFileSync(path, 'utf8'));
  if (!value || typeof value.buildId !== 'string' || typeof value.releaseRoot !== 'string'
    || typeof value.activatedAt !== 'string' || !isAbsolute(value.releaseRoot)) {
    throw new Error('active release marker is invalid');
  }
  return value;
}

export function activateRelease(operationalRoot, release) {
  const path = activeReleaseMarkerPath(operationalRoot);
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(release, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  renameSync(temporary, path);
}

export async function promoteRelease({ repositoryRoot, operationalRoot, lanHost, buildId = currentBuildId(repositoryRoot) }) {
  const sourceRoot = resolve(repositoryRoot);
  const runtimeRoot = resolve(operationalRoot);
  const previous = readActiveRelease(runtimeRoot);
  const releaseRoot = resolve(runtimeRoot, 'releases', `release-${safeBuildId(buildId)}`);
  const stagingRoot = `${releaseRoot}.staging-${process.pid}`;
  const baseManifest = createProfileManifest({ repositoryRoot: sourceRoot, operationalRoot: runtimeRoot, lanHost });
  const backupPath = join(runtimeRoot, 'backups', `live-${timestampForFile(new Date())}-${safeBuildId(buildId)}.sqlite`);
  const plan = createPromotionPlan({ hasLiveDatabase: existsSync(baseManifest.live.databasePath) });

  const actions = {
    build: () => {
      runCommand(['node', 'node_modules/typescript/bin/tsc', '-p', '../packages/item-capture/tsconfig.json'], join(sourceRoot, 'duckworth-api'));
      runCommand(['node', 'node_modules/typescript/bin/tsc', '-p', '../packages/shopping-intelligence/tsconfig.json'], join(sourceRoot, 'duckworth-api'));
      runCommand(['node', 'node_modules/typescript/bin/tsc', '-p', 'tsconfig.json'], join(sourceRoot, 'duckworth-api'));
      runCommand(['node', 'node_modules/@angular/cli/bin/ng.js', 'build'], join(sourceRoot, 'duckworth-web'));
    },
    'backup-live': () => runCommand(buildLiveBackupCommand(
      baseManifest.live.databasePath,
      backupPath,
      previous,
    ), join(sourceRoot, 'duckworth-api')),
    'verify-backup': () => runCommand(['node', 'node_modules/tsx/dist/cli.mjs', 'src/maintenance/database-operations-cli.ts', 'verify', backupPath], join(sourceRoot, 'duckworth-api')),
    'dry-run-backup': () => runCommand(['node', 'node_modules/tsx/dist/cli.mjs', 'src/maintenance/database-operations-cli.ts', 'dry-run', backupPath], join(sourceRoot, 'duckworth-api')),
    'stage-release': () => {
      if (existsSync(releaseRoot)) throw new Error(`release already exists: ${releaseRoot}`);
      removeSafeStaging(runtimeRoot, stagingRoot);
      mkdirSync(stagingRoot, { recursive: true });
      const previousApiRoot = previous ? join(previous.releaseRoot, 'duckworth-api') : null;
      if (!previousApiRoot || !existsSync(previousApiRoot)) {
        throw new Error('a verified production dependency base is required before the first local release promotion');
      }
      cpSync(previousApiRoot, join(stagingRoot, 'duckworth-api'), { recursive: true });
      cpSync(join(sourceRoot, 'duckworth-api', 'dist'), join(stagingRoot, 'duckworth-api', 'dist'), { recursive: true });
      cpSync(join(sourceRoot, 'duckworth-api', 'language-packs'), join(stagingRoot, 'duckworth-api', 'language-packs'), { recursive: true });
      cpSync(join(sourceRoot, 'duckworth-api', 'openapi'), join(stagingRoot, 'duckworth-api', 'openapi'), { recursive: true });
      cpSync(join(sourceRoot, 'duckworth-api', 'package.json'), join(stagingRoot, 'duckworth-api', 'package.json'));
      cpSync(join(sourceRoot, 'duckworth-web', 'dist'), join(stagingRoot, 'duckworth-web', 'dist'), { recursive: true });
      mkdirSync(join(stagingRoot, 'tools', 'lanes'), { recursive: true });
      cpSync(join(sourceRoot, 'tools', 'lanes', 'static-web-server.mjs'), join(stagingRoot, 'tools', 'lanes', 'static-web-server.mjs'));
      writeFileSync(join(stagingRoot, 'release.json'), `${JSON.stringify({ buildId, createdAt: new Date().toISOString() }, null, 2)}\n`);
      renameSync(stagingRoot, releaseRoot);
    },
    activate: () => activateRelease(runtimeRoot, { buildId, releaseRoot, activatedAt: new Date().toISOString() }),
    'restart-live': async () => {
      const manifest = validateProfileManifest(createProfileManifest({
        repositoryRoot: sourceRoot, operationalRoot: runtimeRoot, lanHost, liveReleaseRoot: releaseRoot, liveBuildId: buildId,
      }), { repositoryRoot: sourceRoot });
      const supervisor = createSupervisor({ manifest, processHostPath: join(sourceRoot, 'tools', 'lanes', 'process-host.mjs') });
      await supervisor.ensure(['live'], { restart: true });
    },
    'verify-live': async () => {
      const response = await fetch(`${baseManifest.live.web.publicOrigin}/health`, { signal: AbortSignal.timeout(5_000) });
      if (!response.ok) throw new Error('promoted live health check failed');
      const health = await response.json();
      if (health.lane !== 'live' || health.instanceId !== 'family-live' || health.buildId !== buildId) {
        throw new Error('promoted live build identity did not match');
      }
    },
    rollback: async () => {
      if (!previous) {
        const marker = activeReleaseMarkerPath(runtimeRoot);
        if (existsSync(marker)) unlinkSync(marker);
        return;
      }
      activateRelease(runtimeRoot, previous);
      const manifest = validateProfileManifest(createProfileManifest({
        repositoryRoot: sourceRoot, operationalRoot: runtimeRoot, lanHost, liveReleaseRoot: previous.releaseRoot, liveBuildId: previous.buildId,
      }), { repositoryRoot: sourceRoot });
      const supervisor = createSupervisor({ manifest, processHostPath: join(sourceRoot, 'tools', 'lanes', 'process-host.mjs') });
      await supervisor.ensure(['live'], { restart: true });
    },
  };

  await runPromotionPlan(plan, actions);
  return { buildId, releaseRoot, backupPath: plan.includes('backup-live') ? backupPath : null, previous };
}

function runCommand(command, cwd) {
  const invocation = createCommandInvocation(command);
  const result = spawnSync(invocation.executable, invocation.args, {
    cwd,
    stdio: 'inherit',
    windowsHide: true,
    env: {
      ...process.env,
      CI: 'true',
      npm_config_offline: 'true',
      npm_config_confirm_modules_purge: 'false',
    },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command.join(' ')} failed with exit code ${result.status}`);
}

function currentBuildId(repositoryRoot) {
  const executable = process.platform === 'win32'
    ? execFileSync('where.exe', ['git'], { encoding: 'utf8', windowsHide: true }).split(/\r?\n/u).find(Boolean)
    : 'git';
  if (!executable) throw new Error('git executable was not found');
  return execFileSync(executable, ['rev-parse', '--short=12', 'HEAD'], { cwd: repositoryRoot, encoding: 'utf8', windowsHide: true }).trim();
}

function safeBuildId(buildId) {
  if (!/^[a-zA-Z0-9._-]+$/u.test(buildId)) throw new Error('build ID contains unsafe characters');
  return buildId;
}

function timestampForFile(date) {
  return date.toISOString().replace(/[:.]/gu, '-');
}

function removeSafeStaging(operationalRoot, stagingRoot) {
  const releasesRoot = resolve(operationalRoot, 'releases');
  const target = resolve(stagingRoot);
  const path = relative(releasesRoot, target);
  if (!path || path.startsWith('..') || isAbsolute(path) || !target.includes('.staging-')) {
    throw new Error('refusing to remove an unsafe release staging path');
  }
  rmSync(target, { recursive: true, force: true });
}
