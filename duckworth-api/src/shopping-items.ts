import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { normalizeItemName, type CaptureInterpretation } from '@duckworth/item-capture';

const CREATE_SHOPPING_ITEMS_TABLE = `
  CREATE TABLE IF NOT EXISTS shopping_items (
    id TEXT PRIMARY KEY,
    household_id TEXT NOT NULL,
    capture_text TEXT NOT NULL,
    name TEXT NOT NULL,
    normalized_name TEXT NOT NULL,
    quantity REAL CHECK (quantity > 0 OR quantity IS NULL),
    unit TEXT,
    unit_source TEXT CHECK (unit_source IN ('explicit', 'history') OR unit_source IS NULL),
    unit_confirmed_at TEXT,
    status TEXT NOT NULL CHECK (status IN ('active', 'purchased')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1
  ) STRICT;
`;

export type ShoppingItemStatus = 'active' | 'purchased';
export type ShoppingItemUnitSource = 'explicit' | 'history';
export type ShoppingItemAttentionReason = 'missing_quantity' | 'unconfirmed_historical_unit';

export interface ShoppingItem {
  id: string;
  householdId: string;
  captureText: string;
  name: string;
  quantity: number | null;
  unit: string | null;
  unitSource: ShoppingItemUnitSource | null;
  unitConfirmedAt: string | null;
  attentionReasons: ShoppingItemAttentionReason[];
  status: ShoppingItemStatus;
  createdAt: string;
  updatedAt: string;
  version: number;
}

interface ShoppingItemRow {
  id: string;
  household_id: string;
  capture_text: string;
  name: string;
  quantity: number | null;
  unit: string | null;
  unit_source: ShoppingItemUnitSource | null;
  unit_confirmed_at: string | null;
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
  constructor(
    private readonly database: DatabaseSync,
    private readonly clock: () => Date = () => new Date(),
  ) {
    this.database.exec(CREATE_SHOPPING_ITEMS_TABLE);
    const columns = this.database.prepare('PRAGMA table_info(shopping_items)').all() as Array<{ name: string }>;
    if (!columns.some((column) => column.name === 'capture_text')) {
      this.migrateLegacySchema(columns);
    }
    this.database.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS shopping_items_active_name_unique
      ON shopping_items (household_id, normalized_name)
      WHERE status = 'active';
    `);
  }

  private migrateLegacySchema(columns: Array<{ name: string }>): void {
    const names = new Set(columns.map((column) => column.name));
    const expression = (column: string, fallback: string) => names.has(column) ? column : fallback;
    this.database.exec('BEGIN IMMEDIATE');
    try {
      this.database.exec('ALTER TABLE shopping_items RENAME TO shopping_items_legacy');
      this.database.exec(CREATE_SHOPPING_ITEMS_TABLE);
      this.database.exec(`
        INSERT INTO shopping_items
          (id, household_id, capture_text, name, normalized_name, quantity, unit, unit_source,
           unit_confirmed_at, status, created_at, updated_at, version)
        SELECT
          id,
          household_id,
          ${expression('capture_text', 'name')},
          name,
          normalized_name,
          ${expression('quantity', 'NULL')},
          ${expression('unit', 'NULL')},
          ${expression('unit_source', 'NULL')},
          ${expression('unit_confirmed_at', 'NULL')},
          status,
          created_at,
          updated_at,
          ${expression('version', '1')}
        FROM shopping_items_legacy;
        DROP TABLE shopping_items_legacy;
        COMMIT;
      `);
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  listActive(householdId: string, includePurchased = false): ShoppingItem[] {
    const statusFilter = includePurchased ? '' : "AND status = 'active'";
    const rows = this.database
      .prepare(
        `SELECT id, household_id, capture_text, name, quantity, unit, unit_source, unit_confirmed_at,
                status, created_at, updated_at, version
         FROM shopping_items
         WHERE household_id = ? ${statusFilter}
         ORDER BY created_at ASC`,
      )
      .all(householdId) as unknown as ShoppingItemRow[];
    return rows.map(toShoppingItem);
  }

  create(householdId: string, capture: CaptureInterpretation, confirmedUnit?: string): ShoppingItem {
    const now = this.clock().toISOString();
    const normalizedName = normalizeName(capture.name);
    const explicitUnit = confirmedUnit?.trim() ?? capture.unit;
    const historicalUnit = explicitUnit === null
      ? this.findLatestConfirmedUnit(householdId, normalizedName)
      : null;
    const unit = explicitUnit ?? historicalUnit;
    const unitSource = explicitUnit !== null ? 'explicit' as const : historicalUnit !== null ? 'history' as const : null;
    const item = {
      id: randomUUID(),
      householdId,
      captureText: capture.captureText,
      name: capture.name,
      normalizedName,
      quantity: capture.quantity,
      unit,
      unitSource,
      unitConfirmedAt: unitSource === 'explicit' ? now : null,
      attentionReasons: attentionReasonsForFields('active', capture.quantity, unitSource),
      status: 'active' as const,
      createdAt: now,
      updatedAt: now,
      version: 1,
    };

    try {
      this.database
        .prepare(
          `INSERT INTO shopping_items
           (id, household_id, capture_text, name, normalized_name, quantity, unit, unit_source,
            unit_confirmed_at, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          item.id,
          item.householdId,
          item.captureText,
          item.name,
          item.normalizedName,
          item.quantity,
          item.unit,
          item.unitSource,
          item.unitConfirmedAt,
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

  private findLatestConfirmedUnit(householdId: string, normalizedName: string): string | null {
    const row = this.database.prepare(
      `SELECT unit FROM shopping_items
       WHERE household_id = ? AND normalized_name = ?
         AND unit IS NOT NULL AND unit_source = 'explicit' AND unit_confirmed_at IS NOT NULL
       ORDER BY unit_confirmed_at DESC, created_at DESC, id DESC
       LIMIT 1`,
    ).get(householdId, normalizedName) as { unit: string } | undefined;
    return row?.unit ?? null;
  }

  update(
    householdId: string,
    itemId: string,
    patch: {
      name?: string;
      status?: ShoppingItemStatus;
      quantity?: number | null;
      confirmedUnit?: string | null;
    },
    expectedVersion: number,
  ): ShoppingItem | undefined {
    const updatedAt = this.clock().toISOString();
    const fields: string[] = [];
    const values: Array<string | number | null> = [];
    if (patch.name !== undefined) {
      fields.push('name = ?', 'normalized_name = ?');
      values.push(patch.name.trim(), normalizeName(patch.name));
    }
    if (patch.status !== undefined) {
      fields.push('status = ?');
      values.push(patch.status);
    }
    if (patch.quantity !== undefined) {
      fields.push('quantity = ?');
      values.push(patch.quantity);
    }
    if (patch.confirmedUnit !== undefined) {
      fields.push('unit = ?', 'unit_source = ?', 'unit_confirmed_at = ?');
      if (patch.confirmedUnit === null) {
        values.push(null, null, null);
      } else {
        values.push(patch.confirmedUnit.trim(), 'explicit', updatedAt);
      }
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
      `SELECT id, household_id, capture_text, name, quantity, unit, unit_source, unit_confirmed_at,
              status, created_at, updated_at, version
       FROM shopping_items WHERE id = ? AND household_id = ?`,
    ).get(itemId, householdId) as unknown as ShoppingItemRow | undefined;
    return row ? toShoppingItem(row) : undefined;
  }

  close(): void {
    this.database.close();
  }
}

export function normalizeName(name: string): string {
  return normalizeItemName(name);
}

function toShoppingItem(row: ShoppingItemRow): ShoppingItem {
  return {
    id: row.id,
    householdId: row.household_id,
    captureText: row.capture_text,
    name: row.name,
    quantity: row.quantity,
    unit: row.unit,
    unitSource: row.unit_source,
    unitConfirmedAt: row.unit_confirmed_at,
    attentionReasons: attentionReasonsForFields(row.status, row.quantity, row.unit_source),
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    version: row.version,
  };
}

function attentionReasonsForFields(
  status: ShoppingItemStatus,
  quantity: number | null,
  unitSource: ShoppingItemUnitSource | null,
): ShoppingItemAttentionReason[] {
  if (status !== 'active') return [];
  const reasons: ShoppingItemAttentionReason[] = [];
  if (quantity === null) reasons.push('missing_quantity');
  if (unitSource === 'history') reasons.push('unconfirmed_historical_unit');
  return reasons;
}
