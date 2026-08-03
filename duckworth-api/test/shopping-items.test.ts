import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';

describe('shopping item endpoints', () => {
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
