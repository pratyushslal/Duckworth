import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  activateRelease,
  buildLiveBackupCommand,
  createPromotionPlan,
  readActiveRelease,
  runPromotionPlan,
} from '../release-manager.mjs';

describe('live release promotion', () => {
  const directories = [];
  afterEach(() => directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true })));

  it('builds, backs up, dry-runs, stages, activates and verifies in safety order', () => {
    assert.deepEqual(createPromotionPlan({ hasLiveDatabase: true }), [
      'build', 'backup-live', 'verify-backup', 'dry-run-backup', 'stage-release', 'activate', 'restart-live', 'verify-live',
    ]);
  });

  it('restores the previous active release when post-activation verification fails', async () => {
    const calls = [];
    await assert.rejects(() => runPromotionPlan(['build', 'activate', 'restart-live', 'verify-live'], {
      build: async () => calls.push('build'),
      activate: async () => calls.push('activate'),
      'restart-live': async () => calls.push('restart-live'),
      'verify-live': async () => { calls.push('verify-live'); throw new Error('unhealthy'); },
      rollback: async () => calls.push('rollback'),
    }), /unhealthy/);
    assert.deepEqual(calls, ['build', 'activate', 'restart-live', 'verify-live', 'rollback']);
  });

  it('preserves the startup error after first-release rollback cleanup', async () => {
    const calls = [];
    await assert.rejects(() => runPromotionPlan(['activate', 'restart-live'], {
      activate: async () => calls.push('activate'),
      'restart-live': async () => { throw new Error('startup failed'); },
      rollback: async () => calls.push('clear-first-marker'),
    }), /startup failed/);
    assert.deepEqual(calls, ['activate', 'clear-first-marker']);
  });

  it('atomically records and reads the immutable active release root', () => {
    const root = mkdtempSync(join(tmpdir(), 'duckworth-release-marker-'));
    directories.push(root);
    const releaseRoot = resolve(root, 'releases', 'release-abc123');
    activateRelease(root, { buildId: 'abc123', releaseRoot, activatedAt: '2026-08-14T00:00:00.000Z' });
    assert.deepEqual(readActiveRelease(root), { buildId: 'abc123', releaseRoot, activatedAt: '2026-08-14T00:00:00.000Z' });
  });

  it('adopts a verified unassigned database only on first promotion', () => {
    assert.deepEqual(buildLiveBackupCommand('C:\\live.sqlite', 'C:\\backup.sqlite', null), [
      'node', 'node_modules/tsx/dist/cli.mjs', 'src/maintenance/database-operations-cli.ts', 'backup', 'C:\\live.sqlite', 'C:\\backup.sqlite',
    ]);
    assert.deepEqual(buildLiveBackupCommand('C:\\live.sqlite', 'C:\\backup.sqlite', { buildId: 'old' }).slice(-4), [
      '--lane', 'live', '--instance', 'family-live',
    ]);
  });
});
