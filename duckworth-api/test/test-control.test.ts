import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';

describe('api-test control lease', () => {
  it('requires an instance-bound lease before an api-test mutation', async () => {
    const app = await buildApp({
      databasePath: ':memory:',
      runtimeIdentity: { lane: 'api-test', instanceId: 'api-test-run-1' },
      testControl: { secret: 'launch-secret' },
    });

    const denied = await app.inject({
      method: 'POST',
      url: '/api/v1/households/test-household/items',
      payload: { input: 'milk' },
    });
    expect(denied.statusCode).toBe(403);

    const session = await app.inject({
      method: 'POST',
      url: '/api/v1/test/session',
      headers: { 'x-duckworth-test-secret': 'launch-secret' },
    });
    expect(session.statusCode).toBe(201);
    expect(session.json()).toMatchObject({ lane: 'api-test', instanceId: 'api-test-run-1' });

    const allowed = await app.inject({
      method: 'POST',
      url: '/api/v1/households/test-household/items',
      headers: { 'x-duckworth-test-lease': session.json().lease },
      payload: { input: 'milk' },
    });
    expect(allowed.statusCode).toBe(201);
    await app.close();
  });
});
