import type {
  BrainCaptureEnvelope,
  BrainResult,
  ItemClassification,
  SemanticItem,
} from './index.js';

describe('versioned shopping brain contracts', () => {
  it('round-trips valid v2 data and rejects invalid provenance, spans, or unsupported confidence', async () => {
    const {
      validateBrainCaptureEnvelope,
      validateBrainResult,
    } = await import('./index.js');
    const text = '添加 दूध 🥛';
    const envelope: BrainCaptureEnvelope = {
      schemaVersion: 2,
      inputId: 'input-1',
      householdId: 'household-1',
      contextId: 'context-1',
      shoppingListId: 'list-1',
      source: { kind: 'wearable-shell', deviceId: 'device-1', speakerId: 'speaker-1' },
      text,
      alternatives: [{ text: '添加 दूध', confidence: 0.72 }],
      locale: 'und',
      countryCode: 'ZZ',
      occurredAt: '2026-08-12T08:00:00.000Z',
      idempotencyKey: 'capture-1',
    };
    const item: SemanticItem = {
      itemName: {
        value: 'दूध 🥛',
        confidence: 'confirmed',
        evidence: [{ kind: 'source_span', sourceStart: 3, sourceEnd: text.length }],
      },
      conceptId: { value: null, confidence: 'unknown', evidence: [] },
      brandId: { value: null, confidence: 'unknown', evidence: [] },
      categoryId: { value: null, confidence: 'unknown', evidence: [] },
      requestedCount: { value: null, confidence: 'unknown', evidence: [] },
      requestedUnitId: { value: null, confidence: 'unknown', evidence: [] },
      packageMeasure: { value: null, confidence: 'unknown', evidence: [] },
      attributes: {
        note: { value: '新鮮', confidence: 'unknown', evidence: [] },
      },
      identity: {
        conceptKey: 'concept-1',
        variantKey: 'variant-1',
        requestKey: 'request-1',
      },
    };
    const result: BrainResult = {
      schemaVersion: 2,
      engineVersion: 'engine-1',
      runtimeVersions: { grammar: 'grammar-1' },
      capture: { inputId: envelope.inputId, text },
      operations: [{ kind: 'create', item }],
      warnings: [],
    };

    const roundTripped = JSON.parse(JSON.stringify({ envelope, result })) as {
      envelope: BrainCaptureEnvelope;
      result: BrainResult;
    };
    expect(roundTripped).toEqual({ envelope, result });
    expect(validateBrainCaptureEnvelope(roundTripped.envelope)).toEqual(envelope);
    expect(validateBrainResult(roundTripped.result)).toEqual(result);

    const outOfBounds = JSON.parse(JSON.stringify(result)) as BrainResult;
    const outOfBoundsItem = (outOfBounds.operations[0] as { item: SemanticItem }).item;
    outOfBoundsItem.itemName.evidence[0] = {
      kind: 'source_span',
      sourceStart: 0,
      sourceEnd: text.length + 1,
    };
    expect(() => validateBrainResult(outOfBounds)).toThrow();

    const missingProvenance = { ...result, engineVersion: '' };
    expect(() => validateBrainResult(missingProvenance)).toThrow();

    const unsupportedInference = JSON.parse(JSON.stringify(result)) as BrainResult;
    const unsupportedItem = (unsupportedInference.operations[0] as { item: SemanticItem }).item;
    unsupportedItem.requestedCount = {
      value: 2,
      confidence: 'inferred',
      evidence: [],
    };
    expect(() => validateBrainResult(unsupportedInference)).toThrow();
  });
});

describe('item classification contracts', () => {
  it('round-trips data-driven shop types while rejecting duplicate tags and invalid defaults', async () => {
    const { validateItemClassification } = await import('./index.js');
    const classification: ItemClassification = {
      automaticCategory: {
        value: 'synthetic-category',
        confidence: 'inferred',
        evidence: [{ kind: 'catalog_match', ref: 'synthetic-category-rule' }],
      },
      categoryOverride: null,
      effectiveCategoryId: 'synthetic-category',
      automaticShopTypes: [{
        tagId: 'synthetic-shop-type',
        confidence: 'inferred',
        evidence: [{ kind: 'catalog_match', ref: 'synthetic-shop-rule' }],
        semanticIdentityKey: 'synthetic-identity',
        runtimeVersions: { country: 'test-country-v1' },
      }],
      shopTypeOverrides: [{
        tagId: 'arbitrary-shop-type-id',
        decision: 'exclude',
        semanticIdentityKey: 'synthetic-identity',
      }],
      defaultedQuantity: { value: 1, source: 'policy_default' },
      defaultedUnitId: { value: 'synthetic-unit', source: 'policy_default' },
    };

    const roundTripped = JSON.parse(JSON.stringify(classification)) as ItemClassification;
    expect(validateItemClassification(roundTripped)).toEqual(classification);

    const duplicateAutomaticTag: ItemClassification = {
      ...classification,
      automaticShopTypes: [
        ...classification.automaticShopTypes,
        { ...classification.automaticShopTypes[0] },
      ],
    };
    expect(() => validateItemClassification(duplicateAutomaticTag)).toThrow();

    const invalidDefault: ItemClassification = {
      ...classification,
      defaultedQuantity: { value: 0, source: 'policy_default' },
    };
    expect(() => validateItemClassification(invalidDefault)).toThrow();
  });
});

describe('accepted suggestion provenance', () => {
  it('requires a range-bounded reference tied to the exact raw capture', async () => {
    const { validateBrainCaptureEnvelope } = await import('./index.js');
    const base: BrainCaptureEnvelope = {
      schemaVersion: 2, inputId: 'input', householdId: 'household', contextId: 'context', shoppingListId: 'list',
      source: { kind: 'text' }, text: 'maggie noo 2 packs', locale: 'en-IN', countryCode: 'IN',
      occurredAt: '2026-08-13T00:00:00.000Z', idempotencyKey: 'idempotency',
      acceptedSuggestion: {
        reference: 'local:product%7Cnoodles:maggie%20noo%202%20packs',
        originalText: 'maggie noo 2 packs',
        replacement: { start: 0, end: 10, replacementText: 'Maggi noodles' },
        productId: 'product.maggi.noodles',
      },
    };
    expect(validateBrainCaptureEnvelope(base)).toEqual(base);
    expect(() => validateBrainCaptureEnvelope({ ...base, acceptedSuggestion: {
      ...base.acceptedSuggestion!, originalText: 'different text',
    } })).toThrow(/originalText/i);
    expect(() => validateBrainCaptureEnvelope({ ...base, acceptedSuggestion: {
      ...base.acceptedSuggestion!, replacement: { start: 10, end: 1, replacementText: 'x' },
    } })).toThrow(/range/i);
  });
});
