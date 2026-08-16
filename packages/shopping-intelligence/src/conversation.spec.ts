import { semanticRuntimeFixture } from '../test-fixtures/semantic-runtime.js';

describe('conversation shopping intelligence', () => {
  it('resolves a follow-up only when one active semantic item matches', async () => {
    const { interpretConversation, resolveFollowUp } = await import('./index.js');
    const command = (text: string) => ({
      householdId: 'household-demo',
      text,
      locale: 'en-IN',
      countryCode: 'IN',
      source: 'text' as const,
      occurredAt: '2026-08-10T12:00:00.000Z',
      runtime: semanticRuntimeFixture(),
    });
    const amulButter = {
      id: 'amul-butter',
      ...interpretConversation(command('Amul butter 1 pack 500 g')).items[0],
    };
    const britanniaButter = {
      id: 'britannia-butter',
      ...interpretConversation(command('Britannia butter 1 pack 500 g')).items[0],
    };

    const runtime = semanticRuntimeFixture();
    expect(resolveFollowUp('make Amul butter two packs', [amulButter], runtime))
      .toMatchObject({
        kind: 'merge',
        itemId: 'amul-butter',
        delta: { itemName: 'Amul butter', quantity: 2, unit: 'pack' },
      });
    expect(resolveFollowUp('make butter two packs', [amulButter, britanniaButter], runtime))
      .toEqual({
        kind: 'draft',
        text: 'make butter two packs',
        reason: 'ambiguous_reference',
      });
  });

  it('interprets grocery and electronics clauses through one source-neutral command', async () => {
    const { interpretConversation } = await import('./index.js');

    expect(interpretConversation({
      householdId: 'household-demo',
      text: 'Add Apple iPhone and 4 milk pouches of 1 litre each',
      locale: 'en-IN',
      countryCode: 'IN',
      source: 'text',
      occurredAt: '2026-08-10T12:00:00.000Z',
      runtime: semanticRuntimeFixture(),
    })).toMatchObject({
      captureText: 'Add Apple iPhone and 4 milk pouches of 1 litre each',
      items: [
        {
          itemName: 'Apple iPhone',
          category: { id: 'electronics', confidence: 'inferred' },
          quantity: null,
          unit: null,
          packageSize: null,
          packageUnit: null,
          attributes: {},
        },
        {
          itemName: 'milk',
          category: { id: 'grocery', confidence: 'confirmed' },
          quantity: 4,
          unit: 'pouch',
          packageSize: 1,
          packageUnit: 'l',
          attributes: {},
        },
      ],
      unresolved: [],
    });
  });

  it('classifies non-grocery items and retains only clearly spoken category attributes', async () => {
    const { interpretConversation } = await import('./index.js');
    const result = interpretConversation({
      householdId: 'household-demo',
      text: 'Add a blue cotton t-shirt size large and paracetamol syrup 1 bottle',
      locale: 'en-IN',
      countryCode: 'IN',
      source: 'text',
      occurredAt: '2026-08-10T12:00:00.000Z',
      runtime: semanticRuntimeFixture(),
    });

    expect(result.items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        itemName: 'blue cotton t-shirt size large',
        category: { id: 'apparel', confidence: 'inferred' },
        attributes: { colour: 'blue', material: 'cotton', size: 'large' },
      }),
      expect.objectContaining({
        itemName: 'paracetamol syrup',
        category: { id: 'pharmacy', confidence: 'inferred' },
        quantity: 1,
        unit: 'bottle',
        attributes: { form: 'syrup' },
      }),
    ]));
  });

  it('keeps the brain decision invariant across input source metadata', async () => {
    const { interpretConversation } = await import('./index.js');
    const command = (source: 'text' | 'voice' | 'api' | 'assistant') => ({
      householdId: 'household-demo',
      text: 'Amul butter 1 pack 500 g',
      locale: 'en-IN',
      countryCode: 'IN',
      source,
      occurredAt: '2026-08-10T12:00:00.000Z',
      runtime: semanticRuntimeFixture(),
    });
    const decisions = (['text', 'voice', 'api', 'assistant'] as const).map((source) => (
      interpretConversation(command(source)).items[0]
    ));
    expect(decisions[1]).toEqual(decisions[0]);
    expect(decisions[2]).toEqual(decisions[0]);
    expect(decisions[3]).toEqual(decisions[0]);
  });
});
