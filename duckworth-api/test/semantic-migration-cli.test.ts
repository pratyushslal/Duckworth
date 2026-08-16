import { mkdtempSync, rmSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runSemanticMigrationCommand } from '../src/maintenance/semantic-migration.js';

const temporaryDirectories: string[] = [];

afterEach(() => {
  temporaryDirectories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true }));
});

describe('semantic migration command', () => {
  it('reports a database without importing it', () => {
    const directory = mkdtempSync(join(tmpdir(), 'duckworth-migration-'));
    temporaryDirectories.push(directory);
    const databasePath = join(directory, 'source.sqlite');
    const database = new DatabaseSync(databasePath);
    database.exec(`
      CREATE TABLE shopping_items (household_id TEXT, status TEXT, normalized_name TEXT,
        unit TEXT, package_size REAL, package_unit TEXT);
      INSERT INTO shopping_items VALUES ('family-live', 'active', 'milk', 'pack', NULL, NULL);
    `);
    database.close();

    const result = runSemanticMigrationCommand(['--database', databasePath]);
    expect(result.report).toMatchObject({
      sourcePath: databasePath,
      householdIds: ['family-live'],
      activeItemCount: 1,
      autoImport: false,
    });
    expect(result.quarantine).toBeUndefined();
  });

  it('fails closed for missing or relative database paths', () => {
    expect(() => runSemanticMigrationCommand([])).toThrow(/--database/);
    expect(() => runSemanticMigrationCommand(['--database', 'relative.sqlite'])).toThrow(/absolute/);
  });
});
