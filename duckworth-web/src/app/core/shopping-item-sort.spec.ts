import { describe, expect, it } from 'vitest';
import type { ShoppingItem } from './shopping-items.service';
import { sortShoppingItems } from './shopping-item-sort';

function item(id: string, createdAt: string, name = id): ShoppingItem {
  return {
    id,
    householdId: 'household-demo',
    captureText: id,
    name,
    quantity: null,
    unit: null,
    packageSize: null,
    packageUnit: null,
    brandId: null,
    productId: null,
    conceptId: null,
    unitSource: null,
    unitConfirmedAt: null,
    attentionReasons: ['missing_quantity'],
    status: 'active',
    removedAt: null,
    createdAt,
    updatedAt: createdAt,
    version: 1,
  };
}

describe('sortShoppingItems', () => {
  it('projects latest items first with stable ID ties without changing its input', () => {
    const older = item('item-c', '2026-08-03T09:00:00.000Z');
    const tiedB = item('item-b', '2026-08-05T09:00:00.000Z');
    const tiedA = item('item-a', '2026-08-05T09:00:00.000Z');
    const items = [older, tiedB, tiedA] as const;

    const sorted = sortShoppingItems(items, 'latest');

    expect(sorted.map(({ id }) => id)).toEqual(['item-a', 'item-b', 'item-c']);
    expect(items.map(({ id }) => id)).toEqual(['item-c', 'item-b', 'item-a']);
    expect(sorted).not.toBe(items);
    expect(sorted.find(({ id }) => id === older.id)).toBe(older);
  });

  it('projects oldest items first with stable ID ties', () => {
    const newer = item('item-c', '2026-08-05T09:00:00.000Z');
    const tiedB = item('item-b', '2026-08-03T09:00:00.000Z');
    const tiedA = item('item-a', '2026-08-03T09:00:00.000Z');

    expect(sortShoppingItems([newer, tiedB, tiedA], 'oldest').map(({ id }) => id))
      .toEqual(['item-a', 'item-b', 'item-c']);
  });

  it('projects normalized item names A–Z with stable ID ties', () => {
    const banana = item('item-c', '2026-08-05T09:00:00.000Z', 'Banana');
    const appleB = item('item-b', '2026-08-04T09:00:00.000Z', '  APPLE  ');
    const appleA = item('item-a', '2026-08-03T09:00:00.000Z', 'apple');

    expect(sortShoppingItems([banana, appleB, appleA], 'name-asc').map(({ id }) => id))
      .toEqual(['item-a', 'item-b', 'item-c']);
  });

  it('projects items needing attention first and falls back to latest-first', () => {
    const complete = {
      ...item('item-c', '2026-08-06T09:00:00.000Z'),
      attentionReasons: [],
    } satisfies ShoppingItem;
    const missingQuantity = item('item-a', '2026-08-04T09:00:00.000Z');
    const historicalUnit = {
      ...item('item-b', '2026-08-05T09:00:00.000Z'),
      attentionReasons: ['unconfirmed_historical_unit'],
    } satisfies ShoppingItem;

    expect(sortShoppingItems([complete, missingQuantity, historicalUnit], 'attention').map(({ id }) => id))
      .toEqual(['item-b', 'item-a', 'item-c']);
  });
});
