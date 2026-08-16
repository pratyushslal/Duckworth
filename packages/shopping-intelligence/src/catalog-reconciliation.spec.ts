import {
  applyReconciliationDisposition,
  createReconciliationCandidate,
} from './catalog-reconciliation.js';

describe('catalog reconciliation', () => {
  const local = {
    id: 'household:brand.orion', kind: 'brand' as const, label: 'Orion', aliases: ['orion'],
  };
  const official = { id: 'brand.orion', kind: 'brand' as const, label: 'ORION', aliases: ['orion'] };

  it('creates a review candidate without silently changing the local identity', () => {
    const candidate = createReconciliationCandidate('family-live', local, official);
    expect(candidate).toMatchObject({
      status: 'proposed',
      localEntityId: local.id,
      officialEntityId: official.id,
      replacedByCatalogId: null,
    });
  });

  it('supports explicit link, merge, and keep-separate dispositions', () => {
    const candidate = createReconciliationCandidate('family-live', local, official)!;
    expect(applyReconciliationDisposition(candidate, 'link')).toMatchObject({ status: 'linked', replacedByCatalogId: official.id });
    expect(applyReconciliationDisposition(candidate, 'merge')).toMatchObject({ status: 'merged', replacedByCatalogId: official.id });
    expect(applyReconciliationDisposition(candidate, 'keep_separate')).toMatchObject({ status: 'kept_separate', replacedByCatalogId: null });
  });

  it('does not propose a cross-kind or materially different identity match', () => {
    expect(createReconciliationCandidate('family-live', local, { ...official, kind: 'product' })).toBeNull();
    expect(createReconciliationCandidate('family-live', local, { ...official, label: 'Other brand' })).toBeNull();
  });
});
