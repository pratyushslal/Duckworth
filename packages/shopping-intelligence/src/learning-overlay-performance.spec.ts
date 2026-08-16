import { performance } from 'node:perf_hooks';
import { compileTypedLearningOverlay, type TypedLearningEffect } from './learning-overlay.js';

describe('typed learning overlay performance budget', () => {
  it('compiles a production-shaped 1000-effect ledger within the local budget', () => {
    const effects: TypedLearningEffect[] = Array.from({ length: 1000 }, (_, index) => ({
      id: `effect-${index}`,
      householdId: 'family-live',
      kind: index % 2 === 0 ? 'unit_default' : 'package_default',
      value: index % 2 === 0 ? { unitId: 'pack' } : { size: 500, unitId: 'g' },
      applicability: {
        locale: 'en-IN', countryCode: 'IN', identityRefs: [`identity-${index}`],
        identityDescriptorValueIds: [], applyOnlyWhenFieldAbsent: true,
      },
      status: 'active',
      supportingEventIds: [`correction-${index}`],
    }));
    const start = performance.now();
    const overlay = compileTypedLearningOverlay('family-live', 42, effects);
    const elapsed = performance.now() - start;
    expect(overlay.unitDefaults.size + overlay.packageDefaults.size).toBe(1000);
    expect(elapsed).toBeLessThan(500);
  });
});
