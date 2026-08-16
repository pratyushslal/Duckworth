import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import type { BrainCaptureEnvelope, BrainResult, SemanticItem } from '@duckworth/shopping-intelligence';
import { BrainCaptureStore } from '../src/brain-captures.js';
import { buildApp } from '../src/app.js';

function envelope(): BrainCaptureEnvelope {
  return {
    schemaVersion: 2,
    inputId: 'input-1',
    householdId: 'household-1',
    contextId: 'context-1',
    shoppingListId: 'list-1',
    source: { kind: 'text', deviceId: 'device-1' },
    text: 'milk; ???',
    locale: 'en-IN',
    countryCode: 'IN',
    occurredAt: '2026-08-12T08:00:00.000Z',
    idempotencyKey: 'capture-1',
  };
}

function item(text: string): SemanticItem {
  return {
    itemName: { value: text, confidence: 'confirmed', evidence: [{ kind: 'source_span', sourceStart: 0, sourceEnd: 4 }] },
    conceptId: { value: null, confidence: 'unknown', evidence: [] },
    brandId: { value: null, confidence: 'unknown', evidence: [] },
    categoryId: { value: null, confidence: 'unknown', evidence: [] },
    requestedCount: { value: null, confidence: 'unknown', evidence: [] },
    requestedUnitId: { value: null, confidence: 'unknown', evidence: [] },
    packageMeasure: { value: null, confidence: 'unknown', evidence: [] },
    attributes: {},
    identity: { conceptKey: 'text:milk', variantKey: 'text:milk', requestKey: 'text:milk' },
  };
}

function result(): BrainResult {
  return {
    schemaVersion: 2,
    engineVersion: 'engine-test',
    runtimeVersions: { core: 'core-test', locale: 'locale-test' },
    capture: { inputId: 'input-1', text: 'milk; ???' },
    operations: [
      { kind: 'create', item: item('milk') },
      { kind: 'draft', draft: { reasonCode: 'unsupported', text: '???', sourceStart: 6, sourceEnd: 9, candidateIds: [] } },
    ],
    warnings: [],
  };
}

describe('brain capture persistence', () => {
  it('exposes a bounded audit export and reversibly deletes expired or requested raw captures', () => {
    const database = new DatabaseSync(':memory:');
    let now = new Date('2026-08-12T08:00:00.000Z');
    const store = new BrainCaptureStore(database, () => now, { retentionDays: 1 });
    const first = store.commit(envelope(), result());
    expect(first.expiresAt).toBe('2026-08-13T08:00:00.000Z');
    expect(store.list('household-1')).toHaveLength(1);
    expect(store.delete('other-household', 'input-1')).toBe(false);
    expect(store.delete('household-1', 'input-1')).toBe(true);
    expect(store.get('input-1')).toBeNull();

    const secondEnvelope = { ...envelope(), inputId: 'input-2', idempotencyKey: 'capture-2' };
    const secondResult = { ...result(), capture: { inputId: 'input-2', text: 'milk; ???' } };
    store.commit(secondEnvelope, secondResult);
    now = new Date('2026-08-14T08:00:00.000Z');
    expect(store.list('household-1')).toEqual([]);
  });

  it('applies an absolute correction and a scoped pronoun adjustment through durable context', async () => {
    const app = await buildApp({ databasePath: ':memory:' });
    try {
      const registration = await app.inject({
        method: 'POST',
        url: '/api/v1/households/brain-correction/conversation-contexts',
        payload: { deviceId: 'correction-device' },
      });
      const { context, accessToken } = registration.json() as {
        context: { id: string };
        accessToken: string;
      };
      const capture = (inputId: string, text: string) => app.inject({
        method: 'POST',
        url: '/api/v2/households/brain-correction/brain/captures',
        headers: { 'x-conversation-context-token': accessToken },
        payload: {
          schemaVersion: 2,
          inputId,
          householdId: 'brain-correction',
          contextId: context.id,
          shoppingListId: 'default:brain-correction',
          source: { kind: 'text', deviceId: 'correction-device' },
          text,
          locale: 'en-IN',
          countryCode: 'IN',
          occurredAt: '2026-08-12T08:00:00.000Z',
          idempotencyKey: inputId,
        },
      });

      expect((await capture('correction-create', 'milk')).statusCode).toBe(201);
      const corrected = await capture('correction-absolute', 'correct milk two packs');
      expect(corrected.statusCode, corrected.body).toBe(201);
      expect(corrected.json().result.operations[0]).toMatchObject({ kind: 'correct' });
      const pronoun = await capture('pronoun-additive', 'make it three packs');
      expect(pronoun.statusCode, pronoun.body).toBe(201);
      expect(pronoun.json().result.operations[0]).toMatchObject({ kind: 'merge' });

      const listed = await app.inject({
        method: 'GET',
        url: '/api/v1/households/brain-correction/items',
      });
      expect(listed.json()).toEqual([
        expect.objectContaining({ name: 'milk', quantity: 5, unit: 'pack' }),
      ]);
    } finally {
      await app.close();
    }
  });

  it('preserves reviewed product identity when a follow-up merge omits product details', async () => {
    const app = await buildApp({ databasePath: ':memory:' });
    try {
      const registration = await app.inject({
        method: 'POST',
        url: '/api/v1/households/product-merge/conversation-contexts',
        payload: { deviceId: 'product-merge-device' },
      });
      const { context, accessToken } = registration.json() as {
        context: { id: string };
        accessToken: string;
      };
      const capture = (inputId: string, text: string) => app.inject({
        method: 'POST',
        url: '/api/v2/households/product-merge/brain/captures',
        headers: { 'x-conversation-context-token': accessToken },
        payload: {
          schemaVersion: 2,
          inputId,
          householdId: 'product-merge',
          contextId: context.id,
          shoppingListId: 'default:product-merge',
          source: { kind: 'text', deviceId: 'product-merge-device' },
          text,
          locale: 'en-IN',
          countryCode: 'IN',
          occurredAt: '2026-08-12T08:00:00.000Z',
          idempotencyKey: inputId,
        },
      });

      const created = await capture('product-create', 'Amul Butter 1 pack 500 g');
      expect(created.statusCode, created.body).toBe(201);
      expect(created.json().result.operations[0].item.productId).toMatchObject({
        value: 'product.amul.butter',
      });

      const merged = await capture('product-merge', 'make it two packs');
      expect(merged.statusCode, merged.body).toBe(201);
      expect(merged.json().result.operations[0]).toMatchObject({ kind: 'merge' });

      const listed = await app.inject({
        method: 'GET',
        url: '/api/v1/households/product-merge/items',
      });
      expect(listed.json()).toEqual([
        expect.objectContaining({ name: 'Amul Butter', quantity: 3, productId: 'product.amul.butter' }),
      ]);
    } finally {
      await app.close();
    }
  });

  it('applies an accepted structured suggestion without losing protected quantities', async () => {
    const app = await buildApp({ databasePath: ':memory:' });
    try {
      const registration = await app.inject({
        method: 'POST',
        url: '/api/v1/households/suggestion-accept/conversation-contexts',
        payload: { deviceId: 'suggestion-device' },
      });
      const { context, accessToken } = registration.json() as { context: { id: string }; accessToken: string };
      const text = 'maggie noo 2 packs of 70 g';
      const acceptedText = 'Maggi noodles 2 packs of 70 g';
      const response = await app.inject({
        method: 'POST',
        url: '/api/v2/households/suggestion-accept/brain/captures',
        headers: { 'x-conversation-context-token': accessToken },
        payload: {
          schemaVersion: 2,
          inputId: 'suggestion-accept-1',
          householdId: 'suggestion-accept',
          contextId: context.id,
          shoppingListId: 'default:suggestion-accept',
          source: { kind: 'text', deviceId: 'suggestion-device' },
          text,
          acceptedSuggestion: {
            reference: `local:product.maggi.noodles:${encodeURIComponent(text)}`,
            originalText: text,
            replacement: { start: 0, end: 10, replacementText: 'Maggi noodles' },
            productId: 'product.maggi.noodles',
            conceptId: 'grocery.noodles',
            brandId: 'brand.maggi',
          },
          locale: 'en-IN',
          countryCode: 'IN',
          occurredAt: '2026-08-13T08:00:00.000Z',
          idempotencyKey: 'suggestion-accept-1',
        },
      });
      expect(response.statusCode, response.body).toBe(201);
      expect(response.json().result.capture.text).toBe(acceptedText);
      expect(response.json().result.operations[0].item).toMatchObject({
        itemName: { value: 'Maggi noodles' },
        requestedCount: { value: 2 },
        packageMeasure: { value: { value: 70, unitId: 'g' } },
        productId: { value: 'product.maggi.noodles' },
      });
    } finally {
      await app.close();
    }
  });

  it('atomically persists real projections, drafts, events, replay, scoped merge, and undo across restart', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'duckworth-brain-api-'));
    const databasePath = join(directory, 'duckworth.sqlite');
    const householdId = 'durable-household';
    let firstApp: Awaited<ReturnType<typeof buildApp>> | undefined;
    let reopenedApp: Awaited<ReturnType<typeof buildApp>> | undefined;
    try {
      firstApp = await buildApp({ databasePath });
      const registration = await firstApp.inject({
        method: 'POST',
        url: `/api/v1/households/${householdId}/conversation-contexts`,
        payload: { deviceId: 'durable-device', speakerId: 'speaker-a' },
      });
      const { context, accessToken } = registration.json() as {
        context: { id: string };
        accessToken: string;
      };
      const captureEnvelope: BrainCaptureEnvelope = {
        schemaVersion: 2,
        inputId: 'durable-input-1',
        householdId,
        contextId: context.id,
        shoppingListId: `default:${householdId}`,
        source: { kind: 'text', deviceId: 'durable-device', speakerId: 'speaker-a' },
        text: 'milk; ???',
        locale: 'en-IN',
        countryCode: 'IN',
        occurredAt: '2026-08-12T08:00:00.000Z',
        idempotencyKey: 'durable-key-1',
      };
      const first = await firstApp.inject({
        method: 'POST',
        url: `/api/v2/households/${householdId}/brain/captures`,
        headers: { 'x-conversation-context-token': accessToken },
        payload: captureEnvelope,
      });
      expect(first.statusCode, first.body).toBe(201);
      expect(first.json()).toMatchObject({
        facts: {
          saved: [{ itemId: expect.any(String), item: { itemName: { value: 'milk' } } }],
          drafts: [{ draftId: expect.any(String), text: '???', sourceStart: 6, sourceEnd: 9 }],
          undo: [],
        },
      });
      const firstBody = first.json();
      await firstApp.close();
      firstApp = undefined;

      const persisted = new DatabaseSync(databasePath);
      try {
        const captureRow = persisted.prepare(`
          SELECT result_json, committed_event_ids_json FROM brain_captures WHERE input_id = ?
        `).get(captureEnvelope.inputId) as { result_json: string; committed_event_ids_json: string };
        const eventIds = JSON.parse(captureRow.committed_event_ids_json) as string[];
        expect(eventIds).toHaveLength(1);
        expect(persisted.prepare('SELECT COUNT(*) AS count FROM shopping_item_events').get()).toEqual({ count: 1 });
        expect(persisted.prepare('SELECT text, source_start, source_end, status FROM brain_drafts').get())
          .toEqual({ text: '???', source_start: 6, source_end: 9, status: 'open' });
        expect(JSON.parse(captureRow.result_json)).toEqual(firstBody.result);
      } finally {
        persisted.close();
      }

      reopenedApp = await buildApp({ databasePath });
      const replay = await reopenedApp.inject({
        method: 'POST',
        url: `/api/v2/households/${householdId}/brain/captures`,
        headers: { 'x-conversation-context-token': accessToken },
        payload: captureEnvelope,
      });
      expect(replay.statusCode, replay.body).toBe(200);
      expect(replay.json()).toEqual(firstBody);

      const followUpEnvelope: BrainCaptureEnvelope = {
        ...captureEnvelope,
        inputId: 'durable-input-2',
        text: 'make milk two packs',
        occurredAt: '2026-08-12T08:01:00.000Z',
        idempotencyKey: 'durable-key-2',
      };
      const followUp = await reopenedApp.inject({
        method: 'POST',
        url: `/api/v2/households/${householdId}/brain/captures`,
        headers: { 'x-conversation-context-token': accessToken },
        payload: followUpEnvelope,
      });
      expect(followUp.statusCode, followUp.body).toBe(201);
      expect(followUp.json()).toMatchObject({
        facts: {
          saved: [],
          merged: [{ itemId: firstBody.facts.saved[0].itemId }],
          undo: [{ eventId: expect.any(String), itemId: firstBody.facts.saved[0].itemId }],
        },
      });
      const mergedItem = (await reopenedApp.inject({
        method: 'GET',
        url: `/api/v1/households/${householdId}/items`,
      })).json()[0];
      expect(mergedItem).toMatchObject({ id: firstBody.facts.saved[0].itemId, quantity: 2, unit: 'pack' });

      const undo = await reopenedApp.inject({
        method: 'POST',
        url: `/api/v1/households/${householdId}/shopping-item-events/${followUp.json().facts.undo[0].eventId}/undo`,
      });
      expect(undo.statusCode, undo.body).toBe(200);
      expect(undo.json().item).toMatchObject({
        id: firstBody.facts.saved[0].itemId,
        quantity: 1,
        unit: 'piece',
        categoryId: 'grocery',
      });
      await reopenedApp.close();
      reopenedApp = undefined;
    } finally {
      await firstApp?.close();
      await reopenedApp?.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('survives restart and replays an idempotency key without appending events', () => {
    const directory = mkdtempSync(join(tmpdir(), 'duckworth-brain-'));
    const databasePath = join(directory, 'duckworth.sqlite');
    try {
      const firstDatabase = new DatabaseSync(databasePath);
      const firstStore = new BrainCaptureStore(firstDatabase, () => new Date('2026-08-12T08:01:00.000Z'));
      const stored = firstStore.commit(envelope(), result(), ['event-1']);
      expect(stored).toEqual({
        envelope: envelope(),
        result: result(),
        committedEventIds: ['event-1'],
        createdAt: '2026-08-12T08:01:00.000Z',
        expiresAt: '2026-11-10T08:01:00.000Z',
      });
      expect(firstStore.commit(envelope(), result(), ['event-2'])).toEqual(stored);
      firstDatabase.close();

      const reopenedDatabase = new DatabaseSync(databasePath);
      const reopened = new BrainCaptureStore(reopenedDatabase).get('input-1');
      expect(reopened).toEqual(stored);
      expect(new BrainCaptureStore(reopenedDatabase).findByIdempotencyKey('context-1', 'capture-1')).toEqual(stored);
      reopenedDatabase.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('records pre-v2 rows as unknown semantics with migration provenance', () => {
    const database = new DatabaseSync(':memory:');
    database.exec(`
      CREATE TABLE shopping_items (
        id TEXT PRIMARY KEY,
        household_id TEXT NOT NULL,
        shopping_list_id TEXT,
        capture_text TEXT NOT NULL,
        name TEXT NOT NULL,
        created_at TEXT NOT NULL
      ) STRICT;
      INSERT INTO shopping_items VALUES
        ('legacy-1', 'household-1', 'list-1', 'two mystery widgets', 'mystery widgets', '2026-08-01T00:00:00.000Z');
    `);

    const migrated = new BrainCaptureStore(database).get('migration:legacy-1');
    expect(migrated?.result).toMatchObject({
      engineVersion: 'migration-v1-to-v2',
      runtimeVersions: { migration: 'legacy-unknown' },
      operations: [{
        kind: 'create',
        item: {
          itemName: { value: 'mystery widgets' },
          conceptId: { value: null, confidence: 'unknown' },
          brandId: { value: null, confidence: 'unknown' },
          categoryId: { value: null, confidence: 'unknown' },
        },
      }],
    });
    database.close();
  });
});
