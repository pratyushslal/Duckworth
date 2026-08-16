import { describe, expect, it } from 'vitest';
import { parseDatabaseOperation } from '../src/maintenance/database-operations-cli.js';

describe('database operations CLI', () => {
  it('parses backup, verification, dry-run and disposable restore commands', () => {
    expect(parseDatabaseOperation(['backup', 'C:\\live.sqlite', 'C:\\backup.sqlite', '--lane', 'live', '--instance', 'family-live']))
      .toEqual({ action: 'backup', source: 'C:\\live.sqlite', destination: 'C:\\backup.sqlite', expectedLane: 'live', expectedInstanceId: 'family-live' });
    expect(parseDatabaseOperation(['verify', 'C:\\backup.sqlite'])).toEqual({ action: 'verify', source: 'C:\\backup.sqlite' });
    expect(parseDatabaseOperation(['dry-run', 'C:\\backup.sqlite'])).toEqual({ action: 'dry-run', source: 'C:\\backup.sqlite' });
    expect(parseDatabaseOperation(['restore-drill', 'C:\\backup.sqlite', 'C:\\drill.sqlite']))
      .toEqual({ action: 'restore-drill', source: 'C:\\backup.sqlite', destination: 'C:\\drill.sqlite' });
  });

  it('rejects destructive or incomplete operations', () => {
    expect(() => parseDatabaseOperation(['restore', 'a', 'b'])).toThrow('unknown database operation');
    expect(() => parseDatabaseOperation(['backup', 'a'])).toThrow('backup requires');
  });
});
