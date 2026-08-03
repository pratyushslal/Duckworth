import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

export type ShoppingItemStatus = 'active' | 'purchased';

export interface ShoppingItem {
  id: string;
  householdId: string;
  name: string;
  status: ShoppingItemStatus;
  createdAt: string;
  updatedAt: string;
}

interface ShoppingItemRow {
  id: string;
  household_id: string;
  name: string;
  status: ShoppingItemStatus;
  created_at: string;
  updated_at: string;
}

export class DuplicateShoppingItemError extends Error {
  constructor(readonly existingItemId: string) {
    super('An item with this name is already active in the household');
  }
}

export class ShoppingItemRepository {
  constructor(private readonly database: DatabaseSync) {
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS shopping_items (
        id TEXT PRIMARY KEY,
        household_id TEXT NOT NULL,
        name TEXT NOT NULL,
        normalized_name TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('active', 'purchased')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (household_id, normalized_name, status)
      ) STRICT;
    `);
  }

  listActive(householdId: string): ShoppingItem[] {
    const rows = this.database
      .prepare(
        `SELECT id, household_id, name, status, created_at, updated_at
         FROM shopping_items
         WHERE household_id = ? AND status = 'active'
         ORDER BY created_at ASC`,
      )
      .all(householdId) as unknown as ShoppingItemRow[];
    return rows.map(toShoppingItem);
  }

  create(householdId: string, name: string): ShoppingItem {
    const now = new Date().toISOString();
    const item = {
      id: randomUUID(),
      householdId,
      name: name.trim(),
      normalizedName: normalizeName(name),
      status: 'active' as const,
      createdAt: now,
      updatedAt: now,
    };

    try {
      this.database
        .prepare(
          `INSERT INTO shopping_items
           (id, household_id, name, normalized_name, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          item.id,
          item.householdId,
          item.name,
          item.normalizedName,
          item.status,
          item.createdAt,
          item.updatedAt,
        );
    } catch (error) {
      if (error instanceof Error && error.message.includes('UNIQUE constraint failed')) {
        const existing = this.database
          .prepare(
            `SELECT id FROM shopping_items
             WHERE household_id = ? AND normalized_name = ? AND status = 'active'`,
          )
          .get(householdId, item.normalizedName) as { id: string } | undefined;
        if (existing) throw new DuplicateShoppingItemError(existing.id);
      }
      throw error;
    }

    return item;
  }

  updateStatus(householdId: string, itemId: string, status: ShoppingItemStatus): ShoppingItem | undefined {
    const updatedAt = new Date().toISOString();
    const result = this.database
      .prepare(
        `UPDATE shopping_items SET status = ?, updated_at = ?
         WHERE id = ? AND household_id = ?`,
      )
      .run(status, updatedAt, itemId, householdId);
    if (Number(result.changes) === 0) return undefined;

    const row = this.database
      .prepare(
        `SELECT id, household_id, name, status, created_at, updated_at
         FROM shopping_items WHERE id = ? AND household_id = ?`,
      )
      .get(itemId, householdId) as unknown as ShoppingItem | undefined;
    return row ? toShoppingItem(row as unknown as ShoppingItemRow) : undefined;
  }

  close(): void {
    this.database.close();
  }
}

export function normalizeName(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLocaleLowerCase();
}

function toShoppingItem(row: ShoppingItemRow): ShoppingItem {
  return {
    id: row.id,
    householdId: row.household_id,
    name: row.name,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
