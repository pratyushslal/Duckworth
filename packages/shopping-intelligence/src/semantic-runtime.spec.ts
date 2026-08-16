import type { ValidatedSemanticLayer } from './semantic-runtime.js';
import { semanticRuntimeFixture } from '../test-fixtures/semantic-runtime.js';

describe('semantic runtime layering', () => {
  it('applies explicit household precedence and exposes immutable indexes', async () => {
    const { compileSemanticRuntime } = await import('./semantic-runtime.js');
    const layers: ValidatedSemanticLayer[] = [
      {
        schemaVersion: 2,
        kind: 'core',
        id: 'core',
        version: '1',
        dimensions: [{ id: 'dimension', baseUnitId: 'unit' }],
        units: [{ id: 'unit', capability: 'measure', dimensionId: 'dimension', factorToBase: 1 }],
        attributes: [{ id: 'attribute', valueType: 'string', cardinality: 'one' }],
      },
      {
        schemaVersion: 2,
        kind: 'locale',
        id: 'locale',
        version: '1',
        locale: 'x-test',
        fallbacks: [],
        grammar: { templates: [], separators: [';'], connectors: [], commandPrefixes: [] },
        numerals: { uno: 1 },
        unitAliases: [{ alias: 'measure', unitId: 'unit' }],
        conceptAliases: [{ alias: 'local name', conceptId: 'concept.base' }],
        attributeValues: { attribute: ['value'] },
        displayLabels: {},
      },
      {
        schemaVersion: 2,
        kind: 'country',
        id: 'country',
        version: '1',
        countryCode: 'XX',
        locales: ['x-test'],
        categories: [{ id: 'category', relevantAttributeIds: ['attribute'], variantAttributeIds: ['attribute'], signals: [] }],
        concepts: [
          { id: 'concept.base', categoryId: 'category' },
          { id: 'concept.preferred', categoryId: 'category' },
        ],
        brands: [],
        products: [],
        policy: { acceptThreshold: 0.8, ambiguityMargin: 0.1, maximumSegments: 8, maximumCandidatesPerEntity: 4, minimumLearningSupport: 2 },
      },
      {
        schemaVersion: 2,
        kind: 'household',
        id: 'household',
        version: '1',
        householdId: 'household-1',
        conceptAliases: [{ alias: 'local name', conceptId: 'concept.preferred' }],
        brandAliases: [],
      },
    ];

    const runtime = compileSemanticRuntime(layers);

    expect(runtime.concepts.byAlias.get('local name')?.id).toBe('concept.preferred');
    expect(runtime.versions).toEqual({ core: '1', locale: '1', country: '1', household: '1' });
    expect(Object.isFrozen(runtime)).toBe(true);
    expect(Object.isFrozen(runtime.grammar.separators)).toBe(true);
    expect('set' in runtime.units).toBe(false);
  });

  it('compiles data-driven shop eligibility and defaults without deriving tags from a bare brand', async () => {
    const { classifyShoppingItem, compileSemanticRuntime, resolveSemanticItem } = await import('./index.js');
    const layers: ValidatedSemanticLayer[] = [
      {
        schemaVersion: 2,
        kind: 'core',
        id: 'core',
        version: '1',
        dimensions: [{ id: 'dimension', baseUnitId: 'unit' }],
        units: [{ id: 'unit', capability: 'both', dimensionId: 'dimension', factorToBase: 1 }],
        attributes: [],
      },
      {
        schemaVersion: 2,
        kind: 'locale',
        id: 'locale',
        version: '1',
        locale: 'x-test',
        fallbacks: [],
        grammar: { templates: [], separators: [';'], connectors: [], commandPrefixes: [] },
        numerals: {},
        unitAliases: [],
        conceptAliases: [{ alias: 'sample item', conceptId: 'concept.sample' }],
        attributeValues: {},
        displayLabels: {},
      },
      {
        schemaVersion: 2,
        kind: 'country',
        id: 'country',
        version: '1',
        countryCode: 'XX',
        locales: ['x-test'],
        shopTypes: [{ id: 'shop.synthetic' }],
        categories: [{ id: 'category.synthetic', relevantAttributeIds: [], variantAttributeIds: [], signals: [], shopTypeIds: ['shop.synthetic'] }],
        concepts: [{ id: 'concept.sample', categoryId: 'category.synthetic' }],
        brands: [{ id: 'brand.synthetic' }],
        products: [],
        policy: { acceptThreshold: 0.8, ambiguityMargin: 0.1, maximumSegments: 8, maximumCandidatesPerEntity: 4, minimumLearningSupport: 2, defaultItem: { quantity: 1, unitId: 'unit' } },
      },
    ];

    const runtime = compileSemanticRuntime(layers);
    const resolved = resolveSemanticItem(
      { captureText: 'sample item', name: 'sample item', quantity: null, unit: null, packageSize: null, packageUnit: null },
      runtime,
    ).item;

    expect(classifyShoppingItem(resolved, runtime)).toMatchObject({
      effectiveCategoryId: 'category.synthetic',
      automaticShopTypes: [{ tagId: 'shop.synthetic' }],
      defaultedQuantity: { value: 1, source: 'policy_default' },
      defaultedUnitId: { value: 'unit', source: 'policy_default' },
    });
    expect(classifyShoppingItem({
      ...resolved,
      conceptId: { value: null, confidence: 'unknown', evidence: [] },
      categoryId: { value: null, confidence: 'unknown', evidence: [] },
      brandId: { value: 'brand.synthetic', confidence: 'confirmed', evidence: [{ kind: 'catalog_match', ref: 'brand.synthetic' }] },
    }, runtime).automaticShopTypes).toEqual([]);
  });

  it('rejects duplicate catalog identifiers before indexes can silently overwrite data', async () => {
    expect(() => semanticRuntimeFixture((layers) => {
      const country = layers.find((layer) => layer.kind === 'country') as Extract<ValidatedSemanticLayer, { kind: 'country' }>;
      country.brands.push({ ...country.brands[0] });
    })).toThrow(/duplicate brand id/i);
  });

  it('exposes commercial roles and product-family identity from validated runtime data', () => {
    const runtime = semanticRuntimeFixture();

    expect(runtime.brands.byId.get('brand.maggi')).toMatchObject({ id: 'brand.maggi' });
    expect(runtime.productFamilies.byId.get('family.maggi.noodles')).toMatchObject({
      id: 'family.maggi.noodles',
      conceptId: 'grocery.noodles',
      brandId: 'brand.maggi',
    });
    expect(runtime.organizations.byId.get('org.nestle')).toMatchObject({ id: 'org.nestle' });
    expect(runtime.commercialRoles).toContainEqual(expect.objectContaining({
      role: 'brand_owner',
      organizationId: 'org.nestle',
      brandId: 'brand.maggi',
      countryCode: 'IN',
    }));
  });
});
