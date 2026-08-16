import { DatabaseSync } from 'node:sqlite';
import { backupDatabase, type DatabaseBackupResult } from './database-backup.js';
import type { ApiLane } from './config.js';

export type DatabaseClassification = 'unassigned' | ApiLane;

export interface MigrationCollisionGroup {
  key: string;
  count: number;
}

export interface DatabaseImportDryRun {
  sourcePath: string;
  classification: DatabaseClassification;
  schemaVersion: number;
  lane: ApiLane | null;
  instanceId: string | null;
  householdIds: string[];
  tableCounts: Record<string, number>;
  activeItemCount: number;
  collisionGroups: MigrationCollisionGroup[];
  foreignKeyViolations: number;
  semanticSnapshotVersions: Record<string, number>;
  quarantinedRows: number;
  autoImport: false;
}

export interface QuarantineSnapshot {
  backup: DatabaseBackupResult;
  report: DatabaseImportDryRun;
}

export function dryRunDatabaseImport(databasePath: string): DatabaseImportDryRun {
  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const tableNames = database.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    ).all() as Array<{ name: string }>;
    const tableCounts: Record<string, number> = {};
    for (const table of tableNames) {
      const row = database.prepare(`SELECT COUNT(*) AS count FROM "${escapeIdentifier(table.name)}"`).get() as { count: number };
      tableCounts[table.name] = row.count;
    }
    const migrationRow = readOptional(database, 'SELECT MAX(version) AS version FROM schema_migrations') as { version: number | null } | undefined;
    const identity = readOptional(database, 'SELECT lane, instance_id FROM duckworth_runtime_identity WHERE id = 1') as {
      lane: ApiLane; instance_id: string;
    } | undefined;
    const households = tableCounts.shopping_items === undefined
      ? []
      : (database.prepare('SELECT DISTINCT household_id FROM shopping_items ORDER BY household_id').all() as Array<{ household_id: string }>).map((row) => row.household_id);
    const activeItemCount = tableCounts.shopping_items === undefined
      ? 0
      : (database.prepare("SELECT COUNT(*) AS count FROM shopping_items WHERE status = 'active'").get() as { count: number }).count;
    const collisions = tableCounts.shopping_items === undefined
      ? []
      : readCollisionGroups(database);
    const foreignKeyViolations = (database.prepare('PRAGMA foreign_key_check').all() as unknown[]).length;
    const semanticSnapshotVersions: Record<string, number> = {};
    let quarantinedRows = 0;
    if (tableCounts.brain_item_semantics !== undefined) {
      const snapshots = database.prepare('SELECT semantic_schema_version, semantic_json FROM brain_item_semantics').all() as Array<{ semantic_schema_version: number; semantic_json: string }>;
      snapshots.forEach((snapshot) => {
        const version = Number.isInteger(snapshot.semantic_schema_version) && snapshot.semantic_schema_version > 0
          ? String(snapshot.semantic_schema_version)
          : 'unknown';
        semanticSnapshotVersions[version] = (semanticSnapshotVersions[version] ?? 0) + 1;
        try {
          const parsed = JSON.parse(snapshot.semantic_json) as { semanticVersion?: unknown };
          if (parsed.semanticVersion !== undefined && !Number.isInteger(parsed.semanticVersion)) quarantinedRows += 1;
        } catch {
          quarantinedRows += 1;
        }
      });
    }
    return {
      sourcePath: databasePath,
      classification: identity?.lane ?? 'unassigned',
      schemaVersion: migrationRow?.version ?? 0,
      lane: identity?.lane ?? null,
      instanceId: identity?.instance_id ?? null,
      householdIds: households,
      tableCounts,
      activeItemCount,
      collisionGroups: collisions,
      foreignKeyViolations,
      semanticSnapshotVersions,
      quarantinedRows,
      autoImport: false,
    };
  } finally {
    database.close();
  }
}

function readCollisionGroups(database: DatabaseSync): MigrationCollisionGroup[] {
  const columns = new Set((database.prepare('PRAGMA table_info(shopping_items)').all() as Array<{ name: string }>).map((column) => column.name));
  const participants = ['household_id', 'normalized_name', 'unit', 'package_size', 'package_unit'];
  const selected = participants.filter((column) => columns.has(column));
  const key = selected.map((column) => `IFNULL("${escapeIdentifier(column)}", '')`).join(" || '|' || ");
  const group = selected.map((column) => `"${escapeIdentifier(column)}"`).join(', ');
  return database.prepare(`
    SELECT ${key} AS key, COUNT(*) AS count
    FROM shopping_items
    WHERE status = 'active'
    GROUP BY ${group}
    HAVING COUNT(*) > 1
    ORDER BY key
  `).all() as unknown as MigrationCollisionGroup[];
}

export function quarantineDatabase(sourcePath: string, destinationPath: string): QuarantineSnapshot {
  const report = dryRunDatabaseImport(sourcePath);
  const backup = backupDatabase(sourcePath, destinationPath, {
    expectedLane: report.lane ?? undefined,
    expectedInstanceId: report.instanceId ?? undefined,
  });
  return { backup, report };
}

function readOptional(database: DatabaseSync, sql: string): unknown {
  try {
    return database.prepare(sql).get();
  } catch (error) {
    if (error instanceof Error && error.message.includes('no such table')) return undefined;
    throw error;
  }
}

function escapeIdentifier(value: string): string {
  return value.replaceAll('"', '""');
}
