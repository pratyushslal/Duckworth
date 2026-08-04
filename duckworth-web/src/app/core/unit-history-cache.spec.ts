import { describe, expect, it } from 'vitest';
import type { ShoppingItem } from './shopping-items.service';
import { UnitHistoryCache } from './unit-history-cache';

class MemoryStorage {
  private readonly values = new Map<string, string>();
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, value); }
}

const item = (overrides: Partial<ShoppingItem>): ShoppingItem => ({
  id: 'item-1', householdId: 'family-a', captureText: '2 cartons Milk', name: 'Milk',
  quantity: 2, unit: 'carton', unitSource: 'explicit', unitConfirmedAt: '2026-08-03T00:00:00.000Z',
  attentionReasons: [], status: 'purchased', createdAt: '2026-08-03T00:00:00.000Z',
  updatedAt: '2026-08-03T00:00:00.000Z', version: 2, ...overrides,
});

describe('UnitHistoryCache', () => {
  it('stores only the latest explicit unit under a normalized household-scoped name', () => {
    const storage = new MemoryStorage();
    const cache = new UnitHistoryCache(storage);

    cache.replaceFromItems('family-a', [
      item({ id: 'older', unit: 'carton', unitConfirmedAt: '2026-08-01T00:00:00.000Z' }),
      item({ id: 'inferred', unit: 'bag', unitSource: 'history', unitConfirmedAt: null }),
      item({ id: 'newer', unit: 'bottle', unitConfirmedAt: '2026-08-04T00:00:00.000Z' }),
      item({ id: 'no-unit', name: 'Rice', unit: null, unitSource: null, unitConfirmedAt: null }),
    ]);

    expect(cache.read('family-a')).toEqual({
      milk: { unit: 'bottle', confirmedAt: '2026-08-04T00:00:00.000Z' },
    });
    expect(cache.read('family-b')).toEqual({});
  });

  it('ignores malformed and unknown-version cache data', () => {
    const storage = new MemoryStorage();
    const cache = new UnitHistoryCache(storage);
    storage.setItem(cache.storageKey('family-a'), '{not json');
    expect(cache.read('family-a')).toEqual({});
    storage.setItem(cache.storageKey('family-a'), JSON.stringify({ version: 2, householdId: 'family-a', units: { milk: { unit: 'bag' } } }));
    expect(cache.read('family-a')).toEqual({});
  });

  it('merges a newer explicit SSE item without erasing other cached names', () => {
    const storage = new MemoryStorage();
    const cache = new UnitHistoryCache(storage);
    cache.replaceFromItems('family-a', [
      item({ name: 'Rice', unit: 'bag' }),
      item({ name: 'Milk', unit: 'carton', unitConfirmedAt: '2026-08-01T00:00:00.000Z' }),
    ]);

    const merged = cache.mergeExplicitItem('family-a', item({
      name: 'MILK', unit: 'bottle', unitConfirmedAt: '2026-08-04T00:00:00.000Z',
    }));

    expect(merged['rice'].unit).toBe('bag');
    expect(merged['milk'].unit).toBe('bottle');
    expect(cache.read('family-a')).toEqual(merged);
  });
});
