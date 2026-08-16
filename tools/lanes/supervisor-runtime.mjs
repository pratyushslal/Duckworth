import { execFileSync, spawn } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildDesiredProcesses } from './profile-manifest.mjs';
import { rotateLog } from './log-rotation.mjs';
import {
  applyReconciliation,
  createStateStore,
  isOwnedProcessCommand,
  parseEnvFile,
  planReconciliation,
  requireOwnedRunningProcess,
  withSupervisorLock,
} from './process-supervisor.mjs';

export function createSupervisor({ manifest, processHostPath, fetchImpl = fetch }) {
  const stateRoot = join(manifest.operationalRoot, 'supervisor');
  const logsRoot = join(manifest.operationalRoot, 'logs');
  const store = createStateStore(join(stateRoot, 'processes.json'));
  const lockPath = join(stateRoot, 'reconcile.lock');
  mkdirSync(logsRoot, { recursive: true });

  async function inspect(entry) {
    if (!processExists(entry.pid)) return { ...entry, healthy: false, owned: true, reason: 'not-running' };
    const commandLine = readProcessCommandLine(entry.pid);
    const owned = isOwnedProcessCommand(commandLine, entry);
    if (!owned) return { ...entry, healthy: false, owned: false, reason: 'ownership-mismatch' };
    const health = await readExpectedHealth(entry, fetchImpl);
    const healthy = Boolean(health);
    return { ...entry, healthy, owned, health, ...(healthy ? {} : { reason: 'health-mismatch' }) };
  }

  async function currentState() {
    return Promise.all(store.read().map(inspect));
  }

  async function ensure(profiles = ['live', 'sandbox'], { restart = false } = {}) {
    return withSupervisorLock(lockPath, async () => {
      const desired = buildDesiredProcesses(manifest);
      const current = await currentState();
      const unsafe = current.filter((entry) => profiles.includes(entry.profile) && entry.owned === false);
      if (unsafe.length) {
        throw new Error(`refusing to manage unowned process IDs: ${unsafe.map((entry) => entry.pid).join(', ')}`);
      }
      const effective = restart
        ? current.map((entry) => profiles.includes(entry.profile) ? { ...entry, healthy: false } : entry)
        : current;
      const plan = planReconciliation(effective, desired, { profiles });
      const managed = await applyReconciliation(plan, { stop: stopEntry, start: startEntry });
      const outsideScope = current.filter((entry) => !profiles.includes(entry.profile) && entry.owned !== false);
      const state = [...outsideScope, ...managed].map(stripInspection);
      store.write(state);
      return Promise.all(state.map(inspect));
    });
  }

  async function stop(profiles = ['live', 'sandbox']) {
    return withSupervisorLock(lockPath, async () => {
      const current = await currentState();
      const targets = current.filter((entry) => profiles.includes(entry.profile));
      for (const entry of targets) {
        if (entry.owned === false) throw new Error(`refusing to stop unowned PID ${entry.pid}`);
        if (processExists(entry.pid)) await stopEntry(entry);
      }
      const remaining = current.filter((entry) => !profiles.includes(entry.profile)).map(stripInspection);
      store.write(remaining);
      return remaining;
    });
  }

  async function startEntry(spec) {
    if (!existsSync(spec.cwd)) throw new Error(`${spec.profile} source directory is missing: ${spec.cwd}`);
    let externalEnv = {};
    if (spec.envFile && existsSync(spec.envFile)) externalEnv = parseEnvFile(readFileSync(spec.envFile, 'utf8'));
    if (spec.profile === 'live' && spec.kind === 'api' && !existsSync(spec.envFile)) {
      throw new Error(`live credentials file is missing: ${spec.envFile}`);
    }
    const logPath = join(logsRoot, `${spec.key}.log`);
    const errorPath = join(logsRoot, `${spec.key}.error.log`);
    rotateLog(logPath);
    rotateLog(errorPath);
    const stdout = openSync(logPath, 'a', 0o600);
    const stderr = openSync(errorPath, 'a', 0o600);
    const child = spawn(process.execPath, [
      processHostPath,
      spec.key,
      spec.fingerprint,
      spec.cwd,
      JSON.stringify(spec.command),
    ], {
      cwd: spec.cwd,
      env: { ...process.env, ...externalEnv, ...spec.env },
      detached: true,
      stdio: ['ignore', stdout, stderr],
      windowsHide: true,
    });
    child.unref();
    closeSync(stdout);
    closeSync(stderr);
    const entry = {
      key: spec.key,
      profile: spec.profile,
      kind: spec.kind,
      pid: child.pid,
      fingerprint: spec.fingerprint,
      healthOrigin: spec.healthOrigin,
      instanceId: spec.env.DUCKWORTH_EXPECTED_INSTANCE_ID ?? spec.env.DUCKWORTH_INSTANCE_ID,
      startedAt: new Date().toISOString(),
      logPath,
      errorPath,
    };
    const health = await waitForHealth(entry, fetchImpl);
    if (!health) {
      if (processExists(entry.pid)) await stopEntry(entry);
      throw new Error(`${entry.key} did not reach its expected runtime health`);
    }
    return entry;
  }

  async function stopEntry(entry) {
    if (!requireOwnedRunningProcess(entry, { processExists, readCommandLine: readProcessCommandLine })) return;
    if (process.platform === 'win32') {
      try { execFileSync('taskkill.exe', ['/PID', String(entry.pid), '/T'], { stdio: 'ignore' }); } catch { /* retry below */ }
      await delay(750);
      if (processExists(entry.pid)) execFileSync('taskkill.exe', ['/PID', String(entry.pid), '/T', '/F'], { stdio: 'ignore' });
    } else {
      process.kill(-entry.pid, 'SIGTERM');
      await delay(750);
      if (processExists(entry.pid)) process.kill(-entry.pid, 'SIGKILL');
    }
  }

  return { ensure, status: currentState, stop };
}

async function waitForHealth(entry, fetchImpl, attempts = 30) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const health = await readHealth(entry.healthOrigin, fetchImpl);
    if (health?.status === 'ok' && health.lane === entry.profile && health.instanceId === entry.instanceId) return health;
    await delay(Math.min(250 + attempt * 100, 1_000));
  }
  return null;
}

async function readHealth(origin, fetchImpl) {
  try {
    const response = await fetchImpl(`${origin}/health`, { signal: AbortSignal.timeout(2_000) });
    return response.ok ? await response.json() : null;
  } catch {
    return null;
  }
}

export async function readExpectedHealth(entry, fetchImpl, { attempts = 3, delayMs = 100 } = {}) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const health = await readHealth(entry.healthOrigin, fetchImpl);
    if (health?.status === 'ok' && health.lane === entry.profile && health.instanceId === entry.instanceId) return health;
    if (attempt + 1 < attempts) await delay(delayMs);
  }
  return null;
}

function processExists(pid) {
  if (!Number.isInteger(pid) || pid < 1) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
}

function readProcessCommandLine(pid) {
  try {
    if (process.platform === 'win32') {
      return execFileSync('powershell.exe', [
        '-NoProfile', '-NonInteractive', '-Command',
        `(Get-CimInstance Win32_Process -Filter \"ProcessId=${pid}\").CommandLine`,
      ], { encoding: 'utf8', windowsHide: true }).trim();
    }
    return readFileSync(`/proc/${pid}/cmdline`, 'utf8').replaceAll('\0', ' ');
  } catch {
    return '';
  }
}

function stripInspection(entry) {
  const { healthy: _healthy, owned: _owned, health: _health, reason: _reason, ...persisted } = entry;
  return persisted;
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
