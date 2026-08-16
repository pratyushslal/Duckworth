import { semanticRuntimeFixture } from '../test-fixtures/semantic-runtime.js';
import type { SemanticItem } from './contracts.js';

function semanticItem(conceptKey: string, variantKey: string): SemanticItem {
  const unknown = { value: null, confidence: 'unknown' as const, evidence: [] };
  return {
    itemName: { value: conceptKey, confidence: 'unknown', evidence: [] },
    conceptId: unknown,
    brandId: unknown,
    categoryId: unknown,
    requestedCount: unknown,
    requestedUnitId: unknown,
    packageMeasure: unknown,
    attributes: {},
    identity: { conceptKey, variantKey, requestKey: variantKey },
  };
}

describe('scoped reference resolution', () => {
  it('accepts only a unique exact variant and drafts competing variants', async () => {
    const { resolveContextReference } = await import('./index.js');
    const runtime = semanticRuntimeFixture();
    const exact = semanticItem('grocery.butter.dairy', 'grocery.butter.dairy|brand.amul');
    const candidates = [
      { itemId: 'amul', conceptKey: exact.identity.conceptKey, variantKey: exact.identity.variantKey, mentionedAt: '2026-08-12T08:00:00Z' },
    ];

    expect(resolveContextReference(exact, candidates, runtime.policy)).toEqual({
      kind: 'merge',
      targetItemId: 'amul',
    });

    const generic = semanticItem('grocery.butter.dairy', 'grocery.butter.dairy');
    expect(resolveContextReference(generic, [
      ...candidates,
      { itemId: 'other', conceptKey: generic.identity.conceptKey, variantKey: 'grocery.butter.dairy|brand.other', mentionedAt: '2026-08-12T08:01:00Z' },
    ], runtime.policy)).toEqual({
      kind: 'draft',
      candidateItemIds: ['amul', 'other'],
    });
  });
});
