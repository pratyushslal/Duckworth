import { semanticRuntimeFixture } from '../test-fixtures/semantic-runtime.js';
import type { BrainCaptureEnvelope } from './contracts.js';
import type { DiscourseContext } from './reference-resolution.js';

const context: DiscourseContext = {
  contextId: 'context-1',
  shoppingListId: 'list-1',
  recentEntities: [],
  openDrafts: [],
};

function envelope(text: string, source = 'text'): BrainCaptureEnvelope {
  return {
    schemaVersion: 2,
    inputId: `input-${source}`,
    householdId: 'household-1',
    contextId: context.contextId,
    shoppingListId: context.shoppingListId,
    source: { kind: source },
    text,
    locale: 'en-IN',
    countryCode: 'IN',
    occurredAt: '2026-08-12T08:00:00.000Z',
    idempotencyKey: `key-${source}`,
  };
}

describe('shopping brain pipeline', () => {
  it('emits source-neutral create operations whose source spans consume both clear items', async () => {
    const { runShoppingBrain } = await import('./index.js');
    const runtime = semanticRuntimeFixture();
    const results = ['text', 'voice-transcript', 'assistant'].map((source) => (
      runShoppingBrain(envelope('Add Apple iPhone and 4 milk pouches of 1 litre each', source), runtime, context)
    ));
    const operations = results.map((result) => result.operations);

    expect(operations[1]).toEqual(operations[0]);
    expect(operations[2]).toEqual(operations[0]);
    expect(operations).toEqual(expect.arrayContaining([expect.arrayContaining([
      expect.objectContaining({ kind: 'create', item: expect.objectContaining({ itemName: expect.objectContaining({ value: 'Apple iPhone' }) }) }),
      expect.objectContaining({ kind: 'create', item: expect.objectContaining({ itemName: expect.objectContaining({ value: 'milk' }) }) }),
    ])]));
    expect(results[0].operations.flatMap((operation) => operation.kind === 'draft'
      ? [[operation.draft.sourceStart, operation.draft.sourceEnd]]
      : operation.item.itemName.evidence.map((evidence) => [evidence.sourceStart, evidence.sourceEnd])))
      .toEqual(expect.arrayContaining([[4, 16], [23, 27]]));
  });

  it('merges a unique scoped follow-up and drafts competing variants', async () => {
    const { runShoppingBrain } = await import('./index.js');
    const runtime = semanticRuntimeFixture();
    const first = runShoppingBrain(envelope('Amul Butter'), runtime, context);
    const created = first.operations[0];
    expect(created.kind).toBe('create');
    if (created.kind !== 'create') return;
    const uniqueContext: DiscourseContext = {
      ...context,
      recentEntities: [{ itemId: 'item-1', ...created.item.identity, mentionedAt: envelope('').occurredAt }],
    };
    expect(runShoppingBrain(envelope('make Amul Butter two packs'), runtime, uniqueContext).operations[0])
      .toMatchObject({ kind: 'merge', targetItemId: 'item-1' });

    const competing: DiscourseContext = {
      ...uniqueContext,
      recentEntities: [
        ...uniqueContext.recentEntities,
        { itemId: 'item-2', conceptKey: created.item.identity.conceptKey, variantKey: `${created.item.identity.conceptKey}|brand.other`, mentionedAt: envelope('').occurredAt },
      ],
    };
    expect(runShoppingBrain(envelope('make butter two packs'), runtime, competing).operations[0])
      .toMatchObject({ kind: 'draft', draft: { candidateIds: ['item-1', 'item-2'] } });
  });

  it('commits a clear semicolon clause and drafts an unsupported remainder', async () => {
    const { runShoppingBrain } = await import('./index.js');
    const result = runShoppingBrain(envelope('milk; ???'), semanticRuntimeFixture(), context);

    expect(result.operations).toEqual([
      expect.objectContaining({ kind: 'create' }),
      expect.objectContaining({ kind: 'draft', draft: expect.objectContaining({ text: '???' }) }),
    ]);
  });

  it('uses reviewed correction and pronoun data without crossing context boundaries', async () => {
    const { runShoppingBrain } = await import('./index.js');
    const runtime = semanticRuntimeFixture();
    const created = runShoppingBrain(envelope('milk'), runtime, context).operations[0];
    expect(created.kind).toBe('create');
    if (created.kind !== 'create') return;
    const recent = {
      itemId: 'milk-item',
      ...created.item.identity,
      mentionedAt: envelope('').occurredAt,
      item: created.item,
    };
    const scoped = { ...context, recentEntities: [recent] };

    expect(runShoppingBrain(envelope('correct milk two packs'), runtime, scoped).operations[0])
      .toMatchObject({ kind: 'correct', targetItemId: 'milk-item', item: { requestedCount: { value: 2 } } });
    expect(runShoppingBrain(envelope('make it three packs'), runtime, scoped).operations[0])
      .toMatchObject({
        kind: 'merge',
        targetItemId: 'milk-item',
        item: { itemName: { value: 'milk' }, requestedCount: { value: 3 } },
      });
    expect(runShoppingBrain(envelope('make it three packs'), runtime, context).operations[0])
      .toMatchObject({ kind: 'create' });
  });
});
