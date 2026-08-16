import corpus from '../../catalog/test/fixtures/semantic-corrections/corpus.json' with { type: 'json' };
import { describe, expect, it } from 'vitest';

describe('semantic correction API evaluation matrix', () => {
  it('covers all fields that the atomic correction command must persist', () => {
    const fields = new Set(corpus.cases.flatMap(({ expected }) => expected.correctionFields));
    expect(fields).toEqual(new Set([
      'canonicalLabel',
      'consumerBrand',
      'descriptor',
      'quantity',
      'unit',
      'packageSize',
      'packageUnit',
      'shopTypeDecisions',
    ]));
  });

  it('covers both item-only and future-matching learning scopes', () => {
    const modes = new Set(corpus.cases.map(({ expected }) => expected.learning.mode));
    expect(modes.has('this_item_only')).toBe(true);
    expect(modes.has('future_matching_items')).toBe(true);
    expect(modes.has('none')).toBe(true);
  });

  it('requires provenance and idempotent replay expectations for every case', () => {
    corpus.cases.forEach((fixture) => {
      expect(fixture.sourceCaptureId).toMatch(/^capture-/);
      expect(Number.isInteger(fixture.operationIndex)).toBe(true);
      expect(fixture.expected.api).toEqual({
        requiresIdempotencyKey: true,
        rejectsStaleVersion: true,
        publishesAfterCommit: true,
      });
    });
  });
});
