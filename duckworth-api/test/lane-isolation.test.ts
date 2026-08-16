import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';

describe('physical live and sandbox lane isolation', () => {
  const resources: Array<{ close: () => Promise<void>; directory: string }> = [];

  afterEach(async () => {
    const current = resources.splice(0);
    for (const resource of current) await resource.close();
    for (const resource of current) rmSync(resource.directory, { recursive: true, force: true });
  });

  it('keeps writes, reads, and runtime markers isolated across two database files', async () => {
    const liveDirectory = mkdtempSync(join(tmpdir(), 'duckworth-live-'));
    const sandboxDirectory = mkdtempSync(join(tmpdir(), 'duckworth-sandbox-'));
    const live = await buildApp({ databasePath: join(liveDirectory, 'live.sqlite'), runtimeIdentity: { lane: 'live', instanceId: 'family-live' } });
    const sandbox = await buildApp({ databasePath: join(sandboxDirectory, 'sandbox.sqlite'), runtimeIdentity: { lane: 'sandbox', instanceId: 'sandbox-test' } });
    resources.push({ directory: liveDirectory, close: () => live.close() }, { directory: sandboxDirectory, close: () => sandbox.close() });

    const liveCreate = await live.inject({ method: 'POST', url: '/api/v1/households/family/items', payload: { input: 'live milk' } });
    const sandboxCreate = await sandbox.inject({ method: 'POST', url: '/api/v1/households/family/items', payload: { input: 'sandbox milk' } });
    expect(liveCreate.statusCode).toBe(201);
    expect(sandboxCreate.statusCode).toBe(201);
    expect((await live.inject({ method: 'GET', url: '/health' })).json()).toMatchObject({ lane: 'live', instanceId: 'family-live' });
    expect((await sandbox.inject({ method: 'GET', url: '/health' })).json()).toMatchObject({ lane: 'sandbox', instanceId: 'sandbox-test' });
    expect((await live.inject({ method: 'GET', url: '/api/v1/households/family/items' })).json().map((item: { name: string }) => item.name)).toEqual(['live milk']);
    expect((await sandbox.inject({ method: 'GET', url: '/api/v1/households/family/items' })).json().map((item: { name: string }) => item.name)).toEqual(['sandbox milk']);
  });
});
