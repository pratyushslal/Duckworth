import { semanticRuntimeFixture } from '../test-fixtures/semantic-runtime.js';

vi.mock('./index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./index.js')>();
  const runtime = semanticRuntimeFixture();
  return {
    ...actual,
    interpretItem: (command: Omit<Parameters<typeof actual.interpretItem>[0], 'runtime'>) => (
      actual.interpretItem({ ...command, runtime })
    ),
    reconcileItemCorrection: (
      command: Omit<Parameters<typeof actual.reconcileItemCorrection>[0], 'runtime'>,
    ) => actual.reconcileItemCorrection({ ...command, runtime }),
  };
});

describe('source-neutral shopping intelligence', () => {
  it.each(['text', 'voice', 'api'] as const)('interprets the same transcript from %s', async (source) => {
    const { interpretItem } = await import('./index.js');

    expect(interpretItem({
      text: 'Amul Butter 500 gms 1 pac',
      locale: 'en-IN',
      countryCode: 'IN',
      source,
    })).toEqual({
      captureText: 'Amul Butter 500 gms 1 pac',
      itemName: 'Amul Butter',
      identityKey: 'amul butter',
      quantity: 1,
      unit: 'pack',
      packageSize: 500,
      packageUnit: 'g',
    });
  });

  it('understands a leading container count joined to a packaged item with of', async () => {
    const { interpretItem } = await import('./index.js');

    expect(interpretItem({
      text: '1 pack of Amul Butter 500 gms',
      locale: 'en-IN',
      countryCode: 'IN',
      source: 'text',
    })).toEqual({
      captureText: '1 pack of Amul Butter 500 gms',
      itemName: 'Amul Butter',
      identityKey: 'amul butter',
      quantity: 1,
      unit: 'pack',
      packageSize: 500,
      packageUnit: 'g',
    });
  });

  it('understands a spoken number word in the same source-neutral grammar', async () => {
    const { interpretItem } = await import('./index.js');

    expect(interpretItem({
      text: 'one pack of Amul Butter 500 grams',
      locale: 'en-IN',
      countryCode: 'IN',
      source: 'voice',
    })).toMatchObject({
      itemName: 'Amul Butter',
      identityKey: 'amul butter',
      quantity: 1,
      unit: 'pack',
      packageSize: 500,
      packageUnit: 'g',
    });
  });

  it('understands a leading count with a trailing package size even without a container unit', async () => {
    const { interpretItem } = await import('./index.js');

    expect(interpretItem({
      text: 'one Tata Tea 500 gms',
      locale: 'en-IN',
      countryCode: 'IN',
      source: 'text',
    })).toMatchObject({
      itemName: 'Tata Tea',
      identityKey: 'tata tea',
      quantity: 1,
      unit: null,
      packageSize: 500,
      packageUnit: 'g',
    });
  });

  it('records a reviewed brand hint without rewriting the captured item name', async () => {
    const { interpretItem } = await import('./index.js');

    expect(interpretItem({
      text: 'Amul butter 1 pack 500 gms',
      locale: 'en-IN',
      countryCode: 'IN',
      source: 'text',
      brandHints: [{ label: 'Amul', aliases: ['amul'] }],
    })).toMatchObject({
      itemName: 'Amul butter',
      brandName: 'Amul',
      quantity: 1,
      unit: 'pack',
      packageSize: 500,
      packageUnit: 'g',
    });
  });

  it('understands an attached package measure in reverse two-measure order', async () => {
    const { interpretItem } = await import('./index.js');

    expect(interpretItem({
      text: 'Amul Butter 500g 2 packs',
      locale: 'en-IN',
      countryCode: 'IN',
      source: 'text',
    })).toMatchObject({
      itemName: 'Amul Butter',
      quantity: 2,
      unit: 'pack',
      packageSize: 500,
      packageUnit: 'g',
    });
  });

  it('understands count of package size before the item name', async () => {
    const { interpretItem } = await import('./index.js');

    expect(interpretItem({
      text: '2 packs of 500 g Amul Butter',
      locale: 'en-IN',
      countryCode: 'IN',
      source: 'voice',
    })).toMatchObject({
      itemName: 'Amul Butter',
      quantity: 2,
      unit: 'pack',
      packageSize: 500,
      packageUnit: 'g',
    });
  });

  it.each(['text', 'voice', 'api'] as const)(
    'interprets count-container-of-size-of-item phrasing from %s',
    async (source) => {
      const { interpretItem } = await import('./index.js');

      expect(interpretItem({
        text: '2 pacs of 50g of Amul butter',
        locale: 'en-IN',
        countryCode: 'IN',
        source,
      })).toEqual({
        captureText: '2 pacs of 50g of Amul butter',
        itemName: 'Amul butter',
        identityKey: 'amul butter',
        quantity: 2,
        unit: 'pack',
        packageSize: 50,
        packageUnit: 'g',
      });
    },
  );

  it('consumes the connector after a recognized leading count and container', async () => {
    const { interpretItem } = await import('./index.js');

    expect(interpretItem({
      text: '2 pacs of biscuits',
      locale: 'en-IN',
      countryCode: 'IN',
      source: 'text',
    })).toMatchObject({
      itemName: 'biscuits',
      identityKey: 'biscuits',
      quantity: 2,
      unit: 'pack',
      packageSize: null,
      packageUnit: null,
    });
  });

  it('accepts an omitted connector between a leading container and package size', async () => {
    const { interpretItem } = await import('./index.js');

    expect(interpretItem({
      text: '2 packs 50g of Amul butter',
      locale: 'en-IN',
      countryCode: 'IN',
      source: 'text',
    })).toMatchObject({
      itemName: 'Amul butter',
      quantity: 2,
      unit: 'pack',
      packageSize: 50,
      packageUnit: 'g',
    });
  });

  it('consumes each in a leading count-container-size phrase', async () => {
    const { interpretItem } = await import('./index.js');

    expect(interpretItem({
      text: '2 packs of 50g each of Amul butter',
      locale: 'en-IN',
      countryCode: 'IN',
      source: 'voice',
    })).toMatchObject({
      itemName: 'Amul butter',
      quantity: 2,
      unit: 'pack',
      packageSize: 50,
      packageUnit: 'g',
    });
  });

  it('removes a conversational command prefix without losing the original capture', async () => {
    const { interpretItem } = await import('./index.js');

    expect(interpretItem({
      text: 'I need 2 packs of Amul Butter 500 g',
      locale: 'en-IN',
      countryCode: 'IN',
      source: 'voice',
    })).toEqual({
      captureText: 'I need 2 packs of Amul Butter 500 g',
      itemName: 'Amul Butter',
      identityKey: 'amul butter',
      quantity: 2,
      unit: 'pack',
      packageSize: 500,
      packageUnit: 'g',
    });
  });

  it.each([
    'Formula 1',
    'Vitamin B12 tablets',
    '7UP 2L',
    'milk for 2 days',
    'box of memories',
    'Half and Half',
    'Quarter Pounder',
    'One Direction album',
    'Of Mice and Men',
  ])('keeps ambiguous product wording as the item name: %s', async (text) => {
    const { interpretItem } = await import('./index.js');

    expect(interpretItem({ text, locale: 'en-IN', countryCode: 'IN', source: 'api' }))
      .toMatchObject({
        itemName: text,
        quantity: null,
        unit: null,
        packageSize: null,
        packageUnit: null,
      });
  });

  it('applies the leading-container grammar to unknown item names and plural units', async () => {
    const { interpretItem } = await import('./index.js');

    expect(interpretItem({
      text: '3 bottles of स्थानीय juice 750 ml',
      locale: 'en-IN',
      countryCode: 'IN',
      source: 'text',
    })).toMatchObject({
      itemName: 'स्थानीय juice',
      quantity: 3,
      unit: 'bottle',
      packageSize: 750,
      packageUnit: 'ml',
    });
  });

  it('understands package size before the item and container count', async () => {
    const { interpretItem } = await import('./index.js');

    expect(interpretItem({
      text: '500 g Amul Butter, 2 packs',
      locale: 'en-IN',
      countryCode: 'IN',
      source: 'text',
    })).toMatchObject({
      itemName: 'Amul Butter',
      quantity: 2,
      unit: 'pack',
      packageSize: 500,
      packageUnit: 'g',
    });
  });

  it('consumes of between a leading package size and the item name', async () => {
    const { interpretItem } = await import('./index.js');

    expect(interpretItem({
      text: '100 grams of Amul butter 1 pac',
      locale: 'en-IN',
      countryCode: 'IN',
      source: 'text',
    })).toEqual({
      captureText: '100 grams of Amul butter 1 pac',
      itemName: 'Amul butter',
      identityKey: 'amul butter',
      quantity: 1,
      unit: 'pack',
      packageSize: 100,
      packageUnit: 'g',
    });
  });

  it('understands a punctuated item followed by count of package size', async () => {
    const { interpretItem } = await import('./index.js');

    expect(interpretItem({
      text: 'Amul Butter - 2 packs of 500g',
      locale: 'en-IN',
      countryCode: 'IN',
      source: 'text',
    })).toMatchObject({
      itemName: 'Amul Butter',
      quantity: 2,
      unit: 'pack',
      packageSize: 500,
      packageUnit: 'g',
    });
  });

  it.each([
    ['1 pack Amul Butter 500 g', 'Amul Butter', 1, 'pack', 500, 'g'],
    ['Amul Butter, 2 packs, 500 g each', 'Amul Butter', 2, 'pack', 500, 'g'],
    ['2 500 g packs of Amul Butter', 'Amul Butter', 2, 'pack', 500, 'g'],
    ['Amul Butter 2 x 500 g', 'Amul Butter', 2, 'pack', 500, 'g'],
    ['Amul Butter 500 g x 2', 'Amul Butter', 2, 'pack', 500, 'g'],
    ['2 × 500 g Amul Butter', 'Amul Butter', 2, 'pack', 500, 'g'],
    ['one bottle of olive oil, 750 ml', 'olive oil', 1, 'bottle', 750, 'ml'],
    ['Coke 6 cans of 330 ml each', 'Coke', 6, 'can', 330, 'ml'],
    ['6 cans Coke 330 ml', 'Coke', 6, 'can', 330, 'ml'],
    ['please add two cartons of milk 1 litre each', 'milk', 2, 'carton', 1, 'l'],
    ['Amul Butter (500 g) x 2 packs', 'Amul Butter', 2, 'pack', 500, 'g'],
    ['500 g pack of Amul Butter', 'Amul Butter', 1, 'pack', 500, 'g'],
    ['a 500 g pack of Amul Butter', 'Amul Butter', 1, 'pack', 500, 'g'],
    ['Amul Butter 500 g pack', 'Amul Butter', 1, 'pack', 500, 'g'],
    ['Amul Butter 500 g pack of 2', 'Amul Butter', 2, 'pack', 500, 'g'],
    ['Amul Butter 500 g, pack of 2', 'Amul Butter', 2, 'pack', 500, 'g'],
    ['6x330ml cans of Coke', 'Coke', 6, 'can', 330, 'ml'],
    ['Coke 330ml cans x 6', 'Coke', 6, 'can', 330, 'ml'],
    ['2 packs (500 g each) Amul Butter', 'Amul Butter', 2, 'pack', 500, 'g'],
    ['mineral water 2 bottles 1.5L each', 'mineral water', 2, 'bottle', 1.5, 'l'],
    ['2 bottles mineral water 1.5L each', 'mineral water', 2, 'bottle', 1.5, 'l'],
    ['Amul Butter 2pk 500g', 'Amul Butter', 2, 'pack', 500, 'g'],
    ['Amul Butter 500g 2pk', 'Amul Butter', 2, 'pack', 500, 'g'],
    ['2 trays of eggs 30 pcs each', 'eggs', 2, 'tray', 30, 'piece'],
    ['3 pouches tomato puree 200g each', 'tomato puree', 3, 'pouch', 200, 'g'],
    ['1 jar coffee 100 g', 'coffee', 1, 'jar', 100, 'g'],
    ['2 loaves bread 400g each', 'bread', 2, 'loaf', 400, 'g'],
    ['2 tubs yoghurt 500 g', 'yoghurt', 2, 'tub', 500, 'g'],
    ['one pack of eggs 1 dozen', 'eggs', 1, 'pack', 1, 'dozen'],
  ])(
    'understands a common packaged-item phrasing: %s',
    async (text, itemName, quantity, unit, packageSize, packageUnit) => {
      const { interpretItem } = await import('./index.js');
      expect(interpretItem({ text, locale: 'en-IN', countryCode: 'IN', source: 'api' }))
        .toMatchObject({ itemName, quantity, unit, packageSize, packageUnit });
    },
  );

  it.each([
    ['2L milk', 'milk', 2, 'l'],
    ['milk 2L', 'milk', 2, 'l'],
    ['half kg onions', 'onions', 0.5, 'kg'],
    ['a dozen eggs', 'eggs', 1, 'dozen'],
    ['1/2 kg onions', 'onions', 0.5, 'kg'],
    ['two and a half kg rice', 'rice', 2.5, 'kg'],
    ['quarter kilo onions', 'onions', 0.25, 'kg'],
    ['4 rolls kitchen towel', 'kitchen towel', 4, 'roll'],
    ['1 bunch bananas', 'bananas', 1, 'bunch'],
    ['3 pairs socks', 'socks', 3, 'pair'],
    ['4 bars soap', 'soap', 4, 'bar'],
  ])(
    'understands a common single-quantity phrasing: %s',
    async (text, itemName, quantity, unit) => {
      const { interpretItem } = await import('./index.js');
      expect(interpretItem({ text, locale: 'en-IN', countryCode: 'IN', source: 'text' }))
        .toMatchObject({ itemName, quantity, unit, packageSize: null, packageUnit: null });
    },
  );

  it('removes structured details duplicated in the editable item name', async () => {
    const { reconcileItemCorrection } = await import('./index.js');

    expect(reconcileItemCorrection({
      captureText: 'Britannia 50-50 biscuit 1 pack',
      itemName: 'Britannia 50-50 biscuit 1 pack',
      quantity: 1,
      unit: 'pack',
      packageSize: null,
      packageUnit: null,
      locale: 'en-IN',
      countryCode: 'IN',
      source: 'text',
    })).toEqual({
      captureText: 'Britannia 50-50 biscuit 1 pack',
      itemName: 'Britannia 50-50 biscuit',
      identityKey: 'britannia 50-50 biscuit',
      quantity: 1,
      unit: 'pack',
      packageSize: null,
      packageUnit: null,
    });
  });

  it('refuses to guess when editable item text conflicts with structured details', async () => {
    const { ItemCorrectionConflictError, reconcileItemCorrection } = await import('./index.js');

    expect(() => reconcileItemCorrection({
      captureText: 'Britannia 50-50 biscuit 2 packs',
      itemName: 'Britannia 50-50 biscuit 2 packs',
      quantity: 1,
      unit: 'pack',
      packageSize: null,
      packageUnit: null,
      locale: 'en-IN',
      countryCode: 'IN',
      source: 'api',
    })).toThrow(ItemCorrectionConflictError);
  });

  it('transitions an active item through recoverable removal and restoration', async () => {
    const { transitionItem } = await import('./index.js');
    const removedAt = '2026-08-06T00:00:00.000Z';

    const removed = transitionItem({ status: 'active', removedAt: null }, 'remove', removedAt);
    expect(removed).toEqual({ status: 'removed', removedAt });
    expect(transitionItem(removed, 'restore', '2026-08-06T00:01:00.000Z'))
      .toEqual({ status: 'active', removedAt: null });
  });
});
