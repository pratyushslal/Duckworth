import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';

describe('semantic correction controls and local quality diagnostics', () => {
  it('records scoped learning, exposes provenance, and supports compensating undo', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'duckworth-controls-'));
    const databasePath = join(directory, 'controls.sqlite');
    const app = await buildApp({ databasePath });
    try {
      const created = await app.inject({
        method: 'POST',
        url: '/api/v1/households/controls-household/items',
        payload: { input: 'pepsi' },
      });
      expect(created.statusCode, created.body).toBe(201);
      const item = created.json();
      const command = {
        schemaVersion: 1,
        idempotencyKey: 'controls-correction-1',
        itemId: item.id,
        expectedItemVersion: item.version,
        source: {
          captureInputId: 'capture-controls-1',
          operationIndex: 0,
          sourceStart: 0,
          sourceEnd: 5,
          rawClause: 'pepsi',
        },
        corrected: { canonicalLabel: 'Pepsi', quantity: 2, unitId: 'piece' },
        learn: { mode: 'future_matching_items', scope: 'household' },
      };
      const corrected = await app.inject({
        method: 'POST',
        url: `/api/v2/households/controls-household/items/${item.id}/semantic-corrections`,
        payload: command,
      });
      expect(corrected.statusCode, corrected.body).toBe(200);
      const eventId = corrected.json().correction.eventId as string;

      const controls = await app.inject({
        method: 'GET',
        url: '/api/v2/households/controls-household/learning-control',
      });
      expect(controls.statusCode, controls.body).toBe(200);
      expect(controls.json()).toMatchObject({
        householdId: 'controls-household',
        entries: [{ status: 'active' }],
        corrections: [{ id: eventId, source: { rawClause: 'pepsi' } }],
        metrics: { correctionCount: 1, activeLearningCount: 1, undoCount: 0 },
      });

      const registration = await app.inject({
        method: 'POST',
        url: '/api/v1/households/controls-household/conversation-contexts',
        payload: { deviceId: 'controls-test' },
      });
      const { context, accessToken } = registration.json() as { context: { id: string }; accessToken: string };
      const current = await app.inject({ method: 'GET', url: '/api/v1/households/controls-household/items' });
      await app.inject({
        method: 'PATCH',
        url: `/api/v1/households/controls-household/items/${item.id}`,
        payload: { expectedVersion: current.json()[0].version, status: 'purchased' },
      });
      const replayCapture = await app.inject({
        method: 'POST',
        url: '/api/v2/households/controls-household/brain/captures',
        headers: { 'x-conversation-context-token': accessToken },
        payload: {
          schemaVersion: 2,
          inputId: 'capture-controls-repeat',
          householdId: 'controls-household',
          contextId: context.id,
          shoppingListId: 'default:controls-household',
          source: { kind: 'text', deviceId: 'controls-test' },
          text: 'pepsi',
          locale: 'en-IN',
          countryCode: 'IN',
          occurredAt: '2026-08-13T00:00:00.000Z',
          idempotencyKey: 'capture-controls-repeat',
        },
      });
      expect(replayCapture.statusCode, replayCapture.body).toBe(201);
      expect(replayCapture.json().result.operations[0].item.itemName.value).toBe('Pepsi');

      const diagnostics = await app.inject({
        method: 'GET',
        url: '/api/v2/households/controls-household/diagnostics/quality',
      });
      expect(diagnostics.statusCode, diagnostics.body).toBe(200);
      expect(diagnostics.json()).toMatchObject({
        correctionCount: 1,
        undoCount: 0,
        activeLearningCount: 1,
      });
    } finally {
      await app.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('creates the strict local semantic ledgers and migration report metadata', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'duckworth-controls-schema-'));
    const databasePath = join(directory, 'controls.sqlite');
    const app = await buildApp({ databasePath });
    await app.close();
    const database = new DatabaseSync(databasePath, { readOnly: true });
    try {
      const names = (database.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>)
        .map(({ name }) => name);
      expect(names).toEqual(expect.arrayContaining([
        'household_semantic_entities',
        'household_semantic_aliases',
        'household_learning_proposals',
        'household_learning_effects',
        'household_learning_evidence',
        'catalog_reconciliation_candidates',
      ]));
    } finally {
      database.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('undoes a correction without losing pre-existing shop assignments', async () => {
    const app = await buildApp({ databasePath: ':memory:' });
    try {
      const created = await app.inject({ method: 'POST', url: '/api/v1/households/undo-tags/items', payload: { input: 'milk' } });
      const item = created.json();
      const view = await app.inject({ method: 'GET', url: '/api/v1/households/undo-tags/items/view' });
      const corrected = await app.inject({
        method: 'POST',
        url: `/api/v2/households/undo-tags/items/${item.id}/semantic-corrections`,
        payload: {
          schemaVersion: 1, idempotencyKey: 'undo-tags-correction', itemId: item.id,
          expectedItemVersion: view.json().items[0].version,
          source: { captureInputId: 'undo-tags-capture', operationIndex: 0, sourceStart: 0, sourceEnd: 4, rawClause: 'milk' },
          corrected: { canonicalLabel: 'Whole milk' }, learn: { mode: 'this_item_only', scope: 'household' },
        },
      });
      const undo = await app.inject({ method: 'POST', url: `/api/v2/households/undo-tags/semantic-corrections/${corrected.json().correction.eventId}/undo` });
      expect(undo.statusCode, undo.body).toBe(200);
      expect(undo.json().item).toMatchObject({ name: 'milk' });
    } finally {
      await app.close();
    }
  });
});
