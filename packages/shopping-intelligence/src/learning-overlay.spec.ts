import { semanticRuntimeFixture } from '../test-fixtures/semantic-runtime.js';

describe('governed household learning overlay', () => {
  it('admits only eligible provenance and remains reversible below explicit input', async () => {
    const {
      projectLearnedSemanticEntry,
      compileLearningOverlay,
      resolveLearnedPreference,
    } = await import('./index.js');
    const runtime = semanticRuntimeFixture();
    const candidate = {
      id: 'learned-1',
      householdId: 'household-1',
      kind: 'alias' as const,
      value: { alias: 'weekly staple', conceptId: 'grocery.milk.dairy' },
    };
    const poisoned = [
      { id: 'draft-1', kind: 'draft' as const },
      { id: 'mistake-1', kind: 'removed_mistake' as const },
      { id: 'undo-1', kind: 'undone_merge' as const },
      { id: 'spelling-1', kind: 'rejected_spelling' as const },
      { id: 'contradiction-1', kind: 'confirmed_event' as const, supportsCandidate: false },
    ];

    expect(projectLearnedSemanticEntry(candidate, poisoned, runtime.policy)).toBeNull();
    const learned = projectLearnedSemanticEntry(candidate, [
      { id: 'confirmed-1', kind: 'confirmed_event' },
      { id: 'confirmed-2', kind: 'confirmed_event' },
      ...poisoned,
    ], runtime.policy);
    expect(learned).toEqual({
      ...candidate,
      supportingEventIds: ['confirmed-1', 'confirmed-2'],
      status: 'active',
    });
    expect(compileLearningOverlay('household-1', [learned!]).conceptAliases)
      .toEqual([{ alias: 'weekly staple', conceptId: 'grocery.milk.dairy' }]);
    expect(resolveLearnedPreference('explicit-current', learned)).toBe('explicit-current');

    const cleared = { ...learned!, status: 'cleared' as const };
    expect(compileLearningOverlay('household-1', [cleared]).conceptAliases).toEqual([]);
    expect(cleared.supportingEventIds).toEqual(['confirmed-1', 'confirmed-2']);

    expect(projectLearnedSemanticEntry(candidate, [
      { id: 'correction-1', kind: 'accepted_correction' },
    ], runtime.policy)?.supportingEventIds).toEqual(['correction-1']);

    const quantity = {
      id: 'learned-quantity',
      householdId: 'household-1',
      kind: 'quantity_preference' as const,
      value: { identityKey: 'grocery.milk.dairy', requestedQuantity: 2, unit: 'piece' },
      supportingEventIds: ['confirmed-quantity'],
      status: 'active' as const,
    };
    expect(compileLearningOverlay('household-1', [quantity]).quantityPreferences)
      .toEqual([{ identityKey: 'grocery.milk.dairy', quantity: 2, unitId: 'piece' }]);
  });
});
