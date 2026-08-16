import coreSource from '../../../catalog/source/semantic/core.json';
import localeSource from '../../../catalog/source/semantic/en-IN.json';
import type { CaptureRuntime } from './index.js';

const core = coreSource as unknown as {
  units: Array<{ id: string; capability: 'measure' | 'container' | 'both'; dimensionId?: string; factorToBase?: number }>;
};
const locale = localeSource as unknown as {
  grammar: CaptureRuntime['grammar'];
  numerals: Record<string, number>;
  unitAliases: Array<{ alias: string; unitId: string }>;
};

function runtimeFromSources(): CaptureRuntime {
  const units = new Map(core.units.map((unit) => [unit.id, unit]));
  return {
    grammar: locale.grammar,
    numerals: new Map(Object.entries(locale.numerals)),
    unitAliases: new Map(locale.unitAliases.map(({ alias, unitId }) => [alias, units.get(unitId)!])),
    maximumInputLength: 10_000,
    maximumTemplateSteps: 20_000,
  };
}

describe('data-driven item capture', () => {
  it.each([
    ['1.5 kg potatoes', 'potatoes', 1.5, 'kg', null, null],
    ['amul butter 1 pack 500 gm', 'amul butter', 1, 'pack', 500, 'g'],
    ['two packs of 500 g Amul Butter', 'Amul Butter', 2, 'pack', 500, 'g'],
    ['Formula 1', 'Formula 1', null, null, null, null],
  ])('interprets %s through runtime data', (text, name, quantity, unit, packageSize, packageUnit) => {
    const { interpretCapture } = requireCapture();
    expect(interpretCapture(text, runtimeFromSources())).toMatchObject({
      captureText: text,
      name,
      quantity,
      unit,
      packageSize,
      packageUnit,
    });
  });

  it('parses vocabulary that exists only in a synthetic runtime', () => {
    const { interpretCapture } = requireCapture();
    const synthetic: CaptureRuntime = {
      grammar: {
        templates: [{
          id: 'synthetic-count-unit-item',
          operators: [
            { kind: 'number', capture: 'quantity' },
            { kind: 'unit', capture: 'unit', role: 'any' },
            { kind: 'literal', values: ['zorb'] },
            { kind: 'text', capture: 'itemName', minTokens: 1 },
          ],
        }],
        separators: ['vex'],
        connectors: ['zorb'],
        commandPrefixes: ['naru'],
      },
      numerals: new Map([['dax', 2]]),
      unitAliases: new Map([['glims', { id: 'synthetic.measure', capability: 'measure', dimensionId: 'synthetic' }]]),
      maximumInputLength: 10_000,
      maximumTemplateSteps: 2_000,
    };

    expect(interpretCapture('naru dax glims zorb Ωmega', synthetic)).toMatchObject({
      name: 'Ωmega',
      quantity: 2,
      unit: 'synthetic.measure',
    });
  });

  it('bounds adversarial input without catastrophic matching', () => {
    const { interpretCapture } = requireCapture();
    const input = 'a'.repeat(10_000);
    expect(() => interpretCapture(input, runtimeFromSources())).not.toThrow();
  });
});

function requireCapture(): typeof import('./index.js') {
  return globalThis.__captureModule as typeof import('./index.js');
}

beforeAll(async () => {
  globalThis.__captureModule = await import('./index.js');
});

declare global {
  // eslint-disable-next-line no-var
  var __captureModule: typeof import('./index.js');
}
