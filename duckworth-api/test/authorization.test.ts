import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.js';

describe('central household authorization', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('accepts the configured master bearer token outside test mode for operations', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const app = await buildApp({
      databasePath: ':memory:',
      runtimeIdentity: { lane: 'live', instanceId: 'family-live' },
      authorization: { householdId: 'family-a', accessToken: 'secret-token' },
    });
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/households/family-a/items',
      headers: { authorization: 'Bearer secret-token' },
    });
    expect(response.statusCode).toBe(200);
    await app.close();
  });

  it('rejects household routes without the configured access token', async () => {
    const app = await buildApp({
      databasePath: ':memory:',
      runtimeIdentity: { lane: 'sandbox', instanceId: 'auth-test' },
      authorization: { householdId: 'family-a', accessToken: 'secret-token' },
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/households/family-a/items',
    });

    expect(response.statusCode).toBe(401);
    await app.close();
  });

  it('rejects a valid token used for another household', async () => {
    const app = await buildApp({
      databasePath: ':memory:',
      runtimeIdentity: { lane: 'sandbox', instanceId: 'auth-test' },
      authorization: { householdId: 'family-a', accessToken: 'secret-token' },
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/households/family-b/items',
      headers: { authorization: 'Bearer secret-token' },
    });

    expect(response.statusCode).toBe(403);
    await app.close();
  });

  it('allows an authorized household route and keeps health public', async () => {
    const app = await buildApp({
      databasePath: ':memory:',
      runtimeIdentity: { lane: 'sandbox', instanceId: 'auth-test' },
      authorization: { householdId: 'family-a', accessToken: 'secret-token' },
    });

    const health = await app.inject({ method: 'GET', url: '/health' });
    const items = await app.inject({
      method: 'GET',
      url: '/api/v1/households/family-a/items',
      headers: { authorization: 'Bearer secret-token' },
    });

    expect(health.statusCode).toBe(200);
    expect(items.statusCode).toBe(200);
    await app.close();
  });

  it('exchanges the pairing code for an HttpOnly session cookie', async () => {
    const app = await buildApp({
      databasePath: ':memory:',
      runtimeIdentity: { lane: 'sandbox', instanceId: 'auth-test' },
      authorization: {
        householdId: 'family-a',
        accessToken: 'secret-token',
        pairingCode: 'pair-family-a',
      },
    });

    const invalid = await app.inject({
      method: 'POST',
      url: '/api/v1/session/pair',
      payload: { pairingCode: 'wrong' },
    });
    const paired = await app.inject({
      method: 'POST',
      url: '/api/v1/session/pair',
      payload: { pairingCode: 'pair-family-a' },
    });

    expect(invalid.statusCode).toBe(401);
    expect(paired.statusCode).toBe(200);
    expect(paired.json()).toEqual({ lane: 'sandbox', householdId: 'family-a' });
    const cookie = paired.headers['set-cookie'];
    expect(cookie).toContain('duckworth_session=secret-token');
    expect(cookie).toContain('HttpOnly');

    const secondDevice = await app.inject({
      method: 'POST',
      url: '/api/v1/session/pair',
      payload: { pairingCode: 'pair-family-a' },
    });
    expect(secondDevice.statusCode).toBe(200);
    expect(secondDevice.headers['set-cookie']).toContain('Max-Age=15552000');

    const items = await app.inject({
      method: 'GET',
      url: '/api/v1/households/family-a/items',
      headers: { cookie: String(cookie).split(';')[0] },
    });
    expect(items.statusCode).toBe(200);
    await app.close();
  });

  it('captures immediately after pairing and registering a device context', async () => {
    const app = await buildApp({
      databasePath: ':memory:',
      runtimeIdentity: { lane: 'sandbox', instanceId: 'auth-capture-test' },
      authorization: {
        householdId: 'family-a',
        accessToken: 'secret-token',
        pairingCode: 'pair-family-a',
      },
    });

    const paired = await app.inject({
      method: 'POST',
      url: '/api/v1/session/pair',
      payload: { pairingCode: 'pair-family-a' },
    });
    const cookie = String(paired.headers['set-cookie']).split(';')[0];
    const context = await app.inject({
      method: 'POST',
      url: '/api/v1/households/family-a/conversation-contexts',
      headers: { cookie },
      payload: { deviceId: 'device-after-pairing' },
    });
    const lists = await app.inject({
      method: 'GET',
      url: '/api/v1/households/family-a/shopping-lists',
      headers: { cookie },
    });
    const registration = context.json();
    const shoppingList = lists.json()[0];
    const capture = await app.inject({
      method: 'POST',
      url: '/api/v1/households/family-a/conversation-captures',
      headers: { cookie },
      payload: {
        text: 'milk',
        source: 'text',
        shoppingListId: shoppingList.id,
        contextId: registration.context.id,
        accessToken: registration.accessToken,
        idempotencyKey: 'capture-after-pairing',
      },
    });

    expect(paired.statusCode).toBe(200);
    expect(context.statusCode).toBe(201);
    expect(lists.statusCode).toBe(200);
    expect(capture.statusCode).toBe(201);
    expect(capture.json().saved).toHaveLength(1);
    expect(capture.json().saved[0].name).toBe('milk');
    await app.close();
  });
});
