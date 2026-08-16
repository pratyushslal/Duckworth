import { isAbsolute } from 'node:path';
import { dryRunDatabaseImport, quarantineDatabase, type DatabaseImportDryRun, type QuarantineSnapshot } from '../database-migration.js';

export interface SemanticMigrationCommandResult {
  report: DatabaseImportDryRun;
  quarantine?: QuarantineSnapshot;
}

export function runSemanticMigrationCommand(args: readonly string[]): SemanticMigrationCommandResult {
  let databasePath: string | undefined;
  let quarantinePath: string | undefined;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if ((arg === '--database' || arg === '--quarantine') && typeof args[index + 1] === 'string') {
      const value = args[++index];
      if (arg === '--database') databasePath = value;
      else quarantinePath = value;
      continue;
    }
    throw new Error(`Unknown or incomplete argument: ${arg ?? '(missing)'}`);
  }
  if (!databasePath) throw new Error('--database is required');
  if (!isAbsolute(databasePath)) throw new Error('--database must be an absolute path');
  if (quarantinePath !== undefined && !isAbsolute(quarantinePath)) {
    throw new Error('--quarantine must be an absolute path');
  }
  if (quarantinePath !== undefined && quarantinePath === databasePath) {
    throw new Error('--quarantine must differ from --database');
  }
  const report = dryRunDatabaseImport(databasePath);
  return quarantinePath === undefined
    ? { report }
    : { report, quarantine: quarantineDatabase(databasePath, quarantinePath) };
}

export function formatSemanticMigrationReport(result: SemanticMigrationCommandResult): string {
  return JSON.stringify(result, null, 2);
}
