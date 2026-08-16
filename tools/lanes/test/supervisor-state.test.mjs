import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStateStore, isOwnedProcessCommand, requireOwnedRunningProcess, withSupervisorLock } from '../process-supervisor.mjs';

describe('supervisor state and ownership', () => {
  const directories = [];
  afterEach(() => directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true })));

  it('round-trips process state atomically outside the repository', () => {
    const directory = mkdtempSync(join(tmpdir(), 'duckworth-supervisor-state-'));
    directories.push(directory);
    const store = createStateStore(join(directory, 'processes.json'));
    const state = [{ key: 'live-api', profile: 'live', pid: 123, fingerprint: 'abc' }];
    store.write(state);
    assert.deepEqual(store.read(), state);
  });

  it('only treats the exact hosted key and fingerprint as owned', () => {
    const command = 'node C:\\Duckworth\\process-host.mjs live-api abc123';
    assert.equal(isOwnedProcessCommand(command, { key: 'live-api', fingerprint: 'abc123' }), true);
    assert.equal(isOwnedProcessCommand(command, { key: 'sandbox-api', fingerprint: 'abc123' }), false);
    assert.equal(isOwnedProcessCommand(command, { key: 'live-api', fingerprint: 'wrong' }), false);
  });

  it('treats a confirmed-dead stale PID as already stopped without checking reused ownership', () => {
    let commandLineRead = false;
    const running = requireOwnedRunningProcess({ pid: 32144, key: 'live-web', fingerprint: 'abc' }, {
      processExists: () => false,
      readCommandLine: () => { commandLineRead = true; return ''; },
    });
    assert.equal(running, false);
    assert.equal(commandLineRead, false);
  });

  it('serializes concurrent supervisor writers through one filesystem lock', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'duckworth-supervisor-lock-'));
    directories.push(directory);
    const lockPath = join(directory, 'reconcile.lock');
    const events = [];
    let releaseFirst;
    const gate = new Promise((resolve) => { releaseFirst = resolve; });
    const first = withSupervisorLock(lockPath, async () => {
      events.push('first-start');
      await gate;
      events.push('first-end');
    }, { retryMs: 5, timeoutMs: 1_000 });
    await new Promise((resolve) => setTimeout(resolve, 20));
    const second = withSupervisorLock(lockPath, async () => { events.push('second'); }, {
      retryMs: 5, timeoutMs: 1_000,
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.deepEqual(events, ['first-start']);
    releaseFirst();
    await Promise.all([first, second]);
    assert.deepEqual(events, ['first-start', 'first-end', 'second']);
  });

  it('recovers a lock whose recorded owner is confirmed dead', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'duckworth-supervisor-stale-lock-'));
    directories.push(directory);
    const lockPath = join(directory, 'reconcile.lock');
    mkdirSync(lockPath);
    writeFileSync(join(lockPath, 'owner.json'), JSON.stringify({ pid: 999_999 }));
    let ran = false;
    await withSupervisorLock(lockPath, async () => { ran = true; }, {
      processExists: () => false, retryMs: 5, timeoutMs: 1_000,
    });
    assert.equal(ran, true);
  });
});
