import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';

describe('shopping item endpoints', () => {
  it('creates and lists an active item for a household', async () => {
    const app = await buildApp({ databasePath: ':memory:' });

    const created = await app.inject({
      method: 'POST',
      url: '/api/households/household-demo/items',
      payload: { name: '  Milk  ' },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ name: 'Milk', status: 'active' });

    const listed = await app.inject({
      method: 'GET',
      url: '/api/households/household-demo/items',
    });
    expect(listed.statusCode).toBe(200);
    expect(listed.json()).toHaveLength(1);
    expect(listed.json()[0]).toMatchObject({ name: 'Milk', status: 'active' });

    await app.close();
  });

  it('returns a conflict for a normalized duplicate', async () => {
    const app = await buildApp({ databasePath: ':memory:' });
    const url = '/api/households/household-demo/items';

    await app.inject({ method: 'POST', url, payload: { name: 'Milk' } });
    const duplicate = await app.inject({ method: 'POST', url, payload: { name: ' milk ' } });

    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json()).toMatchObject({ error: 'duplicate_item' });
    await app.close();
  });

  it('marks an item purchased and excludes it from the active list', async () => {
    const app = await buildApp({ databasePath: ':memory:' });
    const url = '/api/households/household-demo/items';
    const created = await app.inject({ method: 'POST', url, payload: { name: 'Bread' } });
    const itemId = created.json().id as string;

    const updated = await app.inject({
      method: 'PATCH',
      url: `${url}/${itemId}`,
      payload: { status: 'purchased' },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json()).toMatchObject({ id: itemId, status: 'purchased' });

    const listed = await app.inject({ method: 'GET', url });
    expect(listed.json()).toEqual([]);
    await app.close();
  });
});
