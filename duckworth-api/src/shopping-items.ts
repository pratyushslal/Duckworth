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
  version: number;
}

interface ShoppingItemRow {
  id: string;
  household_id: string;
  name: string;
  status: ShoppingItemStatus;
  created_at: string;
  updated_at: string;
  version: number;
}

export class DuplicateShoppingItemError extends Error {
  constructor(readonly existingItemId: string) {
    super('An item with this name is already active in the household');
  }
}

export class ItemVersionConflictError extends Error {
  constructor(readonly currentItem: ShoppingItem) {
    super('The shopping item changed since it was loaded');
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
        version INTEGER NOT NULL DEFAULT 1,
        UNIQUE (household_id, normalized_name, status)
      ) STRICT;
    `);
    const columns = this.database.prepare('PRAGMA table_info(shopping_items)').all() as Array<{ name: string }>;
    if (!columns.some((column) => column.name === 'version')) {
      this.database.exec('ALTER TABLE shopping_items ADD COLUMN version INTEGER NOT NULL DEFAULT 1');
    }
  }

  listActive(householdId: string, includePurchased = false): ShoppingItem[] {
    const statusFilter = includePurchased ? '' : "AND status = 'active'";
    const rows = this.database
      .prepare(
        `SELECT id, household_id, name, status, created_at, updated_at, version
         FROM shopping_items
         WHERE household_id = ? ${statusFilter}
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
      version: 1,
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

  update(
    householdId: string,
    itemId: string,
    patch: { name?: string; status?: ShoppingItemStatus },
    expectedVersion: number,
  ): ShoppingItem | undefined {
    const updatedAt = new Date().toISOString();
    const fields: string[] = [];
    const values: Array<string | number> = [];
    if (patch.name !== undefined) {
      fields.push('name = ?', 'normalized_name = ?');
      values.push(patch.name.trim(), normalizeName(patch.name));
    }
    if (patch.status !== undefined) {
      fields.push('status = ?');
      values.push(patch.status);
    }
    fields.push('updated_at = ?', 'version = version + 1');
    values.push(updatedAt, itemId, householdId, expectedVersion);
    let result: { changes: number };
    try {
      result = this.database
        .prepare(
          `UPDATE shopping_items SET ${fields.join(', ')}
           WHERE id = ? AND household_id = ? AND version = ?`,
        )
        .run(...values) as { changes: number };
    } catch (error) {
      if (error instanceof Error && error.message.includes('UNIQUE constraint failed') && patch.name !== undefined) {
        const existing = this.database.prepare(
          `SELECT id FROM shopping_items
           WHERE household_id = ? AND normalized_name = ? AND status = 'active' AND id <> ?`,
        ).get(householdId, normalizeName(patch.name), itemId) as { id: string } | undefined;
        if (existing) throw new DuplicateShoppingItemError(existing.id);
      }
      throw error;
    }
    if (Number(result.changes) === 0) {
      const current = this.get(householdId, itemId);
      if (current && current.version !== expectedVersion) throw new ItemVersionConflictError(current);
      return undefined;
    }

    return this.get(householdId, itemId);
  }

  private get(householdId: string, itemId: string): ShoppingItem | undefined {
    const row = this.database.prepare(
      `SELECT id, household_id, name, status, created_at, updated_at, version
       FROM shopping_items WHERE id = ? AND household_id = ?`,
    ).get(itemId, householdId) as unknown as ShoppingItemRow | undefined;
    return row ? toShoppingItem(row) : undefined;
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
    version: row.version,
  };
}
