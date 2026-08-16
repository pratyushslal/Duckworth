import corpus from '../../../catalog/test/fixtures/semantic-corrections/corpus.json';

const requiredCategories = [
  'identity',
  'shop-eligibility',
  'quantity-package',
  'variant-scope',
  'multi-tag-count',
  'batch-provenance',
  'governance',
  'assistance',
  'unicode',
  'unknown-fallback',
] as const;

describe('semantic correction evaluation corpus', () => {
  it('contains every required correction and learning category', () => {
    expect(corpus.schemaVersion).toBe(1);
    const ids = corpus.cases.map(({ id }) => id);
    expect(new Set(ids).size).toBe(ids.length);
    const categories = new Set(corpus.cases.map(({ category }) => category));
    requiredCategories.forEach((category) => {
      expect(categories.has(category), `missing category ${category}`).toBe(true);
    });
  });

  it.each(corpus.cases)('$id declares an observable semantic contract', (fixture) => {
    expect(fixture.input.trim()).not.toBe('');
    expect(fixture.sourceSpans.length).toBeGreaterThan(0);
    expect(fixture.expected.itemIdentity).toBeDefined();
    expect(fixture.expected.learning).toBeDefined();
    expect(fixture.expected.learning.mode).toMatch(/^(none|this_item_only|future_matching_items)$/);
    expect(fixture.expected.learning.effectKinds).toEqual(
      [...new Set(fixture.expected.learning.effectKinds)],
    );
    fixture.sourceSpans.forEach((span) => {
      expect(span.sourceStart).toBeGreaterThanOrEqual(0);
      expect(span.sourceEnd).toBeGreaterThan(span.sourceStart);
      expect(span.sourceEnd).toBeLessThanOrEqual(fixture.input.length);
      expect(fixture.input.slice(span.sourceStart, span.sourceEnd)).toBe(span.text);
    });
  });

  it('covers every correction field without product-specific application rules', () => {
    const fields = new Set(corpus.cases.flatMap(({ expected }) => expected.correctionFields));
    expect(fields).toEqual(new Set([
      'canonicalLabel',
      'consumerBrand',
      'descriptor',
      'quantity',
      'unit',
      'packageSize',
      'packageUnit',
      'shopTypeDecisions',
    ]));
    expect(corpus.implementationRule).toBe('runtime-data');
  });

  it('contains explicit safety expectations for overrides, counts, and unknown input', () => {
    expect(corpus.cases.some(({ expected }) => expected.safety.includes('explicit-input-wins'))).toBe(true);
    expect(corpus.cases.some(({ expected }) => expected.safety.includes('distinct-item-count'))).toBe(true);
    expect(corpus.cases.some(({ expected }) => expected.safety.includes('unknown-remains-addable'))).toBe(true);
    expect(corpus.cases.some(({ expected }) => expected.safety.includes('no-poisoning'))).toBe(true);
  });
});
