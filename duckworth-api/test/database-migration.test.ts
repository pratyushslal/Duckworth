import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { DatabaseSync } from 'node:sqlite';
import { dryRunDatabaseImport, quarantineDatabase } from '../src/database-migration.js';

describe('database split preflight', () => {
  it('reports an unassigned mixed database without classifying its rows', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'duckworth-migration-'));
    const source = join(directory, 'mixed.sqlite');
    try {
      const app = await buildApp({ databasePath: source });
      await app.inject({
        method: 'POST',
        url: '/api/v1/households/mixed-household/items',
        payload: { input: 'milk' },
      });
      await app.close();

      const report = dryRunDatabaseImport(source);
      expect(report.classification).toBe('unassigned');
      expect(report.householdIds).toEqual(['mixed-household']);
      expect(report.activeItemCount).toBe(1);
      expect(report.foreignKeyViolations).toBe(0);
      expect(report.quarantinedRows).toBe(0);
      expect(report.semanticSnapshotVersions).toEqual({});
      expect(report.autoImport).toBe(false);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('creates a quarantine snapshot and returns a dry-run report for review', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'duckworth-migration-'));
    const source = join(directory, 'mixed.sqlite');
    const quarantine = join(directory, 'quarantine', 'mixed.sqlite');
    try {
      const app = await buildApp({ databasePath: source });
      await app.close();
      const result = quarantineDatabase(source, quarantine);
      expect(result.report.classification).toBe('unassigned');
      expect(result.backup.integrity).toBe('ok');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('preflights a legacy shopping-items schema before package columns existed', () => {
    const directory = mkdtempSync(join(tmpdir(), 'duckworth-legacy-migration-'));
    const source = join(directory, 'legacy.sqlite');
    try {
      const database = new DatabaseSync(source);
      database.exec(`
        CREATE TABLE shopping_items (
          household_id TEXT NOT NULL,
          normalized_name TEXT NOT NULL,
          unit TEXT,
          status TEXT NOT NULL
        ) STRICT;
        INSERT INTO shopping_items VALUES ('family', 'milk', 'litre', 'active');
      `);
      database.close();
      const report = dryRunDatabaseImport(source);
      expect(report.householdIds).toEqual(['family']);
      expect(report.activeItemCount).toBe(1);
      expect(report.collisionGroups).toEqual([]);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
