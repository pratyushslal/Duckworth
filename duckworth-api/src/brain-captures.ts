import { DatabaseSync } from 'node:sqlite';
import {
  validateBrainCaptureEnvelope,
  validateBrainResult,
  type BrainCaptureEnvelope,
  type BrainOutputFacts,
  type BrainResult,
  type DiscourseContext,
  type SemanticItem,
} from '@duckworth/shopping-intelligence';

function validateRetentionDays(value: number): number {
  if (!Number.isInteger(value) || value < 1 || value > 3_650) {
    throw new TypeError('Capture retention must be an integer between 1 and 3650 days');
  }
  return value;
}

export interface StoredBrainCapture {
  envelope: BrainCaptureEnvelope;
  result: BrainResult;
  committedEventIds: readonly string[];
  createdAt: string;
  expiresAt: string;
}

interface StoredBrainCaptureRow {
  envelope_json: string;
  result_json: string;
  committed_event_ids_json: string;
  created_at: string;
  retention_expires_at: string;
}

const CREATE_BRAIN_CAPTURE_TABLES = `
  CREATE TABLE IF NOT EXISTS brain_captures (
    input_id TEXT PRIMARY KEY,
    household_id TEXT NOT NULL,
    context_id TEXT NOT NULL,
    shopping_list_id TEXT NOT NULL,
    idempotency_key TEXT NOT NULL,
    envelope_json TEXT NOT NULL,
    result_json TEXT NOT NULL,
    engine_version TEXT NOT NULL,
    runtime_versions_json TEXT NOT NULL,
    committed_event_ids_json TEXT NOT NULL,
    facts_json TEXT,
    created_at TEXT NOT NULL,
    retention_expires_at TEXT NOT NULL,
    UNIQUE (context_id, idempotency_key)
  ) STRICT;

  CREATE TABLE IF NOT EXISTS brain_runtime_artifacts (
    checksum TEXT PRIMARY KEY,
    artifact_json TEXT NOT NULL,
    created_at TEXT NOT NULL
  ) STRICT;

  CREATE TABLE IF NOT EXISTS brain_drafts (
    id TEXT PRIMARY KEY,
    input_id TEXT NOT NULL,
    household_id TEXT NOT NULL,
    context_id TEXT NOT NULL,
    shopping_list_id TEXT NOT NULL,
    reason_code TEXT NOT NULL,
    text TEXT NOT NULL,
    source_start INTEGER NOT NULL,
    source_end INTEGER NOT NULL,
    candidate_ids_json TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('open', 'resolved', 'dismissed')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  ) STRICT;

  CREATE TABLE IF NOT EXISTS brain_context_entities (
    context_id TEXT NOT NULL,
    shopping_list_id TEXT NOT NULL,
    item_id TEXT NOT NULL,
    concept_key TEXT NOT NULL,
    variant_key TEXT NOT NULL,
    mentioned_at TEXT NOT NULL,
    PRIMARY KEY (context_id, shopping_list_id, item_id)
  ) STRICT;

  CREATE TABLE IF NOT EXISTS brain_item_semantics (
    item_id TEXT PRIMARY KEY,
    household_id TEXT NOT NULL,
    shopping_list_id TEXT NOT NULL,
    semantic_json TEXT NOT NULL,
    original_semantic_json TEXT NOT NULL DEFAULT '{}',
    semantic_schema_version INTEGER NOT NULL DEFAULT 3,
    concept_key TEXT NOT NULL,
    variant_key TEXT NOT NULL,
    request_key TEXT NOT NULL,
    updated_at TEXT NOT NULL
  ) STRICT;

  CREATE TABLE IF NOT EXISTS household_semantic_runtime_settings (
    household_id TEXT PRIMARY KEY,
    locale TEXT NOT NULL,
    country_code TEXT NOT NULL,
    updated_at TEXT NOT NULL
  ) STRICT;
`;

export class BrainCaptureStore {
  private readonly retentionDays: number;

  constructor(
    private readonly database: DatabaseSync,
    private readonly clock: () => Date = () => new Date(),
    options: { manageSchema?: boolean; retentionDays?: number } = {},
  ) {
    this.retentionDays = validateRetentionDays(options.retentionDays ?? 90);
    if (options.manageSchema === false) return;
    this.database.exec(CREATE_BRAIN_CAPTURE_TABLES);
    this.ensureFactsColumn();
    this.ensureRetentionColumn();
    this.ensureSemanticSnapshotColumns();
    this.migrateLegacyItems();
  }

  commit(
    envelopeInput: BrainCaptureEnvelope,
    resultInput: BrainResult,
    committedEventIds: readonly string[] = [],
  ): StoredBrainCapture {
    const envelope = validateBrainCaptureEnvelope(envelopeInput);
    const result = validateBrainResult(resultInput);
    if (result.capture.inputId !== envelope.inputId || result.capture.text !== envelope.text) {
      throw new Error('Brain result capture does not match its envelope');
    }

    const replay = this.findByIdempotencyKey(envelope.contextId, envelope.idempotencyKey);
    if (replay) return replay;
    if (this.get(envelope.inputId)) throw new Error(`Brain input ID already exists: ${envelope.inputId}`);

    const createdAt = this.clock();
    const stored: StoredBrainCapture = {
      envelope,
      result,
      committedEventIds: [...committedEventIds],
      createdAt: createdAt.toISOString(),
      expiresAt: this.expiryFor(createdAt),
    };
    this.database.exec('BEGIN IMMEDIATE');
    try {
      this.insert(stored);
      this.database.exec('COMMIT');
      return stored;
    } catch (error) {
      this.database.exec('ROLLBACK');
      const concurrentReplay = this.findByIdempotencyKey(envelope.contextId, envelope.idempotencyKey);
      if (concurrentReplay) return concurrentReplay;
      throw error;
    }
  }

  commitWithinTransaction(
    envelopeInput: BrainCaptureEnvelope,
    resultInput: BrainResult,
    committedEventIds: readonly string[] = [],
    facts?: BrainOutputFacts,
  ): StoredBrainCapture {
    const envelope = validateBrainCaptureEnvelope(envelopeInput);
    const result = validateBrainResult(resultInput);
    if (result.capture.inputId !== envelope.inputId || result.capture.text !== envelope.text) {
      throw new Error('Brain result capture does not match its envelope');
    }
    const replay = this.findByIdempotencyKey(envelope.contextId, envelope.idempotencyKey);
    if (replay) return replay;
    if (this.get(envelope.inputId)) throw new Error(`Brain input ID already exists: ${envelope.inputId}`);
    const createdAt = this.clock();
    const stored = {
      envelope,
      result,
      committedEventIds: [...committedEventIds],
      createdAt: createdAt.toISOString(),
      expiresAt: this.expiryFor(createdAt),
    };
    this.insert(stored, facts);
    return stored;
  }

  getFacts(inputId: string): BrainOutputFacts | null {
    const row = this.database.prepare('SELECT facts_json FROM brain_captures WHERE input_id = ?')
      .get(inputId) as { facts_json: string | null } | undefined;
    return row?.facts_json ? JSON.parse(row.facts_json) as BrainOutputFacts : null;
  }

  getRuntimeSettings(householdId: string): { locale: string; countryCode: string } | null {
    const row = this.database.prepare(`
      SELECT locale, country_code FROM household_semantic_runtime_settings WHERE household_id = ?
    `).get(householdId) as { locale: string; country_code: string } | undefined;
    return row ? { locale: row.locale, countryCode: row.country_code } : null;
  }

  setRuntimeSettings(
    householdId: string,
    locale: string,
    countryCode: string,
  ): { locale: string; countryCode: string } {
    const selected = { locale: locale.trim(), countryCode: countryCode.trim() };
    if (!selected.locale || !/^[A-Z]{2}$/u.test(selected.countryCode)) {
      throw new TypeError('Invalid household semantic runtime settings');
    }
    this.database.prepare(`
      INSERT INTO household_semantic_runtime_settings (household_id, locale, country_code, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(household_id) DO UPDATE SET
        locale = excluded.locale,
        country_code = excluded.country_code,
        updated_at = excluded.updated_at
    `).run(householdId, selected.locale, selected.countryCode, this.clock().toISOString());
    return selected;
  }

  getDiscourseContext(contextId: string, shoppingListId: string): DiscourseContext {
    const recentEntities = this.database.prepare(`
      SELECT context.item_id, context.concept_key, context.variant_key, context.mentioned_at,
             semantics.semantic_json
      FROM brain_context_entities AS context
      LEFT JOIN brain_item_semantics AS semantics ON semantics.item_id = context.item_id
      WHERE context.context_id = ? AND context.shopping_list_id = ?
      ORDER BY context.mentioned_at DESC, context.item_id ASC
    `).all(contextId, shoppingListId) as Array<{
      item_id: string;
      concept_key: string;
      variant_key: string;
      mentioned_at: string;
      semantic_json: string | null;
    }>;
    const openDrafts = this.database.prepare(`
      SELECT id, candidate_ids_json
      FROM brain_drafts
      WHERE context_id = ? AND shopping_list_id = ? AND status = 'open'
      ORDER BY created_at ASC, id ASC
    `).all(contextId, shoppingListId) as Array<{ id: string; candidate_ids_json: string }>;
    return {
      contextId,
      shoppingListId,
      recentEntities: recentEntities.map((row) => ({
        itemId: row.item_id,
        conceptKey: row.concept_key,
        variantKey: row.variant_key,
        mentionedAt: row.mentioned_at,
        ...(row.semantic_json ? { item: JSON.parse(row.semantic_json) as SemanticItem } : {}),
      })),
      openDrafts: openDrafts.map((row) => ({
        draftId: row.id,
        candidateItemIds: JSON.parse(row.candidate_ids_json) as string[],
      })),
    };
  }

  persistFacts(envelope: BrainCaptureEnvelope, facts: BrainOutputFacts): void {
    const now = this.clock().toISOString();
    const insertDraft = this.database.prepare(`
      INSERT INTO brain_drafts (
        id, input_id, household_id, context_id, shopping_list_id, reason_code,
        text, source_start, source_end, candidate_ids_json, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)
    `);
    facts.drafts.forEach((draft) => insertDraft.run(
      draft.draftId,
      envelope.inputId,
      envelope.householdId,
      envelope.contextId,
      envelope.shoppingListId,
      draft.reasonCode,
      draft.text,
      draft.sourceStart,
      draft.sourceEnd,
      JSON.stringify(draft.candidateIds),
      now,
      now,
    ));
    const upsertEntity = this.database.prepare(`
      INSERT INTO brain_context_entities
        (context_id, shopping_list_id, item_id, concept_key, variant_key, mentioned_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(context_id, shopping_list_id, item_id) DO UPDATE SET
        concept_key = excluded.concept_key,
        variant_key = excluded.variant_key,
        mentioned_at = excluded.mentioned_at
    `);
    [...facts.saved, ...facts.merged].forEach(({ itemId, item }) => upsertEntity.run(
      envelope.contextId,
      envelope.shoppingListId,
      itemId,
      item.identity.conceptKey,
      item.identity.variantKey,
      envelope.occurredAt,
    ));
  }

  findByIdempotencyKey(contextId: string, key: string): StoredBrainCapture | null {
    this.purgeExpired();
    const row = this.database.prepare(`
      SELECT envelope_json, result_json, committed_event_ids_json, created_at, retention_expires_at
      FROM brain_captures
      WHERE context_id = ? AND idempotency_key = ?
    `).get(contextId, key) as StoredBrainCaptureRow | undefined;
    return row ? this.fromRow(row) : null;
  }

  get(inputId: string): StoredBrainCapture | null {
    this.purgeExpired();
    const row = this.database.prepare(`
      SELECT envelope_json, result_json, committed_event_ids_json, created_at, retention_expires_at
      FROM brain_captures
      WHERE input_id = ?
    `).get(inputId) as StoredBrainCaptureRow | undefined;
    return row ? this.fromRow(row) : null;
  }

  list(householdId: string, limit = 100): StoredBrainCapture[] {
    this.purgeExpired();
    const boundedLimit = Math.max(1, Math.min(Math.floor(limit), 500));
    const rows = this.database.prepare(`
      SELECT envelope_json, result_json, committed_event_ids_json, created_at, retention_expires_at
      FROM brain_captures
      WHERE household_id = ?
      ORDER BY created_at DESC, input_id ASC
      LIMIT ?
    `).all(householdId, boundedLimit) as unknown as StoredBrainCaptureRow[];
    return rows.map((row) => this.fromRow(row));
  }

  delete(householdId: string, inputId: string): boolean {
    this.purgeExpired();
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const row = this.database.prepare('SELECT household_id FROM brain_captures WHERE input_id = ?').get(inputId) as { household_id: string } | undefined;
      if (!row || row.household_id !== householdId) {
        this.database.exec('ROLLBACK');
        return false;
      }
      this.database.prepare('DELETE FROM brain_drafts WHERE input_id = ?').run(inputId);
      this.database.prepare('DELETE FROM brain_captures WHERE input_id = ?').run(inputId);
      this.database.exec('COMMIT');
      return true;
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  deleteHousehold(householdId: string): number {
    this.purgeExpired();
    this.database.exec('BEGIN IMMEDIATE');
    try {
      this.database.prepare('DELETE FROM brain_drafts WHERE input_id IN (SELECT input_id FROM brain_captures WHERE household_id = ?)').run(householdId);
      const result = this.database.prepare('DELETE FROM brain_captures WHERE household_id = ?').run(householdId) as { changes?: number };
      this.database.exec('COMMIT');
      return Number(result.changes ?? 0);
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  retentionPolicy(): { days: number } {
    return { days: this.retentionDays };
  }

  storeRuntimeArtifact(checksum: string, artifact: unknown): void {
    if (!checksum.trim()) throw new Error('Runtime artifact checksum is required');
    this.database.prepare(`
      INSERT OR IGNORE INTO brain_runtime_artifacts (checksum, artifact_json, created_at)
      VALUES (?, ?, ?)
    `).run(checksum, JSON.stringify(artifact), this.clock().toISOString());
  }

  private insert(stored: StoredBrainCapture, facts?: BrainOutputFacts): void {
    this.database.prepare(`
      INSERT INTO brain_captures (
        input_id, household_id, context_id, shopping_list_id, idempotency_key,
        envelope_json, result_json, engine_version, runtime_versions_json,
        committed_event_ids_json, facts_json, created_at, retention_expires_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      stored.envelope.inputId,
      stored.envelope.householdId,
      stored.envelope.contextId,
      stored.envelope.shoppingListId,
      stored.envelope.idempotencyKey,
      JSON.stringify(stored.envelope),
      JSON.stringify(stored.result),
      stored.result.engineVersion,
      JSON.stringify(stored.result.runtimeVersions),
      JSON.stringify(stored.committedEventIds),
      facts ? JSON.stringify(facts) : null,
      stored.createdAt,
      stored.expiresAt,
    );
  }

  private ensureFactsColumn(): void {
    const columns = this.database.prepare('PRAGMA table_info(brain_captures)').all() as Array<{ name: string }>;
    if (!columns.some(({ name }) => name === 'facts_json')) {
      this.database.exec('ALTER TABLE brain_captures ADD COLUMN facts_json TEXT');
    }
  }

  private ensureRetentionColumn(): void {
    const columns = this.database.prepare('PRAGMA table_info(brain_captures)').all() as Array<{ name: string }>;
    if (!columns.some(({ name }) => name === 'retention_expires_at')) {
      this.database.exec("ALTER TABLE brain_captures ADD COLUMN retention_expires_at TEXT NOT NULL DEFAULT '9999-12-31T23:59:59.999Z'");
    }
  }

  private ensureSemanticSnapshotColumns(): void {
    const columns = new Set((this.database.prepare('PRAGMA table_info(brain_item_semantics)').all() as Array<{ name: string }>).map(({ name }) => name));
    if (!columns.has('original_semantic_json')) {
      this.database.exec("ALTER TABLE brain_item_semantics ADD COLUMN original_semantic_json TEXT NOT NULL DEFAULT '{}'");
    }
    if (!columns.has('semantic_schema_version')) {
      this.database.exec('ALTER TABLE brain_item_semantics ADD COLUMN semantic_schema_version INTEGER NOT NULL DEFAULT 3');
    }
  }

  private fromRow(row: StoredBrainCaptureRow): StoredBrainCapture {
    return {
      envelope: validateBrainCaptureEnvelope(JSON.parse(row.envelope_json)),
      result: validateBrainResult(JSON.parse(row.result_json)),
      committedEventIds: JSON.parse(row.committed_event_ids_json) as string[],
      createdAt: row.created_at,
      expiresAt: row.retention_expires_at,
    };
  }

  private expiryFor(createdAt: Date): string {
    const expiry = new Date(createdAt.getTime());
    expiry.setUTCDate(expiry.getUTCDate() + this.retentionDays);
    return expiry.toISOString();
  }

  private purgeExpired(): void {
    const now = this.clock().toISOString();
    this.database.prepare('DELETE FROM brain_drafts WHERE input_id IN (SELECT input_id FROM brain_captures WHERE retention_expires_at <= ?)').run(now);
    this.database.prepare('DELETE FROM brain_captures WHERE retention_expires_at <= ?').run(now);
  }

  private migrateLegacyItems(): void {
    const hasItems = this.database.prepare(`
      SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = 'shopping_items'
    `).get() as { present: number } | undefined;
    if (!hasItems) return;
    const columns = this.database.prepare('PRAGMA table_info(shopping_items)').all() as Array<{ name: string }>;
    const required = ['id', 'household_id', 'capture_text', 'name', 'created_at'];
    if (required.some((name) => !columns.some((column) => column.name === name))) return;
    const hasList = columns.some((column) => column.name === 'shopping_list_id');
    const rows = this.database.prepare(`
      SELECT id, household_id, ${hasList ? 'shopping_list_id' : 'NULL AS shopping_list_id'},
             capture_text, name, created_at
      FROM shopping_items
    `).all() as Array<{
      id: string;
      household_id: string;
      shopping_list_id: string | null;
      capture_text: string;
      name: string;
      created_at: string;
    }>;
    for (const row of rows) {
      const inputId = `migration:${row.id}`;
      if (this.get(inputId)) continue;
      const envelope: BrainCaptureEnvelope = {
        schemaVersion: 2,
        inputId,
        householdId: row.household_id,
        contextId: `migration:${row.household_id}`,
        shoppingListId: row.shopping_list_id ?? `migration:${row.household_id}`,
        source: { kind: 'database-migration' },
        text: row.capture_text,
        locale: 'und',
        countryCode: 'ZZ',
        occurredAt: row.created_at,
        idempotencyKey: inputId,
      };
      const semanticItem = this.unknownLegacyItem(row.id, row.name, row.capture_text.length);
      const result: BrainResult = {
        schemaVersion: 2,
        engineVersion: 'migration-v1-to-v2',
        runtimeVersions: { migration: 'legacy-unknown' },
        capture: { inputId, text: row.capture_text },
        operations: [{ kind: 'create', item: semanticItem }],
        warnings: [{ code: 'legacy_semantics_unknown', sourceStart: 0, sourceEnd: row.capture_text.length }],
      };
      const createdAt = this.clock();
      this.insert({ envelope, result, committedEventIds: [], createdAt: createdAt.toISOString(), expiresAt: this.expiryFor(createdAt) });
    }
  }

  private unknownLegacyItem(id: string, name: string, textLength: number): SemanticItem {
    const itemEnd = Math.min(name.length, textLength);
    return {
      itemName: {
        value: name,
        confidence: itemEnd > 0 ? 'confirmed' : 'unknown',
        evidence: itemEnd > 0 ? [{ kind: 'source_span', sourceStart: 0, sourceEnd: itemEnd }] : [],
      },
      conceptId: { value: null, confidence: 'unknown', evidence: [] },
      brandId: { value: null, confidence: 'unknown', evidence: [] },
      categoryId: { value: null, confidence: 'unknown', evidence: [] },
      requestedCount: { value: null, confidence: 'unknown', evidence: [] },
      requestedUnitId: { value: null, confidence: 'unknown', evidence: [] },
      packageMeasure: { value: null, confidence: 'unknown', evidence: [] },
      attributes: {},
      identity: { conceptKey: `legacy:${id}`, variantKey: `legacy:${id}`, requestKey: `legacy:${id}` },
    };
  }
}
