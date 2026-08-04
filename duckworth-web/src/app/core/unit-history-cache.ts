import { normalizeItemName } from '@duckworth/item-capture';
import type { ShoppingItem } from './shopping-items.service';

export interface UnitHistoryRecord {
  unit: string;
  confirmedAt: string;
}

export type UnitHistoryMap = Record<string, UnitHistoryRecord>;

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

interface StoredUnitHistory {
  version: 1;
  householdId: string;
  units: UnitHistoryMap;
}

export class UnitHistoryCache {
  constructor(private readonly storage: StorageLike) {}

  storageKey(householdId: string): string {
    return `duckworth:unit-history:v1:${encodeURIComponent(householdId)}`;
  }

  read(householdId: string): UnitHistoryMap {
    try {
      const raw = this.storage.getItem(this.storageKey(householdId));
      if (!raw) return {};
      const parsed: unknown = JSON.parse(raw);
      if (!this.isStoredHistory(parsed, householdId)) return {};
      return parsed.units;
    } catch {
      return {};
    }
  }

  replaceFromItems(householdId: string, items: ShoppingItem[]): UnitHistoryMap {
    const units: UnitHistoryMap = {};
    for (const item of items) {
      if (item.householdId !== householdId || item.unitSource !== 'explicit' || !item.unit || !item.unitConfirmedAt) continue;
      const name = normalizeItemName(item.name);
      const existing = units[name];
      if (!existing || item.unitConfirmedAt > existing.confirmedAt) {
        units[name] = { unit: item.unit, confirmedAt: item.unitConfirmedAt };
      }
    }
    this.write(householdId, units);
    return units;
  }

  mergeExplicitItem(householdId: string, item: ShoppingItem): UnitHistoryMap {
    const units = this.read(householdId);
    if (item.householdId !== householdId || item.unitSource !== 'explicit' || !item.unit || !item.unitConfirmedAt) return units;
    const name = normalizeItemName(item.name);
    const existing = units[name];
    if (!existing || item.unitConfirmedAt > existing.confirmedAt) {
      units[name] = { unit: item.unit, confirmedAt: item.unitConfirmedAt };
      this.write(householdId, units);
    }
    return units;
  }

  private write(householdId: string, units: UnitHistoryMap): void {
    const value: StoredUnitHistory = { version: 1, householdId, units };
    try {
      this.storage.setItem(this.storageKey(householdId), JSON.stringify(value));
    } catch {
      // Storage is advisory; quota/privacy failures must not affect list use.
    }
  }

  private isStoredHistory(value: unknown, householdId: string): value is StoredUnitHistory {
    if (!value || typeof value !== 'object') return false;
    const candidate = value as Partial<StoredUnitHistory>;
    if (candidate.version !== 1 || candidate.householdId !== householdId || !candidate.units || typeof candidate.units !== 'object') return false;
    return Object.entries(candidate.units).every(([name, record]) => {
      if (!name || !record || typeof record !== 'object') return false;
      const entry = record as Partial<UnitHistoryRecord>;
      return typeof entry.unit === 'string' && entry.unit.length > 0
        && typeof entry.confirmedAt === 'string' && entry.confirmedAt.length > 0;
    });
  }
}
