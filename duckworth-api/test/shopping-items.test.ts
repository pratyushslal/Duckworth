import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolve } from 'node:path';
import { buildApp } from '../src/app.js';
import { CloudAssistClient } from '../src/cloud-assist.js';
import { loadSemanticRuntime } from '../src/semantic-runtime-loader.js';
import { ShoppingItemRepository } from '../src/shopping-items.js';
import { BrainCaptureStore } from '../src/brain-captures.js';
import { createItemIdentity, type BrainCaptureEnvelope, type BrainResult } from '@duckworth/shopping-intelligence';

describe('shopping item endpoints', () => {
  it('classifies an ordinary item creation with runtime defaults and one canonical shop tag', async () => {
    const app = await buildApp({ databasePath: ':memory:' });
    try {
      const created = await app.inject({
        method: 'POST', url: '/api/v1/households/ordinary-classification/items', payload: { input: 'milk' },
      });
      expect(created.statusCode, created.body).toBe(201);
      expect(created.json()).toMatchObject({
        quantity: 1,
        unit: 'piece',
        quantitySource: 'policy_default',
        unitSource: 'policy_default',
        shopTypes: [expect.objectContaining({ id: 'shop.grocery' })],
      });
    } finally {
      await app.close();
    }
  });

  it('stores a pharmacy liquid net content separately while defaulting an omitted requested quantity', async () => {
    const app = await buildApp({ databasePath: ':memory:' });
    try {
      const created = await app.inject({
        method: 'POST', url: '/api/v1/households/pharmacy-liquid/items', payload: { input: 'Pudin Hara 15ml' },
      });

      expect(created.statusCode, created.body).toBe(201);
      expect(created.json()).toMatchObject({
        name: 'Pudin Hara',
        quantity: 1,
        unit: 'piece',
        packageSize: 15,
        packageUnit: 'ml',
        categoryId: 'pharmacy',
        shopTypes: [expect.objectContaining({ id: 'shop.pharmacy' })],
      });
    } finally {
      await app.close();
    }
  });

  it('copies one archived canonical item with its effective shop visibility', async () => {
    const database = new DatabaseSync(':memory:');
    const runtime = await loadSemanticRuntime(resolve(import.meta.dirname, '../language-packs'));
    const repository = new ShoppingItemRepository(database, runtime);
    const item = repository.create('archive-classification', {
      captureText: 'milk', itemName: 'milk', identityKey: 'milk', quantity: 1, unit: 'piece', packageSize: null, packageUnit: null,
    });
    const corrected = repository.updateClassification(
      'archive-classification', item.id, [{ tagId: 'shop.pharmacy', decision: 'include' }], item.version,
    )!;
    const archive = repository.archiveActiveList('archive-classification');
    repository.update('archive-classification', item.id, { status: 'purchased' }, corrected.version);
    const copied = repository.copyShoppingListArchive('archive-classification', archive.id);
    const active = repository.listActive('archive-classification');

    expect(copied.items).toHaveLength(1);
    expect(active).toEqual([
      expect.objectContaining({
        id: copied.items[0].id,
        shopTypes: expect.arrayContaining([
          expect.objectContaining({ id: 'shop.grocery' }),
          expect.objectContaining({ id: 'shop.pharmacy' }),
        ]),
      }),
    ]);
    expect(active.map((candidate) => candidate.id)).toHaveLength(1);
    database.close();
  });

  it('edits one canonical item classification and returns distinct shop-filtered views', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'duckworth-shop-view-'));
    const databasePath = join(directory, 'duckworth.sqlite');
    let app: Awaited<ReturnType<typeof buildApp>> | undefined = await buildApp({ databasePath });
    try {
      const created = await app.inject({
        method: 'POST',
        url: '/api/v1/households/shop-view/items',
        payload: { input: 'milk' },
      });
      expect(created.statusCode, created.body).toBe(201);
      const itemId = created.json().id as string;
      await app.close();
      app = undefined;

      const database = new DatabaseSync(databasePath);
      try {
        const now = '2026-08-13T00:00:00.000Z';
        for (const [id, key] of [['tag-one', 'one'], ['tag-two', 'two']]) {
          database.prepare(`
            INSERT INTO tag_definitions
              (id, namespace, scope, household_id, canonical_key, label, active, created_at, updated_at)
            VALUES (?, 'shop_type', 'household', 'shop-view', ?, ?, 1, ?, ?)
          `).run(id, key, key, now, now);
          database.prepare(`
            INSERT INTO item_tag_assignments
              (item_id, tag_id, origin, decision, confidence, evidence_json, semantic_identity_key,
               runtime_versions_json, active, created_at, updated_at)
            VALUES (?, ?, 'automatic', 'include', 'inferred', '[]', 'milk', '{}', 1, ?, ?)
          `).run(itemId, id, now, now);
        }
      } finally {
        database.close();
      }

      app = await buildApp({ databasePath });
      const before = await app.inject({ method: 'GET', url: '/api/v1/households/shop-view/items/view?shopTypeId=tag-one' });
      expect(before.statusCode, before.body).toBe(200);
      expect(before.json()).toMatchObject({
        activeDistinctCount: 1,
        items: [expect.objectContaining({ id: itemId, shopTypes: expect.arrayContaining([expect.objectContaining({ id: 'tag-one' }), expect.objectContaining({ id: 'tag-two' })]) })],
        facets: expect.arrayContaining([
          expect.objectContaining({ id: 'tag-one', activeDistinctCount: 1 }),
          expect.objectContaining({ id: 'tag-two', activeDistinctCount: 1 }),
        ]),
      });

      const excluded = await app.inject({
        method: 'PATCH',
        url: `/api/v1/households/shop-view/items/${itemId}/classification`,
        payload: { expectedVersion: before.json().items[0].version, shopTypeDecisions: [{ tagId: 'tag-one', decision: 'exclude' }] },
      });
      expect(excluded.statusCode, excluded.body).toBe(200);
      expect(excluded.json()).toMatchObject({
        id: itemId,
        shopTypes: expect.arrayContaining([expect.objectContaining({ id: 'tag-two' })]),
      });
      expect(excluded.json().shopTypes).not.toEqual(expect.arrayContaining([expect.objectContaining({ id: 'tag-one' })]));

      const hidden = await app.inject({ method: 'GET', url: '/api/v1/households/shop-view/items/view?shopTypeId=tag-one' });
      const retained = await app.inject({ method: 'GET', url: '/api/v1/households/shop-view/items/view?shopTypeId=tag-two' });
      expect(hidden.json()).toMatchObject({ activeDistinctCount: 0, items: [] });
      expect(retained.json()).toMatchObject({ activeDistinctCount: 1, items: [expect.objectContaining({ id: itemId })] });
    } finally {
      await app?.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('keeps distinct counts correct for arbitrary overlapping shop tags', async () => {
    const database = new DatabaseSync(':memory:');
    const runtime = await loadSemanticRuntime(resolve(import.meta.dirname, '../language-packs'));
    const repository = new ShoppingItemRepository(database, runtime);
    const householdId = 'overlap-property';
    const now = '2026-08-13T00:00:00.000Z';
    const tagSets = [['tag-alpha', 'tag-beta'], ['tag-beta'], ['tag-alpha', 'tag-gamma'], ['tag-gamma']];
    const tagIds = [...new Set(tagSets.flat())];
    tagIds.forEach((id) => database.prepare(`
      INSERT INTO tag_definitions
        (id, namespace, scope, household_id, canonical_key, label, active, created_at, updated_at)
      VALUES (?, 'shop_type', 'household', ?, ?, ?, 1, ?, ?)
    `).run(id, householdId, id, id, now, now));
    const itemIds = tagSets.map((tags, index) => {
      const item = repository.create(householdId, {
        captureText: `item ${index}`, itemName: `item ${index}`, identityKey: `item ${index}`,
        quantity: 1, unit: 'piece', packageSize: null, packageUnit: null,
      });
      tags.forEach((tagId) => database.prepare(`
        INSERT INTO item_tag_assignments
          (item_id, tag_id, origin, decision, confidence, evidence_json, semantic_identity_key,
           runtime_versions_json, active, created_at, updated_at)
        VALUES (?, ?, 'user', 'include', NULL, '[]', ?, '{}', 1, ?, ?)
      `).run(item.id, tagId, item.id, now, now));
      return item.id;
    });

    const all = repository.getShoppingItemView(householdId);
    expect(all.activeDistinctCount).toBe(itemIds.length);
    expect(new Set(all.items.map((item) => item.id)).size).toBe(itemIds.length);
    tagIds.forEach((tagId) => {
      const expected = tagSets.filter((tags) => tags.includes(tagId)).length;
      expect(all.facets.find((facet) => facet.id === tagId)?.activeDistinctCount).toBe(expected);
      const filtered = repository.getShoppingItemView(householdId, tagId);
      expect(filtered.activeDistinctCount).toBe(expected);
      expect(new Set(filtered.items.map((item) => item.id)).size).toBe(expected);
    });
    database.close();
  });

  it('keeps unclassified items visible in an explicit Unassigned facet', async () => {
    const database = new DatabaseSync(':memory:');
    const runtime = await loadSemanticRuntime(resolve(import.meta.dirname, '../language-packs'));
    const repository = new ShoppingItemRepository(database, runtime);
    const item = repository.create('unassigned-view', {
      captureText: 'unfamiliar household thing', itemName: 'unfamiliar household thing', identityKey: 'unfamiliar household thing',
      quantity: 1, unit: 'piece', packageSize: null, packageUnit: null,
    });
    const all = repository.getShoppingItemView('unassigned-view');
    expect(all.facets).toContainEqual(expect.objectContaining({ id: 'unassigned', activeDistinctCount: 1 }));
    expect(repository.getShoppingItemView('unassigned-view', 'unassigned').items).toEqual([
      expect.objectContaining({ id: item.id }),
    ]);
    database.close();
  });

  it('persists automatic classifications and runtime defaults on one canonical brain item', async () => {
    const database = new DatabaseSync(':memory:');
    const runtime = await loadSemanticRuntime(resolve(import.meta.dirname, '../language-packs'));
    const repository = new ShoppingItemRepository(database, runtime);
    new BrainCaptureStore(database);
    expect(database.prepare(`
      SELECT id, namespace, scope, canonical_key, active FROM tag_definitions WHERE id = ?
    `).get('shop.grocery')).toEqual({
      id: 'shop.grocery', namespace: 'shop_type', scope: 'runtime', canonical_key: 'shop.grocery', active: 1,
    });
    const envelope: BrainCaptureEnvelope = {
      schemaVersion: 2,
      inputId: 'classification-input',
      householdId: 'household-classification',
      contextId: 'context-classification',
      shoppingListId: 'default:household-classification',
      source: { kind: 'test' },
      text: 'synthetic item',
      locale: 'en-IN',
      countryCode: 'IN',
      occurredAt: '2026-08-13T00:00:00.000Z',
      idempotencyKey: 'classification-input',
    };
    const result: BrainResult = {
      schemaVersion: 2,
      engineVersion: 'test',
      runtimeVersions: runtime.versions,
      capture: { inputId: envelope.inputId, text: envelope.text },
      operations: [{
        kind: 'create',
        item: {
          itemName: { value: 'synthetic item', confidence: 'confirmed', evidence: [{ kind: 'source_span', sourceStart: 0, sourceEnd: 14 }] },
          conceptId: { value: null, confidence: 'unknown', evidence: [] },
          brandId: { value: null, confidence: 'unknown', evidence: [] },
          productId: { value: null, confidence: 'unknown', evidence: [] },
          categoryId: { value: 'grocery', confidence: 'inferred', evidence: [{ kind: 'catalog_match', ref: 'grocery' }] },
          requestedCount: { value: null, confidence: 'unknown', evidence: [] },
          requestedUnitId: { value: null, confidence: 'unknown', evidence: [] },
          packageMeasure: { value: null, confidence: 'unknown', evidence: [] },
          attributes: {},
          identity: { conceptKey: 'synthetic', variantKey: 'synthetic', requestKey: 'synthetic' },
        },
      }],
      warnings: [],
    };

    repository.applyBrainResult(envelope, result);

    expect(database.prepare(`
      SELECT quantity, unit, quantity_source, unit_source, category_id, category_automatic_id,
             classification_runtime_versions
      FROM shopping_items WHERE id = ?
    `).get('brain:classification-input:0')).toEqual({
      quantity: 1,
      unit: 'piece',
      quantity_source: 'policy_default',
      unit_source: 'policy_default',
      category_id: 'grocery',
      category_automatic_id: 'grocery',
      classification_runtime_versions: JSON.stringify(runtime.versions),
    });
    expect(database.prepare(`
      SELECT tag_id, origin, decision, active FROM item_tag_assignments WHERE item_id = ?
    `).all('brain:classification-input:0')).toEqual([
      { tag_id: 'shop.grocery', origin: 'automatic', decision: 'include', active: 1 },
    ]);
    database.close();
  });

  it('keeps a tag exclusion for the same identity, retires it on identity change, and restores it through undo', async () => {
    const database = new DatabaseSync(':memory:');
    const runtime = await loadSemanticRuntime(resolve(import.meta.dirname, '../language-packs'));
    const repository = new ShoppingItemRepository(database, runtime);
    new BrainCaptureStore(database);
    const envelope: BrainCaptureEnvelope = {
      schemaVersion: 2,
      inputId: 'classification-lifecycle',
      householdId: 'classification-lifecycle',
      contextId: 'classification-lifecycle',
      shoppingListId: 'default:classification-lifecycle',
      source: { kind: 'test' },
      text: 'synthetic item',
      locale: 'en-IN',
      countryCode: 'IN',
      occurredAt: '2026-08-13T00:00:00.000Z',
      idempotencyKey: 'classification-lifecycle',
    };
    const semantic = {
      itemName: { value: 'synthetic item', confidence: 'confirmed' as const, evidence: [] },
      conceptId: { value: null, confidence: 'unknown' as const, evidence: [] },
      brandId: { value: null, confidence: 'unknown' as const, evidence: [] },
      productId: { value: null, confidence: 'unknown' as const, evidence: [] },
      categoryId: { value: 'grocery', confidence: 'inferred' as const, evidence: [] },
      requestedCount: { value: null, confidence: 'unknown' as const, evidence: [] },
      requestedUnitId: { value: null, confidence: 'unknown' as const, evidence: [] },
      packageMeasure: { value: null, confidence: 'unknown' as const, evidence: [] },
      attributes: {},
      identity: { conceptKey: 'synthetic', variantKey: 'synthetic', requestKey: 'synthetic' },
    };
    semantic.identity = createItemIdentity(semantic, runtime);
    const result: BrainResult = {
      schemaVersion: 2, engineVersion: 'test', runtimeVersions: runtime.versions,
      capture: { inputId: envelope.inputId, text: envelope.text },
      operations: [{ kind: 'create', item: semantic }], warnings: [],
    };

    repository.applyBrainResult(envelope, result);
    const created = repository.listActive(envelope.householdId)[0];
    const excluded = repository.updateClassification(
      envelope.householdId,
      created.id,
      [{ tagId: 'shop.grocery', decision: 'exclude' }],
      created.version,
    )!;
    expect(excluded.shopTypes).toEqual([]);
    const eventId = (database.prepare(`
      SELECT id FROM shopping_item_events
      WHERE item_id = ? AND payload LIKE '%"classificationEdit":true%'
      ORDER BY created_at DESC, id DESC LIMIT 1
    `).get(created.id) as { id: string }).id;

    repository.applyBrainResult(envelope, {
      ...result,
      operations: [{ kind: 'correct', targetItemId: created.id, item: semantic }],
    });
    expect(repository.listActive(envelope.householdId)[0].shopTypes).toEqual([]);

    const undone = repository.undoShoppingItemEvent(envelope.householdId, eventId);
    expect(undone.item.shopTypes).toEqual([
      expect.objectContaining({ id: 'shop.grocery' }),
    ]);
    expect(database.prepare(`
      SELECT active FROM item_tag_assignments WHERE item_id = ? AND tag_id = ? AND origin = 'user'
    `).get(created.id, 'shop.grocery')).toBeUndefined();

    const excludedAgain = repository.updateClassification(
      envelope.householdId,
      created.id,
      [{ tagId: 'shop.grocery', decision: 'exclude' }],
      undone.item.version,
    )!;
    expect(excludedAgain.shopTypes).toEqual([]);

    repository.applyBrainResult(envelope, {
      ...result,
      operations: [{
        kind: 'correct', targetItemId: created.id, item: {
          ...semantic,
          itemName: { value: 'replacement', confidence: 'confirmed', evidence: [] },
          categoryId: { value: 'electronics', confidence: 'inferred', evidence: [] },
          identity: { conceptKey: 'replacement', variantKey: 'replacement', requestKey: 'replacement' },
        },
      }],
    });
    expect(repository.listActive(envelope.householdId)[0].shopTypes).toEqual([
      expect.objectContaining({ id: 'shop.electronics' }),
    ]);
    expect(database.prepare(`
      SELECT active FROM item_tag_assignments WHERE item_id = ? AND tag_id = ? AND origin = 'user'
    `).get(created.id, 'shop.grocery')).toEqual({ active: 0 });
    database.close();
  });

  it('applies and reverses active household learning in the request runtime', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'duckworth-learning-runtime-'));
    const databasePath = join(directory, 'duckworth.sqlite');
    let app = await buildApp({ databasePath });
    try {
      const registration = await app.inject({
        method: 'POST',
        url: '/api/v1/households/household-learning-runtime/conversation-contexts',
        payload: { deviceId: 'learning-test' },
      });
      const { context, accessToken } = registration.json() as {
        context: { id: string };
        accessToken: string;
      };
      await app.close();

      const database = new DatabaseSync(databasePath);
      const runtime = await loadSemanticRuntime(resolve(import.meta.dirname, '../language-packs'));
      const repository = new ShoppingItemRepository(database, runtime);
      repository.saveLearnedSemanticEntry({
        id: 'learned-runtime-alias',
        householdId: 'household-learning-runtime',
        kind: 'alias',
        value: { alias: 'weekly staple', conceptId: 'grocery.milk.dairy' },
        supportingEventIds: ['accepted-correction-1'],
        status: 'active',
      });
      database.close();

      const capture = (inputId: string) => app.inject({
        method: 'POST',
        url: '/api/v2/households/household-learning-runtime/brain/captures',
        headers: { 'x-conversation-context-token': accessToken },
        payload: {
          schemaVersion: 2,
          inputId,
          householdId: 'household-learning-runtime',
          contextId: context.id,
          shoppingListId: 'default:household-learning-runtime',
          source: { kind: 'text', deviceId: 'learning-test' },
          text: 'weekly staple',
          locale: 'en-IN',
          countryCode: 'IN',
          occurredAt: '2026-08-12T08:00:00.000Z',
          idempotencyKey: inputId,
        },
      });

      app = await buildApp({ databasePath });
      const learned = await capture('learned-active');
      expect(learned.statusCode, learned.body).toBe(201);
      expect(learned.json().facts.saved[0].item.conceptId.value).toBe('grocery.milk.dairy');
      await app.close();

      const clearingDatabase = new DatabaseSync(databasePath);
      const clearingRepository = new ShoppingItemRepository(clearingDatabase, runtime);
      clearingRepository.setLearnedSemanticEntryStatus(
        'household-learning-runtime',
        'learned-runtime-alias',
        'cleared',
      );
      clearingDatabase.prepare(
        "UPDATE shopping_items SET status = 'removed' WHERE household_id = ?",
      ).run('household-learning-runtime');
      expect(clearingRepository.listLearnedSemanticEntries('household-learning-runtime', true))
        .toEqual([expect.objectContaining({ status: 'cleared', supportingEventIds: ['accepted-correction-1'] })]);
      clearingDatabase.close();

      app = await buildApp({ databasePath });
      const cleared = await capture('learned-cleared');
      expect(cleared.statusCode, cleared.body).toBe(201);
      expect(cleared.json().facts.saved[0].item.conceptId.value).not.toBe('grocery.milk.dairy');
    } finally {
      await app.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('retains learned-entry provenance when its runtime influence is cleared', async () => {
    const database = new DatabaseSync(':memory:');
    const runtime = await loadSemanticRuntime(resolve(import.meta.dirname, '../language-packs'));
    const repository = new ShoppingItemRepository(database, runtime);
    repository.saveLearnedSemanticEntry({
      id: 'learned-1',
      householdId: 'household-learning',
      kind: 'alias',
      value: { alias: 'weekly staple', conceptId: 'grocery.milk.dairy' },
      supportingEventIds: ['event-1', 'event-2'],
      status: 'active',
    });
    expect(repository.listLearnedSemanticEntries('household-learning')).toHaveLength(1);
    repository.setLearnedSemanticEntryStatus('household-learning', 'learned-1', 'cleared');
    expect(repository.listLearnedSemanticEntries('household-learning')).toEqual([]);
    expect(repository.listLearnedSemanticEntries('household-learning', true)).toEqual([
      expect.objectContaining({ status: 'cleared', supportingEventIds: ['event-1', 'event-2'] }),
    ]);
    database.close();
  });

  it('saves every clear clause in one durable household conversation', async () => {
    const app = await buildApp({ databasePath: ':memory:' });

    const captured = await app.inject({
      method: 'POST',
      url: '/api/v1/households/household-demo/conversation-captures',
      payload: {
        text: 'Add Apple iPhone and 4 milk pouches of 1 litre each',
        source: 'text',
      },
    });

    expect(captured.statusCode, captured.body).toBe(201);
    expect(captured.json()).toMatchObject({
      session: {
        id: expect.any(String),
        householdId: 'household-demo',
        status: 'active',
        closedAt: null,
      },
      saved: [
        expect.objectContaining({ name: 'Apple iPhone', status: 'active' }),
        expect.objectContaining({
          name: 'milk',
          quantity: 4,
          unit: 'pouch',
          packageSize: 1,
          packageUnit: 'l',
          status: 'active',
        }),
      ],
      merged: [],
      drafts: [],
      undo: [],
    });

    const listed = await app.inject({
      method: 'GET',
      url: '/api/v1/households/household-demo/items',
    });
    expect(listed.json()).toHaveLength(2);

    await app.close();
  });

  it('persists category and clear attributes from the source-agnostic brain', async () => {
    const app = await buildApp({ databasePath: ':memory:' });

    const captured = await app.inject({
      method: 'POST',
      url: '/api/v1/households/household-demo/conversation-captures',
      payload: {
        text: 'Add a blue cotton t-shirt size large and paracetamol syrup 1 bottle',
        source: 'text',
      },
    });

    expect(captured.statusCode, captured.body).toBe(201);
    expect(captured.json().saved).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: 'blue cotton t-shirt size large',
        categoryId: 'apparel',
        categoryConfidence: 'inferred',
        attributes: { colour: 'blue', material: 'cotton', size: 'large' },
      }),
      expect.objectContaining({
        name: 'paracetamol syrup',
        categoryId: 'pharmacy',
        categoryConfidence: 'inferred',
        attributes: { form: 'syrup' },
        quantity: 1,
        unit: 'bottle',
      }),
    ]));

    const listed = await app.inject({
      method: 'GET',
      url: '/api/v1/households/household-demo/items',
    });
    expect(listed.json()).toEqual(expect.arrayContaining([
      expect.objectContaining({ categoryId: 'apparel', attributes: { colour: 'blue', material: 'cotton', size: 'large' } }),
      expect.objectContaining({ categoryId: 'pharmacy', attributes: { form: 'syrup' } }),
    ]));

    await app.close();
  });

  it('recomputes semantic fields when an existing item is renamed', async () => {
    const app = await buildApp({ databasePath: ':memory:' });
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/households/household-demo/items',
      payload: { input: 'blue cotton t-shirt size large', source: 'text' },
    });
    expect(created.statusCode, created.body).toBe(201);
    expect(created.json()).toMatchObject({ categoryId: 'apparel' });

    const renamed = await app.inject({
      method: 'PATCH',
      url: `/api/v1/households/household-demo/items/${created.json().id}`,
      payload: { name: 'paracetamol syrup', expectedVersion: created.json().version },
    });
    expect(renamed.statusCode, renamed.body).toBe(200);
    expect(renamed.json()).toMatchObject({
      name: 'paracetamol syrup',
      categoryId: 'pharmacy',
      categoryConfidence: 'inferred',
      attributes: { form: 'syrup' },
    });

    await app.close();
  });

  it('keeps clear clauses and an unresolved remainder in the same active session', async () => {
    const app = await buildApp({ databasePath: ':memory:' });
    const url = '/api/v1/households/household-demo/conversation-captures';

    const first = await app.inject({
      method: 'POST',
      url,
      payload: { text: 'Add eggs', source: 'voice' },
    });
    const continued = await app.inject({
      method: 'POST',
      url,
      payload: { text: 'Add bread and ???', source: 'assistant' },
    });

    expect(continued.statusCode, continued.body).toBe(201);
    expect(continued.json()).toMatchObject({
      session: { id: first.json().session.id, status: 'active' },
      saved: [expect.objectContaining({ name: 'bread' })],
      merged: [],
      drafts: [{
        id: expect.any(String),
        sessionId: first.json().session.id,
        text: '???',
        reason: 'ambiguous_clause',
        status: 'open',
      }],
      undo: [],
    });

    const listed = await app.inject({
      method: 'GET',
      url: '/api/v1/households/household-demo/items',
    });
    expect(listed.json()).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'eggs' }),
      expect.objectContaining({ name: 'bread' }),
    ]));

    await app.close();
  });

  it('identifies and persists a reviewed brand from ordinary item wording', async () => {
    const app = await buildApp({ databasePath: ':memory:' });

    const captured = await app.inject({
      method: 'POST',
      url: '/api/v1/households/household-demo/conversation-captures',
      payload: { text: 'Amul butter 1 pack 500 gms', source: 'voice' },
    });

    expect(captured.statusCode, captured.body).toBe(201);
    expect(captured.json().saved).toEqual([
      expect.objectContaining({
        name: 'Amul butter',
        brandName: 'Amul',
        quantity: 1,
        unit: 'pack',
        packageSize: 500,
        packageUnit: 'g',
      }),
    ]);

    const listed = await app.inject({
      method: 'GET',
      url: '/api/v1/households/household-demo/items',
    });
    expect(listed.json()).toEqual([
      expect.objectContaining({ name: 'Amul butter', brandName: 'Amul' }),
    ]);

    await app.close();
  });

  it('persists a spoken count and trailing package size separately', async () => {
    const app = await buildApp({ databasePath: ':memory:' });

    const captured = await app.inject({
      method: 'POST',
      url: '/api/v1/households/household-demo/conversation-captures',
      payload: { text: 'one Tata Tea 500 gms', source: 'voice' },
    });

    expect(captured.statusCode, captured.body).toBe(201);
    expect(captured.json().saved).toEqual([
      expect.objectContaining({
        name: 'Tata Tea',
        brandName: 'Tata',
        quantity: 1,
        unit: 'piece',
        packageSize: 500,
        packageUnit: 'g',
      }),
    ]);

    await app.close();
  });

  it('merges an exact variant additively and undoes only the selected adjustment', async () => {
    const app = await buildApp({ databasePath: ':memory:' });
    const captureUrl = '/api/v1/households/household-demo/conversation-captures';

    const initial = await app.inject({
      method: 'POST',
      url: captureUrl,
      payload: { text: 'Amul Butter 1 pack 500 g' },
    });
    const itemId = initial.json().saved[0].id as string;
    const firstMerge = await app.inject({
      method: 'POST',
      url: captureUrl,
      payload: { text: 'Amul Butter 2 packs 500 g' },
    });
    expect(firstMerge.statusCode, firstMerge.body).toBe(201);
    expect(firstMerge.json()).toMatchObject({
      saved: [],
      merged: [{ id: itemId, quantity: 3, unit: 'pack', packageSize: 500, packageUnit: 'g' }],
      undo: [{ eventId: expect.any(String), itemId }],
    });

    const secondMerge = await app.inject({
      method: 'POST',
      url: captureUrl,
      payload: { text: '1 pack of Amul Butter 500 gms' },
    });
    expect(secondMerge.json()).toMatchObject({
      merged: [{ id: itemId, quantity: 4 }],
      undo: [{ eventId: expect.any(String), itemId }],
    });
    const eventId = secondMerge.json().undo[0].eventId as string;

    const wrongHousehold = await app.inject({
      method: 'POST',
      url: `/api/v1/households/another-household/shopping-item-events/${eventId}/undo`,
    });
    expect(wrongHousehold.statusCode, wrongHousehold.body).toBe(404);
    expect(wrongHousehold.json()).toEqual({ error: 'event_not_found' });

    const undone = await app.inject({
      method: 'POST',
      url: `/api/v1/households/household-demo/shopping-item-events/${eventId}/undo`,
    });
    expect(undone.statusCode, undone.body).toBe(200);
    expect(undone.json()).toMatchObject({
      item: { id: itemId, quantity: 3 },
      event: {
        id: expect.any(String),
        itemId,
        type: 'reversed',
        inverseOfEventId: eventId,
      },
    });

    const repeatedUndo = await app.inject({
      method: 'POST',
      url: `/api/v1/households/household-demo/shopping-item-events/${eventId}/undo`,
    });
    expect(repeatedUndo.statusCode, repeatedUndo.body).toBe(409);
    expect(repeatedUndo.json()).toEqual({ error: 'event_already_undone' });

    await app.close();
  });

  it('persists an ambiguous follow-up as a draft and applies a unique reference', async () => {
    const app = await buildApp({ databasePath: ':memory:' });
    const url = '/api/v1/households/household-demo/conversation-captures';
    await app.inject({
      method: 'POST',
      url,
      payload: { text: 'Amul butter 1 pack 500 g' },
    });
    await app.inject({
      method: 'POST',
      url,
      payload: { text: 'Britannia butter 1 pack 500 g' },
    });

    const ambiguous = await app.inject({
      method: 'POST',
      url,
      payload: { text: 'make butter two packs' },
    });
    expect(ambiguous.statusCode, ambiguous.body).toBe(201);
    expect(ambiguous.json()).toMatchObject({
      saved: [],
      merged: [],
      drafts: [{ text: 'make butter two packs', reason: 'ambiguous_reference', status: 'open' }],
    });

    const unique = await app.inject({
      method: 'POST',
      url,
      payload: { text: 'make Amul butter two packs' },
    });
    expect(unique.statusCode, unique.body).toBe(201);
    expect(unique.json()).toMatchObject({
      saved: [],
      merged: [{ name: 'Amul butter', quantity: 3, packageSize: 500, packageUnit: 'g' }],
      undo: [{ eventId: expect.any(String), itemId: expect.any(String) }],
    });

    await app.close();
  });

  it('hydrates the scoped list, session, drafts, and pending close action for a registered context', async () => {
    const app = await buildApp({ databasePath: ':memory:' });
    const householdId = 'state-household';
    const contextsUrl = `/api/v1/households/${householdId}/conversation-contexts`;
    const registered = await app.inject({
      method: 'POST',
      url: contextsUrl,
      payload: { deviceId: 'device-a' },
    });
    const registration = registered.json();
    const lists = await app.inject({ method: 'GET', url: `/api/v1/households/${householdId}/shopping-lists` });
    const list = lists.json()[0];
    const capture = await app.inject({
      method: 'POST',
      url: `/api/v1/households/${householdId}/conversation-captures`,
      payload: {
        text: 'Amul butter 1 pack 500 g',
        contextId: registration.context.id,
        accessToken: registration.accessToken,
        shoppingListId: list.id,
      },
    });
    expect(capture.statusCode, capture.body).toBe(201);
    const pending = await app.inject({
      method: 'POST',
      url: `/api/v1/households/${householdId}/conversation-captures`,
      payload: {
        text: 'I am done adding items',
        contextId: registration.context.id,
        accessToken: registration.accessToken,
        shoppingListId: list.id,
      },
    });
    expect(pending.json().pendingAction.status).toBe('pending');

    const state = await app.inject({
      method: 'GET',
      url: `/api/v1/households/${householdId}/conversation-state?shoppingListId=${encodeURIComponent(list.id)}&contextId=${encodeURIComponent(registration.context.id)}&accessToken=${encodeURIComponent(registration.accessToken)}`,
    });
    expect(state.statusCode, state.body).toBe(200);
    expect(state.json()).toMatchObject({
      list: { id: list.id },
      session: { id: capture.json().session.id, status: 'close_pending' },
      pendingAction: { status: 'pending' },
      drafts: [],
    });
    await app.close();
  });

  it('resolves follow-up clauses inside a longer capture without losing clear items', async () => {
    const app = await buildApp({ databasePath: ':memory:' });
    const url = '/api/v1/households/household-demo/conversation-captures';
    await app.inject({ method: 'POST', url, payload: { text: 'Amul butter 1 pack 500 g' } });
    await app.inject({ method: 'POST', url, payload: { text: 'Britannia butter 1 pack 500 g' } });

    const captured = await app.inject({
      method: 'POST',
      url,
      payload: { text: 'Add eggs and make butter two packs' },
    });

    expect(captured.statusCode, captured.body).toBe(201);
    expect(captured.json()).toMatchObject({
      saved: [expect.objectContaining({ name: 'eggs' })],
      merged: [],
      drafts: [{ text: 'make butter two packs', reason: 'ambiguous_reference', status: 'open' }],
    });
    const listed = await app.inject({
      method: 'GET',
      url: '/api/v1/households/household-demo/items',
    });
    expect(listed.json()).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'make butter two packs' }),
    ]));
    await app.close();
  });

  it('keeps a changed package size as a separate active variant', async () => {
    const app = await buildApp({ databasePath: ':memory:' });
    const url = '/api/v1/households/household-demo/conversation-captures';
    await app.inject({ method: 'POST', url, payload: { text: 'Amul butter 1 pack 500 g' } });

    const changedVariant = await app.inject({
      method: 'POST',
      url,
      payload: { text: 'Amul butter 1 pack 100 g' },
    });

    expect(changedVariant.statusCode, changedVariant.body).toBe(201);
    expect(changedVariant.json()).toMatchObject({
      saved: [{ name: 'Amul butter', quantity: 1, packageSize: 100, packageUnit: 'g' }],
      merged: [],
    });
    const listed = await app.inject({
      method: 'GET',
      url: '/api/v1/households/household-demo/items',
    });
    expect(listed.json()).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'Amul butter', packageSize: 500 }),
      expect.objectContaining({ name: 'Amul butter', packageSize: 100 }),
    ]));
    await app.close();
  });

  it('keeps a session active across days and closes only its conversation context', async () => {
    let now = '2026-08-10T08:00:00.000Z';
    const app = await buildApp({ databasePath: ':memory:', clock: () => new Date(now) });
    const captureUrl = '/api/v1/households/household-demo/conversation-captures';
    const first = await app.inject({
      method: 'POST',
      url: captureUrl,
      payload: { text: 'Add eggs' },
    });
    const firstSessionId = first.json().session.id as string;

    now = '2026-08-13T08:00:00.000Z';
    const continued = await app.inject({
      method: 'POST',
      url: captureUrl,
      payload: { text: 'Add bread' },
    });
    expect(continued.json().session.id).toBe(firstSessionId);

    const active = await app.inject({
      method: 'GET',
      url: '/api/v1/households/household-demo/conversation-sessions/active',
    });
    expect(active.statusCode, active.body).toBe(200);
    expect(active.json()).toMatchObject({ id: firstSessionId, status: 'active', closedAt: null });

    const closed = await app.inject({
      method: 'POST',
      url: `/api/v1/households/household-demo/conversation-sessions/${firstSessionId}/close`,
    });
    expect(closed.statusCode, closed.body).toBe(200);
    expect(closed.json()).toMatchObject({
      id: firstSessionId,
      status: 'closed',
      closedAt: now,
    });
    const items = await app.inject({
      method: 'GET',
      url: '/api/v1/households/household-demo/items',
    });
    expect(items.json()).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'eggs', status: 'active' }),
      expect.objectContaining({ name: 'bread', status: 'active' }),
    ]));

    const next = await app.inject({
      method: 'POST',
      url: captureUrl,
      payload: { text: 'Add milk' },
    });
    expect(next.json().session.id).not.toBe(firstSessionId);

    await app.close();
  });

  it('reviews, resolves, and dismisses durable clarification drafts explicitly', async () => {
    const app = await buildApp({ databasePath: ':memory:' });
    const captureUrl = '/api/v1/households/household-demo/conversation-captures';
    const captured = await app.inject({
      method: 'POST',
      url: captureUrl,
      payload: { text: 'Add bread and ???' },
    });
    const sessionId = captured.json().session.id as string;
    const draftId = captured.json().drafts[0].id as string;

    const reviewed = await app.inject({
      method: 'GET',
      url: `/api/v1/households/household-demo/conversation-sessions/${sessionId}/drafts`,
    });
    expect(reviewed.statusCode, reviewed.body).toBe(200);
    expect(reviewed.json()).toEqual([
      expect.objectContaining({ id: draftId, text: '???', status: 'open' }),
    ]);

    const resolved = await app.inject({
      method: 'POST',
      url: `/api/v1/households/household-demo/conversation-drafts/${draftId}/resolve`,
      payload: { text: '2 kg potatoes', source: 'text' },
    });
    expect(resolved.statusCode, resolved.body).toBe(200);
    expect(resolved.json()).toMatchObject({
      draft: { id: draftId, status: 'resolved' },
      result: { saved: [{ name: 'potatoes', quantity: 2, unit: 'kg' }] },
    });

    const second = await app.inject({
      method: 'POST',
      url: captureUrl,
      payload: { text: '???' },
    });
    const dismissedId = second.json().drafts[0].id as string;
    const dismissed = await app.inject({
      method: 'POST',
      url: `/api/v1/households/household-demo/conversation-drafts/${dismissedId}/dismiss`,
    });
    expect(dismissed.statusCode, dismissed.body).toBe(200);
    expect(dismissed.json()).toMatchObject({ id: dismissedId, status: 'dismissed' });

    await app.close();
  });

  it('keeps household capture settings safe and suggestions local, advisory, and reversible', async () => {
    const app = await buildApp({ databasePath: ':memory:' });
    const settingsUrl = '/api/v1/households/household-demo/capture-settings';
    const defaults = await app.inject({ method: 'GET', url: settingsUrl });
    expect(defaults.statusCode, defaults.body).toBe(200);
    expect(defaults.json()).toEqual({
      automaticConversationClose: 'off',
      idleThresholdSeconds: 1800,
      gracePeriodSeconds: 300,
      warningPolicy: 'prompt',
      cloudDraftAssist: 'disabled',
      cloudAssistOnSave: false,
      cloudAssistWhileTyping: false,
      onlineLookupConsent: false,
      onlineLookupTrigger: 'manual',
      suggestions: 'enabled',
      entitlement: 'free',
    });

    const changed = await app.inject({
      method: 'PATCH',
      url: settingsUrl,
      payload: {
        automaticConversationClose: 'after_idle',
        idleThresholdSeconds: 60,
        gracePeriodSeconds: 120,
        warningPolicy: 'prompt',
        cloudDraftAssist: 'ask_before_each_use',
        cloudAssistOnSave: false,
        cloudAssistWhileTyping: false,
        suggestions: 'enabled',
      },
    });
    expect(changed.json()).toEqual({
      automaticConversationClose: 'after_idle',
      idleThresholdSeconds: 60,
      gracePeriodSeconds: 120,
      warningPolicy: 'prompt',
      cloudDraftAssist: 'ask_before_each_use',
      cloudAssistOnSave: false,
      cloudAssistWhileTyping: false,
      onlineLookupConsent: false,
      onlineLookupTrigger: 'manual',
      suggestions: 'enabled',
      entitlement: 'free',
    });

    const captureUrl = '/api/v1/households/household-demo/conversation-captures';
    await app.inject({ method: 'POST', url: captureUrl, payload: { text: 'Amul butter 2 packs 500 g' } });
    await app.inject({ method: 'POST', url: captureUrl, payload: { text: 'Amul butter 2 packs 500 g' } });
    await app.inject({ method: 'POST', url: captureUrl, payload: { text: '???' } });
    await app.inject({ method: 'POST', url: captureUrl, payload: { text: 'Amul butter 1 pack 100 g' } });

    const suggestionsUrl = '/api/v1/households/household-demo/suggestions';
    const suggested = await app.inject({ method: 'GET', url: suggestionsUrl });
    expect(suggested.statusCode, suggested.body).toBe(200);
    expect(suggested.json()).toEqual([{
      itemIdentityKey: expect.stringContaining('amul butter'),
      message: 'Usually: 2 packs · 500 g each',
      sourceEventIds: [expect.any(String), expect.any(String)],
    }]);
    const identityKey = suggested.json()[0].itemIdentityKey as string;

    const accepted = await app.inject({
      method: 'POST',
      url: `/api/v1/households/household-demo/suggestions/${encodeURIComponent(identityKey)}/accept`,
    });
    expect(accepted.statusCode, accepted.body).toBe(200);
    expect(accepted.json()).toEqual({ itemIdentityKey: identityKey, status: 'accepted' });
    expect((await app.inject({ method: 'GET', url: '/api/v1/households/household-demo/learning' })).json()).toEqual([
      expect.objectContaining({ kind: 'quantity_preference', status: 'active', supportingEventIds: [expect.any(String), expect.any(String)] }),
    ]);
    expect((await app.inject({ method: 'GET', url: suggestionsUrl })).json()).toEqual([]);
    const afterAcceptance = await app.inject({
      method: 'GET',
      url: '/api/v1/households/household-demo/items',
    });
    expect(afterAcceptance.json()).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'Amul butter', packageSize: 500, quantity: 4 }),
      expect.objectContaining({ name: 'Amul butter', packageSize: 100, quantity: 1 }),
    ]));

    const dismissed = await app.inject({
      method: 'POST',
      url: `/api/v1/households/household-demo/suggestions/${encodeURIComponent(identityKey)}/dismiss`,
    });
    expect(dismissed.statusCode, dismissed.body).toBe(200);
    expect((await app.inject({ method: 'GET', url: suggestionsUrl })).json()).toEqual([]);

    const restored = await app.inject({
      method: 'POST',
      url: `/api/v1/households/household-demo/suggestions/${encodeURIComponent(identityKey)}/restore`,
    });
    expect(restored.statusCode, restored.body).toBe(200);
    expect((await app.inject({ method: 'GET', url: suggestionsUrl })).json()).toHaveLength(1);

    await app.close();
  });

  it('enforces premium cloud assistance server-side and returns only a confirmation-required suggestion', async () => {
    let providerCalls = 0;
    const client = new CloudAssistClient({
      apiKey: 'server-only-key',
      fetch: async () => {
        providerCalls += 1;
        return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({
        itemName: 'Telma', quantity: 1, unit: 'strip', measures: [{ value: 40, unit: 'mg', role: 'medicine_strength' }], attributes: {}, rationale: 'strength is not a package size',
        }) } }] }), { status: 200 });
      },
    });
    const app = await buildApp({ databasePath: ':memory:', premiumAdminToken: 'operator-secret', cloudAssist: client });
    const householdUrl = '/api/v1/households/cloud-premium';
    const settings = {
      automaticConversationClose: 'off', idleThresholdSeconds: 1800, gracePeriodSeconds: 300,
      warningPolicy: 'prompt', cloudDraftAssist: 'disabled', cloudAssistOnSave: true,
      cloudAssistWhileTyping: false, onlineLookupConsent: true, onlineLookupTrigger: 'manual', suggestions: 'enabled',
    };
    const rejected = await app.inject({ method: 'PATCH', url: `${householdUrl}/capture-settings`, payload: settings });
    expect(rejected.statusCode).toBe(403);

    const elevated = await app.inject({
      method: 'PUT', url: '/api/v1/admin/households/cloud-premium/entitlement',
      headers: { 'x-duckworth-admin-token': 'operator-secret' }, payload: { plan: 'premium' },
    });
    expect(elevated.json()).toEqual({ plan: 'premium' });
    const saved = await app.inject({ method: 'PATCH', url: `${householdUrl}/capture-settings`, payload: settings });
    expect(saved.json()).toMatchObject({ cloudAssistOnSave: true, entitlement: 'premium' });

    const suggestion = await app.inject({
      method: 'POST', url: `${householdUrl}/cloud-assist`, payload: { text: '1 strip of Telma 40 mg', trigger: 'save' },
    });
    expect(suggestion.statusCode, suggestion.body).toBe(200);
    expect(suggestion.json()).toMatchObject({
      requiresUserConfirmation: true,
      suggestion: { itemName: 'Telma', quantity: 1, unit: 'strip', measures: [{ role: 'medicine_strength' }] },
    });
    const cachedSuggestion = await app.inject({
      method: 'POST', url: `${householdUrl}/cloud-assist`, payload: { text: '1 strip of Telma 40 mg', trigger: 'save' },
    });
    expect(cachedSuggestion.statusCode, cachedSuggestion.body).toBe(200);
    expect(providerCalls).toBe(1);
    const token = suggestion.json().acceptanceToken as string;
    const accepted = await app.inject({
      method: 'POST', url: `${householdUrl}/cloud-assist/${token}/accept`, payload: { text: '1 strip of Telma 40 mg' },
    });
    expect(accepted.statusCode, accepted.body).toBe(200);
    const replay = await app.inject({
      method: 'POST', url: `${householdUrl}/cloud-assist/${token}/accept`, payload: { text: '1 strip of Telma 40 mg' },
    });
    expect(replay.statusCode, replay.body).toBe(409);
    await app.close();
  });

  it('only requests automatic idle closure after the household opts in and the threshold elapses', async () => {
    let now = new Date('2026-08-12T00:00:00.000Z');
    const app = await buildApp({ databasePath: ':memory:', clock: () => now });
    const householdUrl = '/api/v1/households/idle-policy';
    const registration = await app.inject({
      method: 'POST',
      url: `${householdUrl}/conversation-contexts`,
      payload: { deviceId: 'device-a' },
    });
    const settings = {
      automaticConversationClose: 'after_idle',
      idleThresholdSeconds: 60,
      gracePeriodSeconds: 120,
      warningPolicy: 'prompt',
      cloudDraftAssist: 'disabled',
      cloudAssistOnSave: false,
      cloudAssistWhileTyping: false,
      suggestions: 'enabled',
    } as const;
    await app.inject({ method: 'PATCH', url: `${householdUrl}/capture-settings`, payload: settings });
    const started = await app.inject({
      method: 'POST',
      url: `${householdUrl}/conversation-captures`,
      payload: { text: 'milk', contextId: registration.json().context.id, accessToken: registration.json().accessToken },
    });
    const listId = started.json().session.shoppingListId as string;
    const early = await app.inject({
      method: 'POST',
      url: `${householdUrl}/conversation-lifecycle/evaluate`,
      payload: { shoppingListId: listId, contextId: registration.json().context.id, accessToken: registration.json().accessToken },
    });
    expect(early.json()).toEqual({ session: null, pendingAction: null });
    now = new Date(now.getTime() + 61_000);
    const evaluated = await app.inject({
      method: 'POST',
      url: `${householdUrl}/conversation-lifecycle/evaluate`,
      payload: { shoppingListId: listId, contextId: registration.json().context.id, accessToken: registration.json().accessToken },
    });
    expect(evaluated.json()).toMatchObject({
      session: { status: 'close_pending' },
      pendingAction: { origin: 'configured_idle_policy', status: 'pending', expiresAt: '2026-08-12T00:03:01.000Z' },
    });
    await app.close();
  });

  it('creates structured intent from typed shorthand', async () => {
    const app = await buildApp({ databasePath: ':memory:' });

    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/households/household-demo/items',
      payload: { input: '1.5 kg potatoes' },
    });

    expect(created.statusCode, created.body).toBe(201);
    expect(created.json()).toMatchObject({
      captureText: '1.5 kg potatoes',
      name: 'potatoes',
      quantity: 1.5,
      unit: 'kg',
      unitSource: 'explicit',
      unitConfirmedAt: expect.any(String),
      attentionReasons: [],
      status: 'active',
      version: 1,
    });

    await app.close();
  });

  it('creates structured intent from trailing quantity and unit shorthand', async () => {
    const app = await buildApp({ databasePath: ':memory:' });
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/households/household-demo/items',
      payload: { input: 'biscuits 2 pcs' },
    });

    expect(created.statusCode, created.body).toBe(201);
    expect(created.json()).toMatchObject({
      captureText: 'biscuits 2 pcs',
      name: 'biscuits',
      quantity: 2,
      unit: 'piece',
      unitSource: 'explicit',
      attentionReasons: [],
    });
    await app.close();
  });

  it('uses the same shopping intelligence for a voice transcript submitted through the API', async () => {
    const app = await buildApp({ databasePath: ':memory:' });

    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/households/household-demo/items',
      payload: {
        input: 'I need 2 packs of Amul Butter 500 g',
        source: 'voice',
      },
    });

    expect(created.statusCode, created.body).toBe(201);
    expect(created.json()).toMatchObject({
      captureText: 'I need 2 packs of Amul Butter 500 g',
      name: 'Amul Butter',
      quantity: 2,
      unit: 'pack',
      packageSize: 500,
      packageUnit: 'g',
      attentionReasons: [],
    });

    await app.close();
  });

  it.each([
    ['1 pack of Amul Butter 500 gms', 'Amul Butter', 1, 'pack', 500, 'g'],
    ['two packs of 500 g Amul Butter', 'Amul Butter', 2, 'pack', 500, 'g'],
    ['Amul Butter 500g 2 packs', 'Amul Butter', 2, 'pack', 500, 'g'],
    ['500 g Amul Butter, 2 packs', 'Amul Butter', 2, 'pack', 500, 'g'],
    ['100 grams of Amul butter 1 pac', 'Amul butter', 1, 'pack', 100, 'g'],
    ['2 pacs of 50g of Amul butter', 'Amul butter', 2, 'pack', 50, 'g'],
    ['Amul Butter - 2 packs of 500g', 'Amul Butter', 2, 'pack', 500, 'g'],
    ['3 bottles of स्थानीय juice 750 ml', 'स्थानीय juice', 3, 'bottle', 750, 'ml'],
    ['Coke 6x330ml cans', 'Coke', 6, 'can', 330, 'ml'],
    ['2 trays of eggs 30 pcs each', 'eggs', 2, 'tray', 30, 'piece'],
    ['Amul Butter 500 g pack of 2', 'Amul Butter', 2, 'pack', 500, 'g'],
  ])(
    'persists a human-language capture matrix: %s',
    async (input, name, quantity, unit, packageSize, packageUnit) => {
      const app = await buildApp({ databasePath: ':memory:' });

      const created = await app.inject({
        method: 'POST',
        url: '/api/v1/households/household-demo/items',
        payload: { input, source: 'api' },
      });

      expect(created.statusCode, created.body).toBe(201);
      expect(created.json()).toMatchObject({
        captureText: input,
        name,
        quantity,
        unit,
        packageSize,
        packageUnit,
      });
      await app.close();
    },
  );

  it('rejects multipack duplicates despite different natural phrasing', async () => {
    const app = await buildApp({ databasePath: ':memory:' });
    const url = '/api/v1/households/household-demo/items';
    const created = await app.inject({ method: 'POST', url, payload: { input: '6x330ml cans of Coke' } });
    const duplicate = await app.inject({
      method: 'POST',
      url,
      payload: { input: 'Coke 6 cans of 330 ml each', source: 'voice' },
    });

    expect(created.statusCode, created.body).toBe(201);
    expect(created.json()).toMatchObject({ name: 'Coke', quantity: 6, unit: 'can', packageSize: 330, packageUnit: 'ml' });
    expect(duplicate.statusCode, duplicate.body).toBe(409);
    expect(duplicate.json()).toEqual({ error: 'duplicate_item', existingItemId: created.json().id });
    await app.close();
  });

  it('rejects an exact package rephrase while preserving changed package variants', async () => {
    const app = await buildApp({ databasePath: ':memory:' });
    const url = '/api/v1/households/household-demo/items';

    const created = await app.inject({
      method: 'POST',
      url,
      payload: { input: 'amul butter 1 pack 500 gm', productId: 'product.amul.butter' },
    });
    const duplicate = await app.inject({
      method: 'POST',
      url,
      payload: { input: 'amul butter 500 gms 1 pac' },
    });
    const duplicateWithSizeFirstConnector = await app.inject({
      method: 'POST',
      url,
      payload: { input: '100 grams of Amul butter 1 pac' },
    });
    const duplicateWithTwoConnectors = await app.inject({
      method: 'POST',
      url,
      payload: { input: '2 pacs of 50g of Amul butter' },
    });

    expect(created.statusCode, created.body).toBe(201);
    expect(created.json()).toMatchObject({
      name: 'Amul Butter',
      quantity: 1,
      unit: 'pack',
      packageSize: 500,
      packageUnit: 'g',
      productId: 'product.amul.butter',
      brandId: 'brand.amul',
      conceptId: 'grocery.butter.dairy',
      attentionReasons: [],
    });
    expect(duplicate.statusCode, duplicate.body).toBe(409);
    expect(duplicate.json()).toMatchObject({
      error: 'duplicate_item',
      existingItemId: created.json().id,
    });
    expect(duplicateWithSizeFirstConnector.statusCode, duplicateWithSizeFirstConnector.body).toBe(201);
    expect(duplicateWithSizeFirstConnector.json()).toMatchObject({
      name: 'Amul butter',
      quantity: 1,
      unit: 'pack',
      packageSize: 100,
      packageUnit: 'g',
    });
    expect(duplicateWithTwoConnectors.statusCode, duplicateWithTwoConnectors.body).toBe(201);
    expect(duplicateWithTwoConnectors.json()).toMatchObject({
      name: 'Amul butter',
      quantity: 2,
      unit: 'pack',
      packageSize: 50,
      packageUnit: 'g',
    });
    await app.close();
  });

  it('rejects a product identity that does not match the captured name', async () => {
    const app = await buildApp({ databasePath: ':memory:' });
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/households/household-demo/items',
      payload: { input: 'rice 1 pack 500 g', productId: 'product.amul.butter' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: 'invalid_product_reference' });
    await app.close();
  });

  it('records a unit explicitly confirmed before creation', async () => {
    const app = await buildApp({ databasePath: ':memory:' });
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/households/household-demo/items',
      payload: { input: '2 milk', confirmedUnit: ' cartons ' },
    });

    expect(response.statusCode, response.body).toBe(201);
    expect(response.json()).toMatchObject({
      quantity: 2,
      unit: 'cartons',
      unitSource: 'explicit',
      unitConfirmedAt: expect.any(String),
      attentionReasons: [],
    });
    await app.close();
  });

  it('saves a bare item with missing quantity attention', async () => {
    const app = await buildApp({ databasePath: ':memory:' });

    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/households/household-demo/items',
      payload: { input: 'milk' },
    });

    expect(created.statusCode, created.body).toBe(201);
    expect(created.json()).toMatchObject({
      name: 'milk',
        quantity: 1,
        unit: 'piece',
        attentionReasons: [],
    });

    await app.close();
  });

  it('hides active attention while purchased and derives it again when reopened', async () => {
    const app = await buildApp({ databasePath: ':memory:' });
    const url = '/api/v1/households/household-demo/items';
    const created = await app.inject({ method: 'POST', url, payload: { input: 'milk' } });
    const itemId = created.json().id as string;

    const purchased = await app.inject({
      method: 'PATCH',
      url: `${url}/${itemId}`,
      payload: { status: 'purchased', expectedVersion: 1 },
    });
    expect(purchased.json().attentionReasons).toEqual([]);

    const reopened = await app.inject({
      method: 'PATCH',
      url: `${url}/${itemId}`,
      payload: { status: 'active', expectedVersion: 2 },
    });
    expect(reopened.json().attentionReasons).toEqual([]);

    await app.close();
  });

  it('creates and lists an active item for a household', async () => {
    const app = await buildApp({ databasePath: ':memory:' });

    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/households/household-demo/items',
      payload: { name: '  Milk  ' },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ name: 'Milk', status: 'active', version: 1 });

    const listed = await app.inject({
      method: 'GET',
      url: '/api/v1/households/household-demo/items',
    });
    expect(listed.statusCode).toBe(200);
    expect(listed.json()).toHaveLength(1);
    expect(listed.json()[0]).toMatchObject({ name: 'Milk', status: 'active' });

    await app.close();
  });

  it('keeps legacy name capture while rejecting ambiguous capture fields', async () => {
    const app = await buildApp({ databasePath: ':memory:' });
    const url = '/api/v1/households/household-demo/items';

    const legacy = await app.inject({ method: 'POST', url, payload: { name: 'Milk' } });
    const neither = await app.inject({ method: 'POST', url, payload: {} });
    const both = await app.inject({ method: 'POST', url, payload: { input: 'Bread', name: 'Bread' } });

    expect(legacy.statusCode, legacy.body).toBe(201);
    expect(legacy.json()).toMatchObject({ captureText: 'Milk', name: 'Milk' });
    expect(neither.statusCode).toBe(400);
    expect(both.statusCode).toBe(400);
    await app.close();
  });

  it('returns a conflict for a normalized duplicate', async () => {
    const app = await buildApp({ databasePath: ':memory:' });
    const url = '/api/v1/households/household-demo/items';

    await app.inject({ method: 'POST', url, payload: { name: 'Milk' } });
    const duplicate = await app.inject({ method: 'POST', url, payload: { name: ' milk ' } });

    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json()).toMatchObject({ error: 'duplicate_item' });
    await app.close();
  });

  it('marks an item purchased and excludes it from the active list', async () => {
    const app = await buildApp({ databasePath: ':memory:' });
    const url = '/api/v1/households/household-demo/items';
    const created = await app.inject({ method: 'POST', url, payload: { name: 'Bread' } });
    const itemId = created.json().id as string;

    const updated = await app.inject({
      method: 'PATCH',
      url: `${url}/${itemId}`,
      payload: { status: 'purchased', expectedVersion: 1 },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json()).toMatchObject({ id: itemId, status: 'purchased', version: 2 });

    const listed = await app.inject({ method: 'GET', url });
    expect(listed.json()).toEqual([]);
    await app.close();
  });

  it('retains repeated purchases while preventing simultaneous active duplicates', async () => {
    const app = await buildApp({ databasePath: ':memory:' });
    const url = '/api/v1/households/household-demo/items';

    const first = await app.inject({ method: 'POST', url, payload: { input: '2 cartons milk' } });
    await app.inject({
      method: 'PATCH',
      url: `${url}/${first.json().id}`,
      payload: { status: 'purchased', expectedVersion: 1 },
    });
    const second = await app.inject({ method: 'POST', url, payload: { input: '2 cartons milk' } });
    const duplicate = await app.inject({ method: 'POST', url, payload: { input: '2 cartons milk' } });

    expect(second.statusCode, second.body).toBe(201);
    expect(duplicate.statusCode).toBe(409);

    const secondPurchased = await app.inject({
      method: 'PATCH',
      url: `${url}/${second.json().id}`,
      payload: { status: 'purchased', expectedVersion: 1 },
    });
    expect(secondPurchased.statusCode, secondPurchased.body).toBe(200);

    const history = await app.inject({ method: 'GET', url: `${url}?includePurchased=true` });
    expect(history.json().filter((item: { status: string }) => item.status === 'purchased')).toHaveLength(2);
    await app.close();
  });

  it('suggests the latest explicitly confirmed household unit without confirming it', async () => {
    const app = await buildApp({ databasePath: ':memory:' });
    const url = '/api/v1/households/household-demo/items';
    const first = await app.inject({ method: 'POST', url, payload: { input: '2 cartons milk' } });
    await app.inject({
      method: 'PATCH',
      url: `${url}/${first.json().id}`,
      payload: { status: 'purchased', expectedVersion: 1 },
    });

    const repeated = await app.inject({ method: 'POST', url, payload: { input: '2 milk' } });

    expect(repeated.statusCode, repeated.body).toBe(201);
    expect(repeated.json()).toMatchObject({
      name: 'milk',
      quantity: 2,
      unit: 'carton',
      unitSource: 'history',
      unitConfirmedAt: null,
      attentionReasons: ['unconfirmed_historical_unit'],
    });
    await app.close();
  });

  it('never suggests another household unit history', async () => {
    const app = await buildApp({ databasePath: ':memory:' });
    const familyA = '/api/v1/households/family-a/items';
    const familyB = '/api/v1/households/family-b/items';
    const first = await app.inject({ method: 'POST', url: familyA, payload: { input: '2 cartons milk' } });
    await app.inject({
      method: 'PATCH', url: `${familyA}/${first.json().id}`,
      payload: { status: 'purchased', expectedVersion: 1 },
    });

    const otherHousehold = await app.inject({ method: 'POST', url: familyB, payload: { input: '2 milk' } });
    expect(otherHousehold.json()).toMatchObject({ unit: 'piece', unitSource: 'policy_default', attentionReasons: [] });
    await app.close();
  });

  it('prefers the most recently confirmed unit when household history differs', async () => {
    let now = '2026-08-04T10:00:00.000Z';
    const app = await buildApp({ databasePath: ':memory:', clock: () => new Date(now) });
    const url = '/api/v1/households/household-demo/items';
    try {
      const cartons = await app.inject({ method: 'POST', url, payload: { input: '2 cartons milk' } });
      await app.inject({
        method: 'PATCH', url: `${url}/${cartons.json().id}`,
        payload: { status: 'purchased', expectedVersion: 1 },
      });

      now = '2026-08-04T11:00:00.000Z';
      const bottles = await app.inject({ method: 'POST', url, payload: { input: '2 bottles milk' } });
      await app.inject({
        method: 'PATCH', url: `${url}/${bottles.json().id}`,
        payload: { status: 'purchased', expectedVersion: 1 },
      });

      now = '2026-08-04T12:00:00.000Z';
      const repeated = await app.inject({ method: 'POST', url, payload: { input: '2 milk' } });
      expect(repeated.json()).toMatchObject({ unit: 'bottle', unitSource: 'history' });
    } finally {
      await app.close();
    }
  });

  it('does not refresh unit confirmation time for status-only changes', async () => {
    let now = '2026-08-04T10:00:00.000Z';
    const app = await buildApp({ databasePath: ':memory:', clock: () => new Date(now) });
    const url = '/api/v1/households/household-demo/items';
    const created = await app.inject({ method: 'POST', url, payload: { input: '2 cartons milk' } });
    now = '2026-08-04T11:00:00.000Z';

    const purchased = await app.inject({
      method: 'PATCH', url: `${url}/${created.json().id}`,
      payload: { status: 'purchased', expectedVersion: 1 },
    });

    expect(created.json().unitConfirmedAt).toBe('2026-08-04T10:00:00.000Z');
    expect(purchased.json().unitConfirmedAt).toBe('2026-08-04T10:00:00.000Z');
    await app.close();
  });

  it('accepts a historical unit with one versioned structured update', async () => {
    let now = '2026-08-04T10:00:00.000Z';
    const app = await buildApp({ databasePath: ':memory:', clock: () => new Date(now) });
    const url = '/api/v1/households/household-demo/items';
    const first = await app.inject({ method: 'POST', url, payload: { input: '2 cartons milk' } });
    await app.inject({
      method: 'PATCH', url: `${url}/${first.json().id}`,
      payload: { status: 'purchased', expectedVersion: 1 },
    });
    const inferred = await app.inject({ method: 'POST', url, payload: { input: '2 milk' } });
    now = '2026-08-04T11:00:00.000Z';

    const accepted = await app.inject({
      method: 'PATCH',
      url: `${url}/${inferred.json().id}`,
      payload: { confirmedUnit: 'carton', expectedVersion: 1 },
    });

    expect(accepted.statusCode, accepted.body).toBe(200);
    expect(accepted.json()).toMatchObject({
      unit: 'carton',
      unitSource: 'explicit',
      unitConfirmedAt: '2026-08-04T11:00:00.000Z',
      attentionReasons: [],
      version: 2,
    });
    await app.close();
  });

  it('makes an edited historical unit the newest confirmed household choice', async () => {
    let now = '2026-08-04T10:00:00.000Z';
    const app = await buildApp({ databasePath: ':memory:', clock: () => new Date(now) });
    const url = '/api/v1/households/household-demo/items';
    const first = await app.inject({ method: 'POST', url, payload: { input: '2 cartons milk' } });
    await app.inject({
      method: 'PATCH', url: `${url}/${first.json().id}`,
      payload: { status: 'purchased', expectedVersion: 1 },
    });
    const inferred = await app.inject({ method: 'POST', url, payload: { input: '2 milk' } });

    now = '2026-08-04T11:00:00.000Z';
    const changed = await app.inject({
      method: 'PATCH', url: `${url}/${inferred.json().id}`,
      payload: { confirmedUnit: 'bottle', expectedVersion: 1 },
    });
    await app.inject({
      method: 'PATCH', url: `${url}/${inferred.json().id}`,
      payload: { status: 'purchased', expectedVersion: changed.json().version },
    });

    now = '2026-08-04T12:00:00.000Z';
    const repeated = await app.inject({ method: 'POST', url, payload: { input: '2 milk' } });
    expect(repeated.json()).toMatchObject({ unit: 'bottle', unitSource: 'history' });
    await app.close();
  });

  it('clears and restores structured quantity and unit details', async () => {
    const app = await buildApp({ databasePath: ':memory:' });
    const url = '/api/v1/households/household-demo/items';
    const created = await app.inject({ method: 'POST', url, payload: { input: '2 kg potatoes' } });

    const cleared = await app.inject({
      method: 'PATCH', url: `${url}/${created.json().id}`,
      payload: { quantity: null, confirmedUnit: null, expectedVersion: 1 },
    });
    expect(cleared.statusCode, cleared.body).toBe(200);
    expect(cleared.json()).toMatchObject({
      quantity: null,
      unit: null,
      unitSource: null,
      unitConfirmedAt: null,
      attentionReasons: ['missing_quantity'],
      version: 2,
    });

    const completed = await app.inject({
      method: 'PATCH', url: `${url}/${created.json().id}`,
      payload: { quantity: 3, expectedVersion: 2 },
    });
    expect(completed.json()).toMatchObject({ quantity: 3, attentionReasons: [], version: 3 });
    await app.close();
  });

  it('edits and reopens an item with optimistic concurrency', async () => {
    const app = await buildApp({ databasePath: ':memory:' });
    const url = '/api/v1/households/household-demo/items';
    const created = await app.inject({ method: 'POST', url, payload: { name: 'Bread' } });
    const itemId = created.json().id as string;

    const edited = await app.inject({
      method: 'PATCH',
      url: `${url}/${itemId}`,
      payload: { name: 'Whole grain bread', expectedVersion: 1 },
    });
    expect(edited.statusCode).toBe(200);
    expect(edited.json()).toMatchObject({ name: 'Whole grain bread', version: 2 });

    const reopened = await app.inject({
      method: 'PATCH',
      url: `${url}/${itemId}`,
      payload: { status: 'active', expectedVersion: 2 },
    });
    expect(reopened.statusCode).toBe(200);
    expect(reopened.json()).toMatchObject({ status: 'active', version: 3 });
    await app.close();
  });

  it('atomically reconciles duplicated measurement text during a complete item correction', async () => {
    const app = await buildApp({ databasePath: ':memory:' });
    const url = '/api/v1/households/household-demo/items';
    const created = await app.inject({
      method: 'POST',
      url,
      payload: { input: 'Britannia 50-50 biscuit' },
    });

    const corrected = await app.inject({
      method: 'PATCH',
      url: `${url}/${created.json().id}`,
      payload: {
        captureText: 'Britannia 50-50 biscuit 1 pack',
        name: 'Britannia 50-50 biscuit 1 pack',
        quantity: 1,
        confirmedUnit: 'pack',
        packageSize: null,
        packageUnit: null,
        expectedVersion: 1,
      },
    });

    expect(corrected.statusCode, corrected.body).toBe(200);
    expect(corrected.json()).toMatchObject({
      captureText: 'Britannia 50-50 biscuit 1 pack',
      name: 'Britannia 50-50 biscuit',
      quantity: 1,
      unit: 'pack',
      packageSize: null,
      packageUnit: null,
      version: 2,
    });
    await app.close();
  });

  it('retains reviewed product identity when only structured details change', async () => {
    const app = await buildApp({ databasePath: ':memory:' });
    const url = '/api/v1/households/household-demo/items';
    const created = await app.inject({
      method: 'POST',
      url,
      payload: { input: 'Amul Butter 1 pack 500 g', productId: 'product.amul.butter' },
    });

    const corrected = await app.inject({
      method: 'PATCH',
      url: `${url}/${created.json().id}`,
      payload: {
        captureText: 'Amul Butter',
        name: 'Amul Butter',
        quantity: 2,
        confirmedUnit: 'pack',
        packageSize: 500,
        packageUnit: 'g',
        expectedVersion: 1,
      },
    });

    expect(corrected.statusCode, corrected.body).toBe(200);
    expect(corrected.json()).toMatchObject({
      name: 'Amul Butter',
      quantity: 2,
      productId: 'product.amul.butter',
      brandId: 'brand.amul',
      conceptId: 'grocery.butter.dairy',
    });
    await app.close();
  });

  it('soft-removes an accidental item and restores it without marking it purchased', async () => {
    const app = await buildApp({ databasePath: ':memory:' });
    const url = '/api/v1/households/household-demo/items';
    const created = await app.inject({ method: 'POST', url, payload: { input: 'Dukes Bourbon 50 g 1 pack' } });

    const removed = await app.inject({
      method: 'PATCH',
      url: `${url}/${created.json().id}`,
      payload: { status: 'removed', expectedVersion: 1 },
    });

    expect(removed.statusCode, removed.body).toBe(200);
    expect(removed.json()).toMatchObject({
      status: 'removed',
      removedAt: expect.any(String),
      version: 2,
    });
    expect((await app.inject({ method: 'GET', url })).json()).toEqual([]);
    expect((await app.inject({ method: 'GET', url: `${url}?includeRemoved=true` })).json())
      .toEqual([expect.objectContaining({ id: created.json().id, status: 'removed' })]);

    const restored = await app.inject({
      method: 'PATCH',
      url: `${url}/${created.json().id}`,
      payload: { status: 'active', expectedVersion: 2 },
    });
    expect(restored.statusCode, restored.body).toBe(200);
    expect(restored.json()).toMatchObject({ status: 'active', removedAt: null, version: 3 });
    await app.close();
  });

  it('does not learn a unit from an item the user removed', async () => {
    const app = await buildApp({ databasePath: ':memory:' });
    const url = '/api/v1/households/household-demo/items';
    const created = await app.inject({ method: 'POST', url, payload: { input: '2 cartons milk' } });
    await app.inject({
      method: 'PATCH',
      url: `${url}/${created.json().id}`,
      payload: { status: 'removed', expectedVersion: 1 },
    });

    const replacement = await app.inject({ method: 'POST', url, payload: { input: '2 milk' } });
    expect(replacement.statusCode, replacement.body).toBe(201);
    expect(replacement.json()).toMatchObject({
      name: 'milk',
      quantity: 2,
      unit: 'piece',
      unitSource: 'policy_default',
      attentionReasons: [],
    });
    await app.close();
  });

  it('rejects a stale update without overwriting the current item', async () => {
    const app = await buildApp({ databasePath: ':memory:' });
    const url = '/api/v1/households/household-demo/items';
    const created = await app.inject({ method: 'POST', url, payload: { name: 'Eggs' } });
    const itemId = created.json().id as string;

    await app.inject({ method: 'PATCH', url: `${url}/${itemId}`, payload: { name: 'Free range eggs', expectedVersion: 1 } });
    const stale = await app.inject({
      method: 'PATCH',
      url: `${url}/${itemId}`,
      payload: { name: 'Brown eggs', expectedVersion: 1 },
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toMatchObject({ error: 'item_version_conflict', currentItem: { name: 'Free range eggs', version: 2 } });
    await app.close();
  });

  it('rejects a stale structured update without changing confirmed history', async () => {
    const app = await buildApp({ databasePath: ':memory:' });
    const url = '/api/v1/households/household-demo/items';
    const created = await app.inject({ method: 'POST', url, payload: { input: '2 kg potatoes' } });

    await app.inject({
      method: 'PATCH', url: `${url}/${created.json().id}`,
      payload: { quantity: 3, expectedVersion: 1 },
    });
    const stale = await app.inject({
      method: 'PATCH', url: `${url}/${created.json().id}`,
      payload: { confirmedUnit: 'bag', expectedVersion: 1 },
    });

    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toMatchObject({
      error: 'item_version_conflict',
      currentItem: { quantity: 3, unit: 'kg', unitSource: 'explicit', version: 2 },
    });
    await app.close();
  });

  it('returns a duplicate conflict when an edit matches another active item', async () => {
    const app = await buildApp({ databasePath: ':memory:' });
    const url = '/api/v1/households/household-demo/items';
    const first = await app.inject({ method: 'POST', url, payload: { name: 'Milk' } });
    const second = await app.inject({ method: 'POST', url, payload: { name: 'Oat milk' } });
    const response = await app.inject({
      method: 'PATCH',
      url: `${url}/${second.json().id}`,
      payload: { name: ' milk ', expectedVersion: 1 },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ error: 'duplicate_item', existingItemId: first.json().id });
    await app.close();
  });

  it('archives an immutable active-list snapshot that can be reviewed, reopened, and copied', async () => {
    const app = await buildApp({ databasePath: ':memory:' });
    const householdUrl = '/api/v1/households/household-demo';
    const captured = await app.inject({
      method: 'POST',
      url: `${householdUrl}/conversation-captures`,
      payload: { text: 'Add bread and 4 milk pouches of 1 litre each' },
    });
    const originalItems = captured.json().saved as Array<{ id: string; version: number }>;

    const archived = await app.inject({
      method: 'POST',
      url: `${householdUrl}/shopping-list-archives`,
    });

    expect(archived.statusCode, archived.body).toBe(201);
    expect(archived.json()).toMatchObject({
      householdId: 'household-demo',
      status: 'archived',
      reopenedAt: null,
      items: expect.arrayContaining([
        expect.objectContaining({ name: 'bread', status: 'active' }),
        expect.objectContaining({ name: 'milk', quantity: 4, unit: 'pouch', packageSize: 1, packageUnit: 'l', status: 'active' }),
      ]),
    });
    const archiveId = archived.json().id as string;

    const reviewed = await app.inject({
      method: 'GET',
      url: `${householdUrl}/shopping-list-archives/${archiveId}`,
    });
    expect(reviewed.statusCode, reviewed.body).toBe(200);
    expect(reviewed.json().items).toEqual(archived.json().items);
    expect((await app.inject({ method: 'GET', url: `${householdUrl}/conversation-sessions/active` })).statusCode)
      .toBe(200);
    expect((await app.inject({ method: 'GET', url: `${householdUrl}/items` })).json())
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ name: 'bread', status: 'active' }),
        expect.objectContaining({ name: 'milk', status: 'active' }),
      ]));

    const reopened = await app.inject({
      method: 'POST',
      url: `${householdUrl}/shopping-list-archives/${archiveId}/reopen`,
    });
    expect(reopened.statusCode, reopened.body).toBe(200);
    expect(reopened.json()).toMatchObject({ id: archiveId, status: 'reopened', reopenedAt: expect.any(String) });
    expect(reopened.json().items).toEqual(archived.json().items);

    for (const item of originalItems) {
      await app.inject({
        method: 'PATCH',
        url: `${householdUrl}/items/${item.id}`,
        payload: { status: 'removed', expectedVersion: item.version },
      });
    }
    const copied = await app.inject({
      method: 'POST',
      url: `${householdUrl}/shopping-list-archives/${archiveId}/copy`,
    });
    expect(copied.statusCode, copied.body).toBe(201);
    expect(copied.json()).toMatchObject({
      archive: { id: archiveId, status: 'reopened' },
      items: expect.arrayContaining([
        expect.objectContaining({ name: 'bread', status: 'active' }),
        expect.objectContaining({ name: 'milk', quantity: 4, unit: 'pouch', packageSize: 1, packageUnit: 'l', status: 'active' }),
      ]),
    });
    expect(copied.json().items.every((item: { status: string }) => item.status === 'active')).toBe(true);
    await app.close();
  });

  it('registers a dynamic device and speaker context with a non-reusable access token', async () => {
    const app = await buildApp({ databasePath: ':memory:' });
    const url = '/api/v1/households/context-household/conversation-contexts';

    const registered = await app.inject({
      method: 'POST',
      url,
      payload: { deviceId: 'kitchen-speaker', speakerId: 'speaker-7', label: 'Kitchen speaker' },
    });

    expect(registered.statusCode, registered.body).toBe(201);
    expect(registered.json()).toMatchObject({
      context: {
        id: expect.any(String),
        householdId: 'context-household',
        deviceId: 'kitchen-speaker',
        speakerId: 'speaker-7',
        status: 'active',
      },
      accessToken: expect.any(String),
    });

    const repeated = await app.inject({
      method: 'POST',
      url,
      payload: { deviceId: 'kitchen-speaker', speakerId: 'speaker-7', label: 'Renamed speaker' },
    });
    expect(repeated.statusCode, repeated.body).toBe(200);
    expect(repeated.json().context.id).toBe(registered.json().context.id);
    expect(repeated.json().accessToken).toEqual(expect.any(String));
    expect(repeated.json().accessToken).not.toBe(registered.json().accessToken);

    const listed = await app.inject({ method: 'GET', url });
    expect(listed.statusCode, listed.body).toBe(200);
    expect(listed.json()).toEqual([
      expect.objectContaining({ id: registered.json().context.id, label: 'Kitchen speaker' }),
    ]);

    const captured = await app.inject({
      method: 'POST',
      url: '/api/v1/households/context-household/conversation-captures',
      payload: {
        text: 'milk',
        source: 'voice',
        contextId: registered.json().context.id,
        accessToken: repeated.json().accessToken,
      },
    });
    expect(captured.statusCode, captured.body).toBe(201);
    expect(captured.json().session.contextId).toBe(registered.json().context.id);

    const replayPayload = {
      text: 'rice 1 pack',
      source: 'api',
      contextId: registered.json().context.id,
      accessToken: repeated.json().accessToken,
      idempotencyKey: 'context-capture-rice-1',
    };
    const firstReplay = await app.inject({
      method: 'POST',
      url: '/api/v1/households/context-household/conversation-captures',
      payload: replayPayload,
    });
    const secondReplay = await app.inject({
      method: 'POST',
      url: '/api/v1/households/context-household/conversation-captures',
      payload: replayPayload,
    });
    expect(firstReplay.statusCode, firstReplay.body).toBe(201);
    expect(secondReplay.statusCode, secondReplay.body).toBe(201);
    expect(secondReplay.json()).toEqual(firstReplay.json());

    const other = await app.inject({
      method: 'POST',
      url,
      payload: { deviceId: 'hallway-speaker', speakerId: 'speaker-8' },
    });
    const forbidden = await app.inject({
      method: 'POST',
      url: '/api/v1/households/context-household/conversation-captures',
      payload: {
        text: 'should stay private',
        source: 'voice',
        contextId: registered.json().context.id,
        accessToken: other.json().accessToken,
      },
    });
    expect(forbidden.statusCode, forbidden.body).toBe(403);
    const otherCapture = await app.inject({
      method: 'POST',
      url: '/api/v1/households/context-household/conversation-captures',
      payload: {
        text: 'bread',
        source: 'assistant',
        contextId: other.json().context.id,
        accessToken: other.json().accessToken,
      },
    });
    expect(otherCapture.statusCode, otherCapture.body).toBe(201);
    expect(otherCapture.json().session.contextId).toBe(other.json().context.id);
    expect(otherCapture.json().session.id).not.toBe(captured.json().session.id);

    const handoff = await app.inject({
      method: 'POST',
      url: `/api/v1/households/context-household/conversation-contexts/${registered.json().context.id}/handoff`,
      payload: {
        accessToken: repeated.json().accessToken,
        targetDeviceId: 'mobile-device',
        targetSpeakerId: 'speaker-7',
      },
    });
    expect(handoff.statusCode, handoff.body).toBe(201);
    expect(handoff.json()).toMatchObject({ handoffToken: expect.any(String), expiresAt: expect.any(String) });

    const claimed = await app.inject({
      method: 'POST',
      url: '/api/v1/households/context-household/conversation-contexts/claim',
      payload: {
        handoffToken: handoff.json().handoffToken,
        deviceId: 'mobile-device',
        speakerId: 'speaker-7',
      },
    });
    expect(claimed.statusCode, claimed.body).toBe(200);
    expect(claimed.json()).toMatchObject({
      context: { id: registered.json().context.id, deviceId: 'kitchen-speaker' },
      accessToken: expect.any(String),
    });

    const claimedAgain = await app.inject({
      method: 'POST',
      url: '/api/v1/households/context-household/conversation-contexts/claim',
      payload: {
        handoffToken: handoff.json().handoffToken,
        deviceId: 'mobile-device',
        speakerId: 'speaker-7',
      },
    });
    expect(claimedAgain.statusCode, claimedAgain.body).toBe(409);
    await app.close();
  });

  it('rejects closing a context-owned session without its context authorization', async () => {
    const app = await buildApp({ databasePath: ':memory:' });
    const contextsUrl = '/api/v1/households/scoped-close/conversation-contexts';
    const registered = await app.inject({
      method: 'POST',
      url: contextsUrl,
      payload: { deviceId: 'tablet-a' },
    });
    const lists = await app.inject({
      method: 'GET',
      url: '/api/v1/households/scoped-close/shopping-lists',
    });
    const shoppingListId = lists.json()[0].id as string;
    const captured = await app.inject({
      method: 'POST',
      url: '/api/v1/households/scoped-close/conversation-captures',
      payload: {
        text: 'milk',
        contextId: registered.json().context.id,
        accessToken: registered.json().accessToken,
        shoppingListId,
        idempotencyKey: 'scoped-close-1',
      },
    });
    const sessionId = captured.json().session.id as string;
    expect(captured.json().session.shoppingListId).toBe(shoppingListId);

    const forbidden = await app.inject({
      method: 'POST',
      url: `/api/v1/households/scoped-close/conversation-sessions/${sessionId}/close`,
      payload: {},
    });
    expect(forbidden.statusCode, forbidden.body).toBe(403);

    const closed = await app.inject({
      method: 'POST',
      url: `/api/v1/households/scoped-close/conversation-sessions/${sessionId}/close`,
      payload: {
        contextId: registered.json().context.id,
        accessToken: registered.json().accessToken,
        idempotencyKey: 'scoped-close-confirm-1',
      },
    });
    expect(closed.statusCode, closed.body).toBe(200);
    expect(closed.json()).toMatchObject({ id: sessionId, status: 'closed' });
    await app.close();
  });

  it('keeps a natural-language close request pending until scoped confirmation', async () => {
    const app = await buildApp({ databasePath: ':memory:' });
    const householdUrl = '/api/v1/households/lifecycle-close';
    const registered = await app.inject({
      method: 'POST',
      url: `${householdUrl}/conversation-contexts`,
      payload: { deviceId: 'phone-a' },
    });
    const started = await app.inject({
      method: 'POST',
      url: `${householdUrl}/conversation-captures`,
      payload: {
        text: 'milk',
        contextId: registered.json().context.id,
        accessToken: registered.json().accessToken,
        idempotencyKey: 'lifecycle-close-start-1',
      },
    });
    expect(started.statusCode, started.body).toBe(201);
    const capturePayload = {
      text: 'I am done adding items',
      contextId: registered.json().context.id,
      accessToken: registered.json().accessToken,
      idempotencyKey: 'lifecycle-close-request-1',
    };
    const pending = await app.inject({
      method: 'POST',
      url: `${householdUrl}/conversation-captures`,
      payload: capturePayload,
    });
    expect(pending.statusCode, pending.body).toBe(201);
    expect(pending.json()).toMatchObject({
      session: { status: 'close_pending' },
      saved: [],
      merged: [],
      pendingAction: {
        type: 'close_session',
        status: 'pending',
        origin: 'explicit_intent',
      },
    });

    const actionId = pending.json().pendingAction.id as string;
    const confirmed = await app.inject({
      method: 'POST',
      url: `${householdUrl}/conversation-pending-actions/${actionId}/confirm`,
      payload: {
        contextId: registered.json().context.id,
        accessToken: registered.json().accessToken,
        idempotencyKey: 'lifecycle-close-confirm-1',
      },
    });
    expect(confirmed.statusCode, confirmed.body).toBe(200);
    expect(confirmed.json()).toMatchObject({
      session: { id: pending.json().session.id, status: 'closed' },
      pendingAction: { id: actionId, status: 'confirmed' },
    });

    const reopened = await app.inject({
      method: 'POST',
      url: `${householdUrl}/conversation-captures`,
      payload: {
        text: 'add bread',
        contextId: registered.json().context.id,
        accessToken: registered.json().accessToken,
        idempotencyKey: 'lifecycle-close-after-1',
      },
    });
    expect(reopened.statusCode, reopened.body).toBe(201);
    expect(reopened.json()).toMatchObject({
      session: { status: 'active' },
      saved: [expect.objectContaining({ name: 'bread' })],
      pendingAction: null,
    });
    await app.close();
  });

  it('cancels a pending close without changing the saved list', async () => {
    const app = await buildApp({ databasePath: ':memory:' });
    const householdUrl = '/api/v1/households/cancel-close';
    const registered = await app.inject({
      method: 'POST',
      url: `${householdUrl}/conversation-contexts`,
      payload: { deviceId: 'phone-a' },
    });
    const started = await app.inject({
      method: 'POST',
      url: `${householdUrl}/conversation-captures`,
      payload: { text: 'milk', contextId: registered.json().context.id, accessToken: registered.json().accessToken },
    });
    const pending = await app.inject({
      method: 'POST',
      url: `${householdUrl}/conversation-captures`,
      payload: { text: 'I am done adding items', contextId: registered.json().context.id, accessToken: registered.json().accessToken },
    });
    const actionId = pending.json().pendingAction.id as string;
    const cancelled = await app.inject({
      method: 'POST',
      url: `${householdUrl}/conversation-pending-actions/${actionId}/cancel`,
      payload: { contextId: registered.json().context.id, accessToken: registered.json().accessToken },
    });
    expect(cancelled.statusCode, cancelled.body).toBe(200);
    expect(cancelled.json()).toMatchObject({
      session: { id: started.json().session.id, status: 'active' },
      pendingAction: { id: actionId, status: 'cancelled' },
    });
    const listed = await app.inject({ method: 'GET', url: `${householdUrl}/items` });
    expect(listed.json()).toEqual([expect.objectContaining({ name: 'milk' })]);
    await app.close();
  });

  it('expires an unconfirmed close request without closing the session', async () => {
    let now = new Date('2026-08-11T12:00:00.000Z');
    const app = await buildApp({ databasePath: ':memory:', clock: () => now });
    const householdUrl = '/api/v1/households/lifecycle-expiry';
    const registered = await app.inject({
      method: 'POST',
      url: `${householdUrl}/conversation-contexts`,
      payload: { deviceId: 'phone-a' },
    });
    const common = {
      contextId: registered.json().context.id,
      accessToken: registered.json().accessToken,
    };
    await app.inject({
      method: 'POST',
      url: `${householdUrl}/conversation-captures`,
      payload: { ...common, text: 'milk', idempotencyKey: 'expiry-start-1' },
    });
    const pending = await app.inject({
      method: 'POST',
      url: `${householdUrl}/conversation-captures`,
      payload: { ...common, text: 'I am done adding items', idempotencyKey: 'expiry-request-1' },
    });
    now = new Date('2026-08-11T12:06:00.000Z');
    const confirmed = await app.inject({
      method: 'POST',
      url: `${householdUrl}/conversation-pending-actions/${pending.json().pendingAction.id}/confirm`,
      payload: { ...common, idempotencyKey: 'expiry-confirm-1' },
    });
    expect(confirmed.statusCode, confirmed.body).toBe(200);
    expect(confirmed.json()).toMatchObject({
      session: { status: 'active' },
      pendingAction: { status: 'expired' },
    });
    await app.close();
  });
});
