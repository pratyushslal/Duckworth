import { describe, expect, it } from 'vitest';
import { classificationHintKey } from './classification-hints';

describe('classificationHintKey', () => {
  it('returns a message key only for a runtime-defaulted item', () => {
    expect(classificationHintKey({ quantitySource: 'policy_default', unitSource: 'policy_default' }))
      .toBe('itemDefaultsApplied');
    expect(classificationHintKey({ quantitySource: 'explicit', unitSource: 'explicit' })).toBeNull();
  });
});
