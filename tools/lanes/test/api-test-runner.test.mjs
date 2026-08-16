import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { createApiTestInstanceSpec } from '../api-test-runner.mjs';
import { createProfileManifest } from '../profile-manifest.mjs';

describe('disposable api-test factory', () => {
  it('creates unique loopback-only instances with separate test-labelled databases', () => {
    const manifest = createProfileManifest({
      repositoryRoot: resolve('C:/work/Duckworth'),
      operationalRoot: resolve('C:/operations/Duckworth'),
      lanHost: 'duckworth.local',
    });
    const first = createApiTestInstanceSpec(manifest, { instanceId: 'api-test-a', secret: 'secret-a' });
    const second = createApiTestInstanceSpec(manifest, { instanceId: 'api-test-b', secret: 'secret-b' });

    assert.equal(first.env.HOST, '127.0.0.1');
    assert.equal(first.env.PORT, '0');
    assert.equal(first.env.DUCKWORTH_LANE, 'api-test');
    assert.ok(first.databasePath.includes('api-test-a'));
    assert.ok(second.databasePath.includes('api-test-b'));
    assert.notEqual(first.databasePath, second.databasePath);
    assert.notEqual(first.readyFile, second.readyFile);
    assert.equal(first.env.DUCKWORTH_TEST_CONTROL_SECRET, 'secret-a');
  });
});
