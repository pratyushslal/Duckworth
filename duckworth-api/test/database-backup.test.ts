import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { backupDatabase, restoreDatabase, verifyDatabaseIntegrity } from '../src/database-backup.js';

describe('SQLite backup primitive', () => {
  it('creates a consistent backup that can be reopened', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'duckworth-backup-'));
    const source = join(directory, 'source.sqlite');
    const backup = join(directory, 'backups', 'source.sqlite');
    try {
      const app = await buildApp({ databasePath: source, runtimeIdentity: { lane: 'sandbox', instanceId: 'backup-test' } });
      await app.close();

      const result = backupDatabase(source, backup, {
        expectedLane: 'sandbox',
        expectedInstanceId: 'backup-test',
        minimumTableCount: 5,
      });
      expect(result.destinationPath).toBe(backup);
      expect(result.integrity).toBe('ok');
      expect(result.schemaVersion).toBe(1);
      expect(result.lane).toBe('sandbox');
      expect(result.instanceId).toBe('backup-test');
      expect(result.tableCount).toBeGreaterThanOrEqual(5);
      expect(result.sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(existsSync(backup)).toBe(true);
      expect(verifyDatabaseIntegrity(backup)).toBe('ok');

      const reopened = await buildApp({ databasePath: backup });
      await reopened.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('rejects a relative or same-file backup target', () => {
    expect(() => backupDatabase('source.sqlite', 'backup.sqlite')).toThrow('database paths must be absolute');
    expect(() => backupDatabase('C:\\Duckworth\\source.sqlite', 'C:\\Duckworth\\source.sqlite')).toThrow('backup target must differ');
  });

  it('rejects overwriting an existing backup', () => {
    const directory = mkdtempSync(join(tmpdir(), 'duckworth-backup-'));
    const source = join(directory, 'source.sqlite');
    try {
      const database = new DatabaseSync(source);
      database.exec('CREATE TABLE values_table (value TEXT) STRICT');
      database.close();
      expect(() => backupDatabase(source, source)).toThrow('backup target must differ');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('rejects a missing source before opening SQLite', () => {
    const directory = mkdtempSync(join(tmpdir(), 'duckworth-backup-'));
    try {
      expect(() => backupDatabase(
        join(directory, 'missing.sqlite'),
        join(directory, 'backup.sqlite'),
      )).toThrow('source database does not exist');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('restores only to a new disposable path and preserves the lane marker', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'duckworth-restore-'));
    const source = join(directory, 'source.sqlite');
    const backup = join(directory, 'backups', 'source.sqlite');
    const restored = join(directory, 'drills', 'restored.sqlite');
    try {
      const app = await buildApp({ databasePath: source, runtimeIdentity: { lane: 'sandbox', instanceId: 'restore-test' } });
      await app.close();
      backupDatabase(source, backup, { expectedLane: 'sandbox', expectedInstanceId: 'restore-test' });

      const result = restoreDatabase(backup, restored, {
        disposable: true,
        expectedLane: 'sandbox',
        expectedInstanceId: 'restore-test',
      });
      expect(result.lane).toBe('sandbox');
      expect(result.instanceId).toBe('restore-test');
      expect(verifyDatabaseIntegrity(restored)).toBe('ok');
      expect(() => restoreDatabase(backup, join(directory, 'drills', 'second.sqlite')))
        .toThrow('disposable restore confirmation is required');
      expect(() => restoreDatabase(backup, restored, { disposable: true }))
        .toThrow('restore target already exists');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('backs up an isolated api-test database without confusing it with sandbox', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'duckworth-api-test-backup-'));
    const source = join(directory, 'api-test.sqlite');
    const backup = join(directory, 'backup.sqlite');
    try {
      const app = await buildApp({ databasePath: source, runtimeIdentity: { lane: 'api-test', instanceId: 'api-test-run-1' } });
      await app.close();
      const result = backupDatabase(source, backup, { expectedLane: 'api-test', expectedInstanceId: 'api-test-run-1' });
      expect(result.lane).toBe('api-test');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('reports legacy tables even when schema and runtime ledgers do not exist yet', () => {
    const directory = mkdtempSync(join(tmpdir(), 'duckworth-legacy-backup-'));
    const source = join(directory, 'legacy.sqlite');
    const backup = join(directory, 'legacy-backup.sqlite');
    try {
      const database = new DatabaseSync(source);
      database.exec('CREATE TABLE shopping_items (name TEXT NOT NULL) STRICT');
      database.close();
      const result = backupDatabase(source, backup, { minimumTableCount: 1 });
      expect(result.tableCount).toBe(1);
      expect(result.schemaVersion).toBe(0);
      expect(result.lane).toBeNull();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
