import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

export interface ConversationContext {
  id: string;
  householdId: string;
  deviceId: string;
  speakerId: string | null;
  label: string;
  status: 'active' | 'closed';
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
}

export class ConversationContextNotFoundError extends Error {}
export class ConversationContextAccessError extends Error {}
export class ConversationContextHandoffNotFoundError extends Error {}
export class ConversationContextHandoffAlreadyClaimedError extends Error {}
export class ConversationContextHandoffExpiredError extends Error {}

interface ContextRow {
  id: string;
  household_id: string;
  device_id: string;
  speaker_id: string;
  label: string;
  status: 'active' | 'closed';
  created_at: string;
  updated_at: string;
  closed_at: string | null;
}

export class ConversationContextRepository {
  constructor(
    private readonly database: DatabaseSync,
    private readonly clock: () => Date,
    options: { manageSchema?: boolean } = {},
  ) {
    if (options.manageSchema === false) return;
    this.migrate();
  }

  register(
    householdId: string,
    deviceId: string,
    speakerId: string | null,
    label?: string,
  ): { context: ConversationContext; accessToken: string; created: boolean } {
    const normalizedHousehold = required(householdId, 'householdId');
    const normalizedDevice = required(deviceId, 'deviceId');
    const normalizedSpeaker = speakerId?.trim() || '';
    const existing = this.database.prepare(`
      SELECT id, household_id, device_id, speaker_id, label, status, created_at, updated_at, closed_at
      FROM conversation_contexts
      WHERE household_id = ? AND device_id = ? AND speaker_id = ?
    `).get(normalizedHousehold, normalizedDevice, normalizedSpeaker) as ContextRow | undefined;
    const now = this.clock().toISOString();
    const context = existing
      ? existing
      : (() => {
        const created: ContextRow = {
          id: randomUUID(),
          household_id: normalizedHousehold,
          device_id: normalizedDevice,
          speaker_id: normalizedSpeaker,
          label: label?.trim() || `${normalizedDevice}${normalizedSpeaker ? ` · ${normalizedSpeaker}` : ''}`,
          status: 'active',
          created_at: now,
          updated_at: now,
          closed_at: null,
        };
        this.database.prepare(`
          INSERT INTO conversation_contexts
            (id, household_id, device_id, speaker_id, label, status, created_at, updated_at, closed_at)
          VALUES (?, ?, ?, ?, ?, 'active', ?, ?, NULL)
        `).run(
          created.id, created.household_id, created.device_id, created.speaker_id,
          created.label, created.created_at, created.updated_at,
        );
        return created;
      })();
    const accessToken = this.rotateToken(context.id, now);
    return { context: toContext(context), accessToken, created: !existing };
  }

  list(householdId: string): ConversationContext[] {
    const rows = this.database.prepare(`
      SELECT id, household_id, device_id, speaker_id, label, status, created_at, updated_at, closed_at
      FROM conversation_contexts
      WHERE household_id = ?
      ORDER BY created_at ASC, id ASC
    `).all(required(householdId, 'householdId')) as unknown as ContextRow[];
    return rows.map(toContext);
  }

  authorize(householdId: string, contextId: string, accessToken: string): ConversationContext {
    const row = this.database.prepare(`
      SELECT id, household_id, device_id, speaker_id, label, status, created_at, updated_at, closed_at
      FROM conversation_contexts
      WHERE household_id = ? AND id = ?
    `).get(required(householdId, 'householdId'), required(contextId, 'contextId')) as ContextRow | undefined;
    if (!row) throw new ConversationContextNotFoundError();
    const token = this.database.prepare(`
      SELECT salt, token_hash FROM conversation_context_tokens WHERE context_id = ?
    `).get(row.id) as { salt: string; token_hash: string } | undefined;
    if (!token || !safeTokenEquals(token.token_hash, hashToken(token.salt, accessToken))) {
      throw new ConversationContextAccessError();
    }
    return toContext(row);
  }

  close(householdId: string, contextId: string, accessToken: string): ConversationContext {
    const current = this.authorize(householdId, contextId, accessToken);
    if (current.status === 'closed') return current;
    const now = this.clock().toISOString();
    this.database.prepare(`
      UPDATE conversation_contexts
      SET status = 'closed', updated_at = ?, closed_at = ?
      WHERE household_id = ? AND id = ? AND status = 'active'
    `).run(now, now, householdId, contextId);
    return this.get(householdId, contextId);
  }

  createHandoff(
    householdId: string,
    contextId: string,
    accessToken: string,
    targetDeviceId: string,
    targetSpeakerId: string | null,
  ): { handoffToken: string; expiresAt: string } {
    this.authorize(householdId, contextId, accessToken);
    const token = randomBytes(32).toString('base64url');
    const salt = randomBytes(16).toString('hex');
    const expiresAt = new Date(this.clock().getTime() + 10 * 60 * 1000).toISOString();
    this.database.prepare(`
      INSERT INTO conversation_context_handoffs
        (id, household_id, context_id, target_device_id, target_speaker_id, salt, token_hash,
         expires_at, claimed_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)
    `).run(
      randomUUID(), required(householdId, 'householdId'), required(contextId, 'contextId'),
      required(targetDeviceId, 'targetDeviceId'), targetSpeakerId?.trim() || '', salt,
      hashToken(salt, token), expiresAt, this.clock().toISOString(),
    );
    return { handoffToken: token, expiresAt };
  }

  claimHandoff(
    householdId: string,
    handoffToken: string,
    deviceId: string,
    speakerId: string | null,
  ): { context: ConversationContext; accessToken: string } {
    const row = this.database.prepare(`
      SELECT id, context_id, target_device_id, target_speaker_id, salt, token_hash, expires_at, claimed_at
      FROM conversation_context_handoffs
      WHERE household_id = ?
      ORDER BY created_at DESC
    `).all(required(householdId, 'householdId')) as unknown as Array<{
      id: string; context_id: string; target_device_id: string; target_speaker_id: string;
      salt: string; token_hash: string; expires_at: string; claimed_at: string | null;
    }>;
    const match = row.find((candidate) => safeTokenEquals(
      candidate.token_hash,
      hashToken(candidate.salt, handoffToken),
    ));
    if (!match) throw new ConversationContextHandoffNotFoundError();
    if (match.claimed_at) throw new ConversationContextHandoffAlreadyClaimedError();
    if (new Date(match.expires_at).getTime() <= this.clock().getTime()) {
      throw new ConversationContextHandoffExpiredError();
    }
    if (match.target_device_id !== required(deviceId, 'deviceId')
      || match.target_speaker_id !== (speakerId?.trim() || '')) {
      throw new ConversationContextAccessError();
    }
    this.database.prepare(
      'UPDATE conversation_context_handoffs SET claimed_at = ? WHERE id = ? AND claimed_at IS NULL',
    ).run(this.clock().toISOString(), match.id);
    const context = this.get(householdId, match.context_id);
    return { context, accessToken: this.rotateToken(context.id, this.clock().toISOString()) };
  }

  private get(householdId: string, contextId: string): ConversationContext {
    const row = this.database.prepare(`
      SELECT id, household_id, device_id, speaker_id, label, status, created_at, updated_at, closed_at
      FROM conversation_contexts WHERE household_id = ? AND id = ?
    `).get(householdId, contextId) as ContextRow | undefined;
    if (!row) throw new ConversationContextNotFoundError();
    return toContext(row);
  }

  private rotateToken(contextId: string, now: string): string {
    const accessToken = randomBytes(32).toString('base64url');
    const salt = randomBytes(16).toString('hex');
    this.database.prepare(`
      INSERT INTO conversation_context_tokens (context_id, salt, token_hash, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(context_id) DO UPDATE SET salt = excluded.salt,
        token_hash = excluded.token_hash, updated_at = excluded.updated_at
    `).run(contextId, salt, hashToken(salt, accessToken), now);
    return accessToken;
  }

  private migrate(): void {
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS conversation_contexts (
        id TEXT PRIMARY KEY,
        household_id TEXT NOT NULL,
        device_id TEXT NOT NULL,
        speaker_id TEXT NOT NULL DEFAULT '',
        label TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('active', 'closed')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        closed_at TEXT,
        UNIQUE (household_id, device_id, speaker_id)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS conversation_context_tokens (
        context_id TEXT PRIMARY KEY,
        salt TEXT NOT NULL,
        token_hash TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS conversation_context_handoffs (
        id TEXT PRIMARY KEY,
        household_id TEXT NOT NULL,
        context_id TEXT NOT NULL,
        target_device_id TEXT NOT NULL,
        target_speaker_id TEXT NOT NULL DEFAULT '',
        salt TEXT NOT NULL,
        token_hash TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        claimed_at TEXT,
        created_at TEXT NOT NULL
      ) STRICT;
    `);
    const columns = this.database.prepare('PRAGMA table_info(conversation_sessions)').all() as Array<{ name: string }>;
    if (columns.length > 0 && !columns.some((column) => column.name === 'shopping_list_id')) {
      this.database.exec('ALTER TABLE conversation_sessions ADD COLUMN shopping_list_id TEXT');
    }
    const refreshedColumns = this.database.prepare('PRAGMA table_info(conversation_sessions)').all() as Array<{ name: string }>;
    if (refreshedColumns.length > 0 && !refreshedColumns.some((column) => column.name === 'context_id')) {
      this.database.exec('ALTER TABLE conversation_sessions ADD COLUMN context_id TEXT');
    }
    const households = this.database.prepare(`
      SELECT DISTINCT household_id FROM conversation_sessions WHERE context_id IS NULL
    `).all() as Array<{ household_id: string }>;
    for (const { household_id: householdId } of households) {
      const now = this.clock().toISOString();
      const contextId = `legacy:${hashToken('legacy', householdId).slice(0, 24)}`;
      this.database.prepare(`
        INSERT OR IGNORE INTO conversation_contexts
          (id, household_id, device_id, speaker_id, label, status, created_at, updated_at, closed_at)
        SELECT ?, household_id, 'legacy-device', '', 'Legacy household context',
          CASE WHEN EXISTS (
            SELECT 1 FROM conversation_sessions active_session
            WHERE active_session.household_id = conversation_sessions.household_id
              AND active_session.status = 'active'
          ) THEN 'active' ELSE 'closed' END,
          ?, ?, NULL
        FROM conversation_sessions WHERE household_id = ? LIMIT 1
      `).run(contextId, now, now, householdId);
      this.database.prepare(
        'UPDATE conversation_sessions SET context_id = ? WHERE household_id = ? AND context_id IS NULL',
      ).run(contextId, householdId);
    }
    this.database.exec(`
      DROP INDEX IF EXISTS conversation_sessions_one_active_per_household;
      CREATE UNIQUE INDEX IF NOT EXISTS conversation_sessions_one_active_per_context
      ON conversation_sessions (household_id, shopping_list_id, context_id)
      WHERE status = 'active' AND context_id IS NOT NULL;
    `);
  }
}

function required(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${field} is required`);
  return normalized;
}

function hashToken(salt: string, token: string): string {
  return createHash('sha256').update(`${salt}:${token}`).digest('hex');
}

function safeTokenEquals(expected: string, actual: string): boolean {
  const expectedBytes = Buffer.from(expected, 'hex');
  const actualBytes = Buffer.from(actual, 'hex');
  return expectedBytes.length === actualBytes.length && timingSafeEqual(expectedBytes, actualBytes);
}

function toContext(row: ContextRow): ConversationContext {
  return {
    id: row.id,
    householdId: row.household_id,
    deviceId: row.device_id,
    speakerId: row.speaker_id || null,
    label: row.label,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    closedAt: row.closed_at,
  };
}
