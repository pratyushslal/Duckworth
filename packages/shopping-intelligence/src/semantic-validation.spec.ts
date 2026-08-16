import { resolveSemanticItem } from './entity-resolution.js';
import { assertSemanticItemCompatible, IncompatibleSemanticItemError } from './semantic-validation.js';
import { interpretCapture } from '../../item-capture/dist/index.js';
import { semanticRuntimeFixture } from '../test-fixtures/semantic-runtime.js';

describe('semantic compatibility boundary', () => {
  it('rejects a pharmaceutical strength surviving on a grocery item', () => {
    const runtime = semanticRuntimeFixture();
    const item = resolveSemanticItem(interpretCapture('Britannia 50-50', runtime), runtime).item;
    const invalid = {
      ...item,
      attributes: {
        ...item.attributes,
        strength: { value: '100 mg', confidence: 'confirmed' as const, evidence: [{ kind: 'grammar_rule' as const, ref: 'test' }] },
      },
    };

    expect(() => assertSemanticItemCompatible(invalid, runtime)).toThrow(IncompatibleSemanticItemError);
  });

  it('accepts the same strength only when the final category declares that mapping', () => {
    const runtime = semanticRuntimeFixture();
    const item = resolveSemanticItem(interpretCapture('Telma 40 mg', runtime), runtime).item;

    expect(item.categoryId.value).toBe('pharmacy');
    expect(item.attributes.strength?.value).toBe('40 mg');
    expect(() => assertSemanticItemCompatible(item, runtime)).not.toThrow();
  });
});
