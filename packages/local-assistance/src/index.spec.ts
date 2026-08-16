describe('local assistance', () => {
  it('matches canonically equivalent Unicode while preserving the reviewed display label', async () => {
    const { createAssistanceIndex, suggest } = await import('./index.js');
    const index = createAssistanceIndex({
      personal: [],
      household: [],
      locale: [{
        canonicalId: 'grocery.cafe',
        locale: 'en-IN',
        text: 'Café',
        aliases: [],
      }],
    });

    expect(suggest(index, {
      input: 'Cafe\u0301',
      activeLocale: 'en-IN',
      enabledLocales: ['en-IN'],
    })).toEqual([{
      text: 'Café',
      source: 'active-locale',
      kind: 'completion',
      canonicalId: 'grocery.cafe',
    }]);
  });

  it('returns active-locale prefix completions and caps results at five', async () => {
    const { createAssistanceIndex, suggest } = await import('./index.js');
    const labels = ['biscuits', 'biscotti', 'biscuit crackers', 'bisc cream', 'biscuit sticks', 'biscuit bites'];
    const index = createAssistanceIndex({
      personal: [],
      household: [],
      locale: labels.map((text, index) => ({
        canonicalId: `grocery.biscuit.${index}`,
        locale: 'en-IN',
        text,
      })),
    });

    const results = suggest(index, {
      input: 'bisc',
      activeLocale: 'en-IN',
      enabledLocales: ['en-IN'],
    });

    expect(results).toHaveLength(5);
    expect(results.map(({ text }) => text)).toContain('biscuits');
  });

  it('returns a bounded item-span edit that preserves quantity and package text', async () => {
    const { createAssistanceIndex, suggestSemantic } = await import('./index.js');
    const index = createAssistanceIndex({
      personal: [],
      household: [],
      regional: [{
        canonicalId: 'product.maggi.noodles',
        productId: 'product.maggi.noodles',
        brandId: 'brand.maggi',
        conceptId: 'grocery.noodles',
        locale: 'en-IN',
        text: 'Maggi noodles',
        aliases: ['maggi noodles'],
        kind: 'item',
      }],
      locale: [],
    });

    expect(suggestSemantic(index, {
      input: 'maggie noo 2 packs of 70 g',
      activeLocale: 'en-IN',
      enabledLocales: ['en-IN'],
    })[0]).toMatchObject({
      text: 'Maggi noodles',
      replacement: { start: 0, end: 10, replacementText: 'Maggi noodles' },
      protectedSuffix: ' 2 packs of 70 g',
      productId: 'product.maggi.noodles',
    });
  });

  it('ranks personal, household, active-locale, then fallback-locale sources', async () => {
    const { createAssistanceIndex, suggest } = await import('./index.js');
    const index = createAssistanceIndex({
      personal: [{ locale: 'en-IN', text: 'biscuits personal' }],
      household: [{ locale: 'en-IN', text: 'biscuits household' }],
      locale: [
        { locale: 'hi-Latn-IN', text: 'biscuits fallback' },
        { locale: 'en-IN', text: 'biscuits active' },
      ],
    });

    expect(suggest(index, {
      input: 'bisc',
      activeLocale: 'en-IN',
      enabledLocales: ['en-IN', 'hi-Latn-IN'],
    }).map(({ source }) => source)).toEqual([
      'personal', 'household', 'active-locale', 'fallback-locale',
    ]);
  });

  it('lets an exact reviewed identity outrank a fuzzy unconfirmed personal spelling', async () => {
    const { createAssistanceIndex, suggest } = await import('./index.js');
    const result = suggest(createAssistanceIndex({
      personal: [{ locale: 'en-IN', text: 'maggie noodles' }],
      household: [],
      regional: [],
      locale: [{ locale: 'en-IN', text: 'Maggi noodles', canonicalId: 'product.maggi.noodles' }],
    }), { input: 'maggi noodles', activeLocale: 'en-IN', enabledLocales: ['en-IN'] });
    expect(result[0]).toMatchObject({ text: 'Maggi noodles', source: 'active-locale', canonicalId: 'product.maggi.noodles' });
  });

  it('suggests a reviewed regional product with its stable canonical identity', async () => {
    const { createAssistanceIndex, suggest } = await import('./index.js');
    const index = createAssistanceIndex({
      personal: [],
      household: [],
      regional: [{
        canonicalId: 'product.amul.butter',
        productId: 'product.amul.butter',
        brandId: 'brand.amul',
        conceptId: 'grocery.butter.dairy',
        locale: 'en-IN',
        text: 'Amul Butter',
        aliases: ['amul butter'],
        kind: 'item',
      }],
      locale: [],
    });

    expect(suggest(index, {
      input: 'amul', activeLocale: 'en-IN', enabledLocales: ['en-IN'],
    })).toEqual([{
      canonicalId: 'product.amul.butter',
      productId: 'product.amul.butter',
      brandId: 'brand.amul',
      conceptId: 'grocery.butter.dairy',
      text: 'Amul Butter',
      source: 'regional-product',
      kind: 'completion',
    }]);
  });

  it('completes numbers that belong to a reviewed product identity', async () => {
    const { createAssistanceIndex, suggest } = await import('./index.js');
    const index = createAssistanceIndex({
      personal: [],
      household: [],
      regional: [{
        canonicalId: 'product.britannia.50-50',
        productId: 'product.britannia.50-50',
        brandId: 'brand.britannia',
        conceptId: 'grocery.biscuits.plain',
        locale: 'en-IN',
        text: 'Britannia 50-50',
        aliases: [
          'britannia 50 50',
          '50-50',
          'britannia 50-50 biscuit',
          'britannia 50-50 biscuits',
        ],
        kind: 'item',
      }],
      locale: [],
    });

    expect(suggest(index, {
      input: 'Britannia 5', activeLocale: 'en-IN', enabledLocales: ['en-IN'],
    })).toEqual([{
      canonicalId: 'product.britannia.50-50',
      productId: 'product.britannia.50-50',
      brandId: 'brand.britannia',
      conceptId: 'grocery.biscuits.plain',
      text: 'Britannia 50-50',
      source: 'regional-product',
      kind: 'completion',
    }]);

    expect(suggest(index, {
      input: 'Britannia 50-50 biscuit', activeLocale: 'en-IN', enabledLocales: ['en-IN'],
    })[0]).toMatchObject({
      text: 'Britannia 50-50',
      productId: 'product.britannia.50-50',
      source: 'regional-product',
    });
  });

  it('ranks exact, prefix, then conservative fuzzy matches with stable ties', async () => {
    const { createAssistanceIndex, suggest } = await import('./index.js');
    const sources = {
      personal: [],
      household: [],
      locale: [
        { canonicalId: 'fuzzy', locale: 'en-IN', text: 'bisk' },
        { canonicalId: 'prefix-b', locale: 'en-IN', text: 'biscotti' },
        { canonicalId: 'exact', locale: 'en-IN', text: 'bisc' },
        { canonicalId: 'prefix-a', locale: 'en-IN', text: 'biscuits' },
      ],
    };
    const index = createAssistanceIndex(sources);
    const request = { input: 'bisc', activeLocale: 'en-IN', enabledLocales: ['en-IN'] };

    const first = suggest(index, request).map(({ canonicalId }) => canonicalId);
    const second = suggest(index, request).map(({ canonicalId }) => canonicalId);

    expect(first).toEqual(['exact', 'prefix-a', 'prefix-b', 'fuzzy']);
    expect(second).toEqual(first);
  });

  it('deduplicates normalized labels and preserves the strongest provenance', async () => {
    const { createAssistanceIndex, suggest } = await import('./index.js');
    const index = createAssistanceIndex({
      personal: [{ canonicalId: 'personal-biscuits', locale: 'en-IN', text: 'Biscuits' }],
      household: [{ canonicalId: 'household-biscuits', locale: 'en-IN', text: 'biscuits' }],
      locale: [{ canonicalId: 'official-biscuits', locale: 'en-IN', text: 'BISCUITS' }],
    });

    expect(suggest(index, {
      input: 'bisc',
      activeLocale: 'en-IN',
      enabledLocales: ['en-IN'],
    })).toEqual([{
      canonicalId: 'personal-biscuits',
      text: 'Biscuits',
      source: 'personal',
      kind: 'completion',
    }]);
  });

  it('completes only a trailing unit token and preserves the entered quantity', async () => {
    const { createAssistanceIndex, suggest } = await import('./index.js');
    const index = createAssistanceIndex({
      personal: [],
      household: [],
      locale: [{
        canonicalId: 'unit.piece',
        locale: 'en-IN',
        text: 'pcs',
        aliases: ['pc'],
        kind: 'unit',
      }],
    });

    expect(suggest(index, {
      input: 'biscuits 2 pc',
      activeLocale: 'en-IN',
      enabledLocales: ['en-IN'],
    })).toEqual([{
      canonicalId: 'unit.piece',
      text: 'biscuits 2 pcs',
      source: 'active-locale',
      kind: 'completion',
    }]);
  });

  it('never invents a quantity outside an explicitly confirmed history capture', async () => {
    const { createAssistanceIndex, suggest } = await import('./index.js');
    const index = createAssistanceIndex({
      personal: [],
      household: [{ locale: 'en-IN', text: 'atta 5 kg', kind: 'capture' }],
      locale: [{ locale: 'en-IN', text: 'biscuits 2 pcs', kind: 'item' }],
    });
    const request = { activeLocale: 'en-IN', enabledLocales: ['en-IN'] };

    expect(suggest(index, { ...request, input: 'bisc' })).toEqual([]);
    expect(suggest(index, { ...request, input: 'att' })).toEqual([{
      text: 'atta 5 kg',
      source: 'household',
      kind: 'history',
    }]);
  });

  it('matches exact personal and household text in unsupported and mixed scripts', async () => {
    const { createAssistanceIndex, suggest } = await import('./index.js');
    const index = createAssistanceIndex({
      personal: [{ locale: 'mr-IN', text: 'आटा' }],
      household: [{ locale: 'mr-IN', text: 'atta आटा' }],
      locale: [],
    });
    const request = { activeLocale: 'mr-IN', enabledLocales: ['mr-IN'] };

    expect(suggest(index, { ...request, input: 'आटा' })[0]).toMatchObject({
      text: 'आटा', source: 'personal',
    });
    expect(suggest(index, { ...request, input: 'atta आ' })[0]).toMatchObject({
      text: 'atta आटा', source: 'household',
    });
  });

  it('detects a conservative clarification candidate from a similar earlier observation', async () => {
    const { createAssistanceIndex, detectClarification } = await import('./index.js');
    const index = createAssistanceIndex({
      personal: [],
      household: [],
      locale: [],
      observations: [{ locale: 'en-IN', text: 'biscut' }],
    });

    const candidate = detectClarification(index, { locale: 'en-IN', text: 'biscuit' });

    expect(candidate).toMatchObject({
      earlier: 'biscut',
      later: 'biscuit',
      locale: 'en-IN',
    });
    expect(candidate?.confidence).toBeGreaterThan(0.8);
  });

  it('does not clarify short or numeric observations', async () => {
    const { createAssistanceIndex, detectClarification } = await import('./index.js');
    const shortIndex = createAssistanceIndex({
      personal: [], household: [], locale: [], observations: [{ locale: 'en-IN', text: 'cat' }],
    });
    const numericIndex = createAssistanceIndex({
      personal: [], household: [], locale: [], observations: [{ locale: 'en-IN', text: 'item2' }],
    });

    expect(detectClarification(shortIndex, { locale: 'en-IN', text: 'cut' })).toBeNull();
    expect(detectClarification(numericIndex, { locale: 'en-IN', text: 'item3' })).toBeNull();
  });

  it('does not clarify ambiguous or explicitly suppressed spelling pairs', async () => {
    const { createAssistanceIndex, detectClarification } = await import('./index.js');
    const ambiguous = createAssistanceIndex({
      personal: [],
      household: [],
      locale: [],
      observations: [
        { locale: 'en-IN', text: 'biscut' },
        { locale: 'en-IN', text: 'biscui' },
      ],
    });
    const suppressed = createAssistanceIndex({
      personal: [],
      household: [],
      locale: [],
      observations: [{ locale: 'en-IN', text: 'biscut' }],
      suppressions: [{ locale: 'en-IN', first: 'biscuit', second: 'biscut' }],
    });
    const later = { locale: 'en-IN', text: 'biscuit' };

    expect(detectClarification(ambiguous, later)).toBeNull();
    expect(detectClarification(suppressed, later)).toBeNull();
  });

  it('matches a private redirect while displaying only the preferred spelling', async () => {
    const { createAssistanceIndex, suggest } = await import('./index.js');
    const index = createAssistanceIndex({
      personal: [{ locale: 'en-IN', text: 'biscuit', redirects: ['biskoot'] }],
      household: [],
      locale: [],
    });

    expect(suggest(index, {
      input: 'biskoot', activeLocale: 'en-IN', enabledLocales: ['en-IN'],
    })).toEqual([{
      text: 'biscuit',
      source: 'personal',
      kind: 'correction',
    }]);
  });

  it('uses recent household confirmation before stable tie-breakers', async () => {
    const { createAssistanceIndex, suggest } = await import('./index.js');
    const index = createAssistanceIndex({
      personal: [],
      household: [
        {
          canonicalId: 'a-older', locale: 'en-IN', text: 'biscuits older',
          confirmedAt: '2026-08-01T00:00:00.000Z',
        },
        {
          canonicalId: 'z-newer', locale: 'en-IN', text: 'biscuits newer',
          confirmedAt: '2026-08-05T00:00:00.000Z',
        },
      ],
      locale: [],
    });

    expect(suggest(index, {
      input: 'bisc', activeLocale: 'en-IN', enabledLocales: ['en-IN'],
    }).map(({ canonicalId }) => canonicalId)).toEqual(['z-newer', 'a-older']);
  });
});
