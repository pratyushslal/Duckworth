import { describe, expect, it } from 'vitest';
import { interpretCapture } from '../../item-capture/dist/index.js';
import { semanticRuntimeFixture } from '../test-fixtures/semantic-runtime.js';
import { extractDomainSemantics } from './domain-semantics.js';
import { resolveSemanticItem } from './entity-resolution.js';
import { runShoppingBrain } from './pipeline.js';

describe('domain semantic interpretation', () => {
  it('keeps a pharmacy strip and medicine strength out of legacy package size', () => {
    const result = runShoppingBrain({
      schemaVersion: 2,
      inputId: 'telma-strip',
      householdId: 'domain-test',
      contextId: 'domain-context',
      shoppingListId: 'domain-list',
      source: { kind: 'text' },
      text: '1 strip of Telma 40 mg',
      locale: 'en-IN',
      countryCode: 'IN',
      occurredAt: '2026-08-14T00:00:00.000Z',
      idempotencyKey: 'telma-strip',
    }, semanticRuntimeFixture(), {
      contextId: 'domain-context', shoppingListId: 'domain-list', recentEntities: [], openDrafts: [],
    });

    const operation = result.operations[0];
    expect(operation).toMatchObject({ kind: 'create' });
    if (operation?.kind !== 'create') throw new Error('expected create operation');
    expect(operation.item.itemName.value).toBe('Telma');
    expect(operation.item.requestedCount.value).toBe(1);
    expect(operation.item.requestedUnitId.value).toBe('strip');
    expect(operation.item.packageMeasure.value).toBeNull();
    expect(operation.item.attributes).toMatchObject({ strength: expect.objectContaining({ value: '40 mg' }) });
    expect(operation.item.measures).toEqual(expect.arrayContaining([
      expect.objectContaining({
        role: 'medicine_strength',
        scope: 'product',
        value: expect.objectContaining({
          kind: 'scalar',
          amount: expect.objectContaining({ value: 40, unitId: 'mg' }),
        }),
      }),
    ]));
  });

  it('keeps a pharmaceutical ratio strength separate from its bottle quantity', () => {
    const operation = capture('1 bottle of cough syrup 100 mg per 5 ml');
    expect(operation.item.itemName.value).toBe('cough syrup');
    expect(operation.item.requestedCount.value).toBe(1);
    expect(operation.item.requestedUnitId.value).toBe('bottle');
    expect(operation.item.attributes).toMatchObject({
      'measure:concentration': expect.objectContaining({ value: '100 mg/5 ml' }),
    });
    expect(operation.item.measures).toEqual(expect.arrayContaining([
      expect.objectContaining({
        role: 'concentration',
        value: expect.objectContaining({
          kind: 'ratio',
          numerator: expect.objectContaining({ value: 100, unitId: 'mg' }),
          denominator: expect.objectContaining({ value: 5, unitId: 'ml' }),
        }),
      }),
    ]));
  });

  it('classifies a curated pharmacy liquid and keeps its net content out of requested quantity', () => {
    const operation = capture('Pudin Hara 15ml');
    expect(operation.item.itemName.value).toBe('Pudin Hara');
    expect(operation.item.categoryId.value).toBe('pharmacy');
    expect(operation.item.requestedCount.value).toBeNull();
    expect(operation.item.requestedUnitId.value).toBeNull();
    expect(operation.item.packageMeasure.value).toMatchObject({ value: 15, unitId: 'ml' });
    expect(operation.item.measures).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: 'net_content', scope: 'package' }),
    ]));
  });

  it('retains grocery container quantity and net content independently', () => {
    const operation = capture('3 bottles of cola 2 L each');
    expect(operation.item.itemName.value).toBe('cola');
    expect(operation.item.requestedCount.value).toBe(3);
    expect(operation.item.requestedUnitId.value).toBe('bottle');
    expect(operation.item.packageMeasure.value).toMatchObject({ value: 2, unitId: 'l' });
    expect(operation.item.measures).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: 'net_content' }),
    ]));
  });

  it('keeps a pint as a requested grocery container without inventing a regional volume conversion', () => {
    const operation = capture('1 pint beer');
    expect(operation.item.itemName.value).toBe('beer');
    expect(operation.item.requestedCount.value).toBe(1);
    expect(operation.item.requestedUnitId.value).toBe('pint');
    expect(operation.item.packageMeasure.value).toBeNull();
  });

  it('keeps electronics compatibility and ratings as typed semantics', () => {
    const runtime = semanticRuntimeFixture();
    expect(extractDomainSemantics('2 USB-C cables 2 m 240 W for iPhone 15', runtime).attributes)
      .toEqual({ compatibility: 'iPhone 15' });
    expect(extractDomainSemantics(interpretCapture('2 USB-C cables 2 m 240 W for iPhone 15', runtime).captureText, runtime).attributes)
      .toEqual({ compatibility: 'iPhone 15' });
    expect(resolveSemanticItem(interpretCapture('2 USB-C cables 2 m 240 W for iPhone 15', runtime), runtime).item.attributes)
      .toMatchObject({ compatibility: expect.objectContaining({ value: 'iPhone 15' }) });
    const operation = capture('2 USB-C cables 2 m 240 W for iPhone 15');
    expect(operation.item.itemName.value).toBe('USB-C cables');
    expect(operation.item.requestedCount.value).toBe(2);
    expect(operation.item.attributes).toMatchObject({ compatibility: expect.objectContaining({ value: 'iPhone 15' }) });
    expect(operation.item.attributes).toMatchObject({
      'measure:cable_length': expect.objectContaining({ value: '2 m' }),
      'measure:power_rating': expect.objectContaining({ value: '240 w' }),
    });
    expect(operation.item.measures).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: 'cable_length', value: expect.objectContaining({ amount: expect.objectContaining({ value: 2, unitId: 'm' }) }) }),
      expect.objectContaining({ role: 'power_rating', value: expect.objectContaining({ amount: expect.objectContaining({ value: 240, unitId: 'w' }) }) }),
    ]));
  });

  it('keeps apparel sizes as attributes rather than item-name noise', () => {
    const operation = capture('2 pairs of jeans W32 L30');
    expect(operation.item.itemName.value).toBe('jeans');
    expect(operation.item.requestedCount.value).toBe(2);
    expect(operation.item.requestedUnitId.value).toBe('pair');
    expect(operation.item.attributes).toMatchObject({
      waist: expect.objectContaining({ value: '32' }),
      inseam: expect.objectContaining({ value: '30' }),
    });
  });

  it('keeps a grocery milligram package measure out of pharmaceutical strength', () => {
    const operation = capture('2 packs of Britannia 50-50 100 mg');
    expect(operation.item.itemName.value).toBe('Britannia 50-50');
    expect(operation.item.categoryId.value).toBe('grocery');
    expect(operation.item.productId?.value).toBe('product.britannia.50-50');
    expect(operation.item.requestedCount.value).toBe(2);
    expect(operation.item.requestedUnitId.value).toBe('pack');
    expect(operation.item.packageMeasure.value).toEqual(expect.objectContaining({ value: 100, unitId: 'mg' }));
    expect(operation.item.attributes).not.toHaveProperty('strength');
    expect(operation.item.attributes).not.toHaveProperty('measure:medicine_strength');
    expect(operation.item.measures).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: 'net_content', scope: 'package' }),
    ]));
  });

  it.each([
    ['1 shirt 40 mg', 'apparel'],
    ['1 notebook 40 mg', 'general'],
    ['1 phone 100 g', 'electronics'],
    ['1 jeans 32 gb', 'apparel'],
    ['1 rice 500 W', 'grocery'],
  ])('does not let an isolated measurement override the identity category for %s', (text, categoryId) => {
    const operation = capture(text);
    expect(operation.item.categoryId.value).toBe(categoryId);
    expect(operation.item.attributes).not.toHaveProperty('strength');
    expect(operation.item.measures?.every((measure) => (
      runtimeRoleIsAllowed(operation.item.categoryId.value, measure.role, measure.value, semanticRuntimeFixture())
    ))).toBe(true);
  });

  it('represents contained paper sheets inside a ream package', () => {
    const operation = capture('1 ream of A4 paper 500 sheets');
    expect(operation.item.itemName.value).toBe('A4 paper');
    expect(operation.item.requestedCount.value).toBe(1);
    expect(operation.item.requestedUnitId.value).toBe('ream');
    expect(operation.item.packaging).toEqual(expect.arrayContaining([
      expect.objectContaining({
        containerUnitId: 'ream',
        containedCount: expect.objectContaining({ value: 500 }),
        containedUnitId: expect.objectContaining({ value: 'sheet' }),
      }),
    ]));
  });

  it('keeps the residual item name intact when a Unicode character precedes a quantity', () => {
    const extraction = extractDomainSemantics('😀 1 strip of Telma 40 mg', semanticRuntimeFixture());
    expect(extraction.itemName).toBe('😀 Telma');
  });
});

function capture(text: string) {
  const result = runShoppingBrain({
    schemaVersion: 2,
    inputId: text,
    householdId: 'domain-test',
    contextId: 'domain-context',
    shoppingListId: 'domain-list',
    source: { kind: 'text' },
    text,
    locale: 'en-IN',
    countryCode: 'IN',
    occurredAt: '2026-08-14T00:00:00.000Z',
    idempotencyKey: text,
  }, semanticRuntimeFixture(), {
    contextId: 'domain-context', shoppingListId: 'domain-list', recentEntities: [], openDrafts: [],
  });
  const operation = result.operations[0];
  if (operation?.kind !== 'create') throw new Error('expected create operation');
  return operation;
}

function runtimeRoleIsAllowed(
  categoryId: string | null,
  role: string,
  value: { kind: 'scalar'; amount: { unitId: string } } | { kind: 'ratio'; numerator: { unitId: string }; denominator: { unitId: string } },
  runtime: ReturnType<typeof semanticRuntimeFixture>,
): boolean {
  const category = runtime.categories.get(categoryId ?? '');
  if (!category) return false;
  const units = value.kind === 'scalar'
    ? [value.amount.unitId]
    : [value.numerator.unitId, value.denominator.unitId];
  return units.every((unitId) => category.unitRoles?.[unitId] === role
    || category.ratioRoles?.some((ratio) => ratio.role === role
      && ratio.numeratorUnitIds.includes(value.kind === 'ratio' ? value.numerator.unitId : unitId)
      && ratio.denominatorUnitIds.includes(value.kind === 'ratio' ? value.denominator.unitId : unitId)) === true);
}
