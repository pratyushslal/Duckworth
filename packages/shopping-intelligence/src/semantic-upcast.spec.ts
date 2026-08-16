import type { SemanticItem } from './contracts.js';
import { upcastSemanticItem } from './semantic-upcast.js';

function legacyItem(): SemanticItem {
  return {
    itemName: { value: 'milk', confidence: 'confirmed', evidence: [] },
    conceptId: { value: 'grocery.milk', confidence: 'confirmed', evidence: [] },
    brandId: { value: null, confidence: 'unknown', evidence: [] },
    categoryId: { value: 'grocery', confidence: 'confirmed', evidence: [] },
    requestedCount: { value: 1, confidence: 'confirmed', evidence: [] },
    requestedUnitId: { value: 'piece', confidence: 'confirmed', evidence: [] },
    packageMeasure: { value: null, confidence: 'unknown', evidence: [] },
    attributes: {},
    identity: { conceptKey: 'grocery.milk', variantKey: 'grocery.milk', requestKey: 'grocery.milk|1|piece' },
  };
}

describe('semantic snapshot upcasting', () => {
  it('upcasts a legacy snapshot without mutating or losing its original fields', () => {
    const legacy = legacyItem();
    const upgraded = upcastSemanticItem(legacy);

    expect(upgraded).toMatchObject({ semanticVersion: 4, descriptorMentions: [], measures: [], packaging: [] });
    expect(legacy.semanticVersion).toBeUndefined();
    expect(upgraded.itemName).toEqual(legacy.itemName);
    expect(upgraded.identity).toEqual(legacy.identity);
  });

  it('preserves existing v3 descriptor evidence', () => {
    const current = { ...legacyItem(), semanticVersion: 3 as const, descriptorMentions: [{
      surface: 'big', normalized: 'big', sourceStart: 0, sourceEnd: 3,
      role: 'packaging_qualifier' as const, evidence: [],
    }] };
    const upgraded = upcastSemanticItem(current);
    expect(upgraded).not.toBe(current);
    expect(upgraded).toMatchObject({ semanticVersion: 4, descriptorMentions: current.descriptorMentions, measures: [], packaging: [] });
  });
});
