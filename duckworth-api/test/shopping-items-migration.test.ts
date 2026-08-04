import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';

describe('shopping item schema migration', () => {
  it('opens the legacy schema and exposes safe structured defaults through HTTP', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'duckworth-migration-'));
    const databasePath = join(directory, 'duckworth.sqlite');
    const legacy = new DatabaseSync(databasePath);
    legacy.exec(`
      CREATE TABLE shopping_items (
        id TEXT PRIMARY KEY,
        household_id TEXT NOT NULL,
        name TEXT NOT NULL,
        normalized_name TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('active', 'purchased')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 1,
        UNIQUE (household_id, normalized_name, status)
      ) STRICT;
      INSERT INTO shopping_items
        (id, household_id, name, normalized_name, status, created_at, updated_at, version)
      VALUES
        ('legacy-milk', 'household-demo', 'Milk', 'milk', 'active',
         '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z', 3);
    `);
    legacy.close();

    const app = await buildApp({ databasePath });
    try {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/households/household-demo/items',
      });

      expect(response.statusCode, response.body).toBe(200);
      expect(response.json()).toEqual([expect.objectContaining({
        id: 'legacy-milk',
        captureText: 'Milk',
        name: 'Milk',
        quantity: null,
        unit: null,
        unitSource: null,
        unitConfirmedAt: null,
        attentionReasons: ['missing_quantity'],
        version: 3,
      })]);
    } finally {
      await app.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
