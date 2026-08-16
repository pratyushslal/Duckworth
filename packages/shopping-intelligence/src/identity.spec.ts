import { semanticRuntimeFixture } from '../test-fixtures/semantic-runtime.js';
import type { SemanticItem } from './contracts.js';

function item(overrides: Partial<SemanticItem> = {}): SemanticItem {
  const evidence = [{ kind: 'catalog_match' as const, ref: 'fixture' }];
  return {
    itemName: { value: 'fixture', confidence: 'confirmed', evidence },
    conceptId: { value: 'concept.fixture', confidence: 'confirmed', evidence },
    brandId: { value: null, confidence: 'unknown', evidence: [] },
    categoryId: { value: 'general', confidence: 'confirmed', evidence },
    requestedCount: { value: 1, confidence: 'confirmed', evidence },
    requestedUnitId: { value: 'pack', confidence: 'confirmed', evidence },
    packageMeasure: { value: null, confidence: 'unknown', evidence: [] },
    attributes: {},
    identity: { conceptKey: '', variantKey: '', requestKey: '' },
    ...overrides,
  };
}

describe('semantic identity and duplicate policy', () => {
  it('keeps concept, variant, and request identity independent', async () => {
    const { createItemIdentity } = await import('./index.js');
    const runtime = semanticRuntimeFixture();
    const branded = item({
      brandId: { value: 'brand.one', confidence: 'confirmed', evidence: [{ kind: 'catalog_match', ref: 'brand.one' }] },
      packageMeasure: {
        value: { value: 1, unitId: 'kg', comparisonValue: 1000, comparisonUnitId: 'g' },
        confidence: 'confirmed',
        evidence: [{ kind: 'grammar_rule', ref: 'package' }],
      },
      attributes: {
        colour: { value: 'blue', confidence: 'confirmed', evidence: [{ kind: 'source_span', sourceStart: 0, sourceEnd: 4 }] },
      },
    });
    const sameVariantDifferentRequest = item({
      ...branded,
      requestedCount: { value: 3, confidence: 'confirmed', evidence: [{ kind: 'grammar_rule', ref: 'count' }] },
    });

    const first = createItemIdentity(branded, runtime);
    const second = createItemIdentity(sameVariantDifferentRequest, runtime);
    expect(second.conceptKey).toBe(first.conceptKey);
    expect(second.variantKey).toBe(first.variantKey);
    expect(second.requestKey).not.toBe(first.requestKey);
  });

  it('canonical comparison units converge without rewriting requested package representation', async () => {
    const { createItemIdentity } = await import('./index.js');
    const runtime = semanticRuntimeFixture();
    const kg = item({ packageMeasure: { value: { value: 1, unitId: 'kg', comparisonValue: 1000, comparisonUnitId: 'g' }, confidence: 'confirmed', evidence: [{ kind: 'grammar_rule', ref: 'package' }] } });
    const grams = item({ packageMeasure: { value: { value: 1000, unitId: 'g', comparisonValue: 1000, comparisonUnitId: 'g' }, confidence: 'confirmed', evidence: [{ kind: 'grammar_rule', ref: 'package' }] } });

    expect(createItemIdentity(kg, runtime).variantKey).toBe(createItemIdentity(grams, runtime).variantKey);
    expect(kg.packageMeasure.value).toEqual({ value: 1, unitId: 'kg', comparisonValue: 1000, comparisonUnitId: 'g' });
  });

  it('keeps distinct catalog products separate even when concept, brand, and package match', async () => {
    const { createItemIdentity } = await import('./index.js');
    const runtime = semanticRuntimeFixture();
    const first = item({
      productId: { value: 'product.one', confidence: 'confirmed', evidence: [] },
      packageMeasure: { value: { value: 500, unitId: 'g' }, confidence: 'confirmed', evidence: [] },
    });
    const second = item({
      productId: { value: 'product.two', confidence: 'confirmed', evidence: [] },
      packageMeasure: { value: { value: 500, unitId: 'g' }, confidence: 'confirmed', evidence: [] },
    });
    expect(createItemIdentity(first, runtime).variantKey)
      .not.toBe(createItemIdentity(second, runtime).variantKey);
  });

  it('refuses exact merge for unresolved participants and returns stable similar candidates', async () => {
    const { classifyDuplicate, createItemIdentity } = await import('./index.js');
    const runtime = semanticRuntimeFixture();
    const unbranded = item();
    const branded = item({
      brandId: { value: 'brand.one', confidence: 'confirmed', evidence: [{ kind: 'catalog_match', ref: 'brand.one' }] },
      packageMeasure: { value: null, confidence: 'confirmed', evidence: [{ kind: 'grammar_rule', ref: 'no_package' }] },
    });
    const existing = { id: 'item-1', item: { ...branded, identity: createItemIdentity(branded, runtime) } };

    expect(classifyDuplicate({ ...unbranded, identity: createItemIdentity(unbranded, runtime) }, [existing], runtime))
      .toEqual({ kind: 'similar', candidateItemIds: ['item-1'] });
    expect(classifyDuplicate(existing.item, [existing], runtime))
      .toEqual({ kind: 'exact_merge', targetItemId: 'item-1' });
  });
});
