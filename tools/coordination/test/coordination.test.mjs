import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCoordinator } from '../duckworth-coordinator.mjs';

describe('Duckworth coordinator', () => {
  const directories = [];
  afterEach(() => directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true })));

  it('persists registered tasks and explicit readiness markers', () => {
    const root = mkdtempSync(join(tmpdir(), 'duckworth-coordinator-'));
    directories.push(root);
    const repositoryRoot = mkdtempSync(join(tmpdir(), 'duckworth-repository-'));
    directories.push(repositoryRoot);
    mkdirSync(join(repositoryRoot, 'tools', 'coordination'), { recursive: true });
    writeFileSync(join(repositoryRoot, 'tools', 'coordination', 'feature-registry.json'), JSON.stringify({ features: [{ id: 'feature-a' }] }));
    writeFileSync(join(repositoryRoot, 'tools', 'coordination', 'test-manifest.json'), JSON.stringify({ tests: [{ id: 'test-a', command: ['node', '--version'] }] }));
    const coordinator = createCoordinator({ root, repositoryRoot });
    const registered = coordinator.registerTask({ taskId: 'task-a', threadId: 'thread-a', scope: 'src' });
    assert.equal(registered.status, 'working');
    const ready = coordinator.publishReady('task-a', {
      commit: 'abc', baseCommit: 'base', changedFeatures: ['feature-a'], testIds: ['test-a'],
    });
    assert.equal(ready.status, 'ready');
    assert.deepEqual(coordinator.status().tasks['task-a'].ready.changedFeatures, ['feature-a']);
  });

  it('binds approval to the exact prepared release artifact', () => {
    const root = mkdtempSync(join(tmpdir(), 'duckworth-coordinator-release-'));
    directories.push(root);
    const coordinator = createCoordinator({ root, repositoryRoot: process.cwd() });
    const release = coordinator.prepareRelease('HEAD', ['release-recovery']);
    assert.throws(() => coordinator.approveRelease(release.releaseId, 'wrong'), /does not match/);
    const approved = coordinator.approveRelease(release.releaseId, release.artifactHash);
    assert.equal(approved.approvalArtifactHash, release.artifactHash);
  });
});
