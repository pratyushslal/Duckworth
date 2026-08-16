import { formatSemanticMigrationReport, runSemanticMigrationCommand } from './semantic-migration.js';

try {
  process.stdout.write(`${formatSemanticMigrationReport(runSemanticMigrationCommand(process.argv.slice(2)))}\n`);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : 'semantic migration failed'}\n`);
  process.exitCode = 2;
}
