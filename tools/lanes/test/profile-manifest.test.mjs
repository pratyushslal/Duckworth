import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { buildDesiredProcesses, createProfileManifest, validateProfileManifest } from '../profile-manifest.mjs';

describe('Duckworth profile manifest', () => {
  it('keeps permanent live and sandbox data outside the source tree', () => {
    const repositoryRoot = resolve('C:/work/Duckworth');
    const operationalRoot = resolve('C:/Users/test/AppData/Local/Duckworth');
    const manifest = createProfileManifest({ repositoryRoot, operationalRoot, lanHost: '192.168.0.102' });

    assert.equal(manifest.live.web.port, 4200);
    assert.equal(manifest.sandbox.web.port, 4300);
    assert.equal(manifest.live.api.port, 3000);
    assert.equal(manifest.sandbox.api.port, 3001);
    assert.ok(manifest.live.databasePath.startsWith(operationalRoot));
    assert.ok(manifest.sandbox.databasePath.startsWith(operationalRoot));
    assert.ok(!manifest.live.databasePath.startsWith(repositoryRoot));
    assert.equal(validateProfileManifest(manifest, { repositoryRoot }), manifest);
  });

  it('rejects duplicate ports or database paths', () => {
    const repositoryRoot = resolve('C:/work/Duckworth');
    const manifest = createProfileManifest({
      repositoryRoot,
      operationalRoot: resolve('C:/operations/Duckworth'),
      lanHost: 'duckworth.local',
    });
    manifest.sandbox.api.port = manifest.live.api.port;
    assert.throws(() => validateProfileManifest(manifest, { repositoryRoot }), /profile ports must be unique/);
  });

  it('uses immutable production commands for live and watch commands only for sandbox', () => {
    const manifest = createProfileManifest({
      repositoryRoot: resolve('C:/work/Duckworth'),
      operationalRoot: resolve('C:/operations/Duckworth'),
      lanHost: 'duckworth.local',
      liveBuildId: 'release-abc123',
    });

    const desired = buildDesiredProcesses(manifest);
    const liveApi = desired.find((entry) => entry.key === 'live-api');
    const liveWeb = desired.find((entry) => entry.key === 'live-web');
    const sandboxApi = desired.find((entry) => entry.key === 'sandbox-api');
    assert.deepEqual(liveApi.command, ['node', 'dist/src/server.js']);
    assert.deepEqual(sandboxApi.command, ['node', 'node_modules/tsx/dist/cli.mjs', 'watch', 'src/server.ts']);
    assert.equal(liveWeb.command[1].endsWith('static-web-server.mjs'), true);
    assert.equal(liveApi.env.DUCKWORTH_LANE, 'live');
    assert.equal(liveApi.env.DUCKWORTH_BUILD_ID, 'release-abc123');
    assert.equal(sandboxApi.env.DUCKWORTH_LANE, 'sandbox');
    assert.equal(JSON.stringify(desired).includes('ACCESS_TOKEN'), false);
  });
});
