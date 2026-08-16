import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildSemanticArtifacts,
  verifySemanticArtifact,
} from '../scripts/build-packs.mjs';

function semanticSources() {
  return {
    core: {
      schemaVersion: 2,
      kind: 'core',
      id: 'core',
      version: '1',
      dimensions: [{ id: 'mass', baseUnitId: 'u.base' }],
      units: [{ id: 'u.base', capability: 'measure', dimensionId: 'mass', factorToBase: 1 }],
      attributes: [{ id: 'tone', valueType: 'string', cardinality: 'one' }],
    },
    locales: [{
      schemaVersion: 2,
      kind: 'locale',
      id: 'locale-x',
      version: '1',
      locale: 'x-test',
      fallbacks: [],
      grammar: { templates: [], separators: [';'], connectors: [], commandPrefixes: [] },
      numerals: { uno: 1 },
      unitAliases: [{ alias: 'ub', unitId: 'u.base' }],
      conceptAliases: [{ alias: 'thing', conceptId: 'concept.thing' }],
      attributeValues: { tone: ['warm'] },
      displayLabels: { item: 'Thing' },
    }],
    countries: [{
      schemaVersion: 2,
      kind: 'country',
      id: 'country-x',
      version: '1',
      countryCode: 'XX',
      locales: ['x-test'],
      shopTypes: [{ id: 'shop.test' }],
      categories: [{ id: 'category.thing', relevantAttributeIds: ['tone'], variantAttributeIds: ['tone'], signals: [], shopTypeIds: ['shop.test'] }],
      concepts: [{ id: 'concept.thing', categoryId: 'category.thing' }],
      brands: [],
      products: [],
      policy: { acceptThreshold: 0.9, ambiguityMargin: 0.1, maximumSegments: 8, maximumCandidatesPerEntity: 4, minimumLearningSupport: 2, defaultItem: { quantity: 1, unitId: 'u.base' } },
    }],
  };
}

test('semantic artifacts are deterministic and checksum protected', () => {
  const artifacts = buildSemanticArtifacts(semanticSources());
  const artifact = JSON.parse(artifacts['semantic/core/1.json']);

  assert.deepEqual(buildSemanticArtifacts(semanticSources()), artifacts);
  assert.equal(verifySemanticArtifact(artifact).id, 'core');
  artifact.units[0].id = 'tampered';
  assert.throws(() => verifySemanticArtifact(artifact), /checksum/i);
});

test('semantic packs reject duplicate aliases without explicit precedence', () => {
  const sources = semanticSources();
  sources.locales[0].conceptAliases.push({ alias: 'thing', conceptId: 'concept.other' });

  assert.throws(() => buildSemanticArtifacts(sources), /duplicate alias.*thing/i);
});

test('semantic packs allow the same text in different entity namespaces', () => {
  const sources = semanticSources();
  sources.locales[0].unitAliases[0].alias = 'thing';

  assert.doesNotThrow(() => buildSemanticArtifacts(sources));
});

test('semantic packs reject conflicting unit dimensions', () => {
  const sources = semanticSources();
  sources.core.units.push({ id: 'u.base', capability: 'measure', dimensionId: 'volume', factorToBase: 1 });

  assert.throws(() => buildSemanticArtifacts(sources), /unit.*u\.base.*conflict/i);
});

test('semantic packs reject cyclic locale fallback chains', () => {
  const sources = semanticSources();
  sources.locales[0].fallbacks = ['y-test'];
  sources.locales.push({ ...structuredClone(sources.locales[0]), id: 'locale-y', locale: 'y-test', fallbacks: ['x-test'] });

  assert.throws(() => buildSemanticArtifacts(sources), /fallback cycle/i);
});

test('semantic packs reject unknown category attribute references', () => {
  const sources = semanticSources();
  sources.countries[0].categories[0].relevantAttributeIds.push('missing');

  assert.throws(() => buildSemanticArtifacts(sources), /unknown attribute.*missing/i);
});

test('semantic packs reject unknown shop type references and unscoped brand rules', () => {
  const unknownShopType = semanticSources();
  unknownShopType.countries[0].categories[0].shopTypeIds = ['shop.missing'];
  assert.throws(() => buildSemanticArtifacts(unknownShopType), /unknown shop type.*shop\.missing/i);

  const unscopedBrand = semanticSources();
  unscopedBrand.countries[0].brands.push({ id: 'brand.test' });
  unscopedBrand.countries[0].brandShopTypeRules = [{ brandId: 'brand.test', shopTypeIds: ['shop.test'] }];
  assert.throws(() => buildSemanticArtifacts(unscopedBrand), /not scoped/i);
});

test('semantic packs reject incompatible schema versions', () => {
  const sources = semanticSources();
  sources.core.schemaVersion = 1;

  assert.throws(() => buildSemanticArtifacts(sources), /schemaVersion.*2/i);
});
