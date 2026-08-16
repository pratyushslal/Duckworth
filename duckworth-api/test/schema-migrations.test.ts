import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { loadSemanticRuntime } from '../src/semantic-runtime-loader.js';
import { prepareSchema } from '../src/schema-migrations.js';
import { ShoppingItemRepository } from '../src/shopping-items.js';
import { BrainCaptureStore } from '../src/brain-captures.js';
import { ConversationContextRepository } from '../src/conversation-contexts.js';

function temporaryDatabase(): { directory: string; path: string } {
  const directory = mkdtempSync(join(tmpdir(), 'duckworth-schema-'));
  return { directory, path: join(directory, 'database.sqlite') };
}

describe('schema migration ledger', () => {
  it('records the supported schema version for a fresh database', async () => {
    const temporary = temporaryDatabase();
    try {
      const app = await buildApp({ databasePath: temporary.path });
      await app.close();
      const database = new DatabaseSync(temporary.path);
      const row = database.prepare('SELECT MAX(version) AS version FROM schema_migrations').get() as { version: number };
      database.close();
      expect(row.version).toBe(1);
    } finally {
      rmSync(temporary.directory, { recursive: true, force: true });
    }
  });

  it('refuses a database newer than this binary before opening repositories', async () => {
    const temporary = temporaryDatabase();
    try {
      const database = new DatabaseSync(temporary.path);
      database.exec('CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL) STRICT');
      database.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (99, ?)').run(new Date().toISOString());
      database.close();

      let error: unknown;
      try {
        await buildApp({ databasePath: temporary.path });
      } catch (caught) {
        error = caught;
      }
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toContain('database schema version 99 is newer than supported version 1');
    } finally {
      rmSync(temporary.directory, { recursive: true, force: true });
    }
  });

  it('prepares the schema centrally before repositories are constructed', async () => {
    const database = new DatabaseSync(':memory:');
    const runtime = await loadSemanticRuntime(resolve(import.meta.dirname, '../language-packs'));
    const clock = () => new Date('2026-08-13T00:00:00.000Z');

    prepareSchema(database, runtime, clock);
    expect(() => new ShoppingItemRepository(database, runtime, clock, { manageSchema: false })).not.toThrow();
    expect(() => new BrainCaptureStore(database, clock, { manageSchema: false })).not.toThrow();
    expect(() => new ConversationContextRepository(database, clock, { manageSchema: false })).not.toThrow();
    database.close();
  });
});
