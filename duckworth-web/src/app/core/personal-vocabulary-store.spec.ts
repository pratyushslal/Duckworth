import { describe, expect, it } from 'vitest';
import { PersonalVocabularyStore } from './personal-vocabulary-store';

class MemoryStorage {
  private readonly values = new Map<string, string>();
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, value); }
}

describe('PersonalVocabularyStore', () => {
  it('isolates device vocabulary by lane, instance, and household scope', () => {
    const storage = new MemoryStorage();
    const live = new PersonalVocabularyStore(storage, 'device-a', 'en-IN', { lane: 'live', instanceId: 'live-1', householdId: 'family' });
    const sandbox = new PersonalVocabularyStore(storage, 'device-a', 'en-IN', { lane: 'sandbox', instanceId: 'sandbox-1', householdId: 'family' });
    live.prefer('Maggi noodles');

    expect(sandbox.read().entries).toEqual([]);
    expect(live.storageKey()).not.toBe(sandbox.storageKey());
  });
  it('scopes preferred spellings, hidden redirects, and keep-separate suppressions by profile and locale', () => {
    const storage = new MemoryStorage();
    const store = new PersonalVocabularyStore(storage, 'profile-a', 'en-IN');

    store.prefer('biscuit', ['biscut']);
    store.keepSeparate('ramen', 'raman');

    expect(store.assistanceSnapshot().entries).toEqual([expect.objectContaining({
      text: 'biscuit', locale: 'en-IN', redirects: ['biscut'], kind: 'item',
    })]);
    expect(store.read().suppressions).toEqual([{ locale: 'en-IN', first: 'ramen', second: 'raman' }]);
    expect(store.read().entries).toEqual([expect.not.objectContaining({ redirects: expect.anything() })]);
    expect(store.read().entries.some((entry) => entry.text === 'biscut')).toBe(false);
    expect(new PersonalVocabularyStore(storage, 'profile-b', 'en-IN').read().entries).toEqual([]);
    expect(new PersonalVocabularyStore(storage, 'profile-a', 'hi-Latn-IN').read().entries).toEqual([]);
  });

  it('bounds raw observations by count and age without promoting them to display entries', () => {
    const storage = new MemoryStorage();
    const now = new Date('2026-08-05T00:00:00.000Z');
    const store = new PersonalVocabularyStore(storage, 'profile-a', 'en-IN', {
      now: () => now,
      maxObservations: 2,
      maxObservationAgeMs: 7 * 24 * 60 * 60 * 1000,
    });

    store.observe('too-old', new Date('2026-07-01T00:00:00.000Z'));
    store.observe('first', new Date('2026-08-03T00:00:00.000Z'));
    store.observe('second', new Date('2026-08-04T00:00:00.000Z'));
    store.observe('third', new Date('2026-08-05T00:00:00.000Z'));

    expect(store.read().observations).toEqual([
      { text: 'second', locale: 'en-IN' },
      { text: 'third', locale: 'en-IN' },
    ]);
    expect(store.read().entries).toEqual([]);
  });

  it('retains no observations when the configured count limit is zero', () => {
    const store = new PersonalVocabularyStore(new MemoryStorage(), 'profile-a', 'en-IN', {
      maxObservations: 0,
    });

    store.observe('biscut');

    expect(store.read().observations).toEqual([]);
  });

  it('skips invalid records individually and preserves valid personal records', () => {
    const storage = new MemoryStorage();
    const store = new PersonalVocabularyStore(storage, 'profile-a', 'en-IN');
    storage.setItem(store.storageKey(), JSON.stringify({
      version: 1,
      revision: 4,
      profileId: 'profile-a',
      locale: 'en-IN',
      entries: [
        { text: 'atta', redirects: ['aata'] },
        { text: 42, redirects: [] },
      ],
      observations: [
        { text: 'biscut', observedAt: '2026-08-04T00:00:00.000Z' },
        { text: null, observedAt: 'yesterday' },
      ],
      suppressions: [
        { first: 'ramen', second: 'raman' },
        { first: '', second: 7 },
      ],
    }));

    const snapshot = store.read();
    expect(snapshot.entries.map((entry) => entry.text)).toEqual(['atta']);
    expect(snapshot.observations).toEqual([{ text: 'biscut', locale: 'en-IN' }]);
    expect(snapshot.suppressions).toEqual([{ locale: 'en-IN', first: 'ramen', second: 'raman' }]);
    expect(snapshot.diagnostics.skippedRecords).toBe(3);
  });

  it('allows a dismissed pair only after new evidence and the cooldown', () => {
    let now = new Date('2026-08-05T00:00:00.000Z');
    const store = new PersonalVocabularyStore(new MemoryStorage(), 'profile-a', 'en-IN', { now: () => now });
    store.observe('biscut');
    store.observe('biscuit');
    const pair = { earlier: 'biscut', later: 'biscuit', locale: 'en-IN', confidence: 0.85 };

    store.dismiss(pair);
    expect(store.canPrompt(pair)).toBe(false);
    now = new Date('2026-08-20T00:00:00.000Z');
    expect(store.canPrompt(pair)).toBe(false);
    store.observe('biscuit');
    expect(store.canPrompt(pair)).toBe(true);
  });
});
