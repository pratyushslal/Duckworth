import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';

describe('structured semantic correction fields', () => {
  it('commits identity, descriptor, package-container, and role corrections to the semantic snapshot', async () => {
    const app = await buildApp({ databasePath: ':memory:' });
    try {
      const created = await app.inject({
        method: 'POST',
        url: '/api/v1/households/structured-correction/items',
        payload: { input: 'tonic' },
      });
      const item = created.json();
      const corrected = await app.inject({
        method: 'POST',
        url: `/api/v2/households/structured-correction/items/${item.id}/semantic-corrections`,
        payload: {
          schemaVersion: 1,
          idempotencyKey: 'structured-correction-1',
          itemId: item.id,
          expectedItemVersion: item.version,
          source: {
            captureInputId: 'legacy-item-capture',
            operationIndex: 0,
            sourceStart: 0,
            sourceEnd: 5,
            rawClause: 'tonic',
          },
          corrected: {
            canonicalLabel: 'Orion Tonic',
            conceptRef: { kind: 'catalog', id: 'grocery.milk.dairy' },
            brandRef: { kind: 'catalog', id: 'brand.maggi' },
            unitId: 'pack',
            packageContainerUnitId: 'pack',
            packageSize: 500,
            packageUnitId: 'g',
            descriptors: [{ attributeId: 'fat_level', valueId: 'whole', role: 'identity_attribute' }],
            brandRoles: [{ role: 'manufacturer', organizationRef: { kind: 'catalog', id: 'org.nestle' } }],
          },
          learn: { mode: 'future_matching_items', scope: 'household' },
        },
      });
      expect(corrected.statusCode, corrected.body).toBe(200);
      expect(corrected.json().item.name).toBe('Orion Tonic');
      expect(corrected.json().learningEntries).toEqual(expect.any(Array));
      expect(app).toBeDefined();
    } finally {
      await app.close();
    }
  });

  it('rejects a correction span that is not inside the stored capture', async () => {
    const app = await buildApp({ databasePath: ':memory:' });
    try {
      const created = await app.inject({ method: 'POST', url: '/api/v1/households/span-correction/items', payload: { input: 'milk' } });
      const item = created.json();
      const response = await app.inject({
        method: 'POST',
        url: `/api/v2/households/span-correction/items/${item.id}/semantic-corrections`,
        payload: {
          schemaVersion: 1, idempotencyKey: 'bad-span', itemId: item.id, expectedItemVersion: item.version,
          source: { captureInputId: 'missing-capture', operationIndex: 0, sourceStart: 0, sourceEnd: 30, rawClause: 'not the stored clause' },
          corrected: { canonicalLabel: 'Milk' }, learn: { mode: 'this_item_only', scope: 'household' },
        },
      });
      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({ error: 'invalid_correction_source' });
    } finally {
      await app.close();
    }
  });

  it('creates a household-local brand when a correction confirms a new brand identity', async () => {
    const app = await buildApp({ databasePath: ':memory:' });
    try {
      const created = await app.inject({ method: 'POST', url: '/api/v1/households/local-brand/items', payload: { input: 'tonic' } });
      const item = created.json();
      const response = await app.inject({
        method: 'POST',
        url: `/api/v2/households/local-brand/items/${item.id}/semantic-corrections`,
        payload: {
          schemaVersion: 1, idempotencyKey: 'local-brand-correction', itemId: item.id, expectedItemVersion: item.version,
          source: { captureInputId: 'missing-capture', operationIndex: 0, sourceStart: 0, sourceEnd: 5, rawClause: 'tonic' },
          corrected: { canonicalLabel: 'Orion Tonic', brandRef: { kind: 'household', id: 'household:local-brand:brand:orion' } },
          learn: { mode: 'future_matching_items', scope: 'household' },
        },
      });
      expect(response.statusCode, response.body).toBe(200);
      expect(response.json().item.brandId).toBe('household:local-brand:brand:orion');
    } finally {
      await app.close();
    }
  });
});
