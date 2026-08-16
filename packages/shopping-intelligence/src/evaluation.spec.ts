import corpus from '../test-fixtures/brain-evaluation.json';
import { semanticRuntimeFixture } from '../test-fixtures/semantic-runtime.js';
import { runShoppingBrain } from './pipeline.js';
import type { BrainCaptureEnvelope } from './contracts.js';

const runtime = semanticRuntimeFixture();

function envelope(text: string, id: string, source = 'text'): BrainCaptureEnvelope {
  return {
    schemaVersion: 2,
    inputId: id,
    householdId: 'evaluation-household',
    contextId: 'evaluation-context',
    shoppingListId: 'evaluation-list',
    source: { kind: source },
    text,
    locale: 'en-IN',
    countryCode: 'IN',
    occurredAt: '2026-08-12T08:00:00.000Z',
    idempotencyKey: id,
  };
}

const context = { contextId: 'evaluation-context', shoppingListId: 'evaluation-list', recentEntities: [], openDrafts: [] };

describe('shopping brain evaluation corpus', () => {
  it.each(corpus.cases)('$id satisfies declared operations and serialization invariants', (fixture) => {
    const fixtureLocale = 'locale' in fixture ? fixture.locale : corpus.runtime.locale;
    const fixtureCountry = 'countryCode' in fixture ? fixture.countryCode : corpus.runtime.countryCode;
    if (fixtureLocale !== corpus.runtime.locale || fixtureCountry !== corpus.runtime.countryCode) {
      expect(fixture.expectedKinds).toEqual(['runtime_unavailable']);
      return;
    }
    const input = {
      ...envelope(fixture.text, fixture.id, 'source' in fixture ? fixture.source : 'text'),
      locale: fixtureLocale,
      countryCode: fixtureCountry,
    };
    const seeded = 'contextSeed' in fixture
      ? runShoppingBrain(envelope(fixture.contextSeed, `${fixture.id}-seed`), runtime, context).operations
          .flatMap((operation) => operation.kind === 'create'
            ? [{
                itemId: `${fixture.id}-seed-item`,
                conceptKey: operation.item.identity.conceptKey,
                variantKey: operation.item.identity.variantKey,
                mentionedAt: '2026-08-12T07:59:00.000Z',
              }]
            : [])
      : [];
    const fixtureContext = {
      ...context,
      recentEntities: 'seedInOtherContext' in fixture && fixture.seedInOtherContext ? [] : seeded,
    };
    const first = runShoppingBrain(input, runtime, fixtureContext);
    const second = runShoppingBrain(input, runtime, fixtureContext);
    expect(first.operations.map(({ kind }) => kind)).toEqual(fixture.expectedKinds);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    expect(first.operations.flatMap((operation) => operation.kind === 'draft' ? [{
      start: operation.draft.sourceStart,
      end: operation.draft.sourceEnd,
      reasonCode: operation.draft.reasonCode,
    }] : [])).toEqual(fixture.expectedUnresolvedSpans);
    const covered = new Set<number>();
    for (const operation of first.operations) {
      const start = operation.kind === 'draft' ? operation.draft.sourceStart : operation.sourceStart;
      const end = operation.kind === 'draft' ? operation.draft.sourceEnd : operation.sourceEnd;
      if (start !== undefined && end !== undefined) {
        for (let index = start; index < end; index += 1) covered.add(index);
      }
    }
    first.warnings.forEach((warning) => {
      if (warning.sourceStart === undefined || warning.sourceEnd === undefined) return;
      for (let index = warning.sourceStart; index < warning.sourceEnd; index += 1) covered.add(index);
    });
    fixture.text.split('').forEach((character, index) => {
      if (/\s|[,;]/u.test(character)) return;
      expect(covered.has(index), `unaccounted source character ${index} in ${fixture.id}`).toBe(true);
    });
    for (const operation of first.operations) {
      if (operation.kind === 'draft') {
        expect(operation.draft.sourceStart).toBeGreaterThanOrEqual(0);
        expect(operation.draft.sourceEnd).toBeLessThanOrEqual(fixture.text.length);
        continue;
      }
      for (const semantic of [operation.item.requestedCount, operation.item.packageMeasure]) {
        if (typeof semantic.value === 'number') expect(Number.isFinite(semantic.value) && semantic.value > 0).toBe(true);
        if (semantic.value && typeof semantic.value === 'object') {
          expect(Number.isFinite(semantic.value.value) && semantic.value.value > 0).toBe(true);
        }
      }
      operation.item.itemName.evidence.forEach((evidence) => {
        if (evidence.kind !== 'source_span') return;
        expect(evidence.sourceStart).toBeGreaterThanOrEqual(0);
        expect(evidence.sourceEnd).toBeLessThanOrEqual(fixture.text.length);
      });
    }
  });

  it('contains every required release-corpus category', () => {
    const categories = new Set(corpus.cases.map(({ category }) => category));
    for (const required of [
      'ordinary', 'branded', 'unknown', 'unicode', 'numeric-identity', 'reordered',
      'multi-item', 'follow-up', 'contradiction', 'unsupported-locale', 'adversarial-length',
      'duplicate', 'undo', 'cross-context',
    ]) expect(categories.has(required), `missing evaluation category ${required}`).toBe(true);
  });

  it('preserves semantic identity across source kinds, whitespace, casing, and harmless punctuation', () => {
    const inputs = ['Amul Butter', '  amul   butter  ', 'amul butter.'];
    const identities = inputs.flatMap((text, index) => {
      const result = runShoppingBrain(envelope(text, `meta-${index}`, index === 1 ? 'voice-transcript' : 'assistant'), runtime, context);
      return result.operations.flatMap((operation) => operation.kind === 'create' ? [operation.item.identity] : []);
    });
    expect(identities).toHaveLength(3);
    expect(new Set(identities.map(({ variantKey }) => variantKey)).size).toBe(1);

    const aliases = ['bread', 'loaf'].map((text, index) => runShoppingBrain(
      envelope(text, `alias-${index}`), runtime, context,
    ).operations.find((operation) => operation.kind === 'create'));
    expect(aliases.every((operation) => operation?.kind === 'create')).toBe(true);
    expect(new Set(aliases.map((operation) => operation?.kind === 'create'
      ? operation.item.identity.conceptKey
      : null)).size).toBe(1);
  });

  it('stays within the committed deterministic single-item latency budget', () => {
    const durations: number[] = [];
    for (let index = 0; index < 100; index += 1) {
      const started = performance.now();
      runShoppingBrain(envelope('milk', `latency-${index}`), runtime, context);
      durations.push(performance.now() - started);
    }
    durations.sort((left, right) => left - right);
    expect(durations[49]).toBeLessThan(corpus.latencyBudgetMs.median);
    expect(durations[94]).toBeLessThan(corpus.latencyBudgetMs.p95);
  });
});
