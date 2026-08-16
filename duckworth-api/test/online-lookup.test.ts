import { describe, expect, it } from 'vitest';
import { OnlineLookupRegistry, type OnlineLookupProvider } from '../src/online-lookup.js';

const request = { phrase: 'telma', locale: 'en-IN', countryCode: 'IN', trigger: 'manual' as const };

describe('online lookup registry', () => {
  it('uses the first available provider and keeps the result advisory', async () => {
    const provider: OnlineLookupProvider = {
      id: 'test-catalog', available: true,
      lookup: async () => ({ itemName: 'Telma', quantity: null, unit: null, measures: [], attributes: {}, rationale: 'catalog match' }),
    };
    const registry = new OnlineLookupRegistry([provider]);
    await expect(registry.lookup(request)).resolves.toEqual(expect.objectContaining({
      providerId: 'test-catalog', candidate: expect.objectContaining({ itemName: 'Telma' }),
    }));
  });

  it('fails closed after repeated provider failures without throwing into capture', async () => {
    let now = 0;
    const provider: OnlineLookupProvider = { id: 'slow', available: true, lookup: async () => { throw new Error('offline'); } };
    const registry = new OnlineLookupRegistry([provider], () => now, 1);
    await registry.lookup(request);
    await registry.lookup(request);
    await registry.lookup(request);
    now = 1;
    await expect(registry.lookup(request)).resolves.toBeNull();
  });

  it('isolates a tripped provider circuit so another configured provider remains available', async () => {
    const failed: OnlineLookupProvider = { id: 'failed', available: true, lookup: async () => { throw new Error('offline'); } };
    const fallback: OnlineLookupProvider = {
      id: 'fallback', available: true,
      lookup: async () => ({ itemName: 'Telma', quantity: null, unit: null, measures: [], attributes: {}, rationale: 'fallback match' }),
    };
    const registry = new OnlineLookupRegistry([failed, fallback]);

    await expect(registry.lookup(request)).resolves.toMatchObject({ providerId: 'fallback' });
    await expect(registry.lookup(request)).resolves.toMatchObject({ providerId: 'fallback' });
    await expect(registry.lookup(request)).resolves.toMatchObject({ providerId: 'fallback' });
    await expect(registry.lookup(request)).resolves.toMatchObject({ providerId: 'fallback' });
  });
});
