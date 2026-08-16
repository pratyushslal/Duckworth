import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';

describe('versioned semantic correction command', () => {
  it('applies a correction, replays the same idempotency key, and rejects stale versions', async () => {
    const app = await buildApp({ databasePath: ':memory:' });
    try {
      const created = await app.inject({
        method: 'POST',
        url: '/api/v1/households/correction-command/items',
        payload: { input: 'milk' },
      });
      expect(created.statusCode, created.body).toBe(201);
      const item = created.json();
      const command = {
        schemaVersion: 1,
        idempotencyKey: 'correction-command-1',
        itemId: item.id,
        expectedItemVersion: item.version,
        source: {
          captureInputId: 'capture-command-1',
          operationIndex: 0,
          sourceStart: 0,
          sourceEnd: 4,
          rawClause: 'milk',
        },
        corrected: {
          canonicalLabel: 'Whole milk',
          quantity: 2,
          unitId: 'piece',
        },
        learn: { mode: 'future_matching_items', scope: 'household' },
      };

      const first = await app.inject({
        method: 'POST',
        url: `/api/v2/households/correction-command/items/${item.id}/semantic-corrections`,
        payload: command,
      });
      expect(first.statusCode, first.body).toBe(200);
      expect(first.json()).toMatchObject({
        correction: { idempotencyKey: command.idempotencyKey, replayed: false },
        item: { id: item.id, name: 'Whole milk', quantity: 2, unit: 'piece' },
      });

      const replay = await app.inject({
        method: 'POST',
        url: `/api/v2/households/correction-command/items/${item.id}/semantic-corrections`,
        payload: command,
      });
      expect(replay.statusCode, replay.body).toBe(200);
      expect(replay.json()).toEqual({
        ...first.json(),
        correction: { ...first.json().correction, replayed: true },
      });

      const conflict = await app.inject({
        method: 'POST',
        url: `/api/v2/households/correction-command/items/${item.id}/semantic-corrections`,
        payload: { ...command, corrected: { canonicalLabel: 'Skimmed milk' } },
      });
      expect(conflict.statusCode, conflict.body).toBe(409);
      expect(conflict.json()).toMatchObject({ error: 'correction_idempotency_conflict' });

      const stale = await app.inject({
        method: 'POST',
        url: `/api/v2/households/correction-command/items/${item.id}/semantic-corrections`,
        payload: { ...command, idempotencyKey: 'correction-command-2' },
      });
      expect(stale.statusCode, stale.body).toBe(409);
      expect(stale.json()).toMatchObject({ error: 'item_version_conflict' });
    } finally {
      await app.close();
    }
  });
});
