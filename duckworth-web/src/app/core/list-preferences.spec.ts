import { describe, expect, it } from 'vitest';
import { ListPreferences } from './list-preferences';

class FakeStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

describe('ListPreferences', () => {
  it('falls back to Latest added for absent, malformed, or unknown stored data', () => {
    const storage = new FakeStorage();
    const preferences = new ListPreferences(storage, 'device-a');

    expect(preferences.readSort('household-a')).toBe('latest');

    storage.setItem(preferences.storageKey('household-a'), '{broken');
    expect(preferences.readSort('household-a')).toBe('latest');

    storage.setItem(preferences.storageKey('household-a'), JSON.stringify({
      version: 1,
      householdId: 'household-a',
      deviceProfileId: 'device-a',
      sort: 'newest-ish',
    }));
    expect(preferences.readSort('household-a')).toBe('latest');
  });

  it('persists a valid sort only for the same household and device profile', () => {
    const storage = new FakeStorage();
    const deviceA = new ListPreferences(storage, 'device-a');

    deviceA.writeSort('household-a', 'name-asc');

    expect(new ListPreferences(storage, 'device-a').readSort('household-a')).toBe('name-asc');
    expect(deviceA.readSort('household-b')).toBe('latest');
    expect(new ListPreferences(storage, 'device-b').readSort('household-a')).toBe('latest');
  });
});
