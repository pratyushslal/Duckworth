import { compileTypedLearningOverlay, resolveLearnedField } from './learning-overlay.js';
import { LearningOverlayCache } from './learning-overlay-cache.js';

describe('typed field-level household learning overlay', () => {
  const effect = (overrides: Partial<Parameters<typeof compileTypedLearningOverlay>[2][number]>) => ({
    id: 'effect-label',
    householdId: 'household-1',
    kind: 'canonical_label' as const,
    value: { label: 'Orion tonic' },
    applicability: {
      locale: 'en-IN', countryCode: 'IN', identityRefs: ['household:brand.orion'],
      identityDescriptorValueIds: [], applyOnlyWhenFieldAbsent: true,
    },
    status: 'active' as const,
    supportingEventIds: ['correction-1'],
    ...overrides,
  });

  it('keeps effects field-specific, scoped, and conflict-aware', () => {
    const overlay = compileTypedLearningOverlay('household-1', 3, [
      effect({}),
      effect({ id: 'effect-conflict', value: { label: 'Different tonic' } }),
      effect({ id: 'effect-quantity', kind: 'quantity_default', value: { quantity: 1, unitId: 'strip' }, applicability: {
        locale: 'en-IN', countryCode: 'IN', identityRefs: ['household:brand.orion'], identityDescriptorValueIds: ['650-mg'], applyOnlyWhenFieldAbsent: true,
      } }),
      effect({ id: 'effect-descriptor', kind: 'descriptor_value', value: { attributeId: 'size', value: 'large' } }),
      effect({ id: 'effect-role', kind: 'commercial_role', value: { role: 'manufacturer', organizationId: 'org.nestle' } }),
    ]);
    expect(overlay.revision).toBe(3);
    expect(overlay.canonicalLabels.size).toBe(0);
    expect(overlay.conflicts).toEqual(['effect-conflict', 'effect-label']);
    expect(overlay.quantityDefaults.get('household:brand.orion')).toBeUndefined();
    expect(overlay.descriptorDefaults.get('household:brand.orion')).toEqual({ size: 'large' });
    expect(overlay.commercialRoleDefaults.get('household:brand.orion')).toEqual([{ role: 'manufacturer', organizationId: 'org.nestle' }]);
    expect(resolveLearnedField('explicit', 'learned')).toBe('explicit');
    expect(resolveLearnedField(undefined, 'learned')).toBe('learned');
  });

  it('caches by household, overlay revision, and runtime version', () => {
    const cache = new LearningOverlayCache();
    const first = cache.getOrCompile('household-1', 1, 'runtime-1', []);
    const same = cache.getOrCompile('household-1', 1, 'runtime-1', []);
    const revised = cache.getOrCompile('household-1', 2, 'runtime-1', []);
    expect(same).toBe(first);
    expect(revised).not.toBe(first);
    cache.invalidateHousehold('household-1');
    expect(cache.getOrCompile('household-1', 2, 'runtime-1', [])).not.toBe(revised);
  });
});
