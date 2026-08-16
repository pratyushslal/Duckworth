import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';

describe('v2 shopping brain contract', () => {
  it('resolves the active runtime from household settings before request metadata', async () => {
    const app = await buildApp({ databasePath: ':memory:' });
    try {
      const settings = await app.inject({
        method: 'PUT',
        url: '/api/v2/households/runtime-settings-household/brain/runtime-settings',
        payload: { locale: 'en-IN', countryCode: 'IN' },
      });
      expect(settings.statusCode, settings.body).toBe(200);
      const registration = await app.inject({
        method: 'POST',
        url: '/api/v1/households/runtime-settings-household/conversation-contexts',
        payload: { deviceId: 'settings-device' },
      });
      const { context, accessToken } = registration.json() as {
        context: { id: string };
        accessToken: string;
      };
      const captured = await app.inject({
        method: 'POST',
        url: '/api/v2/households/runtime-settings-household/brain/captures',
        headers: { 'x-conversation-context-token': accessToken },
        payload: {
          schemaVersion: 2,
          inputId: 'household-runtime-selection',
          householdId: 'runtime-settings-household',
          contextId: context.id,
          shoppingListId: 'default:runtime-settings-household',
          source: { kind: 'text', deviceId: 'settings-device' },
          text: 'milk',
          locale: 'fr-FR',
          countryCode: 'FR',
          occurredAt: '2026-08-12T08:00:00.000Z',
          idempotencyKey: 'household-runtime-selection',
        },
      });
      expect(captured.statusCode, captured.body).toBe(201);
      expect(captured.json().facts.saved[0].item.conceptId.value).toBe('grocery.milk.dairy');
    } finally {
      await app.close();
    }
  });

  it('keeps the v1 capture route as an output translation of the v2 brain facade', async () => {
    const app = await buildApp({ databasePath: ':memory:' });
    try {
      const legacy = await app.inject({
        method: 'POST',
        url: '/api/v1/households/legacy-adapter/conversation-captures',
        payload: { text: '4 milk pouches of 1 litre each', source: 'text' },
      });
      expect(legacy.statusCode, legacy.body).toBe(201);

      const registration = await app.inject({
        method: 'POST',
        url: '/api/v1/households/v2-adapter/conversation-contexts',
        payload: { deviceId: 'contract-device' },
      });
      const { context, accessToken } = registration.json() as {
        context: { id: string };
        accessToken: string;
      };
      const modern = await app.inject({
        method: 'POST',
        url: '/api/v2/households/v2-adapter/brain/captures',
        headers: { 'x-conversation-context-token': accessToken },
        payload: {
          schemaVersion: 2,
          inputId: 'v1-v2-equivalence',
          householdId: 'v2-adapter',
          contextId: context.id,
          shoppingListId: 'default:v2-adapter',
          source: { kind: 'text', deviceId: 'contract-device' },
          text: '4 milk pouches of 1 litre each',
          locale: 'en-IN',
          countryCode: 'IN',
          occurredAt: '2026-08-12T08:00:00.000Z',
          idempotencyKey: 'v1-v2-equivalence',
        },
      });
      expect(modern.statusCode, modern.body).toBe(201);

      const legacyItem = legacy.json().saved[0];
      const modernItem = modern.json().facts.saved[0].item;
      expect({
        name: legacyItem.name,
        quantity: legacyItem.quantity,
        unit: legacyItem.unit,
        packageSize: legacyItem.packageSize,
        packageUnit: legacyItem.packageUnit,
        categoryId: legacyItem.categoryId,
      }).toEqual({
        name: modernItem.itemName.value,
        quantity: modernItem.requestedCount.value,
        unit: modernItem.requestedUnitId.value,
        packageSize: modernItem.packageMeasure.value.value,
        packageUnit: modernItem.packageMeasure.value.unitId,
        categoryId: modernItem.categoryId.value,
      });
    } finally {
      await app.close();
    }
  });

  it('revalidates legacy accepted suggestions before committing', async () => {
    const app = await buildApp({ databasePath: ':memory:' });
    try {
      const text = 'maggie noo 2 packs of 70 g';
      const acceptedSuggestion = {
        reference: `local:product.maggi.noodles:${encodeURIComponent(text)}`,
        originalText: text,
        replacement: { start: 0, end: 10, replacementText: 'Maggi noodles' },
        productId: 'product.maggi.noodles',
        conceptId: 'grocery.noodles',
        brandId: 'brand.maggi',
      };
      const accepted = await app.inject({
        method: 'POST',
        url: '/api/v1/households/legacy-suggestion/conversation-captures',
        payload: { text, acceptedSuggestion },
      });
      expect(accepted.statusCode, accepted.body).toBe(201);
      expect(accepted.json().saved[0]).toMatchObject({ name: 'Maggi noodles', quantity: 2, unit: 'pack', packageSize: 70, packageUnit: 'g' });

      const stale = await app.inject({
        method: 'POST',
        url: '/api/v1/households/legacy-suggestion-stale/conversation-captures',
        payload: {
          text,
          acceptedSuggestion: { ...acceptedSuggestion, productId: 'product.not-current' },
        },
      });
      expect(stale.statusCode, stale.body).toBe(409);
      expect(stale.json()).toEqual({ error: 'suggestion_stale' });
    } finally {
      await app.close();
    }
  });

  it('persists the original v1 capture and exposes the interpretation for inspection', async () => {
    const app = await buildApp({ databasePath: ':memory:' });
    try {
      const captured = await app.inject({
        method: 'POST',
        url: '/api/v1/households/audit-household/conversation-captures',
        payload: {
          text: '200 ml Thums Up x 24 pieces',
          source: 'text',
          idempotencyKey: 'audit-capture-1',
        },
      });
      expect(captured.statusCode, captured.body).toBe(201);
      const body = captured.json() as {
        captureAudit: {
          inputId: string;
          text: string;
          engineVersion: string;
          operations: Array<{ kind: string; itemName?: string; quantity?: number | null; unit?: string | null }>;
        };
      };
      expect(body.captureAudit.text).toBe('200 ml Thums Up x 24 pieces');
      expect(body.captureAudit.engineVersion).toBe('shopping-brain-v2');
      expect(body.captureAudit.operations).toEqual(expect.arrayContaining([
        expect.objectContaining({ kind: 'create', itemName: 'Thums Up', quantity: 24, unit: 'piece' }),
      ]));

      const inspected = await app.inject({
        method: 'GET',
        url: `/api/v2/households/audit-household/brain/captures/${encodeURIComponent(body.captureAudit.inputId)}`,
      });
      expect(inspected.statusCode, inspected.body).toBe(200);
      expect(inspected.json().envelope.text).toBe('200 ml Thums Up x 24 pieces');
      expect(inspected.json().result.operations[0].item.itemName.value).toBe('Thums Up');

      const exported = await app.inject({
        method: 'GET',
        url: '/api/v2/households/audit-household/brain/captures?limit=10',
      });
      expect(exported.statusCode, exported.body).toBe(200);
      expect(exported.json().retention).toEqual({ days: 90 });
      expect(exported.json().captures[0].envelope.text).toBe('200 ml Thums Up x 24 pieces');

      const deleted = await app.inject({
        method: 'DELETE',
        url: `/api/v2/households/audit-household/brain/captures/${encodeURIComponent(body.captureAudit.inputId)}`,
      });
      expect(deleted.statusCode, deleted.body).toBe(204);
      expect((await app.inject({ method: 'GET', url: `/api/v2/households/audit-household/brain/captures/${encodeURIComponent(body.captureAudit.inputId)}` })).statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });

  it('returns source-neutral semantics and records non-authoritative transcript alternatives', async () => {
    const app = await buildApp({ databasePath: ':memory:' });
    try {
      const sources = ['text', 'voice-transcript', 'api', 'assistant'];
      const responses = await Promise.all(sources.map(async (source, index) => {
        const householdId = `contract-household-${index}`;
        const registration = await app.inject({
          method: 'POST',
          url: `/api/v1/households/${householdId}/conversation-contexts`,
          payload: { deviceId: `device-${index}` },
        });
        const registered = registration.json() as { context: { id: string }; accessToken: string };
        const response = await app.inject({
          method: 'POST',
          url: `/api/v2/households/${householdId}/brain/captures`,
          headers: { 'x-conversation-context-token': registered.accessToken },
          payload: {
            schemaVersion: 2,
            inputId: `input-${index}`,
            householdId,
            contextId: registered.context.id,
            shoppingListId: `default:${householdId}`,
            source: { kind: source, deviceId: `device-${index}` },
            text: 'Amul Butter',
            alternatives: source === 'voice-transcript' ? [{ text: 'Britannia biscuits', confidence: 0.99 }] : undefined,
            locale: 'en-IN',
            countryCode: 'IN',
            occurredAt: '2026-08-12T08:00:00.000Z',
            idempotencyKey: `key-${index}`,
          },
        });
        expect(response.statusCode, response.body).toBe(201);
        return response.json();
      }));

      const operations = responses.map(({ result }) => result.operations);
      expect(operations.slice(1)).toEqual(operations.slice(1).map(() => operations[0]));
      expect(operations[0][0]).toMatchObject({
        kind: 'create',
        item: { itemName: { value: 'Amul Butter' } },
      });
      expect(responses[1].provenance.envelope.alternatives).toEqual([
        { text: 'Britannia biscuits', confidence: 0.99 },
      ]);
      expect(responses[1].facts.saved[0].item.itemName.value).toBe('Amul Butter');
    } finally {
      await app.close();
    }
  });
});
