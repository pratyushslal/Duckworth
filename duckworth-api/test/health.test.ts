import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp } from '../src/app.js';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('health endpoint', () => {
  it('reports the deployed build identifier when configured', async () => {
    const app = await buildApp({
      databasePath: ':memory:',
      runtimeIdentity: { lane: 'live', instanceId: 'family-live', buildId: 'release-abc123' },
    });
    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.json()).toMatchObject({ lane: 'live', instanceId: 'family-live', buildId: 'release-abc123' });
    await app.close();
  });

  it('reports that the API process is ready', async () => {
    const app = await buildApp({
      databasePath: ':memory:',
      runtimeIdentity: { lane: 'sandbox', instanceId: 'health-test' },
    });

    const response = await app.inject({
      method: 'GET',
      url: '/health',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok', lane: 'sandbox', instanceId: 'health-test' });

    await app.close();
  });

  it('reports a disposable api-test identity without masquerading as sandbox', async () => {
    const app = await buildApp({
      databasePath: ':memory:',
      runtimeIdentity: { lane: 'api-test', instanceId: 'api-test-run-1' },
    });

    const response = await app.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok', lane: 'api-test', instanceId: 'api-test-run-1' });
    await app.close();
  });

  it('rejects an implicit persistent database in test mode', async () => {
    vi.stubEnv('NODE_ENV', 'test');

    let error: unknown;
    try {
      const app = await buildApp();
      await app.close();
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain(
      'Test mode requires an explicit in-memory or temporary database path',
    );
  });

  it('persists and verifies the runtime lane marker', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'duckworth-runtime-'));
    const databasePath = join(directory, 'runtime.sqlite');
    const runtimeIdentity = { lane: 'sandbox' as const, instanceId: 'test-sandbox' };
    try {
      const app = await buildApp({ databasePath, runtimeIdentity });
      await app.close();

      const reopened = await buildApp({ databasePath, runtimeIdentity });
      await reopened.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('rejects a runtime identity change for an existing database', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'duckworth-runtime-'));
    const databasePath = join(directory, 'runtime.sqlite');
    try {
      const app = await buildApp({
        databasePath,
        runtimeIdentity: { lane: 'sandbox', instanceId: 'test-sandbox' },
      });
      await app.close();

      let error: unknown;
      try {
        await buildApp({
          databasePath,
          runtimeIdentity: { lane: 'live', instanceId: 'test-live' },
        });
      } catch (caught) {
        error = caught;
      }
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toContain('database runtime identity does not match configured lane');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
