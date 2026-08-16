describe('local assistance performance budget', () => {
  it('builds immutable indexes and keeps repeated lookup latency bounded', async () => {
    const { assistanceIndexStats, createAssistanceIndex, suggestSemantic } = await import('./index.js');
    const entries = Array.from({ length: 20_000 }, (_, index) => {
      const key = index.toString(36).padStart(4, '0');
      return {
        locale: 'en-IN',
        canonicalId: `synthetic.${key}`,
        text: `${key} household item`,
        aliases: [`${key} item`],
      };
    });
    const buildStart = performance.now();
    const index = createAssistanceIndex({ personal: [], household: [], regional: [], locale: entries });
    const buildMilliseconds = performance.now() - buildStart;
    const stats = assistanceIndexStats(index);
    expect(stats.records).toBe(entries.length);
    expect(stats.prefixBuckets).toBeGreaterThan(0);
    expect(stats.tokenBuckets).toBeGreaterThan(0);

    const samples: number[] = [];
    for (let run = 0; run < 100; run += 1) {
      const start = performance.now();
      const result = suggestSemantic(index, {
        input: `${run.toString(36).padStart(4, '0')} hou`,
        activeLocale: 'en-IN',
        enabledLocales: ['en-IN'],
      });
      expect(result.length).toBeGreaterThan(0);
      samples.push(performance.now() - start);
    }
    samples.sort((left, right) => left - right);
    const p95Milliseconds = samples[Math.floor(samples.length * 0.95)];
    // This is a regression budget for a mobile-sized local lookup, not a claim about all devices.
    expect(buildMilliseconds).toBeLessThan(5_000);
    expect(p95Milliseconds).toBeLessThan(50);
  });
});
