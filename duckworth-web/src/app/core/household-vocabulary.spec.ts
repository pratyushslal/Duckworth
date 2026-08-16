import { describe, expect, it } from 'vitest';
import type { ShoppingItem } from './shopping-items.service';
import { HouseholdVocabulary } from './household-vocabulary';

const item = (overrides: Partial<ShoppingItem> = {}): ShoppingItem => ({
  id: 'item-1', householdId: 'family-a', captureText: 'milk 2 l', name: 'milk', quantity: 2,
  unit: 'l', packageSize: null, packageUnit: null,
  brandId: null, productId: 'product.milk', conceptId: 'grocery.milk',
  unitSource: 'explicit', unitConfirmedAt: '2026-08-03T00:00:00.000Z',
  attentionReasons: [], status: 'active', removedAt: null, createdAt: '2026-08-03T00:00:00.000Z',
  updatedAt: '2026-08-03T00:00:00.000Z', version: 1, ...overrides,
});

describe('HouseholdVocabulary', () => {
  it('projects authoritative item names and confirmed full captures as distinct history entries', () => {
    const vocabulary = new HouseholdVocabulary('en-IN');
    vocabulary.replace([item()]);

    expect(vocabulary.snapshot().entries).toEqual([
      expect.objectContaining({ text: 'milk', locale: 'en-IN', kind: 'item', confirmedAt: '2026-08-03T00:00:00.000Z' }),
      expect.objectContaining({ text: 'milk 2 l', locale: 'en-IN', kind: 'capture', confirmedAt: '2026-08-03T00:00:00.000Z' }),
    ]);
  });

  it('refreshes its source version for list/create/SSE changes but not identical authoritative data', () => {
    const vocabulary = new HouseholdVocabulary('en-IN');
    vocabulary.replace([item()]);
    const listed = vocabulary.snapshot().version;

    vocabulary.replace([item()]);
    expect(vocabulary.snapshot().version).toBe(listed);

    vocabulary.merge(item({ id: 'item-2', name: 'bread', captureText: 'bread' }));
    expect(vocabulary.snapshot().version).toBe(listed + 1);
    expect(vocabulary.snapshot().entries.some((entry) => entry.text === 'bread')).toBe(true);

    vocabulary.merge(item({ id: 'item-2', name: 'brown bread', captureText: 'brown bread', version: 2 }));
    expect(vocabulary.snapshot().version).toBe(listed + 2);
    expect(vocabulary.snapshot().entries.some((entry) => entry.text === 'brown bread')).toBe(true);
  });

  it('does not learn item names or captures from removed mistakes', () => {
    const vocabulary = new HouseholdVocabulary('en-IN');
    vocabulary.replace([item({ status: 'removed', removedAt: '2026-08-06T00:00:00.000Z' })]);

    expect(vocabulary.snapshot().entries).toEqual([]);
  });

  it('does not project an unreviewed free-text row into shared household suggestions', () => {
    const vocabulary = new HouseholdVocabulary('en-IN');
    vocabulary.replace([item({ name: 'biscut', captureText: 'biscut', conceptId: null, productId: null })]);

    expect(vocabulary.snapshot().entries).toEqual([]);
  });

  it('does not promote a catalog concept alone to confirmed household spelling evidence', () => {
    const vocabulary = new HouseholdVocabulary('en-IN');
    vocabulary.replace([item({ productId: null, conceptId: 'grocery.milk', name: 'milkk', captureText: 'milkk' })]);
    expect(vocabulary.snapshot().entries).toEqual([]);
    vocabulary.replace([item({ productId: null, conceptId: 'grocery.milk', name: 'Whole milk', captureText: 'milkk', semanticLearningStatus: 'confirmed' })]);
    expect(vocabulary.snapshot().entries).toEqual(expect.arrayContaining([
      expect.objectContaining({ text: 'Whole milk', kind: 'item' }),
    ]));
  });
});
