export function planReconciliation(current, desired, { profiles } = {}) {
  const scope = new Set(profiles ?? desired.map((entry) => entry.profile));
  const currentByKey = new Map(current.filter((entry) => scope.has(entry.profile)).map((entry) => [entry.key, entry]));
  const desiredInScope = desired.filter((entry) => scope.has(entry.profile));
  const desiredByKey = new Map(desiredInScope.map((entry) => [entry.key, entry]));
  const keep = [];
  const stop = [];
  const start = [];

  for (const entry of currentByKey.values()) {
    const target = desiredByKey.get(entry.key);
    if (target && entry.healthy && entry.fingerprint === target.fingerprint) keep.push(entry);
    else stop.push(entry);
  }
  for (const entry of desiredInScope) {
    const existing = currentByKey.get(entry.key);
    if (!existing || !existing.healthy || existing.fingerprint !== entry.fingerprint) start.push(entry);
  }
  return { keep, stop, start };
}

export async function applyReconciliation(plan, adapter) {
  for (const entry of plan.stop) await adapter.stop(entry);
  const started = [];
  for (const entry of plan.start) started.push(await adapter.start(entry));
  return [...plan.keep, ...started];
}

export function parseEnvFile(contents) {
  const result = {};
  for (const line of contents.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const separator = trimmed.indexOf('=');
    if (separator < 1) continue;
    const key = trimmed.slice(0, separator).trim();
    if (!/^[A-Z_][A-Z0-9_]*$/u.test(key)) continue;
    let value = trimmed.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}

export function createStateStore(statePath) {
  return {
    read() {
      if (!existsSync(statePath)) return [];
      const decoded = JSON.parse(readFileSync(statePath, 'utf8'));
      if (!Array.isArray(decoded)) throw new Error('supervisor state must be an array');
      return decoded;
    },
    write(entries) {
      mkdirSync(dirname(statePath), { recursive: true });
      const temporary = `${statePath}.${process.pid}.tmp`;
      writeFileSync(temporary, `${JSON.stringify(entries, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
      renameSync(temporary, statePath);
    },
  };
}

export function isOwnedProcessCommand(commandLine, entry) {
  if (!commandLine || !commandLine.includes('process-host.mjs')) return false;
  const tokens = commandLine.split(/\s+/u).map((token) => token.replace(/^["']|["']$/gu, ''));
  return tokens.includes(entry.key) && tokens.includes(entry.fingerprint);
}

export function requireOwnedRunningProcess(entry, { processExists, readCommandLine }) {
  if (!processExists(entry.pid)) return false;
  if (!isOwnedProcessCommand(readCommandLine(entry.pid), entry)) {
    throw new Error(`refusing to stop unowned PID ${entry.pid}`);
  }
  return true;
}

export async function withSupervisorLock(lockPath, action, {
  processExists = defaultProcessExists,
  retryMs = 100,
  timeoutMs = 120_000,
} = {}) {
  if (!lockPath || typeof action !== 'function') throw new Error('supervisor lock path and action are required');
  const token = randomUUID();
  const startedAt = Date.now();
  while (true) {
    try {
      mkdirSync(lockPath);
      writeFileSync(join(lockPath, 'owner.json'), JSON.stringify({ pid: process.pid, token }), {
        encoding: 'utf8', mode: 0o600,
      });
      break;
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      if (reclaimDeadLock(lockPath, processExists)) continue;
      if (Date.now() - startedAt >= timeoutMs) throw new Error('timed out waiting for the supervisor reconciliation lock');
      await delay(retryMs);
    }
  }
  try {
    return await action();
  } finally {
    try {
      const owner = JSON.parse(readFileSync(join(lockPath, 'owner.json'), 'utf8'));
      if (owner.token === token) rmSync(lockPath, { recursive: true, force: true });
    } catch {
      // Preserve an unexpectedly replaced or malformed lock for diagnosis.
    }
  }
}

function reclaimDeadLock(lockPath, processExists) {
  try {
    const owner = JSON.parse(readFileSync(join(lockPath, 'owner.json'), 'utf8'));
    if (!Number.isInteger(owner.pid) || owner.pid < 1 || processExists(owner.pid)) return false;
    rmSync(lockPath, { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
}

function defaultProcessExists(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
