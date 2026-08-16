import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startApiTestInstance } from '../api-test-runner.mjs';
import { createProfileManifest } from '../profile-manifest.mjs';

describe('disposable api-test process', () => {
  const resources = [];
  afterEach(async () => {
    for (const resource of resources.splice(0)) await resource.stop();
  });

  it('starts on a dynamic localhost port, requires its lease, and removes its database', async () => {
    const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
    const operationalRoot = mkdtempSync(join(tmpdir(), 'duckworth-api-test-runtime-'));
    const manifest = createProfileManifest({ repositoryRoot, operationalRoot, lanHost: '127.0.0.1' });
    const instance = await startApiTestInstance(manifest, { ttlMs: 60_000 });
    resources.push(instance);

    const denied = await fetch(`${instance.origin}/api/v1/households/test-household/items`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ input: 'milk' }),
    });
    assert.equal(denied.status, 403);
    const allowed = await fetch(`${instance.origin}/api/v1/households/test-household/items`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-duckworth-test-lease': instance.lease },
      body: JSON.stringify({ input: 'milk' }),
    });
    assert.equal(allowed.status, 201);
    const instanceRoot = dirname(instance.databasePath);
    await instance.stop();
    resources.splice(resources.indexOf(instance), 1);
    assert.equal(existsSync(instanceRoot), false);
    rmSync(operationalRoot, { recursive: true, force: true });
  });

  it('optionally serves the browser app and injects the lease only in its local proxy', async () => {
    const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
    const operationalRoot = mkdtempSync(join(tmpdir(), 'duckworth-api-test-browser-'));
    const staticRoot = join(operationalRoot, 'web');
    const manifest = createProfileManifest({ repositoryRoot, operationalRoot, lanHost: '127.0.0.1' });
    mkdirSync(staticRoot, { recursive: true });
    writeFileSync(join(staticRoot, 'index.html'), '<h1>Disposable Duckworth</h1>');
    const instance = await startApiTestInstance(manifest, { ttlMs: 60_000, withWeb: true, staticRoot });
    resources.push(instance);

    assert.match(instance.webOrigin, /^http:\/\/127\.0\.0\.1:\d+$/u);
    assert.equal(await (await fetch(instance.webOrigin)).text(), '<h1>Disposable Duckworth</h1>');
    const health = await (await fetch(`${instance.webOrigin}/health`)).json();
    assert.equal(health.instanceId, instance.instanceId);
    const created = await fetch(`${instance.webOrigin}/api/v1/households/${instance.instanceId}/items`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ input: 'milk' }),
    });
    assert.equal(created.status, 201);

    await instance.stop();
    resources.splice(resources.indexOf(instance), 1);
    rmSync(operationalRoot, { recursive: true, force: true });
  });
});
