import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { installSupervisorApp, readSupervisorInstallation } from '../supervisor-install.mjs';

describe('stable supervisor installation', () => {
  const directories = [];
  afterEach(() => directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true })));
  it('copies runtime scripts outside the worktree and records only non-secret paths', () => {
    const root = mkdtempSync(join(tmpdir(), 'duckworth-supervisor-install-'));
    directories.push(root);
    const source = join(root, 'source');
    const operationalRoot = join(root, 'operations');
    const repositoryRoot = join(root, 'repo');
    mkdirSync(source, { recursive: true });
    writeFileSync(join(source, 'duckworth-profiles.mjs'), 'export {};');
    writeFileSync(join(source, 'helper.mjs'), 'export {};');
    const installed = installSupervisorApp({ sourceDirectory: source, operationalRoot, repositoryRoot, lanHost: '192.168.0.102' });
    assert.equal(existsSync(installed.cliPath), true);
    assert.deepEqual(readSupervisorInstallation(installed.appRoot), { version: 1, repositoryRoot, operationalRoot, lanHost: '192.168.0.102' });
    assert.equal(readFileSync(join(installed.appRoot, 'installation.json'), 'utf8').includes('TOKEN'), false);
  });
});
