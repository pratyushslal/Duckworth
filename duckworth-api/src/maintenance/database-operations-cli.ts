import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { backupDatabase, restoreDatabase, verifyDatabaseIntegrity } from '../database-backup.js';
import { dryRunDatabaseImport } from '../database-migration.js';
import type { ApiLane } from '../config.js';

type DatabaseOperation =
  | { action: 'backup'; source: string; destination: string; expectedLane?: ApiLane; expectedInstanceId?: string }
  | { action: 'verify'; source: string }
  | { action: 'dry-run'; source: string }
  | { action: 'restore-drill'; source: string; destination: string };

export function parseDatabaseOperation(argv: readonly string[]): DatabaseOperation {
  const [action, source, destination] = argv;
  if (action === 'verify' || action === 'dry-run') {
    if (!source) throw new Error(`${action} requires a database path`);
    return { action, source };
  }
  if (action === 'restore-drill') {
    if (!source || !destination) throw new Error('restore-drill requires source and destination paths');
    return { action, source, destination };
  }
  if (action === 'backup') {
    if (!source || !destination) throw new Error('backup requires source and destination paths');
    const lane = optionValue(argv, '--lane');
    if (lane !== undefined && lane !== 'live' && lane !== 'sandbox' && lane !== 'api-test') {
      throw new Error('--lane must be live, sandbox, or api-test');
    }
    const instance = optionValue(argv, '--instance');
    return {
      action,
      source,
      destination,
      ...(lane ? { expectedLane: lane } : {}),
      ...(instance ? { expectedInstanceId: instance } : {}),
    };
  }
  throw new Error(`unknown database operation: ${action ?? ''}`);
}

export function runDatabaseOperation(operation: DatabaseOperation): unknown {
  if (operation.action === 'verify') return { integrity: verifyDatabaseIntegrity(operation.source) };
  if (operation.action === 'dry-run') return dryRunDatabaseImport(operation.source);
  if (operation.action === 'restore-drill') return restoreDatabase(operation.source, operation.destination, { disposable: true });
  return backupDatabase(operation.source, operation.destination, {
    expectedLane: operation.expectedLane,
    expectedInstanceId: operation.expectedInstanceId,
  });
}

function optionValue(argv: readonly string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  if (index < 0) return undefined;
  const value = argv[index + 1]?.trim();
  if (!value) throw new Error(`${name} requires a value`);
  return value;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  try {
    process.stdout.write(`${JSON.stringify(runDatabaseOperation(parseDatabaseOperation(process.argv.slice(2))), null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
