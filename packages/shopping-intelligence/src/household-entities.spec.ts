import type { CaptureInterpretation } from '@duckworth/item-capture';
import { semanticRuntimeFixture } from '../test-fixtures/semantic-runtime.js';
import type { SemanticHouseholdLayer } from './semantic-runtime.js';
import { resolveSemanticItem } from './entity-resolution.js';

function capture(text: string): CaptureInterpretation {
  return { captureText: text, name: text, quantity: null, unit: null, packageSize: null, packageUnit: null };
}

describe('household-local semantic identities', () => {
  it('resolves a household-local product and preserves its confirmed label and local brand', () => {
    const runtime = semanticRuntimeFixture((layers) => {
      layers.push({
        schemaVersion: 2,
        kind: 'household',
        id: 'household-local-identities',
        version: '1',
        householdId: 'family-live',
        conceptAliases: [],
        brandAliases: [],
        localEntities: [
          { id: 'household:family-live:brand.orion', kind: 'brand', label: 'Orion', aliases: ['orion'] },
          {
            id: 'household:family-live:product.orion.tonic',
            kind: 'product',
            label: 'Orion tonic',
            aliases: ['orion tonic'],
            conceptId: 'grocery.bread.loaf',
            brandId: 'household:family-live:brand.orion',
          },
        ],
      } satisfies SemanticHouseholdLayer);
    });

    const result = resolveSemanticItem(capture('orion tonic'), runtime);
    expect(result.alternatives).toEqual([]);
    expect(result.item).toMatchObject({
      itemName: { value: 'Orion tonic', confidence: 'confirmed' },
      conceptId: { value: 'grocery.bread.loaf', confidence: 'confirmed' },
      brandId: { value: 'household:family-live:brand.orion', confidence: 'confirmed' },
      productId: { value: 'household:family-live:product.orion.tonic', confidence: 'confirmed' },
    });
    expect(runtime.displayLabels['household:family-live:brand.orion']).toBe('Orion');
    expect(runtime.householdEntities.get('household:family-live:brand.orion')?.label).toBe('Orion');
  });

  it('composes multiple household layers and rejects duplicate local entity IDs', () => {
    expect(() => semanticRuntimeFixture((layers) => {
      layers.push(
        {
          schemaVersion: 2, kind: 'household', id: 'device', version: '1', householdId: 'family-live',
          conceptAliases: [], brandAliases: [],
          localEntities: [{ id: 'household:family-live:brand.same', kind: 'brand', label: 'Same', aliases: ['same'] }],
        },
        {
          schemaVersion: 2, kind: 'household', id: 'household', version: '1', householdId: 'family-live',
          conceptAliases: [], brandAliases: [],
          localEntities: [{ id: 'household:family-live:brand.same', kind: 'brand', label: 'Different', aliases: ['different'] }],
        },
      );
    })).toThrow(/Duplicate household entity/);
  });

  it('compiles local concepts, product families, and aliases into one household runtime', () => {
    const runtime = semanticRuntimeFixture((layers) => {
      layers.push({
        schemaVersion: 2,
        kind: 'household',
        id: 'household-local-family',
        version: '1',
        householdId: 'family-live',
        conceptAliases: [],
        brandAliases: [],
        localEntities: [
          { id: 'household:family-live:concept:tonic', kind: 'concept', label: 'Tonic', aliases: ['tonic'], categoryId: 'grocery' },
          { id: 'household:family-live:brand:orion', kind: 'brand', label: 'Orion', aliases: ['orion'] },
          {
            id: 'household:family-live:family:orion-tonic', kind: 'product_family', label: 'Orion tonic', aliases: ['orion tonic'],
            conceptId: 'household:family-live:concept:tonic', brandId: 'household:family-live:brand:orion',
          },
        ],
      } satisfies SemanticHouseholdLayer);
    });
    expect(runtime.concepts.byAlias.get('tonic')?.id).toBe('household:family-live:concept:tonic');
    expect(runtime.brands.byAlias.get('orion')?.id).toBe('household:family-live:brand:orion');
    expect(runtime.productFamilies.byAlias.get('orion tonic')?.id).toBe('household:family-live:family:orion-tonic');
  });
});
