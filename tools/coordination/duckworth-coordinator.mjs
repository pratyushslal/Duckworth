import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const STATE_VERSION = 1;
const DEFAULT_LEASE_MS = 30 * 60 * 1000;

export function defaultCoordinationRoot(env = process.env) {
  const localAppData = env.LOCALAPPDATA?.trim();
  return resolve(localAppData || join(homedir(), 'AppData', 'Local'), 'Duckworth', 'coordination');
}

export function createCoordinator({
  root = defaultCoordinationRoot(),
  repositoryRoot = process.cwd(),
  now = () => new Date(),
  runTests = defaultRunTests,
  gitExecutable = resolveGitExecutable(),
} = {}) {
  const statePath = join(root, 'state.json');
  const eventsPath = join(root, 'events.ndjson');
  const lockPath = join(root, 'coordinator.lock');
  const featureRegistryPath = join(repositoryRoot, 'tools', 'coordination', 'feature-registry.json');
  const testManifestPath = join(repositoryRoot, 'tools', 'coordination', 'test-manifest.json');

  function readState() {
    if (!existsSync(statePath)) return { version: STATE_VERSION, revision: 0, tasks: {}, releases: {} };
    const state = JSON.parse(readFileSync(statePath, 'utf8'));
    if (state.version !== STATE_VERSION || !state.tasks || !state.releases) throw new Error('unsupported coordinator state');
    return state;
  }

  function writeState(state) {
    mkdirSync(root, { recursive: true });
    const next = { ...state, version: STATE_VERSION, revision: state.revision + 1 };
    const temporary = `${statePath}.${process.pid}.${randomUUID()}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(next, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    renameSync(temporary, statePath);
    return next;
  }

  function event(kind, payload) {
    mkdirSync(root, { recursive: true });
    appendFileSync(eventsPath, `${JSON.stringify({ at: now().toISOString(), kind, ...payload })}\n`, { encoding: 'utf8', mode: 0o600 });
  }

  function withLock(action) {
    mkdirSync(root, { recursive: true });
    const owner = { pid: process.pid, token: randomUUID(), at: now().toISOString() };
    try {
      mkdirSync(lockPath);
      writeFileSync(join(lockPath, 'owner.json'), `${JSON.stringify(owner)}\n`, { encoding: 'utf8', mode: 0o600 });
    } catch (error) {
      if (error?.code === 'EEXIST' && reclaimExpiredLock()) {
        mkdirSync(lockPath);
        writeFileSync(join(lockPath, 'owner.json'), `${JSON.stringify(owner)}\n`, { encoding: 'utf8', mode: 0o600 });
      } else {
        throw new Error('coordinator is busy; inspect coordinator.lock before retrying');
      }
    }
    try {
      return action();
    } finally {
      try {
        const current = JSON.parse(readFileSync(join(lockPath, 'owner.json'), 'utf8'));
        if (current.token === owner.token) rmSync(lockPath, { recursive: true, force: true });
      } catch {
        // Leave replacement or malformed locks available for diagnosis.
      }
    }
  }

  function reclaimExpiredLock() {
    try {
      const ownerPath = join(lockPath, 'owner.json');
      const owner = JSON.parse(readFileSync(ownerPath, 'utf8'));
      const age = now().getTime() - Date.parse(owner.at);
      if (!Number.isFinite(age) || age < DEFAULT_LEASE_MS) return false;
      rmSync(lockPath, { recursive: true, force: true });
      return true;
    } catch {
      return false;
    }
  }

  function registerTask(input) {
    return withLock(() => {
      const task = normalizeTask(input, now(), repositoryRoot);
      const state = readState();
      if (state.tasks[task.taskId]) throw new Error(`task already exists: ${task.taskId}`);
      state.tasks[task.taskId] = task;
      const next = writeState(state);
      event('task.registered', { taskId: task.taskId, threadId: task.threadId });
      return next.tasks[task.taskId];
    });
  }

  function heartbeat(taskId, owner) {
    return withLock(() => updateTask(taskId, (task) => {
      assertOwner(task, owner);
      const updated = { ...task, lease: { ...task.lease, expiresAt: new Date(now().getTime() + DEFAULT_LEASE_MS).toISOString() }, updatedAt: now().toISOString() };
      event('task.heartbeat', { taskId, owner });
      return updated;
    }));
  }

  function publishReady(taskId, marker) {
    return withLock(() => updateTask(taskId, (task) => {
      if (!['assigned', 'working'].includes(task.status)) throw new Error(`task ${taskId} is not working`);
      const ready = normalizeReadyMarker(marker, task);
      const updated = { ...task, status: 'ready', ready, updatedAt: now().toISOString() };
      event('task.ready', { taskId, commit: ready.commit, features: ready.changedFeatures });
      return updated;
    }));
  }

  async function verifyTask(taskId, { executeTests = false } = {}) {
    const task = readState().tasks[taskId];
    if (!task) throw new Error(`unknown task: ${taskId}`);
    if (task.status !== 'ready') throw new Error(`task ${taskId} is not ready`);
    const ready = task.ready;
    const changedFiles = git(task.worktree, ['diff', '--name-only', `${ready.baseCommit}..${ready.commit}`]);
    if (git(task.worktree, ['status', '--porcelain'])) throw new Error(`task ${taskId} worktree is dirty`);
    git(task.worktree, ['cat-file', '-e', `${ready.commit}^{commit}`]);
    git(task.worktree, ['merge-base', '--is-ancestor', ready.baseCommit, ready.commit]);
    const features = readJson(featureRegistryPath);
    const knownFeatures = new Set(features.features.map((feature) => feature.id));
    const unknownFeatures = ready.changedFeatures.filter((feature) => !knownFeatures.has(feature));
    if (unknownFeatures.length) throw new Error(`unknown feature IDs: ${unknownFeatures.join(', ')}`);
    const tests = readJson(testManifestPath).tests;
    const selectedTests = tests.filter((test) => ready.testIds.includes(test.id));
    if (selectedTests.length !== ready.testIds.length) throw new Error('task references an unknown test ID');
    const results = executeTests ? await runTests(selectedTests, repositoryRoot) : selectedTests.map((test) => ({ id: test.id, status: 'evidence-only' }));
    if (results.some((result) => result.status !== 'passed' && result.status !== 'evidence-only')) throw new Error(`task ${taskId} has failing tests`);
    return withLock(() => updateTask(taskId, (current) => ({
      ...current,
      status: 'verified',
      verification: { commit: ready.commit, changedFiles, tests: results, verifiedAt: now().toISOString() },
      updatedAt: now().toISOString(),
    })));
  }

  function prepareRelease(commit, featureIds = []) {
    return withLock(() => {
      git(repositoryRoot, ['cat-file', '-e', `${commit}^{commit}`]);
      const source = git(repositoryRoot, ['rev-parse', commit]);
      const releaseId = `release-${source.slice(0, 12)}`;
      const manifest = { schemaVersion: 1, releaseId, sourceCommit: source, featureIds: [...new Set(featureIds)].sort(), preparedAt: now().toISOString() };
      manifest.artifactHash = createHash('sha256').update(JSON.stringify(manifest)).digest('hex');
      const state = readState();
      state.releases[releaseId] = { ...manifest, approvedAt: null, approvalArtifactHash: null };
      const next = writeState(state);
      event('release.prepared', { releaseId, sourceCommit: source, artifactHash: manifest.artifactHash });
      return next.releases[releaseId];
    });
  }

  function approveRelease(releaseId, artifactHash) {
    return withLock(() => {
      const state = readState();
      const release = state.releases[releaseId];
      if (!release) throw new Error(`unknown release: ${releaseId}`);
      if (release.artifactHash !== artifactHash) throw new Error('approval does not match the release artifact');
      const updated = { ...release, approvedAt: now().toISOString(), approvalArtifactHash: artifactHash };
      state.releases[releaseId] = updated;
      const next = writeState(state);
      event('release.approved', { releaseId, artifactHash });
      return next.releases[releaseId];
    });
  }

  function reconcile() {
    return withLock(() => {
      const state = readState();
      const at = now().getTime();
      const updates = Object.fromEntries(Object.entries(state.tasks).map(([taskId, task]) => {
        if (task.lease && Date.parse(task.lease.expiresAt) <= at && !['integrated', 'released', 'abandoned'].includes(task.status)) {
          const updated = { ...task, status: 'stale', updatedAt: now().toISOString() };
          event('task.stale', { taskId });
          return [taskId, updated];
        }
        return [taskId, task];
      }));
      return writeState({ ...state, tasks: updates });
    });
  }

  function status() {
    return readState();
  }

  function updateTask(taskId, updater) {
    const state = readState();
    const current = state.tasks[taskId];
    if (!current) throw new Error(`unknown task: ${taskId}`);
    state.tasks[taskId] = updater(current);
    return writeState(state).tasks[taskId];
  }

  return { registerTask, heartbeat, publishReady, verifyTask, prepareRelease, approveRelease, reconcile, status };
}

function normalizeTask(input, now, repositoryRoot) {
  const taskId = String(input.taskId ?? '').trim();
  if (!/^[A-Za-z0-9._-]+$/u.test(taskId)) throw new Error('taskId must be a stable identifier');
  const worktree = resolve(input.worktree ?? repositoryRoot);
  return {
    taskId,
    threadId: String(input.threadId ?? '').trim() || 'unlinked',
    owner: String(input.owner ?? process.env.USERNAME ?? 'local').trim(),
    scope: String(input.scope ?? '').trim() || 'unscoped',
    branch: String(input.branch ?? '').trim() || 'unassigned',
    worktree,
    status: 'working',
    lease: { owner: String(input.owner ?? process.env.USERNAME ?? 'local').trim(), expiresAt: new Date(now.getTime() + DEFAULT_LEASE_MS).toISOString() },
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
}

function normalizeReadyMarker(marker, task) {
  const commit = String(marker.commit ?? '').trim();
  const baseCommit = String(marker.baseCommit ?? '').trim();
  if (!commit || !baseCommit) throw new Error('ready marker requires commit and baseCommit');
  const changedFeatures = [...new Set((marker.changedFeatures ?? []).map(String))].sort();
  const testIds = [...new Set((marker.testIds ?? []).map(String))].sort();
  if (!changedFeatures.length) throw new Error('ready marker requires changedFeatures');
  if (!testIds.length) throw new Error('ready marker requires testIds');
  return { taskId: task.taskId, commit, baseCommit, changedFeatures, testIds, publishedAt: new Date().toISOString() };
}

function assertOwner(task, owner) {
  if (task.lease?.owner !== owner) throw new Error(`task ${task.taskId} is owned by ${task.lease?.owner}`);
}

function readJson(path) { return JSON.parse(readFileSync(path, 'utf8')); }

function git(cwd, args, executable = resolveGitExecutable()) {
  return execFileSync(executable, ['-c', `safe.directory=${cwd}`, '-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function resolveGitExecutable(env = process.env) {
  const configured = env.DUCKWORTH_GIT_EXE?.trim();
  if (configured) return configured;
  const candidates = process.platform === 'win32'
    ? ['C:\\Program Files\\Git\\cmd\\git.exe', 'C:\\Program Files\\Git\\bin\\git.exe']
    : ['/usr/bin/git', '/usr/local/bin/git'];
  return candidates.find((candidate) => existsSync(candidate)) ?? (process.platform === 'win32' ? 'git.exe' : 'git');
}

async function defaultRunTests(tests, repositoryRoot) {
  return tests.map((test) => {
    try {
      execFileSync(test.command[0], test.command.slice(1), { cwd: resolve(repositoryRoot, test.cwd ?? '.'), stdio: 'inherit' });
      return { id: test.id, status: 'passed' };
    } catch (error) {
      return { id: test.id, status: 'failed', exitCode: error.status ?? 1 };
    }
  });
}

export function parseArgs(argv) {
  const [action = 'status', ...rest] = argv;
  const values = {};
  for (let index = 0; index < rest.length; index += 1) {
    if (!rest[index].startsWith('--')) continue;
    const key = rest[index].slice(2);
    values[key] = rest[index + 1]?.startsWith('--') ? true : rest[index + 1];
    if (values[key] !== true) index += 1;
  }
  return { action, values };
}

export async function runCli(argv = process.argv.slice(2), env = process.env) {
  const { action, values } = parseArgs(argv);
  const coordinator = createCoordinator({
    root: env.DUCKWORTH_COORDINATION_ROOT || defaultCoordinationRoot(env),
    repositoryRoot: env.DUCKWORTH_REPOSITORY_ROOT || process.cwd(),
  });
  let result;
  if (action === 'status') result = coordinator.status();
  else if (action === 'reconcile') result = coordinator.reconcile();
  else if (action === 'register') result = coordinator.registerTask(values);
  else if (action === 'ready') result = coordinator.publishReady(values.task, { ...values, changedFeatures: split(values.features), testIds: split(values.tests) });
  else if (action === 'verify') result = await coordinator.verifyTask(values.task, { executeTests: values['run-tests'] === true });
  else if (action === 'release-prepare') result = coordinator.prepareRelease(values.commit, split(values.features));
  else if (action === 'release-approve') result = coordinator.approveRelease(values.release, values.artifact);
  else throw new Error(`unknown coordinator action: ${action}`);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return result;
}

function split(value) { return String(value ?? '').split(',').map((entry) => entry.trim()).filter(Boolean); }

if (import.meta.url === `file://${process.argv[1]?.replaceAll('\\', '/')}`) {
  runCli().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}
