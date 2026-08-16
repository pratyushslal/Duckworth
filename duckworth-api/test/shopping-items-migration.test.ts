import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';

describe('shopping item schema migration', () => {
  it('creates one default list per household and assigns captured items to it', async () => {
    const app = await buildApp({ databasePath: ':memory:' });
    try {
      const lists = await app.inject({
        method: 'GET',
        url: '/api/v1/households/household-demo/shopping-lists',
      });
      expect(lists.statusCode, lists.body).toBe(200);
      expect(lists.json()).toEqual([
        expect.objectContaining({
          householdId: 'household-demo',
          isDefault: true,
          status: 'active',
        }),
      ]);

      const captured = await app.inject({
        method: 'POST',
        url: '/api/v1/households/household-demo/conversation-captures',
        payload: { text: 'Add milk' },
      });
      expect(captured.statusCode, captured.body).toBe(201);
      expect(captured.json().saved[0]).toMatchObject({
        shoppingListId: lists.json()[0].id,
      });
    } finally {
      await app.close();
    }
  });

  it('resumes the same active household conversation after reopening the database', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'duckworth-conversation-'));
    const databasePath = join(directory, 'duckworth.sqlite');

    try {
      const firstApp = await buildApp({ databasePath });
      const first = await firstApp.inject({
        method: 'POST',
        url: '/api/v1/households/household-demo/conversation-captures',
        payload: { text: 'Add eggs' },
      });
      expect(first.statusCode, first.body).toBe(201);
      const sessionId = first.json().session.id as string;
      await firstApp.close();

      const reopenedApp = await buildApp({ databasePath });
      const continued = await reopenedApp.inject({
        method: 'POST',
        url: '/api/v1/households/household-demo/conversation-captures',
        payload: { text: 'Add bread' },
      });
      expect(continued.statusCode, continued.body).toBe(201);
      expect(continued.json().session).toMatchObject({ id: sessionId, status: 'active' });
      await reopenedApp.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

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

  it('rejects a rephrased duplicate of a package capture saved before semantic parsing', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'duckworth-legacy-duplicate-'));
    const databasePath = join(directory, 'duckworth.sqlite');
    const legacy = new DatabaseSync(databasePath);
    legacy.exec(`
      CREATE TABLE shopping_items (
        id TEXT PRIMARY KEY,
        household_id TEXT NOT NULL,
        capture_text TEXT NOT NULL,
        name TEXT NOT NULL,
        normalized_name TEXT NOT NULL,
        quantity REAL,
        unit TEXT,
        package_size REAL,
        package_unit TEXT,
        unit_source TEXT,
        unit_confirmed_at TEXT,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 1
      ) STRICT;
      INSERT INTO shopping_items
        (id, household_id, capture_text, name, normalized_name, quantity, unit, status,
         created_at, updated_at, version)
      VALUES
        ('legacy-amul', 'household-demo', 'I need 1 pack of amul butter 500 gm',
         'I need 1 pack of amul butter 500 gm', 'i need 1 pack of amul butter 500 gm', NULL, NULL, 'active',
         '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z', 1);
      INSERT INTO shopping_items
        (id, household_id, capture_text, name, normalized_name, quantity, unit, status,
         created_at, updated_at, version)
      VALUES
        ('legacy-britannia', 'household-demo', 'Britannia 50-50 biscuit',
         'Britannia 50-50 biscuit 1 pack', 'britannia 50-50 biscuit 1 pack', 1, 'pack', 'active',
         '2026-08-02T00:00:00.000Z', '2026-08-02T00:00:00.000Z', 1);
      INSERT INTO shopping_items
        (id, household_id, capture_text, name, normalized_name, quantity, unit, status,
         created_at, updated_at, version)
      VALUES
        ('legacy-size-of', 'household-size-of', '100 grams of Amul butter 1 pac',
         'of Amul butter', 'of amul butter', 1, 'pack', 'active',
         '2026-08-03T00:00:00.000Z', '2026-08-03T00:00:00.000Z', 1);
      INSERT INTO shopping_items
        (id, household_id, capture_text, name, normalized_name, quantity, unit, status,
         created_at, updated_at, version)
      VALUES
        ('legacy-size-of-canonical', 'household-size-of', 'Amul Butter 500 gms 1 pac',
         'Amul Butter', 'amul butter', 1, 'pack', 'active',
         '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z', 1);
      INSERT INTO shopping_items
        (id, household_id, capture_text, name, normalized_name, quantity, unit, status,
         created_at, updated_at, version)
      VALUES
        ('legacy-count-size-of', 'household-size-of', '2 pacs of 50g of Amul butter',
         'pacs of 50g of Amul butter', 'pacs of 50g of amul butter', 2, NULL, 'active',
         '2026-08-04T00:00:00.000Z', '2026-08-04T00:00:00.000Z', 1);
      INSERT INTO shopping_items
        (id, household_id, capture_text, name, normalized_name, quantity, unit, package_size, package_unit, status,
         created_at, updated_at, version)
      VALUES
        ('legacy-telma-strip', 'household-demo', '1 strip of Telma 40 mg',
         'strip of telma', 'strip of telma', 1, 'piece', 40, 'g', 'active',
         '2026-08-05T00:00:00.000Z', '2026-08-05T00:00:00.000Z', 1);
      INSERT INTO shopping_items
        (id, household_id, capture_text, name, normalized_name, quantity, unit, package_size, package_unit, status,
         created_at, updated_at, version)
      VALUES
        ('legacy-pudin-hara', 'household-demo', 'Pudin Hara 15ml',
         'pudin hara', 'pudin hara', 15, 'ml', 15, 'ml', 'active',
         '2026-08-06T00:00:00.000Z', '2026-08-06T00:00:00.000Z', 1);
    `);
    legacy.close();

    const app = await buildApp({ databasePath });
    try {
      const repaired = await app.inject({
        method: 'GET',
        url: '/api/v1/households/household-demo/items',
      });
      expect(repaired.json()).toEqual(expect.arrayContaining([
        expect.objectContaining({
          id: 'legacy-amul',
          captureText: 'I need 1 pack of amul butter 500 gm',
          name: 'amul butter',
          quantity: 1,
          unit: 'pack',
          packageSize: 500,
          packageUnit: 'g',
        }),
        expect.objectContaining({
          id: 'legacy-britannia',
          captureText: 'Britannia 50-50 biscuit',
          name: 'Britannia 50-50 biscuit',
          quantity: 1,
          unit: 'pack',
        }),
        expect.objectContaining({
          id: 'legacy-telma-strip',
          captureText: '1 strip of Telma 40 mg',
          name: 'Telma',
          quantity: 1,
          unit: 'strip',
          packageSize: null,
          packageUnit: null,
        }),
        expect.objectContaining({
          id: 'legacy-pudin-hara',
          captureText: 'Pudin Hara 15ml',
          name: 'pudin hara',
          quantity: 1,
          unit: 'piece',
          packageSize: 15,
          packageUnit: 'ml',
          categoryId: 'pharmacy',
          shopTypes: [expect.objectContaining({ id: 'shop.pharmacy' })],
        }),
      ]));

      const repairedSizeFirst = await app.inject({
        method: 'GET',
        url: '/api/v1/households/household-size-of/items',
      });
      expect(repairedSizeFirst.statusCode, repairedSizeFirst.body).toBe(200);
      expect(repairedSizeFirst.json()).toEqual([
        expect.objectContaining({
          id: 'legacy-size-of-canonical',
          name: 'Amul Butter',
          status: 'active',
        }),
      ]);

      const repairedSizeFirstWithRemoved = await app.inject({
        method: 'GET',
        url: '/api/v1/households/household-size-of/items?includeRemoved=true',
      });
      expect(repairedSizeFirstWithRemoved.statusCode, repairedSizeFirstWithRemoved.body).toBe(200);
      expect(repairedSizeFirstWithRemoved.json()).toEqual(expect.arrayContaining([
        expect.objectContaining({
          id: 'legacy-size-of',
          captureText: '100 grams of Amul butter 1 pac',
          name: 'Amul butter',
          quantity: 1,
          unit: 'pack',
          packageSize: 100,
          packageUnit: 'g',
          status: 'removed',
          removedAt: expect.any(String),
        }),
        expect.objectContaining({
          id: 'legacy-count-size-of',
          captureText: '2 pacs of 50g of Amul butter',
          name: 'Amul butter',
          quantity: 2,
          unit: 'pack',
          packageSize: 50,
          packageUnit: 'g',
          status: 'removed',
          removedAt: expect.any(String),
        }),
      ]));

      const duplicate = await app.inject({
        method: 'POST',
        url: '/api/v1/households/household-demo/items',
        payload: { input: 'amul butter 500 gms 1 pac' },
      });

      expect(duplicate.statusCode, duplicate.body).toBe(409);
      expect(duplicate.json()).toEqual({ error: 'duplicate_item', existingItemId: 'legacy-amul' });
    } finally {
      await app.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('migrates independently known semantic identifiers and preserves canonical tag assignments across restart', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'duckworth-classification-migration-'));
    const databasePath = join(directory, 'duckworth.sqlite');
    let app: Awaited<ReturnType<typeof buildApp>> | undefined = await buildApp({ databasePath });
    try {
      const lists = await app.inject({
        method: 'GET',
        url: '/api/v1/households/household-classification/shopping-lists',
      });
      const listId = lists.json()[0].id as string;
      await app.close();
      app = undefined;

      const database = new DatabaseSync(databasePath);
      try {
        database.prepare(`
          INSERT INTO shopping_items
            (id, household_id, shopping_list_id, capture_text, name, normalized_name, category_id,
             category_automatic_id, category_override_id, classification_runtime_versions,
             concept_id, status, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)
        `).run(
          'concept-only-item', 'household-classification', listId, 'synthetic item', 'synthetic item',
          'synthetic item', 'synthetic-category', 'synthetic-category', null,
          JSON.stringify({ country: 'test-v1' }), 'concept-only',
          '2026-08-13T00:00:00.000Z', '2026-08-13T00:00:00.000Z',
        );
        database.prepare(`
          INSERT INTO tag_definitions
            (id, namespace, scope, household_id, canonical_key, label, active, created_at, updated_at)
          VALUES (?, 'shop_type', 'runtime', NULL, ?, ?, 1, ?, ?)
        `).run('tag-synthetic', 'synthetic-shop', 'Synthetic shop', '2026-08-13T00:00:00.000Z', '2026-08-13T00:00:00.000Z');
        database.prepare(`
          INSERT INTO item_tag_assignments
            (item_id, tag_id, origin, decision, confidence, evidence_json, semantic_identity_key,
             runtime_versions_json, active, created_at, updated_at)
          VALUES (?, ?, 'automatic', 'include', 'inferred', ?, ?, ?, 1, ?, ?)
        `).run(
          'concept-only-item', 'tag-synthetic', JSON.stringify([{ kind: 'catalog_match', ref: 'test' }]),
          'concept-only', JSON.stringify({ country: 'test-v1' }),
          '2026-08-13T00:00:00.000Z', '2026-08-13T00:00:00.000Z',
        );
      } finally {
        database.close();
      }

      const reopened = await buildApp({ databasePath });
      const response = await reopened.inject({
        method: 'GET',
        url: '/api/v1/households/household-classification/items',
      });
      expect(response.statusCode, response.body).toBe(200);
      expect(response.json()).toEqual([expect.objectContaining({
        id: 'concept-only-item',
        conceptId: 'concept-only',
        productId: null,
        brandId: null,
      })]);
      await reopened.close();

      const verification = new DatabaseSync(databasePath);
      expect(verification.prepare(`SELECT COUNT(*) AS count FROM item_tag_assignments WHERE item_id = ?`)
        .get('concept-only-item')).toEqual({ count: 1 });
      expect(verification.prepare(`SELECT category_automatic_id, classification_runtime_versions FROM shopping_items WHERE id = ?`)
        .get('concept-only-item')).toEqual({
          category_automatic_id: 'synthetic-category',
          classification_runtime_versions: JSON.stringify({ country: 'test-v1' }),
        });
      verification.close();
    } finally {
      if (app) await app.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
