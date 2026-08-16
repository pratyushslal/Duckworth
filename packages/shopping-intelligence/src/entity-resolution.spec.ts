import type { CaptureInterpretation } from '@duckworth/item-capture';
import { semanticRuntimeFixture } from '../test-fixtures/semantic-runtime.js';
import type { SemanticCountryLayer } from './semantic-runtime.js';

function capture(
  captureText: string,
  name = captureText,
  quantity: number | null = null,
  unit: string | null = null,
  packageSize: number | null = null,
  packageUnit: string | null = null,
  packQualifier?: string,
): CaptureInterpretation {
  return {
    captureText,
    name,
    quantity,
    unit,
    packageSize,
    packageUnit,
    ...(packQualifier ? { packQualifier, packQualifierSpan: { start: 16, end: 19 } } : {}),
  };
}

describe('evidence-based semantic entity resolution', () => {
  it('resolves a reviewed branded product with measurements and exact source evidence', async () => {
    const { resolveSemanticItem } = await import('./index.js');
    const result = resolveSemanticItem(
      capture('2 packs of Amul Butter 500 g', 'Amul Butter', 2, 'pack', 500, 'g'),
      semanticRuntimeFixture(),
    );

    expect(result.item).toMatchObject({
      itemName: { value: 'Amul Butter', confidence: 'confirmed' },
      conceptId: { value: 'grocery.butter.dairy', confidence: 'confirmed' },
      brandId: { value: 'brand.amul', confidence: 'confirmed' },
      categoryId: { value: 'grocery', confidence: 'confirmed' },
      requestedCount: { value: 2, confidence: 'confirmed' },
      requestedUnitId: { value: 'pack', confidence: 'confirmed' },
      packageMeasure: {
        value: { value: 500, unitId: 'g', comparisonValue: 500, comparisonUnitId: 'g' },
        confidence: 'confirmed',
      },
    });
    expect(result.item.itemName.evidence).toContainEqual({
      kind: 'source_span',
      sourceStart: 11,
      sourceEnd: 22,
    });
    expect(result.alternatives).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it.each([
    ['blue cotton t-shirt size large', 'apparel', { colour: 'blue', material: 'cotton', size: 'large' }],
    ['paracetamol syrup', 'pharmacy', { form: 'syrup' }],
  ])('uses category-owned typed attributes for %s', async (text, categoryId, attributes) => {
    const { resolveSemanticItem } = await import('./index.js');
    const result = resolveSemanticItem(capture(text), semanticRuntimeFixture());

    expect(result.item.categoryId).toMatchObject({ value: categoryId, confidence: 'inferred' });
    expect(Object.fromEntries(Object.entries(result.item.attributes).map(([key, semantic]) => [key, semantic.value])))
      .toEqual(attributes);
  });

  it('retains pack qualifiers as packaging descriptors rather than variant identity', async () => {
    const { resolveSemanticItem } = await import('./index.js');
    const result = resolveSemanticItem(
      capture('maggi noodles 1 big pack of 8 pieces', 'maggi noodles', 1, 'pack', 8, 'piece', 'big'),
      semanticRuntimeFixture(),
    );

    expect(result.item.descriptorMentions).toEqual([
      expect.objectContaining({
        surface: 'big',
        role: 'packaging_qualifier',
        sourceStart: 16,
        sourceEnd: 19,
      }),
    ]);
    expect(result.item.identity.variantKey).not.toContain('big');
  });

  it('projects a captured package container into semantic evidence and identity', async () => {
    const { resolveSemanticItem } = await import('./index.js');
    const result = resolveSemanticItem(
      {
        ...capture('Coca Cola 5 pieces of 1 litre bottle', 'Coca Cola', 5, 'piece', 1, 'l'),
        packageContainerUnit: 'bottle',
      },
      semanticRuntimeFixture(),
    );
    expect(result.item.packageContainerUnitId).toMatchObject({ value: 'bottle', confidence: 'confirmed' });
    expect(result.item.packageContainerUnitId?.evidence).toContainEqual({ kind: 'grammar_rule', ref: 'package_container' });
    expect(result.item.identity.variantKey).toContain('container:bottle');
  });

  it('applies a reviewed household package default only when the capture omits package size', async () => {
    const { resolveSemanticItem } = await import('./index.js');
    const runtime = semanticRuntimeFixture((layers) => {
      layers.push({
        schemaVersion: 2,
        kind: 'household',
        id: 'household:test:learning',
        version: '1',
        householdId: 'test',
        conceptAliases: [],
        brandAliases: [],
        quantityPreferences: [],
        packagePreferences: [{ identityKey: 'grocery.milk.dairy', size: 500, unitId: 'ml' }],
      });
    });
    const learned = resolveSemanticItem(capture('milk'), runtime).item;
    expect(learned.packageMeasure).toMatchObject({ value: { value: 500, unitId: 'ml' }, confidence: 'confirmed' });
    const explicit = resolveSemanticItem(capture('milk 1 l', 'milk', null, null, 1, 'l'), runtime).item;
    expect(explicit.packageMeasure).toMatchObject({ value: { value: 1, unitId: 'l' } });
  });

  it('extracts an open model value only when runtime data defines its marker', async () => {
    const { resolveSemanticItem } = await import('./index.js');
    const runtime = semanticRuntimeFixture((layers) => {
      const country = layers.find((layer): layer is SemanticCountryLayer => layer.kind === 'country')!;
      country.categories.push({ id: 'device', relevantAttributeIds: ['model'], variantAttributeIds: ['model'], signals: ['gizmo'] });
      country.concepts.push({ id: 'device.gizmo', categoryId: 'device' });
      const locale = layers.find((layer) => layer.kind === 'locale')!;
      locale.conceptAliases.push({ alias: 'gizmo', conceptId: 'device.gizmo' });
      locale.attributeMarkers = [{ attributeId: 'model', prefixes: ['model'] }];
    });

    const result = resolveSemanticItem(capture('gizmo model X-200'), runtime);
    expect(result.item.attributes.model).toMatchObject({ value: 'X-200', confidence: 'confirmed' });
  });

  it('keeps unknown Unicode input as a generic item without fabricating semantics', async () => {
    const { resolveSemanticItem } = await import('./index.js');
    const result = resolveSemanticItem(capture('未知 चीज़ 🌿'), semanticRuntimeFixture());

    expect(result.item.itemName.value).toBe('未知 चीज़ 🌿');
    expect(result.item.conceptId).toEqual({ value: null, confidence: 'unknown', evidence: [] });
    expect(result.item.brandId).toEqual({ value: null, confidence: 'unknown', evidence: [] });
    expect(result.item.categoryId).toEqual({ value: null, confidence: 'unknown', evidence: [] });
    expect(result.alternatives).toEqual([]);
  });

  it('returns stable alternatives for an unresolved reviewed alias collision', async () => {
    const { resolveSemanticItem } = await import('./index.js');
    const runtime = semanticRuntimeFixture((layers) => {
      const country = layers.find((layer): layer is SemanticCountryLayer => layer.kind === 'country')!;
      country.products.push({
        id: 'product.other.butter',
        brandId: 'brand.britannia',
        conceptId: 'grocery.butter.dairy',
        aliases: ['amul butter'],
      });
    });

    const result = resolveSemanticItem(capture('Amul Butter'), runtime);
    expect(result.item.brandId.confidence).toBe('unknown');
    expect(result.alternatives.map(({ item }) => item.brandId.value)).toEqual([
      'brand.amul',
      'brand.britannia',
    ]);
  });

  it('resolves a reviewed Maggi product family and organization role without title-casing heuristics', async () => {
    const { resolveSemanticItem } = await import('./index.js');
    const result = resolveSemanticItem(capture('maggie noodles'), semanticRuntimeFixture());

    expect(result.item).toMatchObject({
      itemName: { value: 'Maggi noodles' },
      conceptId: { value: 'grocery.noodles', confidence: 'confirmed' },
      brandId: { value: 'brand.maggi', confidence: 'confirmed' },
      productFamilyId: { value: 'family.maggi.noodles', confidence: 'confirmed' },
      productId: { value: 'product.maggi.noodles', confidence: 'confirmed' },
      commercialRoles: [expect.objectContaining({
        role: 'brand_owner',
        organizationId: 'org.nestle',
      })],
    });
  });

  it('classifies identity-bearing descriptors only from runtime applicability', async () => {
    const { resolveSemanticItem } = await import('./index.js');
    const runtime = semanticRuntimeFixture((layers) => {
      const core = layers.find((layer) => layer.kind === 'core')!;
      // fat_level is part of the reviewed core catalog fixture.
      const locale = layers.find((layer) => layer.kind === 'locale')!;
      locale.attributeValues.fat_level = ['low-fat', 'whole'];
      const country = layers.find((layer): layer is SemanticCountryLayer => layer.kind === 'country')!;
      const grocery = country.categories.find((category) => category.id === 'grocery')!;
      grocery.relevantAttributeIds.push('fat_level');
      grocery.variantAttributeIds.push('fat_level');
      country.descriptors = [{
        alias: 'low-fat',
        role: 'identity_attribute',
        attributeId: 'fat_level',
        value: 'low-fat',
        categoryIds: ['grocery'],
      }];
    });

    const result = resolveSemanticItem(capture('low-fat milk'), runtime);
    expect(result.item.attributes.fat_level).toMatchObject({ value: 'low-fat', confidence: 'confirmed' });
    expect(result.item.descriptorMentions).toContainEqual(expect.objectContaining({
      surface: 'low-fat',
      role: 'identity_attribute',
    }));
    expect(result.item.identity.variantKey).toContain('fat_level');
  });
});
