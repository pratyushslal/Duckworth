import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp } from '../src/app.js';

describe('semantic correction transactional persistence', () => {
  it('replays a committed correction after an API restart with immutable provenance', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'duckworth-correction-transaction-'));
    const databasePath = join(directory, 'duckworth.sqlite');
    let app = await buildApp({ databasePath });
    try {
      const created = await app.inject({
        method: 'POST',
        url: '/api/v1/households/transactional/items',
        payload: { input: 'milk' },
      });
      const item = created.json();
      const command = {
        schemaVersion: 1,
        idempotencyKey: 'transactional-correction-1',
        itemId: item.id,
        expectedItemVersion: item.version,
        source: { captureInputId: 'capture-transactional-1', operationIndex: 0, sourceStart: 0, sourceEnd: 4, rawClause: 'milk' },
        corrected: { canonicalLabel: 'Whole milk', quantity: 2, unitId: 'piece' },
        learn: { mode: 'future_matching_items', scope: 'household' },
      };
      const committed = await app.inject({
        method: 'POST',
        url: `/api/v2/households/transactional/items/${item.id}/semantic-corrections`,
        payload: command,
      });
      expect(committed.statusCode, committed.body).toBe(200);
      expect(committed.json().correction.eventId).toMatch(/^[0-9a-f-]{36}$/);
      await app.close();

      app = await buildApp({ databasePath });
      const replay = await app.inject({
        method: 'POST',
        url: `/api/v2/households/transactional/items/${item.id}/semantic-corrections`,
        payload: command,
      });
      expect(replay.statusCode, replay.body).toBe(200);
      expect(replay.json()).toMatchObject({
        correction: { replayed: true, idempotencyKey: command.idempotencyKey },
        item: { name: 'Whole milk', quantity: 2, version: 2 },
        overlayRevision: 1,
      });
    } finally {
      await app.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('rolls back the item update when classification validation fails', async () => {
    const app = await buildApp({ databasePath: ':memory:' });
    try {
      const created = await app.inject({
        method: 'POST',
        url: '/api/v1/households/transactional-rollback/items',
        payload: { input: 'milk' },
      });
      const item = created.json();
      const failed = await app.inject({
        method: 'POST',
        url: `/api/v2/households/transactional-rollback/items/${item.id}/semantic-corrections`,
        payload: {
          schemaVersion: 1,
          idempotencyKey: 'transactional-rollback-1',
          itemId: item.id,
          expectedItemVersion: item.version,
          source: { captureInputId: 'capture-rollback-1', operationIndex: 0, sourceStart: 0, sourceEnd: 4, rawClause: 'milk' },
          corrected: { canonicalLabel: 'Whole milk', shopTypeDecisions: [{ tagId: 'shop.missing', decision: 'include' }] },
          learn: { mode: 'future_matching_items', scope: 'household' },
        },
      });
      expect(failed.statusCode).toBe(500);
      const listed = await app.inject({ method: 'GET', url: '/api/v1/households/transactional-rollback/items' });
      expect(listed.json()).toMatchObject([{ id: item.id, name: 'milk', version: 1 }]);
    } finally {
      await app.close();
    }
  });
});
