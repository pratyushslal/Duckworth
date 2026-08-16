import { describe, expect, it } from 'vitest';
import { LanguagePreferences } from './language-preferences';
import {
  InMemoryLanguagePackStorage,
  LanguagePackRepository,
  type LanguagePackBundle,
} from './language-pack-repository';

class MemoryStorage {
  private readonly values = new Map<string, string>();
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, value); }
}

const hinglishPack: LanguagePackBundle = {
  schemaVersion: 1,
  checksum: 'sha256:2222222222222222222222222222222222222222222222222222222222222222',
  locale: 'hi-Latn-IN',
  version: '2026.08.05.1',
  fallbacks: ['en-IN'],
  ui: { greeting: 'Namaste' },
  items: [{ id: 'flour', primary: 'atta', aliases: ['aata'], category: 'staples', compatibleUnits: ['kg'] }],
  units: [{ id: 'kg', primary: 'kg', aliases: ['kilo'] }],
};

describe('LanguagePreferences', () => {
  it('falls back to en-IN for absent, corrupt, unknown-version, or invalid preferences', () => {
    const storage = new MemoryStorage();
    const preferences = new LanguagePreferences(storage, 'device-a');
    expect(preferences.read()).toEqual({ activeLocale: 'en-IN', enabledLocales: ['en-IN'] });

    storage.setItem(preferences.storageKey(), '{broken');
    expect(new LanguagePreferences(storage, 'device-a').read()).toEqual({
      activeLocale: 'en-IN', enabledLocales: ['en-IN'],
    });

    storage.setItem(preferences.storageKey(), JSON.stringify({
      version: 2, deviceProfileId: 'device-a', activeLocale: 'hi-Latn-IN', enabledLocales: ['hi-Latn-IN'],
    }));
    expect(new LanguagePreferences(storage, 'device-a').read().activeLocale).toBe('en-IN');

    storage.setItem(preferences.storageKey(), JSON.stringify({
      version: 1, deviceProfileId: 'device-a', activeLocale: '../unsafe', enabledLocales: ['../unsafe'],
    }));
    expect(new LanguagePreferences(storage, 'device-a').read().activeLocale).toBe('en-IN');

    preferences.enable('hi-Latn-IN');
    preferences.setActive('hi-Latn-IN');
    storage.setItem(preferences.storageKey(), '{broken again');
    expect(preferences.read()).toEqual({ activeLocale: 'en-IN', enabledLocales: ['en-IN'] });
  });

  it('persists enabled and active locales only for the same device profile', () => {
    const storage = new MemoryStorage();
    const preferences = new LanguagePreferences(storage, 'device-a');

    preferences.enable('hi-Latn-IN');
    preferences.setActive('hi-Latn-IN');

    expect(new LanguagePreferences(storage, 'device-a').read()).toEqual({
      activeLocale: 'hi-Latn-IN', enabledLocales: ['en-IN', 'hi-Latn-IN'],
    });
    expect(new LanguagePreferences(storage, 'device-b').read()).toEqual({
      activeLocale: 'en-IN', enabledLocales: ['en-IN'],
    });
  });

  it('disables a locale for matching without deleting its validated cached artifact', async () => {
    const storage = new MemoryStorage();
    const preferences = new LanguagePreferences(storage, 'device-a');
    preferences.enable('hi-Latn-IN');
    preferences.setActive('hi-Latn-IN');

    const artifactStorage = new InMemoryLanguagePackStorage(hinglishPack);
    preferences.disable('hi-Latn-IN');

    expect(preferences.read()).toEqual({ activeLocale: 'en-IN', enabledLocales: ['en-IN'] });
    const repository = new LanguagePackRepository(artifactStorage);
    await repository.hydrate();
    expect(repository.active()).toEqual(hinglishPack);
  });
});
