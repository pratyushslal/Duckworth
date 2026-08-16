import type { ShoppingItemSort } from './shopping-item-sort';

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

interface StoredListPreferences {
  version: 1;
  householdId: string;
  deviceProfileId: string;
  sort: ShoppingItemSort;
}

const SORT_MODES: readonly ShoppingItemSort[] = ['latest', 'oldest', 'name-asc', 'attention'];

export class ListPreferences {
  constructor(
    private readonly storage: StorageLike,
    private readonly deviceProfileId: string,
  ) {}

  storageKey(householdId: string): string {
    return `duckworth:list-preferences:v1:${encodeURIComponent(householdId)}:${encodeURIComponent(this.deviceProfileId)}`;
  }

  readSort(householdId: string): ShoppingItemSort {
    try {
      const raw = this.storage.getItem(this.storageKey(householdId));
      if (!raw) return 'latest';
      const parsed: unknown = JSON.parse(raw);
      if (!this.isStoredPreferences(parsed, householdId)) return 'latest';
      return parsed.sort;
    } catch {
      return 'latest';
    }
  }

  writeSort(householdId: string, sort: ShoppingItemSort): void {
    const value: StoredListPreferences = {
      version: 1,
      householdId,
      deviceProfileId: this.deviceProfileId,
      sort,
    };
    try {
      this.storage.setItem(this.storageKey(householdId), JSON.stringify(value));
    } catch {
      // List ordering remains usable for the session when persistence is unavailable.
    }
  }

  private isStoredPreferences(value: unknown, householdId: string): value is StoredListPreferences {
    if (!value || typeof value !== 'object') return false;
    const candidate = value as Partial<StoredListPreferences>;
    return candidate.version === 1
      && candidate.householdId === householdId
      && candidate.deviceProfileId === this.deviceProfileId
      && SORT_MODES.includes(candidate.sort as ShoppingItemSort);
  }
}
