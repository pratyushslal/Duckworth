import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';

describe('OpenAPI contract', () => {
  it('describes the versioned shopping and event endpoints', async () => {
    const app = await buildApp({ databasePath: ':memory:' });
    await app.ready();
    const document = app.swagger() as { paths: Record<string, unknown> };
    expect(document.paths['/api/v1/households/{householdId}/items']).toBeDefined();
    expect(document.paths['/api/v1/households/{householdId}/items/{itemId}']).toBeDefined();
    expect(document.paths['/api/v1/households/{householdId}/events']).toBeDefined();
    await app.close();
  });

  it('publishes structured capture, attention, and update schemas', async () => {
    const app = await buildApp({ databasePath: ':memory:' });
    await app.ready();
    const document = app.swagger() as any;
    const item = Object.values(document.components.schemas).find(
      (schema: any) => schema.title === 'ShoppingItem',
    ) as any;
    const collection = document.paths['/api/v1/households/{householdId}/items'];
    const member = document.paths['/api/v1/households/{householdId}/items/{itemId}'];
    const createBody = collection.post.requestBody.content['application/json'].schema;
    const patchBody = member.patch.requestBody.content['application/json'].schema;

    expect(item.required).toEqual(expect.arrayContaining([
      'captureText', 'quantity', 'unit', 'unitSource', 'unitConfirmedAt', 'attentionReasons',
    ]));
    expect(item.properties.unitSource.anyOf[0].enum).toEqual(['explicit', 'history']);
    expect(item.properties.attentionReasons.items.enum).toEqual([
      'missing_quantity', 'unconfirmed_historical_unit',
    ]);
    expect(createBody.oneOf).toHaveLength(2);
    expect(createBody.properties).toHaveProperty('confirmedUnit');
    expect(patchBody.properties).toMatchObject({
      quantity: { anyOf: expect.any(Array) },
      confirmedUnit: { anyOf: expect.any(Array) },
    });
    await app.close();
  });
});
