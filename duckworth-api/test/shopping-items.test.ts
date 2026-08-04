import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';

describe('shopping item endpoints', () => {
  it('creates structured intent from typed shorthand', async () => {
    const app = await buildApp({ databasePath: ':memory:' });

    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/households/household-demo/items',
      payload: { input: '1.5 kg potatoes' },
    });

    expect(created.statusCode, created.body).toBe(201);
    expect(created.json()).toMatchObject({
      captureText: '1.5 kg potatoes',
      name: 'potatoes',
      quantity: 1.5,
      unit: 'kg',
      unitSource: 'explicit',
      unitConfirmedAt: expect.any(String),
      attentionReasons: [],
      status: 'active',
      version: 1,
    });

    await app.close();
  });

  it('creates structured intent from trailing quantity and unit shorthand', async () => {
    const app = await buildApp({ databasePath: ':memory:' });
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/households/household-demo/items',
      payload: { input: 'biscuits 2 pcs' },
    });

    expect(created.statusCode, created.body).toBe(201);
    expect(created.json()).toMatchObject({
      captureText: 'biscuits 2 pcs',
      name: 'biscuits',
      quantity: 2,
      unit: 'piece',
      unitSource: 'explicit',
      attentionReasons: [],
    });
    await app.close();
  });

  it('records a unit explicitly confirmed before creation', async () => {
    const app = await buildApp({ databasePath: ':memory:' });
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/households/household-demo/items',
      payload: { input: '2 milk', confirmedUnit: ' cartons ' },
    });

    expect(response.statusCode, response.body).toBe(201);
    expect(response.json()).toMatchObject({
      quantity: 2,
      unit: 'cartons',
      unitSource: 'explicit',
      unitConfirmedAt: expect.any(String),
      attentionReasons: [],
    });
    await app.close();
  });

  it('saves a bare item with missing quantity attention', async () => {
    const app = await buildApp({ databasePath: ':memory:' });

    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/households/household-demo/items',
      payload: { input: 'milk' },
    });

    expect(created.statusCode, created.body).toBe(201);
    expect(created.json()).toMatchObject({
      name: 'milk',
      quantity: null,
      unit: null,
      attentionReasons: ['missing_quantity'],
    });

    await app.close();
  });

  it('hides active attention while purchased and derives it again when reopened', async () => {
    const app = await buildApp({ databasePath: ':memory:' });
    const url = '/api/v1/households/household-demo/items';
    const created = await app.inject({ method: 'POST', url, payload: { input: 'milk' } });
    const itemId = created.json().id as string;

    const purchased = await app.inject({
      method: 'PATCH',
      url: `${url}/${itemId}`,
      payload: { status: 'purchased', expectedVersion: 1 },
    });
    expect(purchased.json().attentionReasons).toEqual([]);

    const reopened = await app.inject({
      method: 'PATCH',
      url: `${url}/${itemId}`,
      payload: { status: 'active', expectedVersion: 2 },
    });
    expect(reopened.json().attentionReasons).toEqual(['missing_quantity']);

    await app.close();
  });

  it('creates and lists an active item for a household', async () => {
    const app = await buildApp({ databasePath: ':memory:' });

    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/households/household-demo/items',
      payload: { name: '  Milk  ' },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ name: 'Milk', status: 'active', version: 1 });

    const listed = await app.inject({
      method: 'GET',
      url: '/api/v1/households/household-demo/items',
    });
    expect(listed.statusCode).toBe(200);
    expect(listed.json()).toHaveLength(1);
    expect(listed.json()[0]).toMatchObject({ name: 'Milk', status: 'active' });

    await app.close();
  });

  it('keeps legacy name capture while rejecting ambiguous capture fields', async () => {
    const app = await buildApp({ databasePath: ':memory:' });
    const url = '/api/v1/households/household-demo/items';

    const legacy = await app.inject({ method: 'POST', url, payload: { name: 'Milk' } });
    const neither = await app.inject({ method: 'POST', url, payload: {} });
    const both = await app.inject({ method: 'POST', url, payload: { input: 'Bread', name: 'Bread' } });

    expect(legacy.statusCode, legacy.body).toBe(201);
    expect(legacy.json()).toMatchObject({ captureText: 'Milk', name: 'Milk' });
    expect(neither.statusCode).toBe(400);
    expect(both.statusCode).toBe(400);
    await app.close();
  });

  it('returns a conflict for a normalized duplicate', async () => {
    const app = await buildApp({ databasePath: ':memory:' });
    const url = '/api/v1/households/household-demo/items';

    await app.inject({ method: 'POST', url, payload: { name: 'Milk' } });
    const duplicate = await app.inject({ method: 'POST', url, payload: { name: ' milk ' } });

    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json()).toMatchObject({ error: 'duplicate_item' });
    await app.close();
  });

  it('marks an item purchased and excludes it from the active list', async () => {
    const app = await buildApp({ databasePath: ':memory:' });
    const url = '/api/v1/households/household-demo/items';
    const created = await app.inject({ method: 'POST', url, payload: { name: 'Bread' } });
    const itemId = created.json().id as string;

    const updated = await app.inject({
      method: 'PATCH',
      url: `${url}/${itemId}`,
      payload: { status: 'purchased', expectedVersion: 1 },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json()).toMatchObject({ id: itemId, status: 'purchased', version: 2 });

    const listed = await app.inject({ method: 'GET', url });
    expect(listed.json()).toEqual([]);
    await app.close();
  });

  it('retains repeated purchases while preventing simultaneous active duplicates', async () => {
    const app = await buildApp({ databasePath: ':memory:' });
    const url = '/api/v1/households/household-demo/items';

    const first = await app.inject({ method: 'POST', url, payload: { input: '2 cartons milk' } });
    await app.inject({
      method: 'PATCH',
      url: `${url}/${first.json().id}`,
      payload: { status: 'purchased', expectedVersion: 1 },
    });
    const second = await app.inject({ method: 'POST', url, payload: { input: '2 cartons milk' } });
    const duplicate = await app.inject({ method: 'POST', url, payload: { input: '2 cartons milk' } });

    expect(second.statusCode, second.body).toBe(201);
    expect(duplicate.statusCode).toBe(409);

    const secondPurchased = await app.inject({
      method: 'PATCH',
      url: `${url}/${second.json().id}`,
      payload: { status: 'purchased', expectedVersion: 1 },
    });
    expect(secondPurchased.statusCode, secondPurchased.body).toBe(200);

    const history = await app.inject({ method: 'GET', url: `${url}?includePurchased=true` });
    expect(history.json().filter((item: { status: string }) => item.status === 'purchased')).toHaveLength(2);
    await app.close();
  });

  it('suggests the latest explicitly confirmed household unit without confirming it', async () => {
    const app = await buildApp({ databasePath: ':memory:' });
    const url = '/api/v1/households/household-demo/items';
    const first = await app.inject({ method: 'POST', url, payload: { input: '2 cartons milk' } });
    await app.inject({
      method: 'PATCH',
      url: `${url}/${first.json().id}`,
      payload: { status: 'purchased', expectedVersion: 1 },
    });

    const repeated = await app.inject({ method: 'POST', url, payload: { input: '2 milk' } });

    expect(repeated.statusCode, repeated.body).toBe(201);
    expect(repeated.json()).toMatchObject({
      name: 'milk',
      quantity: 2,
      unit: 'carton',
      unitSource: 'history',
      unitConfirmedAt: null,
      attentionReasons: ['unconfirmed_historical_unit'],
    });
    await app.close();
  });

  it('never suggests another household unit history', async () => {
    const app = await buildApp({ databasePath: ':memory:' });
    const familyA = '/api/v1/households/family-a/items';
    const familyB = '/api/v1/households/family-b/items';
    const first = await app.inject({ method: 'POST', url: familyA, payload: { input: '2 cartons milk' } });
    await app.inject({
      method: 'PATCH', url: `${familyA}/${first.json().id}`,
      payload: { status: 'purchased', expectedVersion: 1 },
    });

    const otherHousehold = await app.inject({ method: 'POST', url: familyB, payload: { input: '2 milk' } });
    expect(otherHousehold.json()).toMatchObject({ unit: null, unitSource: null, attentionReasons: [] });
    await app.close();
  });

  it('prefers the most recently confirmed unit when household history differs', async () => {
    let now = '2026-08-04T10:00:00.000Z';
    const app = await buildApp({ databasePath: ':memory:', clock: () => new Date(now) });
    const url = '/api/v1/households/household-demo/items';
    try {
      const cartons = await app.inject({ method: 'POST', url, payload: { input: '2 cartons milk' } });
      await app.inject({
        method: 'PATCH', url: `${url}/${cartons.json().id}`,
        payload: { status: 'purchased', expectedVersion: 1 },
      });

      now = '2026-08-04T11:00:00.000Z';
      const bottles = await app.inject({ method: 'POST', url, payload: { input: '2 bottles milk' } });
      await app.inject({
        method: 'PATCH', url: `${url}/${bottles.json().id}`,
        payload: { status: 'purchased', expectedVersion: 1 },
      });

      now = '2026-08-04T12:00:00.000Z';
      const repeated = await app.inject({ method: 'POST', url, payload: { input: '2 milk' } });
      expect(repeated.json()).toMatchObject({ unit: 'bottle', unitSource: 'history' });
    } finally {
      await app.close();
    }
  });

  it('does not refresh unit confirmation time for status-only changes', async () => {
    let now = '2026-08-04T10:00:00.000Z';
    const app = await buildApp({ databasePath: ':memory:', clock: () => new Date(now) });
    const url = '/api/v1/households/household-demo/items';
    const created = await app.inject({ method: 'POST', url, payload: { input: '2 cartons milk' } });
    now = '2026-08-04T11:00:00.000Z';

    const purchased = await app.inject({
      method: 'PATCH', url: `${url}/${created.json().id}`,
      payload: { status: 'purchased', expectedVersion: 1 },
    });

    expect(created.json().unitConfirmedAt).toBe('2026-08-04T10:00:00.000Z');
    expect(purchased.json().unitConfirmedAt).toBe('2026-08-04T10:00:00.000Z');
    await app.close();
  });

  it('accepts a historical unit with one versioned structured update', async () => {
    let now = '2026-08-04T10:00:00.000Z';
    const app = await buildApp({ databasePath: ':memory:', clock: () => new Date(now) });
    const url = '/api/v1/households/household-demo/items';
    const first = await app.inject({ method: 'POST', url, payload: { input: '2 cartons milk' } });
    await app.inject({
      method: 'PATCH', url: `${url}/${first.json().id}`,
      payload: { status: 'purchased', expectedVersion: 1 },
    });
    const inferred = await app.inject({ method: 'POST', url, payload: { input: '2 milk' } });
    now = '2026-08-04T11:00:00.000Z';

    const accepted = await app.inject({
      method: 'PATCH',
      url: `${url}/${inferred.json().id}`,
      payload: { confirmedUnit: 'carton', expectedVersion: 1 },
    });

    expect(accepted.statusCode, accepted.body).toBe(200);
    expect(accepted.json()).toMatchObject({
      unit: 'carton',
      unitSource: 'explicit',
      unitConfirmedAt: '2026-08-04T11:00:00.000Z',
      attentionReasons: [],
      version: 2,
    });
    await app.close();
  });

  it('makes an edited historical unit the newest confirmed household choice', async () => {
    let now = '2026-08-04T10:00:00.000Z';
    const app = await buildApp({ databasePath: ':memory:', clock: () => new Date(now) });
    const url = '/api/v1/households/household-demo/items';
    const first = await app.inject({ method: 'POST', url, payload: { input: '2 cartons milk' } });
    await app.inject({
      method: 'PATCH', url: `${url}/${first.json().id}`,
      payload: { status: 'purchased', expectedVersion: 1 },
    });
    const inferred = await app.inject({ method: 'POST', url, payload: { input: '2 milk' } });

    now = '2026-08-04T11:00:00.000Z';
    const changed = await app.inject({
      method: 'PATCH', url: `${url}/${inferred.json().id}`,
      payload: { confirmedUnit: 'bottle', expectedVersion: 1 },
    });
    await app.inject({
      method: 'PATCH', url: `${url}/${inferred.json().id}`,
      payload: { status: 'purchased', expectedVersion: changed.json().version },
    });

    now = '2026-08-04T12:00:00.000Z';
    const repeated = await app.inject({ method: 'POST', url, payload: { input: '2 milk' } });
    expect(repeated.json()).toMatchObject({ unit: 'bottle', unitSource: 'history' });
    await app.close();
  });

  it('clears and restores structured quantity and unit details', async () => {
    const app = await buildApp({ databasePath: ':memory:' });
    const url = '/api/v1/households/household-demo/items';
    const created = await app.inject({ method: 'POST', url, payload: { input: '2 kg potatoes' } });

    const cleared = await app.inject({
      method: 'PATCH', url: `${url}/${created.json().id}`,
      payload: { quantity: null, confirmedUnit: null, expectedVersion: 1 },
    });
    expect(cleared.statusCode, cleared.body).toBe(200);
    expect(cleared.json()).toMatchObject({
      quantity: null,
      unit: null,
      unitSource: null,
      unitConfirmedAt: null,
      attentionReasons: ['missing_quantity'],
      version: 2,
    });

    const completed = await app.inject({
      method: 'PATCH', url: `${url}/${created.json().id}`,
      payload: { quantity: 3, expectedVersion: 2 },
    });
    expect(completed.json()).toMatchObject({ quantity: 3, attentionReasons: [], version: 3 });
    await app.close();
  });

  it('edits and reopens an item with optimistic concurrency', async () => {
    const app = await buildApp({ databasePath: ':memory:' });
    const url = '/api/v1/households/household-demo/items';
    const created = await app.inject({ method: 'POST', url, payload: { name: 'Bread' } });
    const itemId = created.json().id as string;

    const edited = await app.inject({
      method: 'PATCH',
      url: `${url}/${itemId}`,
      payload: { name: 'Whole grain bread', expectedVersion: 1 },
    });
    expect(edited.statusCode).toBe(200);
    expect(edited.json()).toMatchObject({ name: 'Whole grain bread', version: 2 });

    const reopened = await app.inject({
      method: 'PATCH',
      url: `${url}/${itemId}`,
      payload: { status: 'active', expectedVersion: 2 },
    });
    expect(reopened.statusCode).toBe(200);
    expect(reopened.json()).toMatchObject({ status: 'active', version: 3 });
    await app.close();
  });

  it('rejects a stale update without overwriting the current item', async () => {
    const app = await buildApp({ databasePath: ':memory:' });
    const url = '/api/v1/households/household-demo/items';
    const created = await app.inject({ method: 'POST', url, payload: { name: 'Eggs' } });
    const itemId = created.json().id as string;

    await app.inject({ method: 'PATCH', url: `${url}/${itemId}`, payload: { name: 'Free range eggs', expectedVersion: 1 } });
    const stale = await app.inject({
      method: 'PATCH',
      url: `${url}/${itemId}`,
      payload: { name: 'Brown eggs', expectedVersion: 1 },
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toMatchObject({ error: 'item_version_conflict', currentItem: { name: 'Free range eggs', version: 2 } });
    await app.close();
  });

  it('rejects a stale structured update without changing confirmed history', async () => {
    const app = await buildApp({ databasePath: ':memory:' });
    const url = '/api/v1/households/household-demo/items';
    const created = await app.inject({ method: 'POST', url, payload: { input: '2 kg potatoes' } });

    await app.inject({
      method: 'PATCH', url: `${url}/${created.json().id}`,
      payload: { quantity: 3, expectedVersion: 1 },
    });
    const stale = await app.inject({
      method: 'PATCH', url: `${url}/${created.json().id}`,
      payload: { confirmedUnit: 'bag', expectedVersion: 1 },
    });

    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toMatchObject({
      error: 'item_version_conflict',
      currentItem: { quantity: 3, unit: 'kg', unitSource: 'explicit', version: 2 },
    });
    await app.close();
  });

  it('returns a duplicate conflict when an edit matches another active item', async () => {
    const app = await buildApp({ databasePath: ':memory:' });
    const url = '/api/v1/households/household-demo/items';
    const first = await app.inject({ method: 'POST', url, payload: { name: 'Milk' } });
    const second = await app.inject({ method: 'POST', url, payload: { name: 'Oat milk' } });
    const response = await app.inject({
      method: 'PATCH',
      url: `${url}/${second.json().id}`,
      payload: { name: ' milk ', expectedVersion: 1 },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ error: 'duplicate_item', existingItemId: first.json().id });
    await app.close();
  });
});
