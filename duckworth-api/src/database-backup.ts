import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import type { ApiLane } from './config.js';

export interface DatabaseBackupOptions {
  expectedLane?: ApiLane;
  expectedInstanceId?: string;
  minimumTableCount?: number;
}

export interface DatabaseRestoreOptions extends DatabaseBackupOptions {
  disposable?: boolean;
}

export interface DatabaseBackupResult {
  sourcePath: string;
  destinationPath: string;
  integrity: 'ok';
  sha256: string;
  schemaVersion: number;
  lane: ApiLane | null;
  instanceId: string | null;
  tableCount: number;
}

export function backupDatabase(
  sourcePath: string,
  destinationPath: string,
  options: DatabaseBackupOptions = {},
): DatabaseBackupResult {
  if (!isAbsolute(sourcePath) || !isAbsolute(destinationPath)) {
    throw new Error('database paths must be absolute');
  }
  const source = resolve(sourcePath);
  const destination = resolve(destinationPath);
  if (source.toLocaleLowerCase('en-US') === destination.toLocaleLowerCase('en-US')) {
    throw new Error('backup target must differ from source database');
  }
  if (!existsSync(source)) throw new Error('source database does not exist');
  if (existsSync(destination)) throw new Error('backup target already exists');
  mkdirSync(dirname(destination), { recursive: true });

  const database = new DatabaseSync(source);
  try {
    database.exec('PRAGMA wal_checkpoint(PASSIVE)');
    database.exec(`VACUUM INTO '${escapeSqlString(destination)}'`);
  } finally {
    database.close();
  }
  const integrity = verifyDatabaseIntegrity(destination);
  if (integrity !== 'ok') throw new Error('database backup integrity check failed');
  const metadata = inspectDatabase(destination);
  if (options.expectedLane && metadata.lane !== options.expectedLane) {
    throw new Error(`database backup lane mismatch: expected ${options.expectedLane}`);
  }
  if (options.expectedInstanceId && metadata.instanceId !== options.expectedInstanceId) {
    throw new Error(`database backup instance mismatch: expected ${options.expectedInstanceId}`);
  }
  if (options.minimumTableCount !== undefined && metadata.tableCount < options.minimumTableCount) {
    throw new Error(`database backup has ${metadata.tableCount} tables; expected at least ${options.minimumTableCount}`);
  }
  const sha256 = createHash('sha256').update(readFileSync(destination)).digest('hex');
  return { sourcePath: source, destinationPath: destination, integrity, sha256, ...metadata };
}

export function restoreDatabase(
  backupPath: string,
  destinationPath: string,
  options: DatabaseRestoreOptions = {},
): DatabaseBackupResult {
  if (options.disposable !== true) {
    throw new Error('disposable restore confirmation is required');
  }
  if (isAbsolute(destinationPath) && existsSync(resolve(destinationPath))) {
    throw new Error('restore target already exists');
  }
  const { disposable: _disposable, ...backupOptions } = options;
  return backupDatabase(backupPath, destinationPath, backupOptions);
}

export function verifyDatabaseIntegrity(databasePath: string): 'ok' {
  if (!isAbsolute(databasePath)) throw new Error('database path must be absolute');
  const database = new DatabaseSync(resolve(databasePath), { readOnly: true });
  try {
    const row = database.prepare('PRAGMA integrity_check').get() as { integrity_check: string };
    if (row.integrity_check !== 'ok') throw new Error(`database integrity check failed: ${row.integrity_check}`);
    return 'ok';
  } finally {
    database.close();
  }
}

function escapeSqlString(value: string): string {
  return value.replaceAll("'", "''");
}

function inspectDatabase(databasePath: string): Omit<DatabaseBackupResult, 'sourcePath' | 'destinationPath' | 'integrity' | 'sha256'> {
  const database = new DatabaseSync(resolve(databasePath), { readOnly: true });
  try {
    const tableRow = database.prepare(
      "SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
    ).get() as { count: number };
    const migrationRow = readOptional<{ version: number | null }>(database, "SELECT MAX(version) AS version FROM schema_migrations");
    const identity = readOptional<{ lane: ApiLane; instance_id: string }>(database, 'SELECT lane, instance_id FROM duckworth_runtime_identity WHERE id = 1');
    return {
      schemaVersion: migrationRow?.version ?? 0,
      lane: identity?.lane ?? null,
      instanceId: identity?.instance_id ?? null,
      tableCount: tableRow.count,
    };
  } finally {
    database.close();
  }
}

function readOptional<T>(database: DatabaseSync, sql: string): T | undefined {
  try {
    return database.prepare(sql).get() as T | undefined;
  } catch (error) {
    if (error instanceof Error && error.message.includes('no such table')) return undefined;
    throw error;
  }
}
