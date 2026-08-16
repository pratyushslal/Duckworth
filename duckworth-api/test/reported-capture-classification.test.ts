import { describe, expect, it } from 'vitest';
import { interpretCapture } from '@duckworth/item-capture';
import { classifyShoppingItem, resolveSemanticItem, runShoppingBrain } from '@duckworth/shopping-intelligence';
import { loadSemanticRuntime } from '../src/semantic-runtime-loader.js';

const runtime = await loadSemanticRuntime('./language-packs', 'en-IN', 'IN');

describe('reported capture classification regressions', () => {
  it.each([
    ['Naproxen', 'pharmacy', 'shop.pharmacy'],
    ['Coca Cola', 'grocery', 'shop.grocery'],
    ['Thums Up', 'grocery', 'shop.grocery'],
  ])('derives the catalog category and shop tag for %s', (input, categoryId, shopTypeId) => {
    const capture = interpretCapture(input, runtime);
    const semantic = resolveSemanticItem(capture, runtime).item;
    const classification = classifyShoppingItem(semantic, runtime);

    expect(classification.automaticCategory.value).toBe(categoryId);
    expect(classification.automaticShopTypes.map(({ tagId }) => tagId)).toContain(shopTypeId);
  });

  it.each([
    ['Coca Cola 5 pieces of 1 litre bottle', 'Coca Cola', 5, 'piece', 1, 'l'],
    ['200 ml Thums Up x 24 pieces', 'Thums Up', 24, 'piece', 200, 'ml'],
  ])('preserves count and pack size in the brain result for %s', (text, name, quantity, unit, packageSize, packageUnit) => {
    const result = runShoppingBrain({
      schemaVersion: 2,
      inputId: `reported-${text}`,
      householdId: 'reported-household',
      contextId: 'reported-context',
      shoppingListId: 'reported-list',
      source: { kind: 'text' },
      text,
      locale: 'en-IN',
      countryCode: 'IN',
      occurredAt: '2026-08-13T00:00:00.000Z',
      idempotencyKey: `reported-${text}`,
    }, runtime, {
      contextId: 'reported-context',
      shoppingListId: 'reported-list',
      recentEntities: [],
      openDrafts: [],
    });
    const operation = result.operations.find((candidate) => candidate.kind === 'create');
    expect(operation?.kind).toBe('create');
    if (operation?.kind !== 'create') return;
    expect(operation.item.itemName.value).toBe(name);
    expect(operation.item.requestedCount.value).toBe(quantity);
    expect(operation.item.requestedUnitId.value).toBe(unit);
    expect(operation.item.packageMeasure.value).toEqual(expect.objectContaining({ value: packageSize, unitId: packageUnit }));
  });
});
