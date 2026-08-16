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
    expect(document.paths['/api/v1/language-packs/countries/{countryCode}/manifest']).toBeDefined();
    expect(document.paths['/api/v1/language-packs/{locale}/{version}']).toBeDefined();
    expect(document.paths['/api/v2/households/{householdId}/brain/captures']).toBeDefined();
    expect(document.paths['/api/v2/households/{householdId}/brain/runtime-settings']).toBeDefined();
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
    expect(item.properties.unitSource.anyOf[0].enum).toEqual([
      'explicit', 'history', 'catalog_default', 'policy_default',
    ]);
    expect(item.properties.attentionReasons.items.enum).toEqual([
      'missing_quantity', 'unconfirmed_historical_unit',
    ]);
    expect(createBody.oneOf).toHaveLength(2);
    expect(createBody.properties).toHaveProperty('confirmedUnit');
    expect(patchBody.properties).toMatchObject({
      quantity: { anyOf: expect.any(Array) },
      confirmedUnit: { anyOf: expect.any(Array) },
    });
    const brainBody = document.paths['/api/v2/households/{householdId}/brain/captures']
      .post.requestBody.content['application/json'].schema;
    expect(brainBody.required).toEqual(expect.arrayContaining([
      'schemaVersion', 'inputId', 'householdId', 'contextId', 'shoppingListId',
      'source', 'text', 'locale', 'countryCode', 'occurredAt', 'idempotencyKey',
    ]));
    expect(brainBody.properties.source.required).toEqual(['kind']);
    await app.close();
  });

  it('publishes complete language-pack manifest and artifact schemas', async () => {
    const app = await buildApp({ databasePath: ':memory:' });
    await app.ready();
    const document = app.swagger() as any;
    const manifestOperation = document.paths['/api/v1/language-packs/countries/{countryCode}/manifest'].get;
    const artifactOperation = document.paths['/api/v1/language-packs/{locale}/{version}'].get;
    const manifestSchema = manifestOperation.responses['200'].content['application/json'].schema;
    const artifactSchema = artifactOperation.responses['200'].content['application/json'].schema;

    expect(manifestSchema.properties).toMatchObject({
      checksum: { type: 'string' },
      defaultLocale: { type: 'string' },
      bridgeLocales: { type: 'array' },
      locales: { type: 'array' },
    });
    expect(manifestSchema.properties.locales.items.properties).toMatchObject({
      locale: { type: 'string' },
      version: { type: 'string' },
      checksum: { type: 'string' },
      artifactPath: { type: 'string' },
      fallbacks: { type: 'array' },
    });
    expect(artifactSchema.properties).toMatchObject({
      checksum: { type: 'string' },
      locale: { type: 'string' },
      version: { type: 'string' },
      fallbacks: { type: 'array' },
      ui: { type: 'object' },
      items: { type: 'array' },
      units: { type: 'array' },
    });
    await app.close();
  });
});
