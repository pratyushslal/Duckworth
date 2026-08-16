import { createHash, randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { InvalidCaptureError, normalizeItemName } from '@duckworth/item-capture';
import {
  interpretItem,
  decideConversationLifecycle,
  InvalidItemTransitionError,
  ItemCorrectionConflictError,
  reconcileItemCorrection,
  transitionItem,
  type ConversationDecision,
  type ConversationInterpretation,
  type ConversationItemCandidate,
  type BrandHint,
  type ItemIntent,
  type ItemLifecycleAction,
  type ConversationLifecycleState,
  type CloseActionOrigin,
  type SemanticRuntime,
  type LearnedSemanticEntry,
  type BrainCaptureEnvelope,
  type BrainOutputFacts,
  type BrainResult,
  type SemanticItem,
  type SemanticCommercialRole,
  type SemanticEvidence,
  type DescriptorMention,
  type TypedLearningEffect,
  type SemanticCorrectionCommandV1,
  type SemanticValue,
  classifyShoppingItem,
  createItemIdentity,
  resolveSemanticItem,
  assertSemanticItemCompatible,
  normalizeSemanticItemForRuntime,
  upcastSemanticItem,
} from '@duckworth/shopping-intelligence';
import type { ResolvedRegionalProduct } from './regional-product-packs.js';

const CREATE_SHOPPING_ITEMS_TABLE = `
  CREATE TABLE IF NOT EXISTS shopping_items (
    id TEXT PRIMARY KEY,
    household_id TEXT NOT NULL,
    shopping_list_id TEXT,
    capture_text TEXT NOT NULL,
    name TEXT NOT NULL,
    normalized_name TEXT NOT NULL,
    quantity REAL CHECK (quantity > 0 OR quantity IS NULL),
    unit TEXT,
    package_size REAL CHECK (package_size > 0 OR package_size IS NULL),
    package_unit TEXT,
    category_id TEXT NOT NULL DEFAULT 'unknown',
    category_automatic_id TEXT NOT NULL DEFAULT 'unknown',
    category_override_id TEXT,
    category_confidence TEXT NOT NULL DEFAULT 'unknown'
      CHECK (category_confidence IN ('confirmed', 'inferred', 'unknown')),
    classification_runtime_versions TEXT NOT NULL DEFAULT '{}',
    attributes_json TEXT NOT NULL DEFAULT '{}',
    semantic_variant_key TEXT NOT NULL DEFAULT '',
    brand_name TEXT,
    brand_id TEXT,
    product_id TEXT,
    concept_id TEXT,
    quantity_source TEXT CHECK (quantity_source IN ('explicit', 'history', 'catalog_default', 'policy_default') OR quantity_source IS NULL),
    unit_source TEXT CHECK (unit_source IN ('explicit', 'history', 'catalog_default', 'policy_default') OR unit_source IS NULL),
    unit_confirmed_at TEXT,
    status TEXT NOT NULL CHECK (status IN ('active', 'purchased', 'removed')),
    removed_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    CHECK ((package_size IS NULL) = (package_unit IS NULL))
  ) STRICT;
`;

const CREATE_ITEM_CLASSIFICATION_TABLES = `
  CREATE TABLE IF NOT EXISTS tag_definitions (
    id TEXT PRIMARY KEY,
    namespace TEXT NOT NULL CHECK (namespace IN ('shop_type')),
    scope TEXT NOT NULL CHECK (scope IN ('runtime', 'household')),
    household_id TEXT,
    canonical_key TEXT NOT NULL,
    label TEXT NOT NULL,
    active INTEGER NOT NULL CHECK (active IN (0, 1)),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    CHECK ((scope = 'runtime' AND household_id IS NULL) OR (scope = 'household' AND household_id IS NOT NULL)),
    UNIQUE (namespace, scope, household_id, canonical_key)
  ) STRICT;

  CREATE TABLE IF NOT EXISTS item_tag_assignments (
    item_id TEXT NOT NULL,
    tag_id TEXT NOT NULL,
    origin TEXT NOT NULL CHECK (origin IN ('automatic', 'user')),
    decision TEXT NOT NULL CHECK (decision IN ('include', 'exclude')),
    confidence TEXT CHECK (confidence IN ('confirmed', 'inferred', 'unknown') OR confidence IS NULL),
    evidence_json TEXT NOT NULL DEFAULT '[]',
    semantic_identity_key TEXT NOT NULL,
    runtime_versions_json TEXT NOT NULL DEFAULT '{}',
    active INTEGER NOT NULL CHECK (active IN (0, 1)),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (item_id, tag_id, origin)
  ) STRICT;

  CREATE INDEX IF NOT EXISTS item_tag_assignments_active_tag
    ON item_tag_assignments (tag_id, item_id)
    WHERE active = 1;
`;

const CREATE_CONVERSATION_TABLES = `
  CREATE TABLE IF NOT EXISTS shopping_lists (
    id TEXT PRIMARY KEY,
    household_id TEXT NOT NULL,
    name TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('active', 'archived')),
    is_default INTEGER NOT NULL CHECK (is_default IN (0, 1)),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  ) STRICT;

  CREATE TABLE IF NOT EXISTS conversation_sessions (
    id TEXT PRIMARY KEY,
    household_id TEXT NOT NULL,
    shopping_list_id TEXT,
    context_id TEXT,
    status TEXT NOT NULL CHECK (status IN ('active', 'idle', 'close_pending', 'closed')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    closed_at TEXT
  ) STRICT;

  CREATE TABLE IF NOT EXISTS conversation_drafts (
    id TEXT PRIMARY KEY,
    household_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    text TEXT NOT NULL,
    reason TEXT NOT NULL CHECK (reason IN ('ambiguous_clause', 'ambiguous_reference')),
    status TEXT NOT NULL CHECK (status IN ('open', 'resolved', 'dismissed')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  ) STRICT;

  CREATE TABLE IF NOT EXISTS conversation_pending_actions (
    id TEXT PRIMARY KEY,
    household_id TEXT NOT NULL,
    shopping_list_id TEXT NOT NULL,
    context_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('close_session')),
    origin TEXT NOT NULL CHECK (origin IN ('explicit_intent', 'configured_idle_policy')),
    previous_status TEXT NOT NULL CHECK (previous_status IN ('active', 'idle')),
    status TEXT NOT NULL CHECK (status IN ('pending', 'confirmed', 'cancelled', 'expired')),
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    resolved_at TEXT
  ) STRICT;

  CREATE TABLE IF NOT EXISTS shopping_item_events (
    id TEXT PRIMARY KEY,
    household_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    item_id TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('created', 'quantity_adjusted', 'merged', 'reversed')),
    inverse_of_event_id TEXT,
    payload TEXT NOT NULL,
    created_at TEXT NOT NULL
  ) STRICT;

  CREATE TABLE IF NOT EXISTS conversation_capture_receipts (
    context_id TEXT NOT NULL,
    idempotency_key TEXT NOT NULL,
    result_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (context_id, idempotency_key)
  ) STRICT;

  CREATE TABLE IF NOT EXISTS household_capture_settings (
    household_id TEXT PRIMARY KEY,
    automatic_conversation_close TEXT NOT NULL
      CHECK (automatic_conversation_close IN ('off', 'after_idle')),
    idle_threshold_seconds INTEGER NOT NULL DEFAULT 1800 CHECK (idle_threshold_seconds BETWEEN 60 AND 604800),
    grace_period_seconds INTEGER NOT NULL DEFAULT 300 CHECK (grace_period_seconds BETWEEN 30 AND 3600),
    warning_policy TEXT NOT NULL DEFAULT 'prompt' CHECK (warning_policy IN ('silent', 'prompt')),
    cloud_draft_assist TEXT NOT NULL
      CHECK (cloud_draft_assist IN ('disabled', 'ask_before_each_use')),
    cloud_assist_on_save INTEGER NOT NULL DEFAULT 0 CHECK (cloud_assist_on_save IN (0, 1)),
    cloud_assist_while_typing INTEGER NOT NULL DEFAULT 0 CHECK (cloud_assist_while_typing IN (0, 1)),
    online_lookup_consent INTEGER NOT NULL DEFAULT 0 CHECK (online_lookup_consent IN (0, 1)),
    online_lookup_trigger TEXT NOT NULL DEFAULT 'manual' CHECK (online_lookup_trigger IN ('manual', 'on_idle')),
    suggestions TEXT NOT NULL CHECK (suggestions IN ('enabled', 'disabled')),
    updated_at TEXT NOT NULL
  ) STRICT;

  CREATE TABLE IF NOT EXISTS household_entitlements (
    household_id TEXT PRIMARY KEY,
    plan TEXT NOT NULL CHECK (plan IN ('free', 'premium')),
    updated_at TEXT NOT NULL
  ) STRICT;

  CREATE TABLE IF NOT EXISTS household_suggestion_feedback (
    household_id TEXT NOT NULL,
    identity_key TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('accepted', 'dismissed')),
    updated_at TEXT NOT NULL,
    PRIMARY KEY (household_id, identity_key)
  ) STRICT;

  CREATE TABLE IF NOT EXISTS online_lookup_receipts (
    token TEXT PRIMARY KEY,
    household_id TEXT NOT NULL,
    normalized_phrase TEXT NOT NULL,
    provider_id TEXT NOT NULL,
    candidate_json TEXT NOT NULL,
    runtime_versions_json TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    accepted_at TEXT
  ) STRICT;
  CREATE INDEX IF NOT EXISTS online_lookup_receipts_expiry ON online_lookup_receipts (expires_at);

  CREATE TABLE IF NOT EXISTS online_lookup_cache (
    cache_key TEXT PRIMARY KEY,
    provider_id TEXT NOT NULL,
    candidate_json TEXT NOT NULL,
    runtime_versions_json TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL
  ) STRICT;
  CREATE INDEX IF NOT EXISTS online_lookup_cache_expiry ON online_lookup_cache (expires_at);

  CREATE TABLE IF NOT EXISTS household_semantic_learning (
    id TEXT PRIMARY KEY,
    household_id TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('alias', 'brand_preference', 'variant_preference', 'quantity_preference')),
    value_json TEXT NOT NULL,
    supporting_event_ids_json TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('active', 'suppressed', 'cleared')),
    updated_at TEXT NOT NULL
  ) STRICT;

  CREATE TABLE IF NOT EXISTS semantic_correction_receipts (
    household_id TEXT NOT NULL,
    idempotency_key TEXT NOT NULL,
    request_json TEXT NOT NULL,
    response_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (household_id, idempotency_key)
  ) STRICT;

  CREATE TABLE IF NOT EXISTS semantic_correction_events (
    id TEXT PRIMARY KEY,
    household_id TEXT NOT NULL,
    item_id TEXT NOT NULL,
    idempotency_key TEXT NOT NULL,
    operation_index INTEGER NOT NULL CHECK (operation_index >= 0),
    source_capture_id TEXT NOT NULL,
    source_start INTEGER NOT NULL CHECK (source_start >= 0),
    source_end INTEGER NOT NULL CHECK (source_end >= source_start),
    raw_clause TEXT NOT NULL,
    before_json TEXT NOT NULL,
    after_json TEXT NOT NULL,
    changed_fields_json TEXT NOT NULL,
    classification_before_json TEXT NOT NULL DEFAULT '[]',
    classification_after_json TEXT NOT NULL DEFAULT '[]',
    runtime_versions_json TEXT NOT NULL DEFAULT '{}',
    actor_receipt_json TEXT NOT NULL DEFAULT '{}',
    inverse_of_event_id TEXT,
    created_at TEXT NOT NULL,
    UNIQUE (household_id, idempotency_key)
  ) STRICT;

  CREATE TABLE IF NOT EXISTS household_overlay_revisions (
    household_id TEXT PRIMARY KEY,
    revision INTEGER NOT NULL CHECK (revision >= 0),
    updated_at TEXT NOT NULL
  ) STRICT;

  CREATE TABLE IF NOT EXISTS household_semantic_entities (
    id TEXT PRIMARY KEY,
    household_id TEXT NOT NULL,
    entity_type TEXT NOT NULL CHECK (entity_type IN ('concept', 'product_family', 'product', 'brand', 'organization')),
    canonical_label TEXT NOT NULL,
    locale TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('active', 'suppressed', 'reconciled')),
    provenance_json TEXT NOT NULL DEFAULT '{}',
    replaced_by_catalog_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  ) STRICT;

  CREATE TABLE IF NOT EXISTS household_semantic_aliases (
    id TEXT PRIMARY KEY,
    household_id TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    alias TEXT NOT NULL,
    normalized_alias TEXT NOT NULL,
    locale TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('active', 'suppressed', 'cleared')),
    evidence_json TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (household_id, locale, normalized_alias)
  ) STRICT;

  CREATE TABLE IF NOT EXISTS household_learning_proposals (
    id TEXT PRIMARY KEY,
    household_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    effect_json TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('candidate', 'reviewed', 'active', 'suppressed', 'cleared', 'expired')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  ) STRICT;

  CREATE TABLE IF NOT EXISTS household_learning_effects (
    id TEXT PRIMARY KEY,
    household_id TEXT NOT NULL,
    proposal_id TEXT,
    kind TEXT NOT NULL,
    value_json TEXT NOT NULL,
    applicability_json TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('candidate', 'reviewed', 'active', 'suppressed', 'cleared', 'expired')),
    supporting_event_ids_json TEXT NOT NULL DEFAULT '[]',
    contradicting_event_ids_json TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  ) STRICT;

  CREATE TABLE IF NOT EXISTS household_learning_evidence (
    id TEXT PRIMARY KEY,
    effect_id TEXT NOT NULL,
    correction_event_id TEXT,
    relation TEXT NOT NULL CHECK (relation IN ('support', 'contradict')),
    created_at TEXT NOT NULL
  ) STRICT;

  CREATE TABLE IF NOT EXISTS catalog_reconciliation_candidates (
    id TEXT PRIMARY KEY,
    household_id TEXT NOT NULL,
    local_entity_id TEXT NOT NULL,
    catalog_entity_id TEXT NOT NULL,
    fingerprint TEXT NOT NULL,
    disposition TEXT NOT NULL CHECK (disposition IN ('pending', 'link', 'merge', 'keep_separate')),
    evidence_json TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  ) STRICT;

  CREATE TABLE IF NOT EXISTS shopping_list_archives (
    id TEXT PRIMARY KEY,
    household_id TEXT NOT NULL,
    items_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    reopened_at TEXT
  ) STRICT;
`;

export type ShoppingItemStatus = 'active' | 'purchased' | 'removed';
export type ShoppingItemValueSource = 'explicit' | 'history' | 'catalog_default' | 'policy_default';
export type ShoppingItemUnitSource = ShoppingItemValueSource;
export type ShoppingItemAttentionReason = 'missing_quantity' | 'unconfirmed_historical_unit';

export interface ShoppingItem {
  id: string;
  householdId: string;
  shoppingListId: string;
  captureText: string;
  name: string;
  quantity: number | null;
  unit: string | null;
  packageSize: number | null;
  packageUnit: string | null;
  categoryId: string;
  categoryConfidence: 'confirmed' | 'inferred' | 'unknown';
  attributes: Readonly<Record<string, string | number>>;
  semanticVariantKey?: string;
  brandName?: string;
  brandId: string | null;
  productId: string | null;
  conceptId: string | null;
  shopTypes?: readonly ShoppingItemShopType[];
  quantitySource?: ShoppingItemValueSource | null;
  unitSource: ShoppingItemUnitSource | null;
  unitConfirmedAt: string | null;
  attentionReasons: ShoppingItemAttentionReason[];
  status: ShoppingItemStatus;
  removedAt: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface ConversationSession {
  id: string;
  householdId: string;
  shoppingListId: string;
  contextId: string | null;
  status: 'active' | 'idle' | 'close_pending' | 'closed';
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
}

export interface PendingConversationAction {
  id: string;
  householdId: string;
  shoppingListId: string;
  contextId: string;
  sessionId: string;
  type: 'close_session';
  origin: CloseActionOrigin;
  previousStatus: 'active' | 'idle';
  status: 'pending' | 'confirmed' | 'cancelled' | 'expired';
  expiresAt: string;
  createdAt: string;
  resolvedAt: string | null;
}

export interface ClarificationDraft {
  id: string;
  householdId: string;
  sessionId: string;
  text: string;
  reason: 'ambiguous_clause' | 'ambiguous_reference';
  status: 'open' | 'resolved' | 'dismissed';
  createdAt: string;
  updatedAt: string;
}

export interface ConversationCaptureResult {
  session: ConversationSession;
  pendingAction: PendingConversationAction | null;
  saved: ShoppingItem[];
  merged: ShoppingItem[];
  drafts: ClarificationDraft[];
  undo: UndoToken[];
}

export interface UndoToken {
  eventId: string;
  itemId: string;
}

export interface ShoppingItemEvent {
  id: string;
  itemId: string;
  sessionId: string;
  type: 'created' | 'quantity_adjusted' | 'merged' | 'reversed';
  inverseOfEventId: string | null;
  payload: string;
  createdAt: string;
}

export interface ShoppingItemShopType {
  id: string;
  label: string;
}

export interface ShoppingItemView {
  items: ShoppingItem[];
  activeDistinctCount: number;
  appliedShopTypeId: string | null;
  facets: Array<ShoppingItemShopType & { activeDistinctCount: number }>;
}

export interface AppliedBrainResult {
  facts: BrainOutputFacts;
  committedEventIds: readonly string[];
}

export interface HouseholdCaptureSettings {
  automaticConversationClose: 'off' | 'after_idle';
  idleThresholdSeconds: number;
  gracePeriodSeconds: number;
  warningPolicy: 'silent' | 'prompt';
  cloudDraftAssist: 'disabled' | 'ask_before_each_use';
  cloudAssistOnSave: boolean;
  cloudAssistWhileTyping: boolean;
  /** Explicit household consent before the minimized item phrase may leave Duckworth. */
  onlineLookupConsent?: boolean;
  /** Premium lookup behavior; manual remains the safe default for existing households. */
  onlineLookupTrigger?: 'manual' | 'on_idle';
  suggestions: 'enabled' | 'disabled';
  entitlement: 'free' | 'premium';
}

export type HouseholdCaptureSettingsUpdate = Omit<HouseholdCaptureSettings, 'entitlement'>;

export interface HouseholdSuggestion {
  itemIdentityKey: string;
  message: string;
  sourceEventIds: string[];
}

export interface ShoppingListArchive {
  id: string;
  householdId: string;
  status: 'archived' | 'reopened';
  items: ShoppingItem[];
  createdAt: string;
  reopenedAt: string | null;
}

export interface ShoppingList {
  id: string;
  householdId: string;
  name: string;
  status: 'active' | 'archived';
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

interface ShoppingItemRow {
  id: string;
  household_id: string;
  shopping_list_id: string;
  capture_text: string;
  name: string;
  quantity: number | null;
  unit: string | null;
  package_size: number | null;
  package_unit: string | null;
  category_id?: ShoppingItem['categoryId'];
  category_confidence?: ShoppingItem['categoryConfidence'];
  attributes_json?: string;
  semantic_variant_key?: string;
  brand_name: string | null;
  brand_id: string | null;
  product_id: string | null;
  concept_id: string | null;
  quantity_source?: ShoppingItemValueSource | null;
  unit_source: ShoppingItemUnitSource | null;
  unit_confirmed_at: string | null;
  status: ShoppingItemStatus;
  removed_at: string | null;
  created_at: string;
  updated_at: string;
  version: number;
}

interface ShoppingListArchiveRow {
  id: string;
  household_id: string;
  items_json: string;
  created_at: string;
  reopened_at: string | null;
}

interface PendingConversationActionRow {
  id: string;
  household_id: string;
  shopping_list_id: string;
  context_id: string;
  session_id: string;
  type: 'close_session';
  origin: CloseActionOrigin;
  previous_status: 'active' | 'idle';
  status: 'pending' | 'confirmed' | 'cancelled' | 'expired';
  expires_at: string;
  created_at: string;
  resolved_at: string | null;
}

export class DuplicateShoppingItemError extends Error {
  constructor(readonly existingItemId: string) {
    super('An item with this name is already active in the household');
  }
}

export class ItemVersionConflictError extends Error {
  constructor(readonly currentItem: ShoppingItem) {
    super('The shopping item changed since it was loaded');
  }
}

export class SemanticCorrectionIdempotencyConflictError extends Error {
  constructor() {
    super('A semantic correction idempotency key was already used with a different request');
  }
}

export class ShoppingItemRepository {
  constructor(
    private readonly database: DatabaseSync,
    private readonly semanticRuntime: SemanticRuntime,
    private readonly clock: () => Date = () => new Date(),
    options: { manageSchema?: boolean } = {},
  ) {
    if (options.manageSchema === false) return;
    this.database.exec(CREATE_SHOPPING_ITEMS_TABLE);
    const columns = this.database.prepare('PRAGMA table_info(shopping_items)').all() as Array<{ name: string }>;
    if (['capture_text', 'package_size', 'package_unit', 'category_id', 'category_automatic_id', 'category_override_id', 'category_confidence', 'classification_runtime_versions', 'attributes_json', 'semantic_variant_key', 'brand_name', 'brand_id', 'product_id', 'concept_id', 'quantity_source', 'removed_at'].some(
      (required) => !columns.some((column) => column.name === required),
    )) {
      this.migrateLegacySchema(columns);
    }
    this.database.exec(CREATE_CONVERSATION_TABLES);
    this.ensureSemanticCorrectionEventColumns();
    this.database.exec(CREATE_ITEM_CLASSIFICATION_TABLES);
    this.synchronizeRuntimeShopTypes();
    this.ensureCaptureSettingsColumns();
    this.ensureShoppingListBoundary();
    this.database.exec('DROP INDEX IF EXISTS shopping_items_active_name_unique');
    this.repairLegacySemanticRows();
    this.ensureSemanticVariantKey();
    this.database.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS shopping_items_active_variant_unique
      ON shopping_items (
        household_id,
        shopping_list_id,
        semantic_variant_key
      )
      WHERE status = 'active';
    `);
  }

  private ensureSemanticCorrectionEventColumns(): void {
    const columns = this.database.prepare('PRAGMA table_info(semantic_correction_events)').all() as Array<{ name: string }>;
    if (!columns.some((column) => column.name === 'classification_before_json')) {
      this.database.exec("ALTER TABLE semantic_correction_events ADD COLUMN classification_before_json TEXT NOT NULL DEFAULT '[]'");
    }
    if (!columns.some((column) => column.name === 'classification_after_json')) {
      this.database.exec("ALTER TABLE semantic_correction_events ADD COLUMN classification_after_json TEXT NOT NULL DEFAULT '[]'");
    }
    if (!columns.some((column) => column.name === 'runtime_versions_json')) {
      this.database.exec("ALTER TABLE semantic_correction_events ADD COLUMN runtime_versions_json TEXT NOT NULL DEFAULT '{}'");
    }
    if (!columns.some((column) => column.name === 'actor_receipt_json')) {
      this.database.exec("ALTER TABLE semantic_correction_events ADD COLUMN actor_receipt_json TEXT NOT NULL DEFAULT '{}'");
    }
  }

  getSemanticSnapshot(householdId: string, itemId: string): SemanticItem | null {
    const row = this.database.prepare(`
      SELECT semantic_json FROM brain_item_semantics
      WHERE household_id = ? AND item_id = ?
    `).get(householdId, itemId) as { semantic_json: string } | undefined;
    return row ? upcastSemanticItem(JSON.parse(row.semantic_json) as SemanticItem) : null;
  }

  private validateCorrectionSource(
    householdId: string,
    item: ShoppingItem,
    source: SemanticCorrectionCommandV1['source'],
  ): void {
    let sourceText = item.captureText;
    const capture = this.database.prepare(`
      SELECT household_id, envelope_json, result_json
      FROM brain_captures WHERE input_id = ?
    `).get(source.captureInputId) as { household_id: string; envelope_json: string; result_json: string } | undefined;
    if (capture) {
      if (capture.household_id !== householdId) throw new Error('invalid correction source');
      const envelope = JSON.parse(capture.envelope_json) as { text?: unknown };
      if (typeof envelope.text === 'string') sourceText = envelope.text;
      const result = JSON.parse(capture.result_json) as { operations?: unknown[] };
      if (!Array.isArray(result.operations) || source.operationIndex >= result.operations.length) {
        throw new Error('invalid correction source');
      }
    }
    if (source.sourceEnd > sourceText.length
      || source.rawClause !== sourceText.slice(source.sourceStart, source.sourceEnd)) {
      throw new Error('invalid correction source');
    }
  }

  private validateSemanticReference(
    householdId: string,
    reference: { kind: 'catalog' | 'household'; id: string },
    expected: 'concept' | 'productFamily' | 'brand' | 'product' | 'organization',
  ): void {
    if (reference.kind === 'catalog') {
      const exists = expected === 'concept'
        ? this.semanticRuntime.concepts.byId.has(reference.id)
        : expected === 'productFamily'
          ? this.semanticRuntime.productFamilies.byId.has(reference.id)
          : expected === 'brand'
            ? this.semanticRuntime.brands.byId.has(reference.id)
            : expected === 'product'
              ? this.semanticRuntime.products.byId.has(reference.id)
              : this.semanticRuntime.organizations.byId.has(reference.id);
      if (!exists) throw new Error('invalid semantic reference');
      return;
    }
    const row = this.database.prepare(`
      SELECT entity_type FROM household_semantic_entities
      WHERE household_id = ? AND id = ? AND status = 'active'
    `).get(householdId, reference.id) as { entity_type: string } | undefined;
    if (!row || row.entity_type !== expected) throw new Error('invalid semantic reference');
  }

  private applyStructuredSemanticCorrection(
    householdId: string,
    before: SemanticItem,
    command: SemanticCorrectionCommandV1,
  ): SemanticItem {
    const corrected = command.corrected;
    const evidence: SemanticEvidence[] = [{ kind: 'household_confirmation', ref: command.idempotencyKey }];
    const semantic: SemanticItem = {
      ...before,
      attributes: { ...before.attributes },
      descriptorMentions: [...(before.descriptorMentions ?? [])],
      commercialRoles: [...(before.commercialRoles ?? [])],
    };
    if (corrected.canonicalLabel !== undefined) {
      semantic.itemName = { value: corrected.canonicalLabel.trim(), confidence: 'confirmed', evidence };
    }
    if (corrected.conceptRef !== undefined && corrected.conceptRef !== null) {
      this.validateSemanticReference(householdId, corrected.conceptRef, 'concept');
      semantic.conceptId = { value: corrected.conceptRef.id, confidence: 'confirmed', evidence };
      const category = this.semanticRuntime.concepts.byId.get(corrected.conceptRef.id)?.categoryId;
      if (category) semantic.categoryId = { value: category, confidence: 'confirmed', evidence };
    }
    if (corrected.productFamilyRef !== undefined && corrected.productFamilyRef !== null) {
      this.validateSemanticReference(householdId, corrected.productFamilyRef, 'productFamily');
      semantic.productFamilyId = { value: corrected.productFamilyRef.id, confidence: 'confirmed', evidence };
    }
    if (corrected.brandRef !== undefined && corrected.brandRef !== null) {
      if (corrected.brandRef.kind === 'household') {
        const existing = this.database.prepare(`SELECT id FROM household_semantic_entities WHERE household_id = ? AND id = ?`).get(householdId, corrected.brandRef.id);
        if (!existing) {
          this.database.prepare(`
            INSERT INTO household_semantic_entities
              (id, household_id, entity_type, canonical_label, locale, status, provenance_json, created_at, updated_at)
            VALUES (?, ?, 'brand', ?, 'und', 'active', ?, ?, ?)
          `).run(
            corrected.brandRef.id,
            householdId,
            corrected.canonicalLabel?.trim() || before.itemName.value,
            JSON.stringify({ correctionId: command.idempotencyKey }),
            this.clock().toISOString(),
            this.clock().toISOString(),
          );
        }
      }
      this.validateSemanticReference(householdId, corrected.brandRef, 'brand');
      semantic.brandId = { value: corrected.brandRef.id, confidence: 'confirmed', evidence };
    }
    if (corrected.productRef !== undefined && corrected.productRef !== null) {
      this.validateSemanticReference(householdId, corrected.productRef, 'product');
      semantic.productId = { value: corrected.productRef.id, confidence: 'confirmed', evidence };
    }
    if (corrected.quantity !== undefined) {
      semantic.requestedCount = { value: corrected.quantity, confidence: 'confirmed', evidence };
    }
    if (corrected.unitId !== undefined) {
      if (corrected.unitId !== null && !this.semanticRuntime.units.has(corrected.unitId)) throw new Error('invalid semantic unit');
      semantic.requestedUnitId = { value: corrected.unitId, confidence: 'confirmed', evidence };
    }
    if (corrected.packageContainerUnitId !== undefined) {
      const unit = corrected.packageContainerUnitId === null ? undefined : this.semanticRuntime.units.get(corrected.packageContainerUnitId);
      if (corrected.packageContainerUnitId !== null && (!unit || (unit.capability !== 'container' && unit.capability !== 'both'))) throw new Error('invalid package container unit');
      semantic.packageContainerUnitId = { value: corrected.packageContainerUnitId, confidence: 'confirmed', evidence };
    }
    if (corrected.packageSize !== undefined || corrected.packageUnitId !== undefined) {
      const size = corrected.packageSize !== undefined ? corrected.packageSize : semantic.packageMeasure.value?.value ?? null;
      const unitId = corrected.packageUnitId !== undefined ? corrected.packageUnitId : semantic.packageMeasure.value?.unitId ?? null;
      const unit = unitId === null ? undefined : this.semanticRuntime.units.get(unitId);
      if (unitId !== null && (!unit || (unit.capability !== 'measure' && unit.capability !== 'both'))) throw new Error('invalid package measurement unit');
      semantic.packageMeasure = {
        value: size === null || unitId === null ? null : { value: size, unitId },
        confidence: 'confirmed', evidence,
      };
    }
    if (corrected.descriptors !== undefined) {
      for (const descriptor of corrected.descriptors) {
        const attribute = this.semanticRuntime.attributes.get(descriptor.attributeId);
        if (!attribute) throw new Error('invalid descriptor attribute');
        const category = semantic.categoryId.value
          ? this.semanticRuntime.categories.get(semantic.categoryId.value)
          : undefined;
        const allowed = category && new Set([
          ...category.relevantAttributeIds,
          ...Object.values(category.measureAttributeIds ?? {}),
        ]).has(descriptor.attributeId);
        if (category && !allowed) throw new Error('descriptor attribute is not allowed for category');
        if (descriptor.valueId !== undefined) {
          const values = this.semanticRuntime.attributeValues.get(descriptor.attributeId) ?? [];
          if (!values.includes(descriptor.valueId)) throw new Error('invalid descriptor value');
        }
        const value = descriptor.valueId ?? descriptor.value;
        if (value === undefined) throw new Error('invalid descriptor value');
        semantic.attributes = {
          ...semantic.attributes,
          [descriptor.attributeId]: { value, confidence: 'confirmed', evidence },
        };
        const mention: DescriptorMention = {
          surface: String(value), normalized: String(value).normalize('NFKC').toLocaleLowerCase(),
          sourceStart: command.source.sourceStart, sourceEnd: command.source.sourceEnd,
          role: descriptor.role ?? 'identity_attribute', evidence,
        };
        semantic.descriptorMentions = [...(semantic.descriptorMentions ?? []), mention];
      }
    }
    if (corrected.brandRoles !== undefined) {
      semantic.commercialRoles = corrected.brandRoles.map((role) => {
        this.validateSemanticReference(householdId, role.organizationRef, 'organization');
        return {
          role: role.role as SemanticCommercialRole['role'],
          organizationId: role.organizationRef.id,
          confidence: role.confidence ?? 'confirmed',
          evidence,
        };
      });
    }
    const result = normalizeSemanticItemForRuntime(
      { ...semantic, identity: createItemIdentity(semantic, this.semanticRuntime) },
      this.semanticRuntime,
    );
    assertSemanticItemCompatible(result, this.semanticRuntime);
    return result;
  }

  applySemanticCorrection(
    householdId: string,
    command: SemanticCorrectionCommandV1,
  ): { item: ShoppingItem; eventId: string; replayed: boolean; overlayRevision: number; learningEntries?: LearnedSemanticEntry[] } {
    const requestJson = JSON.stringify(command);
    const existing = this.database.prepare(`
      SELECT request_json, response_json FROM semantic_correction_receipts
      WHERE household_id = ? AND idempotency_key = ?
    `).get(householdId, command.idempotencyKey) as { request_json: string; response_json: string } | undefined;
    if (existing) {
      if (existing.request_json !== requestJson) throw new SemanticCorrectionIdempotencyConflictError();
      const response = JSON.parse(existing.response_json) as { item: ShoppingItem; eventId: string; overlayRevision: number; learningEntries?: LearnedSemanticEntry[] };
      return { ...response, replayed: true };
    }

    const current = this.get(householdId, command.itemId);
    if (!current) throw new Error('semantic correction item not found');
    if (current.version !== command.expectedItemVersion) throw new ItemVersionConflictError(current);
    this.validateCorrectionSource(householdId, current, command.source);
    const semanticBefore = this.getBrainSemantic(command.itemId)
      ?? (command.corrected.conceptRef !== undefined
        || command.corrected.productFamilyRef !== undefined
        || command.corrected.brandRef !== undefined
        || command.corrected.productRef !== undefined
        || command.corrected.brandRoles !== undefined
        || command.corrected.descriptors !== undefined
        || command.corrected.packageContainerUnitId !== undefined
        ? this.semanticFromShoppingItem(current)
        : null);
    const corrected = command.corrected;
    const classificationBefore = this.classificationAssignments(command.itemId);
    const patch: {
      name?: string;
      quantity?: number | null;
      confirmedUnit?: string | null;
      packageSize?: number | null;
      packageUnit?: string | null;
    } = {};
    if (corrected.canonicalLabel !== undefined) patch.name = corrected.canonicalLabel;
    if (corrected.quantity !== undefined) patch.quantity = corrected.quantity;
    if (corrected.unitId !== undefined) patch.confirmedUnit = corrected.unitId;
    if (corrected.packageSize !== undefined) patch.packageSize = corrected.packageSize;
    if (corrected.packageUnitId !== undefined) patch.packageUnit = corrected.packageUnitId;

    this.database.exec('BEGIN IMMEDIATE');
    try {
      const now = this.clock().toISOString();
      const semanticAfter = semanticBefore
        ? this.applyStructuredSemanticCorrection(householdId, semanticBefore, command)
        : null;
      let item = semanticBefore
        ? this.replaceFromBrainSemantic(current, semanticAfter!, now)
        : Object.keys(patch).length > 0
          ? this.update(householdId, command.itemId, patch, command.expectedItemVersion)
          : current;
      if (!item) throw new Error('semantic correction item not found');
      if (semanticAfter) this.upsertBrainSemanticSnapshot(
        householdId,
        current.shoppingListId,
        command.itemId,
        semanticAfter,
        now,
      );
      if (corrected.shopTypeDecisions !== undefined) {
        item = this.updateClassification(
          householdId,
          command.itemId,
          corrected.shopTypeDecisions.map(({ tagId, decision }) => ({ tagId, decision })),
          item.version,
          false,
        ) ?? item;
      }
      const after = this.get(householdId, command.itemId)!;
      const classificationAfter = this.classificationAssignments(command.itemId);
      const eventId = randomUUID();
      this.database.prepare(`
        INSERT INTO semantic_correction_events
          (id, household_id, item_id, idempotency_key, operation_index, source_capture_id,
           source_start, source_end, raw_clause, before_json, after_json, changed_fields_json,
           classification_before_json, classification_after_json, runtime_versions_json, actor_receipt_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        eventId,
        householdId,
        command.itemId,
        command.idempotencyKey,
        command.source.operationIndex,
        command.source.captureInputId,
        command.source.sourceStart,
        command.source.sourceEnd,
        command.source.rawClause,
        JSON.stringify(current),
        JSON.stringify(after),
        JSON.stringify(Object.keys(corrected)),
        JSON.stringify(classificationBefore),
        JSON.stringify(classificationAfter),
        JSON.stringify(this.semanticRuntime.versions),
        JSON.stringify({}),
        now,
      );
      const learningEntries = this.recordCorrectionLearning(
        householdId,
        command,
        current,
        after,
        eventId,
        now,
      );
      const revisionRow = this.database.prepare(`
        INSERT INTO household_overlay_revisions (household_id, revision, updated_at)
        VALUES (?, 1, ?)
        ON CONFLICT(household_id) DO UPDATE SET revision = revision + 1, updated_at = excluded.updated_at
        RETURNING revision
      `).get(householdId, now) as { revision: number };
      const response = { item: after, eventId, overlayRevision: revisionRow.revision, learningEntries };
      this.database.prepare(`
        INSERT INTO semantic_correction_receipts (household_id, idempotency_key, request_json, response_json, created_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(householdId, command.idempotencyKey, requestJson, JSON.stringify(response), now);
      this.database.exec('COMMIT');
      return { ...response, replayed: false };
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  getHouseholdOverlayRevision(householdId: string): number {
    const row = this.database.prepare(`
      SELECT revision FROM household_overlay_revisions WHERE household_id = ?
    `).get(householdId) as { revision: number } | undefined;
    return row?.revision ?? 0;
  }

  listCanonicalLearningAliases(householdId: string): Array<{ alias: string; label: string }> {
    const rows = this.database.prepare(`
      SELECT applicability_json, value_json
      FROM household_learning_effects
      WHERE household_id = ? AND kind = 'canonical_label' AND status = 'active'
      ORDER BY updated_at ASC, id ASC
    `).all(householdId) as Array<{ applicability_json: string; value_json: string }>;
    return rows.flatMap((row) => {
      try {
        const applicability = JSON.parse(row.applicability_json) as { sourceAliasKey?: unknown };
        const value = JSON.parse(row.value_json) as { label?: unknown };
        return typeof applicability.sourceAliasKey === 'string' && typeof value.label === 'string'
          ? [{ alias: applicability.sourceAliasKey, label: value.label }]
          : [];
      } catch {
        return [];
      }
    });
  }

  listTypedLearningEffects(householdId: string): TypedLearningEffect[] {
    const rows = this.database.prepare(`
      SELECT id, household_id, kind, value_json, applicability_json, status,
             supporting_event_ids_json, contradicting_event_ids_json
      FROM household_learning_effects
      WHERE household_id = ?
      ORDER BY updated_at ASC, id ASC
    `).all(householdId) as Array<{
      id: string;
      household_id: string;
      kind: TypedLearningEffect['kind'];
      value_json: string;
      applicability_json: string;
      status: TypedLearningEffect['status'];
      supporting_event_ids_json: string;
      contradicting_event_ids_json: string;
    }>;
    return rows.flatMap((row) => {
      try {
        return [{
          id: row.id,
          householdId: row.household_id,
          kind: row.kind,
          value: JSON.parse(row.value_json) as TypedLearningEffect['value'],
          applicability: JSON.parse(row.applicability_json) as TypedLearningEffect['applicability'],
          status: row.status,
          supportingEventIds: JSON.parse(row.supporting_event_ids_json) as string[],
          contradictingEventIds: JSON.parse(row.contradicting_event_ids_json) as string[],
        }];
      } catch {
        return [];
      }
    });
  }

  listSemanticCorrectionEvents(householdId: string): Array<{
    id: string;
    itemId: string;
    inverseOfEventId: string | null;
    source: { captureInputId: string; operationIndex: number; sourceStart: number; sourceEnd: number; rawClause: string };
    before: ShoppingItem;
    after: ShoppingItem;
    changedFields: string[];
    runtimeVersions: Readonly<Record<string, string>>;
    actorReceipt: Readonly<Record<string, string>>;
    createdAt: string;
  }> {
    const rows = this.database.prepare(`
      SELECT id, item_id, inverse_of_event_id, operation_index, source_capture_id, source_start,
             source_end, raw_clause, before_json, after_json, changed_fields_json,
             runtime_versions_json, actor_receipt_json, created_at
      FROM semantic_correction_events
      WHERE household_id = ?
      ORDER BY created_at ASC, id ASC
    `).all(householdId) as Array<{
      id: string; item_id: string; inverse_of_event_id: string | null; operation_index: number;
      source_capture_id: string; source_start: number; source_end: number; raw_clause: string;
      before_json: string; after_json: string; changed_fields_json: string;
      runtime_versions_json: string; actor_receipt_json: string; created_at: string;
    }>;
    return rows.map((row) => ({
      id: row.id,
      itemId: row.item_id,
      inverseOfEventId: row.inverse_of_event_id,
      source: {
        captureInputId: row.source_capture_id,
        operationIndex: row.operation_index,
        sourceStart: row.source_start,
        sourceEnd: row.source_end,
        rawClause: row.raw_clause,
      },
      before: JSON.parse(row.before_json) as ShoppingItem,
      after: JSON.parse(row.after_json) as ShoppingItem,
      changedFields: JSON.parse(row.changed_fields_json) as string[],
      runtimeVersions: JSON.parse(row.runtime_versions_json) as Readonly<Record<string, string>>,
      actorReceipt: JSON.parse(row.actor_receipt_json) as Readonly<Record<string, string>>,
      createdAt: row.created_at,
    }));
  }

  getHouseholdQualityMetrics(householdId: string): {
    correctionCount: number;
    undoCount: number;
    activeLearningCount: number;
    suppressedLearningCount: number;
    unresolvedCount: number;
    conflictCount: number;
  } {
    const count = (sql: string): number => Number((this.database.prepare(sql).get(householdId) as { count: number }).count);
    return {
      correctionCount: count('SELECT COUNT(*) AS count FROM semantic_correction_events WHERE household_id = ?'),
      undoCount: count("SELECT COUNT(*) AS count FROM semantic_correction_events WHERE household_id = ? AND inverse_of_event_id IS NOT NULL"),
      activeLearningCount: count("SELECT COUNT(DISTINCT supporting_event_ids_json) AS count FROM household_learning_effects WHERE household_id = ? AND status = 'active'")
        + count("SELECT COUNT(*) AS count FROM household_semantic_learning WHERE household_id = ? AND status = 'active' AND id NOT LIKE 'typed:%'"),
      suppressedLearningCount: count("SELECT COUNT(*) AS count FROM household_learning_effects WHERE household_id = ? AND status IN ('suppressed', 'cleared')")
        + count("SELECT COUNT(*) AS count FROM household_semantic_learning WHERE household_id = ? AND status IN ('suppressed', 'cleared')"),
      unresolvedCount: count("SELECT COUNT(*) AS count FROM shopping_items WHERE household_id = ? AND status = 'active' AND (category_confidence = 'unknown' OR quantity IS NULL OR unit IS NULL)"),
      conflictCount: count("SELECT COUNT(*) AS count FROM household_learning_effects WHERE household_id = ? AND status = 'candidate'"),
    };
  }

  getLearningControl(householdId: string): {
    householdId: string;
    overlayRevision: number;
    entries: LearnedSemanticEntry[];
    corrections: ReturnType<ShoppingItemRepository['listSemanticCorrectionEvents']>;
    metrics: ReturnType<ShoppingItemRepository['getHouseholdQualityMetrics']>;
  } {
    return {
      householdId,
      overlayRevision: this.getHouseholdOverlayRevision(householdId),
      entries: this.listLearnedSemanticEntries(householdId, true),
      corrections: this.listSemanticCorrectionEvents(householdId),
      metrics: this.getHouseholdQualityMetrics(householdId),
    };
  }

  undoSemanticCorrection(householdId: string, eventId: string): { item: ShoppingItem; inverseOfEventId: string; eventId: string } {
    const original = this.database.prepare(`
      SELECT id, item_id, inverse_of_event_id, before_json, after_json, operation_index,
             source_capture_id, source_start, source_end, raw_clause, classification_before_json
      FROM semantic_correction_events WHERE id = ? AND household_id = ?
    `).get(eventId, householdId) as {
      id: string; item_id: string; inverse_of_event_id: string | null; before_json: string; after_json: string;
      operation_index: number; source_capture_id: string; source_start: number; source_end: number; raw_clause: string;
      classification_before_json: string;
    } | undefined;
    if (!original) throw new Error('semantic correction event not found');
    const existingInverse = this.database.prepare(`
      SELECT id FROM semantic_correction_events WHERE household_id = ? AND inverse_of_event_id = ? LIMIT 1
    `).get(householdId, eventId) as { id: string } | undefined;
    if (existingInverse) throw new Error('semantic correction event already undone');
    const before = JSON.parse(original.before_json) as ShoppingItem;
    const current = this.get(householdId, original.item_id);
    if (!current) throw new Error('semantic correction item not found');
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const updated = this.update(householdId, original.item_id, {
        name: before.name,
        quantity: before.quantity,
        confirmedUnit: before.unit,
        packageSize: before.packageSize,
        packageUnit: before.packageUnit,
        brandName: before.brandName ?? null,
      }, current.version);
      if (!updated) throw new Error('semantic correction item not found');
      const now = this.clock().toISOString();
      this.database.prepare(`
        UPDATE shopping_items
        SET capture_text = ?, name = ?, normalized_name = ?, quantity = ?, unit = ?,
            package_size = ?, package_unit = ?, category_id = ?, category_confidence = ?,
            attributes_json = ?, semantic_variant_key = ?, brand_name = ?, brand_id = ?,
            product_id = ?, concept_id = ?, quantity_source = ?, unit_source = ?,
            unit_confirmed_at = ?, status = ?, removed_at = ?, updated_at = ?, version = version + 1
        WHERE id = ? AND household_id = ? AND version = ?
      `).run(
        before.captureText, before.name, normalizeName(before.name), before.quantity, before.unit,
        before.packageSize, before.packageUnit, before.categoryId, before.categoryConfidence,
        JSON.stringify(before.attributes), before.semanticVariantKey ?? updated.semanticVariantKey ?? '',
        before.brandName ?? null, before.brandId, before.productId, before.conceptId,
        before.quantitySource ?? null, before.unitSource, before.unitConfirmedAt,
        before.status, before.removedAt, now, original.item_id, householdId, updated.version,
      );
      const restored = this.get(householdId, original.item_id);
      if (!restored) throw new Error('semantic correction item not found');
      const assignmentsBefore = JSON.parse(original.classification_before_json) as Parameters<ShoppingItemRepository['restoreClassificationAssignments']>[1];
      this.restoreClassificationAssignments(original.item_id, assignmentsBefore, now);
      const finalRestored = this.get(householdId, original.item_id)!;
      const inverseId = randomUUID();
      this.database.prepare(`
        INSERT INTO semantic_correction_events
          (id, household_id, item_id, idempotency_key, operation_index, source_capture_id,
           source_start, source_end, raw_clause, before_json, after_json, changed_fields_json,
           inverse_of_event_id, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        inverseId, householdId, original.item_id, `undo:${eventId}`, original.operation_index,
        original.source_capture_id, original.source_start, original.source_end, original.raw_clause,
        JSON.stringify(current), JSON.stringify(finalRestored), JSON.stringify(['undo']), eventId, now,
      );
      this.database.prepare(`
        UPDATE household_semantic_learning SET status = 'suppressed', updated_at = ?
        WHERE household_id = ? AND supporting_event_ids_json LIKE ?
      `).run(now, householdId, `%${eventId}%`);
      this.database.prepare(`
        UPDATE household_learning_effects SET status = 'suppressed', updated_at = ?
        WHERE household_id = ? AND supporting_event_ids_json LIKE ?
      `).run(now, householdId, `%${eventId}%`);
      this.database.prepare(`
        INSERT INTO household_overlay_revisions (household_id, revision, updated_at)
        VALUES (?, 1, ?)
        ON CONFLICT(household_id) DO UPDATE SET revision = revision + 1, updated_at = excluded.updated_at
      `).run(householdId, now);
      this.database.exec('COMMIT');
      return { item: finalRestored, inverseOfEventId: eventId, eventId: inverseId };
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  private recordCorrectionLearning(
    householdId: string,
    command: SemanticCorrectionCommandV1,
    before: ShoppingItem,
    after: ShoppingItem,
    eventId: string,
    now: string,
  ): LearnedSemanticEntry[] {
    if (command.learn.mode !== 'future_matching_items') return [];
    const entries: LearnedSemanticEntry[] = [];
    const identityKey = before.semanticVariantKey ?? `${normalizeName(before.name)}:${before.unit ?? ''}:${before.packageUnit ?? ''}`;
    if (command.corrected.quantity !== undefined && command.corrected.quantity !== null) {
      const entry: LearnedSemanticEntry = {
        id: `typed:${householdId}:${eventId}:quantity`,
        householdId,
        kind: 'quantity_preference',
        value: {
          identityKey,
          requestedQuantity: command.corrected.quantity,
          unit: command.corrected.unitId ?? after.unit ?? '',
        },
        supportingEventIds: [eventId],
        status: 'active',
      };
      this.saveLearnedSemanticEntry(entry);
      entries.push(entry);
      this.database.prepare(`
        INSERT INTO household_learning_effects
          (id, household_id, kind, value_json, applicability_json, status, supporting_event_ids_json, created_at, updated_at)
        VALUES (?, ?, 'quantity_default', ?, ?, 'active', ?, ?, ?)
      `).run(
        entry.id, householdId, JSON.stringify(entry.value),
        JSON.stringify({ identityRefs: [identityKey], identityDescriptorValueIds: [], applyOnlyWhenFieldAbsent: true }),
        JSON.stringify([eventId]), now, now,
      );
    }
    if (command.corrected.canonicalLabel !== undefined && command.corrected.canonicalLabel.trim() !== before.name.trim()) {
      const entityId = `household:${householdId}:entity:${eventId}`;
      this.database.prepare(`
        INSERT INTO household_semantic_entities
          (id, household_id, entity_type, canonical_label, locale, status, provenance_json, created_at, updated_at)
        VALUES (?, ?, 'product', ?, 'und', 'active', ?, ?, ?)
      `).run(entityId, householdId, command.corrected.canonicalLabel.trim(), JSON.stringify({ eventId }), now, now);
      this.database.prepare(`
        INSERT INTO household_semantic_aliases
          (id, household_id, entity_id, alias, normalized_alias, locale, status, evidence_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 'und', 'active', ?, ?, ?)
      `).run(
        `alias:${eventId}`, householdId, entityId, command.source.rawClause,
        normalizeName(command.source.rawClause), JSON.stringify([eventId]), now, now,
      );
      this.database.prepare(`
        INSERT INTO household_learning_effects
          (id, household_id, kind, value_json, applicability_json, status, supporting_event_ids_json, created_at, updated_at)
        VALUES (?, ?, 'canonical_label', ?, ?, 'active', ?, ?, ?)
      `).run(
        `label:${eventId}`, householdId, JSON.stringify({ label: command.corrected.canonicalLabel.trim(), entityId }),
        JSON.stringify({ identityRefs: [identityKey], identityDescriptorValueIds: [], sourceAliasKey: normalizeName(command.source.rawClause), applyOnlyWhenFieldAbsent: true }),
        JSON.stringify([eventId]), now, now,
      );
    }
    const applicability = JSON.stringify({
      identityRefs: [identityKey],
      identityDescriptorValueIds: [],
      applyOnlyWhenFieldAbsent: true,
    });
    if (command.corrected.unitId) {
      this.database.prepare(`
        INSERT INTO household_learning_effects
          (id, household_id, kind, value_json, applicability_json, status, supporting_event_ids_json, created_at, updated_at)
        VALUES (?, ?, 'unit_default', ?, ?, 'active', ?, ?, ?)
      `).run(
        `unit:${eventId}`, householdId,
        JSON.stringify({ unitId: command.corrected.unitId }), applicability,
        JSON.stringify([eventId]), now, now,
      );
    }
    if (command.corrected.packageSize !== undefined && command.corrected.packageUnitId) {
      this.database.prepare(`
        INSERT INTO household_learning_effects
          (id, household_id, kind, value_json, applicability_json, status, supporting_event_ids_json, created_at, updated_at)
        VALUES (?, ?, 'package_default', ?, ?, 'active', ?, ?, ?)
      `).run(
        `package:${eventId}`, householdId,
        JSON.stringify({ size: command.corrected.packageSize, unitId: command.corrected.packageUnitId }), applicability,
        JSON.stringify([eventId]), now, now,
      );
    }
    for (const [index, descriptor] of (command.corrected.descriptors ?? []).entries()) {
      const value = descriptor.valueId ?? descriptor.value;
      if (value === undefined) continue;
      this.database.prepare(`
        INSERT INTO household_learning_effects
          (id, household_id, kind, value_json, applicability_json, status, supporting_event_ids_json, created_at, updated_at)
        VALUES (?, ?, 'descriptor_value', ?, ?, 'active', ?, ?, ?)
      `).run(
        `descriptor:${eventId}:${index}`, householdId,
        JSON.stringify({ attributeId: descriptor.attributeId, valueId: descriptor.valueId ?? null, value }),
        JSON.stringify({ identityRefs: [identityKey], identityDescriptorValueIds: [String(value)], applyOnlyWhenFieldAbsent: false }),
        JSON.stringify([eventId]), now, now,
      );
    }
    for (const [index, role] of (command.corrected.brandRoles ?? []).entries()) {
      this.database.prepare(`
        INSERT INTO household_learning_effects
          (id, household_id, kind, value_json, applicability_json, status, supporting_event_ids_json, created_at, updated_at)
        VALUES (?, ?, 'commercial_role', ?, ?, 'active', ?, ?, ?)
      `).run(
        `role:${eventId}:${index}`, householdId,
        JSON.stringify({ role: role.role, organizationId: role.organizationRef.id }),
        JSON.stringify({ identityRefs: [identityKey], identityDescriptorValueIds: [], applyOnlyWhenFieldAbsent: false }),
        JSON.stringify([eventId]), now, now,
      );
    }
    if (command.corrected.shopTypeDecisions?.length) {
      this.database.prepare(`
        INSERT INTO household_learning_effects
          (id, household_id, kind, value_json, applicability_json, status, supporting_event_ids_json, created_at, updated_at)
        VALUES (?, ?, 'shop_eligibility', ?, ?, 'active', ?, ?, ?)
      `).run(
        `shop:${eventId}`, householdId,
        JSON.stringify({ tagIds: command.corrected.shopTypeDecisions.filter(({ decision }) => decision === 'include').map(({ tagId }) => tagId) }),
        JSON.stringify({ identityRefs: [identityKey], identityDescriptorValueIds: [], applyOnlyWhenFieldAbsent: false }),
        JSON.stringify([eventId]), now, now,
      );
    }
    return entries;
  }

  private ensureSemanticVariantKey(): void {
    const columns = this.database.prepare('PRAGMA table_info(shopping_items)').all() as Array<{ name: string }>;
    if (!columns.some((column) => column.name === 'semantic_variant_key')) {
      this.database.exec("ALTER TABLE shopping_items ADD COLUMN semantic_variant_key TEXT NOT NULL DEFAULT ''");
    }
    this.database.prepare(`
      UPDATE shopping_items
      SET semantic_variant_key = CASE
        WHEN semantic_variant_key = '' THEN json_array(normalized_name, unit, package_size, package_unit)
        ELSE semantic_variant_key
      END
      WHERE semantic_variant_key = ''
    `).run();
  }

  private ensureShoppingListBoundary(): void {
    const columns = this.database.prepare('PRAGMA table_info(shopping_items)').all() as Array<{ name: string }>;
    if (!columns.some((column) => column.name === 'shopping_list_id')) {
      this.database.exec('ALTER TABLE shopping_items ADD COLUMN shopping_list_id TEXT');
    }
    this.migrateConversationSessionLifecycle();
    const sessionColumns = this.database.prepare('PRAGMA table_info(conversation_sessions)').all() as Array<{ name: string }>;
    if (!sessionColumns.some((column) => column.name === 'shopping_list_id')) {
      this.database.exec('ALTER TABLE conversation_sessions ADD COLUMN shopping_list_id TEXT');
    }

    const households = this.database.prepare(`
      SELECT household_id FROM shopping_items
      UNION
      SELECT household_id FROM conversation_sessions
      UNION
      SELECT household_id FROM household_capture_settings
      UNION
      SELECT household_id FROM shopping_list_archives
    `).all() as Array<{ household_id: string }>;
    const now = this.clock().toISOString();
    const create = this.database.prepare(`
      INSERT OR IGNORE INTO shopping_lists
        (id, household_id, name, status, is_default, created_at, updated_at)
      VALUES (?, ?, ?, 'active', 1, ?, ?)
    `);
    const defaultList = this.database.prepare(`
      SELECT id FROM shopping_lists
      WHERE household_id = ? AND is_default = 1
      ORDER BY created_at ASC, id ASC
      LIMIT 1
    `);
    const assign = this.database.prepare(`
      UPDATE shopping_items SET shopping_list_id = ?
      WHERE household_id = ? AND shopping_list_id IS NULL
    `);
    const assignSessions = this.database.prepare(`
      UPDATE conversation_sessions SET shopping_list_id = ?
      WHERE household_id = ? AND shopping_list_id IS NULL
    `);
    for (const household of households) {
      const id = `default:${household.household_id}`;
      create.run(id, household.household_id, 'Household list', now, now);
      const list = defaultList.get(household.household_id) as { id: string } | undefined;
      if (list) {
        assign.run(list.id, household.household_id);
        assignSessions.run(list.id, household.household_id);
      }
    }
  }

  private ensureCaptureSettingsColumns(): void {
    const columns = new Set((this.database.prepare('PRAGMA table_info(household_capture_settings)').all() as Array<{ name: string }>).map((column) => column.name));
    if (!columns.has('idle_threshold_seconds')) {
      this.database.exec('ALTER TABLE household_capture_settings ADD COLUMN idle_threshold_seconds INTEGER NOT NULL DEFAULT 1800');
    }
    if (!columns.has('grace_period_seconds')) {
      this.database.exec('ALTER TABLE household_capture_settings ADD COLUMN grace_period_seconds INTEGER NOT NULL DEFAULT 300');
    }
    if (!columns.has('warning_policy')) {
      this.database.exec("ALTER TABLE household_capture_settings ADD COLUMN warning_policy TEXT NOT NULL DEFAULT 'prompt'");
    }
    if (!columns.has('cloud_assist_on_save')) {
      this.database.exec('ALTER TABLE household_capture_settings ADD COLUMN cloud_assist_on_save INTEGER NOT NULL DEFAULT 0');
    }
    if (!columns.has('cloud_assist_while_typing')) {
      this.database.exec('ALTER TABLE household_capture_settings ADD COLUMN cloud_assist_while_typing INTEGER NOT NULL DEFAULT 0');
    }
    if (!columns.has('online_lookup_consent')) {
      this.database.exec('ALTER TABLE household_capture_settings ADD COLUMN online_lookup_consent INTEGER NOT NULL DEFAULT 0');
    }
    if (!columns.has('online_lookup_trigger')) {
      this.database.exec("ALTER TABLE household_capture_settings ADD COLUMN online_lookup_trigger TEXT NOT NULL DEFAULT 'manual'");
    }
  }

  private migrateConversationSessionLifecycle(): void {
    const table = this.database.prepare(`
      SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'conversation_sessions'
    `).get() as { sql: string } | undefined;
    if (!table?.sql || table.sql.includes("'close_pending'")) return;
    const columns = new Set((this.database.prepare('PRAGMA table_info(conversation_sessions)').all() as Array<{ name: string }>).map((column) => column.name));
    const expression = (column: string, fallback: string) => columns.has(column) ? column : fallback;
    this.database.exec('BEGIN IMMEDIATE');
    try {
      this.database.exec('ALTER TABLE conversation_sessions RENAME TO conversation_sessions_legacy_lifecycle');
      this.database.exec(`
        CREATE TABLE conversation_sessions (
          id TEXT PRIMARY KEY,
          household_id TEXT NOT NULL,
          shopping_list_id TEXT,
          context_id TEXT,
          status TEXT NOT NULL CHECK (status IN ('active', 'idle', 'close_pending', 'closed')),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          closed_at TEXT
        ) STRICT;
        INSERT INTO conversation_sessions
          (id, household_id, shopping_list_id, context_id, status, created_at, updated_at, closed_at)
        SELECT id, household_id, ${expression('shopping_list_id', 'NULL')}, ${expression('context_id', 'NULL')},
               status, created_at, updated_at, ${expression('closed_at', 'NULL')}
        FROM conversation_sessions_legacy_lifecycle;
        DROP TABLE conversation_sessions_legacy_lifecycle;
      `);
      this.database.exec('COMMIT');
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  listShoppingLists(householdId: string): ShoppingList[] {
    const rows = this.database.prepare(`
      SELECT id, household_id, name, status, is_default, created_at, updated_at
      FROM shopping_lists
      WHERE household_id = ?
      ORDER BY is_default DESC, created_at ASC, id ASC
    `).all(householdId) as Array<{
      id: string; household_id: string; name: string; status: 'active' | 'archived';
      is_default: number; created_at: string; updated_at: string;
    }>;
    return rows.map((row) => ({
      id: row.id,
      householdId: row.household_id,
      name: row.name,
      status: row.status,
      isDefault: row.is_default === 1,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  getDefaultShoppingList(householdId: string): ShoppingList {
    const existing = this.listShoppingLists(householdId).find((list) => list.isDefault);
    if (existing) return existing;
    const now = this.clock().toISOString();
    const list: ShoppingList = {
      id: `default:${householdId}`,
      householdId,
      name: 'Household list',
      status: 'active',
      isDefault: true,
      createdAt: now,
      updatedAt: now,
    };
    this.database.prepare(`
      INSERT OR IGNORE INTO shopping_lists
        (id, household_id, name, status, is_default, created_at, updated_at)
      VALUES (?, ?, ?, 'active', 1, ?, ?)
    `).run(list.id, householdId, list.name, now, now);
    return this.listShoppingLists(householdId).find((candidate) => candidate.isDefault) ?? list;
  }

  resolveShoppingList(householdId: string, shoppingListId?: string): ShoppingList {
    const list = shoppingListId
      ? this.listShoppingLists(householdId).find((candidate) => candidate.id === shoppingListId)
      : this.getDefaultShoppingList(householdId);
    if (!list || list.status !== 'active') throw new ShoppingListNotFoundError();
    return list;
  }

  private migrateLegacySchema(columns: Array<{ name: string }>): void {
    const names = new Set(columns.map((column) => column.name));
    const expression = (column: string, fallback: string) => names.has(column) ? column : fallback;
    this.database.exec('BEGIN IMMEDIATE');
    try {
      this.database.exec('ALTER TABLE shopping_items RENAME TO shopping_items_legacy');
      this.database.exec(CREATE_SHOPPING_ITEMS_TABLE);
      this.database.exec(`
        INSERT INTO shopping_items
          (id, household_id, capture_text, name, normalized_name, quantity, unit, package_size,
           package_unit, category_id, category_automatic_id, category_override_id, category_confidence, classification_runtime_versions,
           attributes_json, semantic_variant_key, brand_name, brand_id, product_id, concept_id, quantity_source, unit_source,
           unit_confirmed_at, status, removed_at, created_at, updated_at, version)
        SELECT
          id,
          household_id,
          ${expression('capture_text', 'name')},
          name,
          normalized_name,
          ${expression('quantity', 'NULL')},
          ${expression('unit', 'NULL')},
          ${expression('package_size', 'NULL')},
          ${expression('package_unit', 'NULL')},
          ${expression('category_id', "'unknown'")},
          ${expression('category_automatic_id', expression('category_id', "'unknown'"))},
          ${expression('category_override_id', 'NULL')},
          ${expression('category_confidence', "'unknown'")},
          ${expression('classification_runtime_versions', "'{}'")},
           ${expression('attributes_json', "'{}'")},
           ${expression('semantic_variant_key', `json_array(${expression('normalized_name', 'name')}, ${expression('unit', 'NULL')}, ${expression('package_size', 'NULL')}, ${expression('package_unit', 'NULL')})`)},
          ${expression('brand_name', 'NULL')},
          ${expression('brand_id', 'NULL')},
          ${expression('product_id', 'NULL')},
          ${expression('concept_id', 'NULL')},
          ${expression('quantity_source', 'NULL')},
          ${expression('unit_source', 'NULL')},
          ${expression('unit_confirmed_at', 'NULL')},
          status,
          ${expression('removed_at', 'NULL')},
          created_at,
          updated_at,
          ${expression('version', '1')}
        FROM shopping_items_legacy;
        DROP TABLE shopping_items_legacy;
        COMMIT;
      `);
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  listActive(
    householdId: string,
    includePurchased = false,
    includeRemoved = false,
    shoppingListId = this.getDefaultShoppingList(householdId).id,
  ): ShoppingItem[] {
    const statuses: ShoppingItemStatus[] = [
      'active',
      ...(includePurchased ? ['purchased' as const] : []),
      ...(includeRemoved ? ['removed' as const] : []),
    ];
    const placeholders = statuses.map(() => '?').join(', ');
    const rows = this.database
      .prepare(
        `SELECT id, household_id, shopping_list_id, capture_text, name, quantity, unit, package_size, package_unit,
                category_id, category_confidence, attributes_json, brand_name, brand_id, product_id, concept_id,
                quantity_source, unit_source, unit_confirmed_at,
                status, removed_at, created_at, updated_at, version
         FROM shopping_items
         WHERE household_id = ? AND shopping_list_id = ? AND status IN (${placeholders})
         ORDER BY created_at ASC`,
      )
      .all(householdId, shoppingListId, ...statuses) as unknown as ShoppingItemRow[];
    return rows.map((row) => this.withEffectiveShopTypes(toShoppingItem(row, this.semanticRuntime)));
  }

  private synchronizeRuntimeShopTypes(): void {
    const now = this.clock().toISOString();
    this.database.prepare(`
      UPDATE tag_definitions SET active = 0, updated_at = ?
      WHERE namespace = 'shop_type' AND scope = 'runtime' AND active = 1
    `).run(now);
    const upsert = this.database.prepare(`
      INSERT INTO tag_definitions
        (id, namespace, scope, household_id, canonical_key, label, active, created_at, updated_at)
      VALUES (?, 'shop_type', 'runtime', NULL, ?, ?, 1, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        namespace = excluded.namespace, scope = excluded.scope, household_id = NULL,
        canonical_key = excluded.canonical_key, label = excluded.label, active = 1,
        updated_at = excluded.updated_at
    `);
    this.semanticRuntime.shopTypes.forEach((shopType) => {
      upsert.run(
        shopType.id,
        shopType.id,
        this.semanticRuntime.displayLabels[shopType.id] ?? shopType.id,
        now,
        now,
      );
    });
  }

  getShoppingItemView(
    householdId: string,
    shopTypeId?: string,
    shoppingListId = this.getDefaultShoppingList(householdId).id,
  ): ShoppingItemView {
    const allItems = this.listActive(householdId, false, false, shoppingListId);
    const definitions = this.database.prepare(`
      SELECT id, label FROM tag_definitions
      WHERE namespace = 'shop_type' AND active = 1
        AND (scope = 'runtime' OR (scope = 'household' AND household_id = ?))
      ORDER BY label ASC, id ASC
    `).all(householdId) as Array<{ id: string; label: string }>;
    const unassigned = allItems.filter((item) => (item.shopTypes?.length ?? 0) === 0);
    const visible = shopTypeId === 'unassigned'
      ? unassigned
      : shopTypeId
      ? allItems.filter((item) => item.shopTypes?.some((shopType) => shopType.id === shopTypeId))
      : allItems;
    return {
      items: visible,
      activeDistinctCount: visible.length,
      appliedShopTypeId: shopTypeId ?? null,
      facets: [
        ...definitions.map((definition) => ({
        ...definition,
        activeDistinctCount: allItems.filter((item) => item.shopTypes?.some((shopType) => shopType.id === definition.id)).length,
        })),
        { id: 'unassigned', label: 'Unassigned', activeDistinctCount: unassigned.length },
      ],
    };
  }

  updateClassification(
    householdId: string,
    itemId: string,
    decisions: readonly { tagId: string; decision: 'include' | 'exclude' | 'clear' }[],
    expectedVersion: number,
    manageTransaction = true,
  ): ShoppingItem | undefined {
    const current = this.get(householdId, itemId);
    if (!current) return undefined;
    if (current.version !== expectedVersion) throw new ItemVersionConflictError(current);
    const now = this.clock().toISOString();
    if (manageTransaction) this.database.exec('BEGIN IMMEDIATE');
    try {
      const assignmentsBefore = this.classificationAssignments(itemId);
      const semanticIdentityKey = this.getBrainSemantic(itemId)?.identity.variantKey
        ?? this.automaticClassificationIdentityKey(itemId)
        ?? current.id;
      for (const change of decisions) {
        const definition = this.database.prepare(`
          SELECT id FROM tag_definitions
          WHERE id = ? AND namespace = 'shop_type' AND active = 1
            AND (scope = 'runtime' OR (scope = 'household' AND household_id = ?))
        `).get(change.tagId, householdId) as { id: string } | undefined;
        if (!definition) throw new Error('invalid_shop_type');
        if (change.decision === 'clear') {
          this.database.prepare(`
            UPDATE item_tag_assignments SET active = 0, updated_at = ?
            WHERE item_id = ? AND tag_id = ? AND origin = 'user' AND active = 1
          `).run(now, itemId, change.tagId);
          continue;
        }
        this.database.prepare(`
          INSERT INTO item_tag_assignments
            (item_id, tag_id, origin, decision, confidence, evidence_json, semantic_identity_key,
             runtime_versions_json, active, created_at, updated_at)
          VALUES (?, ?, 'user', ?, NULL, '[]', ?, '{}', 1, ?, ?)
          ON CONFLICT(item_id, tag_id, origin) DO UPDATE SET
            decision = excluded.decision, semantic_identity_key = excluded.semantic_identity_key,
            active = 1, updated_at = excluded.updated_at
        `).run(itemId, change.tagId, change.decision, semanticIdentityKey, now, now);
      }
      const updated = this.database.prepare(`
        UPDATE shopping_items SET updated_at = ?, version = version + 1
        WHERE id = ? AND household_id = ? AND version = ?
      `).run(now, itemId, householdId, expectedVersion) as { changes: number };
      if (Number(updated.changes) !== 1) throw new ItemVersionConflictError(this.get(householdId, itemId) ?? current);
      const after = this.get(householdId, itemId)!;
      this.insertShoppingItemEvent(
        householdId,
        `classification:${itemId}`,
        itemId,
        'merged',
        JSON.stringify({
          schemaVersion: 2,
          classificationEdit: true,
          before: current,
          after,
          assignmentsBefore,
          assignmentsAfter: this.classificationAssignments(itemId),
        }),
        now,
      );
      if (manageTransaction) this.database.exec('COMMIT');
    } catch (error) {
      if (manageTransaction) this.database.exec('ROLLBACK');
      throw error;
    }
    return this.get(householdId, itemId);
  }

  archiveActiveList(householdId: string): ShoppingListArchive {
    const activeItems = this.listActive(householdId);
    if (activeItems.length === 0) throw new EmptyShoppingListArchiveError();
    const archive: ShoppingListArchive = {
      id: randomUUID(),
      householdId,
      status: 'archived',
      items: activeItems,
      createdAt: this.clock().toISOString(),
      reopenedAt: null,
    };
    this.database.prepare(`
      INSERT INTO shopping_list_archives (id, household_id, items_json, created_at, reopened_at)
      VALUES (?, ?, ?, ?, NULL)
    `).run(archive.id, householdId, JSON.stringify(archive.items), archive.createdAt);
    return archive;
  }

  listShoppingListArchives(householdId: string): ShoppingListArchive[] {
    const rows = this.database.prepare(`
      SELECT id, household_id, items_json, created_at, reopened_at
      FROM shopping_list_archives
      WHERE household_id = ?
      ORDER BY created_at DESC, id DESC
    `).all(householdId) as unknown as ShoppingListArchiveRow[];
    return rows.map(toShoppingListArchive);
  }

  getShoppingListArchive(householdId: string, archiveId: string): ShoppingListArchive | undefined {
    const row = this.database.prepare(`
      SELECT id, household_id, items_json, created_at, reopened_at
      FROM shopping_list_archives
      WHERE id = ? AND household_id = ?
    `).get(archiveId, householdId) as ShoppingListArchiveRow | undefined;
    return row ? toShoppingListArchive(row) : undefined;
  }

  reopenShoppingListArchive(householdId: string, archiveId: string): ShoppingListArchive {
    const reopenedAt = this.clock().toISOString();
    const result = this.database.prepare(`
      UPDATE shopping_list_archives
      SET reopened_at = COALESCE(reopened_at, ?)
      WHERE id = ? AND household_id = ?
    `).run(reopenedAt, archiveId, householdId) as { changes: number };
    if (Number(result.changes) === 0) throw new ShoppingListArchiveNotFoundError();
    return this.getShoppingListArchive(householdId, archiveId)!;
  }

  copyShoppingListArchive(
    householdId: string,
    archiveId: string,
  ): { archive: ShoppingListArchive; items: ShoppingItem[] } {
    const archive = this.getShoppingListArchive(householdId, archiveId);
    if (!archive) throw new ShoppingListArchiveNotFoundError();
    const copied: ShoppingItem[] = [];
    this.database.exec('BEGIN IMMEDIATE');
    try {
      for (const source of archive.items) {
        const existing = this.findActiveVariantByFields(
          householdId,
          normalizeName(source.name),
          source.unit,
          source.packageSize,
          source.packageUnit,
        );
        if (existing) {
          continue;
        }
        const item = this.insertArchivedItemCopy(householdId, source);
        const semantic = resolveSemanticItem({
          captureText: source.captureText,
          name: source.name,
          quantity: source.quantity,
          unit: source.unit,
          packageSize: source.packageSize,
          packageUnit: source.packageUnit,
        }, this.semanticRuntime).item;
        this.applyAutomaticClassification(item, semantic, this.clock().toISOString(), false);
        this.copyCompatibleUserTagAssignments(source.id, item.id, semantic.identity.variantKey);
        copied.push(this.get(householdId, item.id)!);
      }
      this.database.exec('COMMIT');
      return { archive, items: copied };
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  private insertArchivedItemCopy(householdId: string, source: ShoppingItem): ShoppingItem {
    const now = this.clock().toISOString();
    const item: ShoppingItem = {
      ...source,
      id: randomUUID(),
      householdId,
      shoppingListId: this.getDefaultShoppingList(householdId).id,
      status: 'active',
      removedAt: null,
      createdAt: now,
      updatedAt: now,
      version: 1,
      attentionReasons: attentionReasonsForFields('active', source.quantity, source.unitSource),
    };
    this.database.prepare(`
      INSERT INTO shopping_items
        (id, household_id, shopping_list_id, capture_text, name, normalized_name, quantity, unit, package_size,
         package_unit, category_id, category_confidence, attributes_json, semantic_variant_key, brand_name, brand_id, product_id, concept_id, quantity_source, unit_source, unit_confirmed_at, status,
         removed_at, created_at, updated_at, version)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      item.id, householdId, item.shoppingListId, item.captureText, item.name, normalizeName(item.name), item.quantity,
      item.unit, item.packageSize, item.packageUnit, item.categoryId, item.categoryConfidence, JSON.stringify(item.attributes), item.semanticVariantKey ?? semanticVariantIdentityKey(item),
      item.brandName ?? null, item.brandId, item.productId, item.conceptId,
      item.quantitySource ?? null, item.unitSource, item.unitConfirmedAt, item.status, item.removedAt, item.createdAt, item.updatedAt, item.version,
    );
    return item;
  }

  private copyCompatibleUserTagAssignments(
    sourceItemId: string,
    targetItemId: string,
    semanticIdentityKey: string,
  ): void {
    const rows = this.database.prepare(`
      SELECT tag_id, origin, decision, confidence, evidence_json, semantic_identity_key,
             runtime_versions_json, created_at, updated_at
      FROM item_tag_assignments
      WHERE item_id = ? AND origin = 'user' AND active = 1 AND semantic_identity_key = ?
    `).all(sourceItemId, semanticIdentityKey) as Array<{
      tag_id: string;
      origin: 'automatic' | 'user';
      decision: 'include' | 'exclude';
      confidence: 'confirmed' | 'inferred' | 'unknown' | null;
      evidence_json: string;
      semantic_identity_key: string;
      runtime_versions_json: string;
      created_at: string;
      updated_at: string;
    }>;
    const now = this.clock().toISOString();
    const insert = this.database.prepare(`
      INSERT INTO item_tag_assignments
        (item_id, tag_id, origin, decision, confidence, evidence_json, semantic_identity_key,
         runtime_versions_json, active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
    `);
    rows.forEach((row) => insert.run(
      targetItemId,
      row.tag_id,
      row.origin,
      row.decision,
      row.confidence,
      row.evidence_json,
      row.semantic_identity_key,
      row.runtime_versions_json,
      now,
      now,
    ));
  }

  listConversationCandidates(householdId: string): ConversationItemCandidate[] {
    return this.listActive(householdId).map((item) => ({
      id: item.id,
      captureText: item.captureText,
      itemName: item.name,
      identityKey: normalizeName(item.name),
      quantity: item.quantity,
      unit: item.unit,
      packageSize: item.packageSize,
      packageUnit: item.packageUnit,
      category: { id: item.categoryId, confidence: item.categoryConfidence },
      attributes: item.attributes,
    }));
  }

  captureConversation(
    householdId: string,
    interpretation: ConversationInterpretation,
    decisions?: readonly ConversationDecision[],
    contextId?: string,
    idempotencyKey?: string,
    shoppingListId = this.getDefaultShoppingList(householdId).id,
  ): ConversationCaptureResult {
    this.database.exec('BEGIN IMMEDIATE');
    try {
      if (contextId && idempotencyKey) {
        const receipt = this.database.prepare(`
          SELECT result_json FROM conversation_capture_receipts
          WHERE context_id = ? AND idempotency_key = ?
        `).get(contextId, idempotencyKey) as { result_json: string } | undefined;
        if (receipt) {
          const replayed = JSON.parse(receipt.result_json) as ConversationCaptureResult;
          this.database.exec('COMMIT');
          return replayed;
        }
      }
      const session = this.findOrCreateActiveSession(householdId, contextId, shoppingListId);
      const now = this.clock().toISOString();
      const saved: ShoppingItem[] = [];
      const merged: ShoppingItem[] = [];
      const undo: UndoToken[] = [];
      const captureDecisions = decisions ?? interpretation.items.map((item) => ({
        kind: 'create' as const,
        item,
      }));
      for (const decision of captureDecisions) {
        if (decision.kind === 'draft') continue;
        const intent = decision.kind === 'merge' ? decision.delta : decision.item;
        const existing = decision.kind === 'merge'
          ? this.get(householdId, decision.itemId)
          : this.findActiveVariantByFields(
            householdId,
            intent.identityKey,
            intent.unit,
            intent.packageSize,
            intent.packageUnit,
            shoppingListId,
          );
        if (!existing) {
          const item = this.create(householdId, intent, undefined, undefined, shoppingListId);
          saved.push(item);
          this.insertShoppingItemEvent(
            householdId,
            session.id,
            item.id,
            'created',
          JSON.stringify({
            schemaVersion: 2,
            before: null,
            after: item,
            identityKey: semanticVariantIdentityKey(item),
              requestedQuantity: item.quantity,
              unit: item.unit,
              packageSize: item.packageSize,
              packageUnit: item.packageUnit,
            }),
            now,
          );
          continue;
        }

        const quantityDelta = intent.quantity ?? 0;
        const quantity = existing.quantity === null && intent.quantity === null
          ? null
          : (existing.quantity ?? 0) + quantityDelta;
        this.database.prepare(`
          UPDATE shopping_items
          SET quantity = ?, updated_at = ?, version = version + 1
          WHERE id = ? AND household_id = ? AND shopping_list_id = ?
        `).run(quantity, now, existing.id, householdId, shoppingListId);
        const updated = this.get(householdId, existing.id)!;
        const event = this.insertShoppingItemEvent(
          householdId,
          session.id,
          existing.id,
          'merged',
          JSON.stringify({
            schemaVersion: 2,
            before: existing,
            after: updated,
            identityKey: semanticVariantIdentityKey(updated),
            requestedQuantity: intent.quantity,
            unit: updated.unit,
            packageSize: updated.packageSize,
            packageUnit: updated.packageUnit,
            quantityDelta,
            previousQuantity: existing.quantity,
          }),
          now,
        );
        merged.push(updated);
        undo.push({ eventId: event.id, itemId: existing.id });
      }
      const unresolvedFragments = [
        ...interpretation.unresolved,
        ...captureDecisions
          .filter((decision): decision is Extract<ConversationDecision, { kind: 'draft' }> => (
            decision.kind === 'draft'
          ))
          .map((decision) => ({ text: decision.text, reason: decision.reason })),
      ];
      const drafts = unresolvedFragments.map((unresolved): ClarificationDraft => {
        const draft = {
          id: randomUUID(),
          householdId,
          sessionId: session.id,
          text: unresolved.text,
          reason: unresolved.reason,
          status: 'open' as const,
          createdAt: now,
          updatedAt: now,
        };
        this.database.prepare(`
          INSERT INTO conversation_drafts
            (id, household_id, session_id, text, reason, status, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          draft.id,
          draft.householdId,
          draft.sessionId,
          draft.text,
          draft.reason,
          draft.status,
          draft.createdAt,
          draft.updatedAt,
        );
        return draft;
      });

      const result = { session, pendingAction: null, saved, merged, drafts, undo };
      if (contextId && idempotencyKey) {
        this.database.prepare(`
          INSERT INTO conversation_capture_receipts
            (context_id, idempotency_key, result_json, created_at)
          VALUES (?, ?, ?, ?)
        `).run(contextId, idempotencyKey, JSON.stringify(result), now);
      }
      this.database.exec('COMMIT');
      return result;
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  private insertShoppingItemEvent(
    householdId: string,
    sessionId: string,
    itemId: string,
    type: ShoppingItemEvent['type'],
    payload: string,
    createdAt: string,
    inverseOfEventId: string | null = null,
  ): ShoppingItemEvent {
    const event: ShoppingItemEvent = {
      id: randomUUID(),
      itemId,
      sessionId,
      type,
      inverseOfEventId,
      payload,
      createdAt,
    };
    this.database.prepare(`
      INSERT INTO shopping_item_events
        (id, household_id, session_id, item_id, type, inverse_of_event_id, payload, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      event.id,
      householdId,
      event.sessionId,
      event.itemId,
      event.type,
      event.inverseOfEventId,
      event.payload,
      event.createdAt,
    );
    return event;
  }

  private findOrCreateActiveSession(
    householdId: string,
    contextId?: string,
    shoppingListId = this.getDefaultShoppingList(householdId).id,
  ): ConversationSession {
    const existing = this.database.prepare(`
      SELECT id, household_id, shopping_list_id, context_id, status, created_at, updated_at, closed_at
      FROM conversation_sessions
      WHERE household_id = ? AND shopping_list_id = ? AND status = 'active'
        AND (? IS NULL OR context_id = ?)
      LIMIT 1
    `).get(householdId, shoppingListId, contextId ?? null, contextId ?? null) as {
      id: string;
      household_id: string;
      shopping_list_id: string;
      context_id: string | null;
      status: 'active' | 'idle' | 'close_pending' | 'closed';
      created_at: string;
      updated_at: string;
      closed_at: null;
    } | undefined;
    if (existing) {
      return {
        id: existing.id,
        householdId: existing.household_id,
        shoppingListId: existing.shopping_list_id,
        contextId: existing.context_id,
        status: existing.status,
        createdAt: existing.created_at,
        updatedAt: existing.updated_at,
        closedAt: existing.closed_at,
      };
    }

    const now = this.clock().toISOString();
    const session: ConversationSession = {
      id: randomUUID(),
      householdId,
      shoppingListId,
      contextId: contextId ?? null,
      status: 'active',
      createdAt: now,
      updatedAt: now,
      closedAt: null,
    };
    this.database.prepare(`
      INSERT INTO conversation_sessions
        (id, household_id, shopping_list_id, context_id, status, created_at, updated_at, closed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, NULL)
    `).run(
      session.id, session.householdId, session.shoppingListId, session.contextId, session.status,
      session.createdAt, session.updatedAt,
    );
    return session;
  }

  getActiveConversationSession(householdId: string): ConversationSession | undefined {
    const row = this.database.prepare(`
      SELECT id, household_id, shopping_list_id, context_id, status, created_at, updated_at, closed_at
      FROM conversation_sessions
      WHERE household_id = ? AND status = 'active'
      LIMIT 1
    `).get(householdId) as {
      id: string;
      household_id: string;
      shopping_list_id: string;
      context_id: string | null;
      status: 'active' | 'idle' | 'close_pending' | 'closed';
      created_at: string;
      updated_at: string;
      closed_at: null;
    } | undefined;
    return row ? toConversationSession(row) : undefined;
  }

  getConversationSession(householdId: string, sessionId: string): ConversationSession | undefined {
    const row = this.database.prepare(`
      SELECT id, household_id, shopping_list_id, context_id, status, created_at, updated_at, closed_at
      FROM conversation_sessions
      WHERE id = ? AND household_id = ?
    `).get(sessionId, householdId) as {
      id: string;
      household_id: string;
      shopping_list_id: string;
      context_id: string | null;
      status: 'active' | 'idle' | 'close_pending' | 'closed';
      created_at: string;
      updated_at: string;
      closed_at: string | null;
    } | undefined;
    return row ? toConversationSession(row) : undefined;
  }

  getActiveConversationSessionForScope(
    householdId: string,
    shoppingListId: string,
    contextId: string,
  ): ConversationSession | undefined {
    const row = this.database.prepare(`
      SELECT id, household_id, shopping_list_id, context_id, status, created_at, updated_at, closed_at
      FROM conversation_sessions
      WHERE household_id = ? AND shopping_list_id = ? AND context_id = ?
        AND status IN ('active', 'idle', 'close_pending')
      ORDER BY updated_at DESC, id DESC
      LIMIT 1
    `).get(householdId, shoppingListId, contextId) as {
      id: string;
      household_id: string;
      shopping_list_id: string;
      context_id: string | null;
      status: 'active' | 'idle' | 'close_pending' | 'closed';
      created_at: string;
      updated_at: string;
      closed_at: string | null;
    } | undefined;
    return row ? toConversationSession(row) : undefined;
  }

  getConversationStateForScope(
    householdId: string,
    shoppingList: ShoppingList,
    contextId: string,
  ): {
    list: ShoppingList;
    session: ConversationSession | null;
    pendingAction: PendingConversationAction | null;
    drafts: ClarificationDraft[];
  } {
    const session = this.getActiveConversationSessionForScope(householdId, shoppingList.id, contextId) ?? null;
    const pendingAction = session
      ? this.getPendingConversationActionForSession(householdId, session.id) ?? null
      : null;
    const drafts = session ? this.listConversationDrafts(householdId, session.id) : [];
    return { list: shoppingList, session, pendingAction, drafts };
  }

  getPendingConversationAction(
    householdId: string,
    actionId: string,
  ): PendingConversationAction | undefined {
    const row = this.database.prepare(`
      SELECT id, household_id, shopping_list_id, context_id, session_id, type, origin,
             previous_status, status, expires_at, created_at, resolved_at
      FROM conversation_pending_actions
      WHERE id = ? AND household_id = ?
    `).get(actionId, householdId) as PendingConversationActionRow | undefined;
    return row ? toPendingConversationAction(row) : undefined;
  }

  getPendingConversationActionForSession(
    householdId: string,
    sessionId: string,
  ): PendingConversationAction | undefined {
    const row = this.database.prepare(`
      SELECT id, household_id, shopping_list_id, context_id, session_id, type, origin,
             previous_status, status, expires_at, created_at, resolved_at
      FROM conversation_pending_actions
      WHERE household_id = ? AND session_id = ? AND status = 'pending'
      ORDER BY created_at DESC, id DESC
      LIMIT 1
    `).get(householdId, sessionId) as PendingConversationActionRow | undefined;
    return row ? toPendingConversationAction(row) : undefined;
  }

  requestConversationClose(
    householdId: string,
    shoppingListId: string,
    contextId: string,
    origin: CloseActionOrigin,
    gracePeriodSeconds = 300,
  ): { session: ConversationSession; pendingAction: PendingConversationAction } | undefined {
    const session = this.getActiveConversationSessionForScope(householdId, shoppingListId, contextId);
    if (!session || (session.status !== 'active' && session.status !== 'idle')) return undefined;
    const existing = this.database.prepare(`
      SELECT id, household_id, shopping_list_id, context_id, session_id, type, origin,
             previous_status, status, expires_at, created_at, resolved_at
      FROM conversation_pending_actions
      WHERE household_id = ? AND session_id = ? AND status = 'pending'
      ORDER BY created_at DESC, id DESC LIMIT 1
    `).get(householdId, session.id) as PendingConversationActionRow | undefined;
    if (existing) {
      return { session: this.getConversationSession(householdId, session.id)!, pendingAction: toPendingConversationAction(existing) };
    }
    const now = this.clock();
    const pendingAction: PendingConversationAction = {
      id: randomUUID(),
      householdId,
      shoppingListId,
      contextId,
      sessionId: session.id,
      type: 'close_session',
      origin,
      previousStatus: session.status === 'idle' ? 'idle' : 'active',
      status: 'pending',
      expiresAt: new Date(now.getTime() + gracePeriodSeconds * 1000).toISOString(),
      createdAt: now.toISOString(),
      resolvedAt: null,
    };
    this.database.exec('BEGIN IMMEDIATE');
    try {
      this.database.prepare(`
        UPDATE conversation_sessions
        SET status = 'close_pending', updated_at = ?
        WHERE id = ? AND household_id = ? AND shopping_list_id = ? AND context_id = ?
      `).run(pendingAction.createdAt, session.id, householdId, shoppingListId, contextId);
      this.database.prepare(`
        INSERT INTO conversation_pending_actions
          (id, household_id, shopping_list_id, context_id, session_id, type, origin,
           previous_status, status, expires_at, created_at, resolved_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
      `).run(
        pendingAction.id, pendingAction.householdId, pendingAction.shoppingListId,
        pendingAction.contextId, pendingAction.sessionId, pendingAction.type,
        pendingAction.origin, pendingAction.previousStatus, pendingAction.status,
        pendingAction.expiresAt, pendingAction.createdAt,
      );
      this.database.exec('COMMIT');
      return {
        session: this.getConversationSession(householdId, session.id)!,
        pendingAction,
      };
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  evaluateAutomaticConversationClose(
    householdId: string,
    shoppingListId: string,
    contextId: string,
  ): { session: ConversationSession; pendingAction: PendingConversationAction } | undefined {
    const settings = this.getHouseholdCaptureSettings(householdId);
    if (settings.automaticConversationClose !== 'after_idle') return undefined;
    const session = this.getActiveConversationSessionForScope(householdId, shoppingListId, contextId);
    if (!session) return undefined;
    if (session.status === 'close_pending') {
      const pending = this.getPendingConversationActionForSession(householdId, session.id);
      if (!pending || settings.warningPolicy !== 'silent') return pending
        ? { session, pendingAction: pending }
        : undefined;
      if (new Date(pending.expiresAt).getTime() > this.clock().getTime()) {
        return { session, pendingAction: pending };
      }
      return this.confirmConversationClose(householdId, pending.id, shoppingListId, contextId);
    }
    if (session.status !== 'active' && session.status !== 'idle') return undefined;
    const elapsed = this.clock().getTime() - new Date(session.updatedAt).getTime();
    if (elapsed < settings.idleThresholdSeconds * 1000) return undefined;
    return this.requestConversationClose(
      householdId,
      shoppingListId,
      contextId,
      'configured_idle_policy',
      settings.gracePeriodSeconds,
    );
  }

  confirmConversationClose(
    householdId: string,
    actionId: string,
    shoppingListId: string,
    contextId: string,
  ): { session: ConversationSession; pendingAction: PendingConversationAction } | undefined {
    const pending = this.getPendingConversationAction(householdId, actionId);
    if (!pending || pending.shoppingListId !== shoppingListId || pending.contextId !== contextId) return undefined;
    if (pending.status !== 'pending') {
      const session = this.getConversationSession(householdId, pending.sessionId);
      return session ? { session, pendingAction: pending } : undefined;
    }
    const now = this.clock();
    const expired = new Date(pending.expiresAt).getTime() <= now.getTime();
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const status = expired ? 'expired' : 'confirmed';
      const sessionStatus = expired ? pending.previousStatus : 'closed';
      this.database.prepare(`
        UPDATE conversation_pending_actions
        SET status = ?, resolved_at = ?
        WHERE id = ? AND household_id = ? AND status = 'pending'
      `).run(status, now.toISOString(), actionId, householdId);
      this.database.prepare(`
        UPDATE conversation_sessions
        SET status = ?, updated_at = ?, closed_at = CASE WHEN ? = 'closed' THEN ? ELSE closed_at END
        WHERE id = ? AND household_id = ? AND shopping_list_id = ? AND context_id = ?
      `).run(
        sessionStatus, now.toISOString(), sessionStatus, now.toISOString(),
        pending.sessionId, householdId, shoppingListId, contextId,
      );
      this.database.exec('COMMIT');
      return {
        session: this.getConversationSession(householdId, pending.sessionId)!,
        pendingAction: this.getPendingConversationAction(householdId, actionId)!,
      };
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  cancelConversationClose(
    householdId: string,
    sessionId: string,
    shoppingListId: string,
    contextId: string,
  ): void {
    const pending = this.database.prepare(`
      SELECT id, previous_status FROM conversation_pending_actions
      WHERE household_id = ? AND session_id = ? AND shopping_list_id = ? AND context_id = ? AND status = 'pending'
      ORDER BY created_at DESC, id DESC LIMIT 1
    `).get(householdId, sessionId, shoppingListId, contextId) as { id: string; previous_status: 'active' | 'idle' } | undefined;
    if (!pending) return;
    const now = this.clock().toISOString();
    this.database.exec('BEGIN IMMEDIATE');
    try {
      this.database.prepare(`
        UPDATE conversation_pending_actions SET status = 'cancelled', resolved_at = ?
        WHERE id = ? AND household_id = ? AND status = 'pending'
      `).run(now, pending.id, householdId);
      this.database.prepare(`
        UPDATE conversation_sessions SET status = ?, updated_at = ?
        WHERE id = ? AND household_id = ? AND shopping_list_id = ? AND context_id = ?
      `).run(pending.previous_status, now, sessionId, householdId, shoppingListId, contextId);
      this.database.exec('COMMIT');
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  cancelConversationCloseAction(
    householdId: string,
    actionId: string,
    shoppingListId: string,
    contextId: string,
  ): ConversationSession | undefined {
    const pending = this.getPendingConversationAction(householdId, actionId);
    if (!pending || pending.shoppingListId !== shoppingListId || pending.contextId !== contextId) return undefined;
    this.cancelConversationClose(householdId, pending.sessionId, shoppingListId, contextId);
    return this.getConversationSession(householdId, pending.sessionId);
  }

  closeConversationSession(
    householdId: string,
    sessionId: string,
    contextId?: string,
  ): ConversationSession | undefined {
    const current = this.getConversationSession(householdId, sessionId);
    if (!current) return undefined;
    if (current.status === 'closed') return current;
    if (current.contextId !== (contextId ?? null)) return undefined;
    const now = this.clock().toISOString();
    const result = this.database.prepare(`
      UPDATE conversation_sessions
      SET status = 'closed', updated_at = ?, closed_at = ?
      WHERE id = ? AND household_id = ? AND status = 'active'
    `).run(now, now, sessionId, householdId) as { changes: number };
    if (Number(result.changes) === 0) return undefined;
    const row = this.database.prepare(`
      SELECT id, household_id, shopping_list_id, context_id, status, created_at, updated_at, closed_at
      FROM conversation_sessions
      WHERE id = ? AND household_id = ?
    `).get(sessionId, householdId) as {
      id: string;
      household_id: string;
      shopping_list_id: string;
      context_id: string | null;
      status: 'active' | 'idle' | 'close_pending' | 'closed';
      created_at: string;
      updated_at: string;
      closed_at: string;
    };
    return toConversationSession(row);
  }

  listConversationDrafts(
    householdId: string,
    sessionId: string,
  ): ClarificationDraft[] {
    const rows = this.database.prepare(`
      SELECT id, household_id, session_id, text, reason, status, created_at, updated_at
      FROM conversation_drafts
      WHERE household_id = ? AND session_id = ?
      ORDER BY created_at ASC, id ASC
    `).all(householdId, sessionId) as Array<{
      id: string;
      household_id: string;
      session_id: string;
      text: string;
      reason: ClarificationDraft['reason'];
      status: ClarificationDraft['status'];
      created_at: string;
      updated_at: string;
    }>;
    return rows.map(toClarificationDraft);
  }

  getConversationDraft(
    householdId: string,
    draftId: string,
  ): ClarificationDraft | undefined {
    const row = this.database.prepare(`
      SELECT id, household_id, session_id, text, reason, status, created_at, updated_at
      FROM conversation_drafts
      WHERE id = ? AND household_id = ?
    `).get(draftId, householdId) as {
      id: string;
      household_id: string;
      session_id: string;
      text: string;
      reason: ClarificationDraft['reason'];
      status: ClarificationDraft['status'];
      created_at: string;
      updated_at: string;
    } | undefined;
    return row ? toClarificationDraft(row) : undefined;
  }

  setConversationDraftStatus(
    householdId: string,
    draftId: string,
    status: 'resolved' | 'dismissed',
  ): ClarificationDraft | undefined {
    const now = this.clock().toISOString();
    const result = this.database.prepare(`
      UPDATE conversation_drafts
      SET status = ?, updated_at = ?
      WHERE id = ? AND household_id = ? AND status = 'open'
    `).run(status, now, draftId, householdId) as { changes: number };
    return Number(result.changes) === 0
      ? undefined
      : this.getConversationDraft(householdId, draftId);
  }

  getHouseholdCaptureSettings(householdId: string): HouseholdCaptureSettings {
    const row = this.database.prepare(`
      SELECT automatic_conversation_close, idle_threshold_seconds, grace_period_seconds,
             warning_policy, cloud_draft_assist, cloud_assist_on_save, cloud_assist_while_typing,
             online_lookup_consent, online_lookup_trigger, suggestions
      FROM household_capture_settings
      WHERE household_id = ?
    `).get(householdId) as {
      automatic_conversation_close: HouseholdCaptureSettings['automaticConversationClose'];
      idle_threshold_seconds: number;
      grace_period_seconds: number;
      warning_policy: HouseholdCaptureSettings['warningPolicy'];
      cloud_draft_assist: HouseholdCaptureSettings['cloudDraftAssist'];
      cloud_assist_on_save: number;
      cloud_assist_while_typing: number;
      online_lookup_consent: number;
      online_lookup_trigger: 'manual' | 'on_idle';
      suggestions: HouseholdCaptureSettings['suggestions'];
    } | undefined;
    return row ? {
      automaticConversationClose: row.automatic_conversation_close,
      idleThresholdSeconds: row.idle_threshold_seconds,
      gracePeriodSeconds: row.grace_period_seconds,
      warningPolicy: row.warning_policy,
      cloudDraftAssist: row.cloud_draft_assist,
      cloudAssistOnSave: row.cloud_assist_on_save === 1,
      cloudAssistWhileTyping: row.cloud_assist_while_typing === 1,
      onlineLookupConsent: row.online_lookup_consent === 1,
      onlineLookupTrigger: row.online_lookup_trigger,
      suggestions: row.suggestions,
      entitlement: this.getHouseholdEntitlement(householdId),
    } : {
      automaticConversationClose: 'off',
      idleThresholdSeconds: 1800,
      gracePeriodSeconds: 300,
      warningPolicy: 'prompt',
      cloudDraftAssist: 'disabled',
      cloudAssistOnSave: false,
      cloudAssistWhileTyping: false,
      onlineLookupConsent: false,
      onlineLookupTrigger: 'manual',
      suggestions: 'enabled',
      entitlement: this.getHouseholdEntitlement(householdId),
    };
  }

  setHouseholdCaptureSettings(
    householdId: string,
    settings: HouseholdCaptureSettingsUpdate,
  ): HouseholdCaptureSettings {
    const normalized = {
      ...settings,
      onlineLookupConsent: settings.onlineLookupConsent ?? false,
      onlineLookupTrigger: settings.onlineLookupTrigger ?? 'manual' as const,
    };
    const entitlement = this.getHouseholdEntitlement(householdId);
    if (entitlement !== 'premium' && (normalized.cloudAssistOnSave || normalized.cloudAssistWhileTyping || normalized.onlineLookupConsent)) {
      throw new Error('premium_entitlement_required');
    }
    this.database.prepare(`
      INSERT INTO household_capture_settings
        (household_id, automatic_conversation_close, idle_threshold_seconds, grace_period_seconds,
         warning_policy, cloud_draft_assist, cloud_assist_on_save, cloud_assist_while_typing,
         online_lookup_consent, online_lookup_trigger, suggestions, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(household_id) DO UPDATE SET
        automatic_conversation_close = excluded.automatic_conversation_close,
        idle_threshold_seconds = excluded.idle_threshold_seconds,
        grace_period_seconds = excluded.grace_period_seconds,
        warning_policy = excluded.warning_policy,
        cloud_draft_assist = excluded.cloud_draft_assist,
        cloud_assist_on_save = excluded.cloud_assist_on_save,
        cloud_assist_while_typing = excluded.cloud_assist_while_typing,
        online_lookup_consent = excluded.online_lookup_consent,
        online_lookup_trigger = excluded.online_lookup_trigger,
        suggestions = excluded.suggestions,
        updated_at = excluded.updated_at
    `).run(
      householdId,
      normalized.automaticConversationClose,
      normalized.idleThresholdSeconds,
      normalized.gracePeriodSeconds,
      normalized.warningPolicy,
      normalized.cloudDraftAssist,
      normalized.cloudAssistOnSave ? 1 : 0,
      normalized.cloudAssistWhileTyping ? 1 : 0,
      normalized.onlineLookupConsent ? 1 : 0,
      normalized.onlineLookupTrigger,
      normalized.suggestions,
      this.clock().toISOString(),
    );
    return { ...normalized, entitlement };
  }

  getHouseholdEntitlement(householdId: string): 'free' | 'premium' {
    const row = this.database.prepare('SELECT plan FROM household_entitlements WHERE household_id = ?').get(householdId) as { plan: 'free' | 'premium' } | undefined;
    return row?.plan ?? 'free';
  }

  recordOnlineLookupReceipt(
    householdId: string,
    normalizedPhrase: string,
    providerId: string,
    candidate: unknown,
    runtimeVersions: Readonly<Record<string, string>>,
    ttlMilliseconds = 5 * 60 * 1000,
  ): { token: string; expiresAt: string } {
    const token = randomUUID();
    const expiresAt = new Date(this.clock().getTime() + ttlMilliseconds).toISOString();
    this.database.prepare(`
      INSERT INTO online_lookup_receipts
        (token, household_id, normalized_phrase, provider_id, candidate_json, runtime_versions_json, expires_at, accepted_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, NULL)
    `).run(token, householdId, this.lookupPhraseKey(householdId, normalizedPhrase), providerId, JSON.stringify(candidate), JSON.stringify(runtimeVersions), expiresAt);
    return { token, expiresAt };
  }

  getOnlineLookupCandidate(
    householdId: string,
    countryCode: string,
    locale: string,
    normalizedPhrase: string,
    runtimeVersions: Readonly<Record<string, string>>,
  ): { providerId: string; candidate: unknown } | null {
    const now = this.clock().toISOString();
    this.database.prepare('DELETE FROM online_lookup_cache WHERE expires_at <= ?').run(now);
    const row = this.database.prepare(`
      SELECT provider_id, candidate_json, runtime_versions_json, expires_at
      FROM online_lookup_cache
      WHERE cache_key = ?
    `).get(this.lookupCacheKey(householdId, countryCode, locale, normalizedPhrase, runtimeVersions)) as {
      provider_id: string;
      candidate_json: string;
      runtime_versions_json: string;
      expires_at: string;
    } | undefined;
    if (!row || row.expires_at <= now || row.runtime_versions_json !== JSON.stringify(runtimeVersions)) return null;
    return { providerId: row.provider_id, candidate: JSON.parse(row.candidate_json) };
  }

  recordOnlineLookupCandidate(
    householdId: string,
    countryCode: string,
    locale: string,
    normalizedPhrase: string,
    providerId: string,
    candidate: unknown,
    runtimeVersions: Readonly<Record<string, string>>,
    ttlMilliseconds = 24 * 60 * 60 * 1000,
  ): void {
    const now = this.clock().toISOString();
    const expiresAt = new Date(this.clock().getTime() + ttlMilliseconds).toISOString();
    this.database.prepare(`
      INSERT INTO online_lookup_cache
        (cache_key, provider_id, candidate_json, runtime_versions_json, expires_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(cache_key) DO UPDATE SET
        provider_id = excluded.provider_id,
        candidate_json = excluded.candidate_json,
        runtime_versions_json = excluded.runtime_versions_json,
        expires_at = excluded.expires_at,
        created_at = excluded.created_at
    `).run(
      this.lookupCacheKey(householdId, countryCode, locale, normalizedPhrase, runtimeVersions),
      providerId,
      JSON.stringify(candidate),
      JSON.stringify(runtimeVersions),
      expiresAt,
      now,
    );
  }

  acceptOnlineLookupReceipt(
    householdId: string,
    token: string,
    normalizedPhrase: string,
    runtimeVersions: Readonly<Record<string, string>>,
  ): { providerId: string; candidate: unknown; expiresAt: string } | null {
    const row = this.database.prepare(`
      SELECT normalized_phrase, provider_id, candidate_json, runtime_versions_json, expires_at, accepted_at
      FROM online_lookup_receipts
      WHERE token = ? AND household_id = ?
    `).get(token, householdId) as { normalized_phrase: string; provider_id: string; candidate_json: string; runtime_versions_json: string; expires_at: string; accepted_at: string | null } | undefined;
    if (!row || row.expires_at <= this.clock().toISOString()
      || row.accepted_at !== null
      || row.runtime_versions_json !== JSON.stringify(runtimeVersions)
      || row.normalized_phrase !== this.lookupPhraseKey(householdId, normalizedPhrase)) return null;
    const updated = this.database.prepare(
      'UPDATE online_lookup_receipts SET accepted_at = ? WHERE token = ? AND household_id = ? AND accepted_at IS NULL',
    ).run(this.clock().toISOString(), token, householdId);
    if (updated.changes !== 1) return null;
    return { providerId: row.provider_id, candidate: JSON.parse(row.candidate_json), expiresAt: row.expires_at };
  }

  private normalizeLookupPhrase(text: string): string {
    return text.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLocaleLowerCase('en-IN');
  }

  private lookupPhraseKey(householdId: string, text: string): string {
    return createHash('sha256').update(`${householdId}\u0000${this.normalizeLookupPhrase(text)}`).digest('hex');
  }

  private lookupCacheKey(
    householdId: string,
    countryCode: string,
    locale: string,
    text: string,
    runtimeVersions: Readonly<Record<string, string>>,
  ): string {
    return createHash('sha256').update([
      householdId,
      countryCode.toUpperCase(),
      locale,
      this.normalizeLookupPhrase(text),
      JSON.stringify(runtimeVersions),
    ].join('\u0000')).digest('hex');
  }

  setHouseholdEntitlement(householdId: string, plan: 'free' | 'premium'): 'free' | 'premium' {
    this.database.prepare(`
      INSERT INTO household_entitlements (household_id, plan, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(household_id) DO UPDATE SET plan = excluded.plan, updated_at = excluded.updated_at
    `).run(householdId, plan, this.clock().toISOString());
    return plan;
  }

  listHouseholdSuggestions(householdId: string): HouseholdSuggestion[] {
    if (this.getHouseholdCaptureSettings(householdId).suggestions === 'disabled') return [];
    const hidden = new Set((this.database.prepare(`
      SELECT identity_key FROM household_suggestion_feedback
      WHERE household_id = ? AND status IN ('dismissed', 'accepted')
    `).all(householdId) as Array<{ identity_key: string }>).map((row) => row.identity_key));
    const rows = this.database.prepare(`
      SELECT event.id, event.payload
      FROM shopping_item_events AS event
      WHERE event.household_id = ?
        AND event.type IN ('created', 'merged', 'quantity_adjusted')
        AND NOT EXISTS (
          SELECT 1 FROM shopping_item_events AS reversal
          WHERE reversal.household_id = event.household_id
            AND reversal.inverse_of_event_id = event.id
        )
      ORDER BY event.created_at ASC, event.id ASC
    `).all(householdId) as Array<{ id: string; payload: string }>;
    const groups = new Map<string, {
      eventIds: string[];
      latest: SuggestionEventPayload;
    }>();
    for (const row of rows) {
      const payload = parseSuggestionEventPayload(row.payload);
      if (!payload) continue;
      const group = groups.get(payload.identityKey) ?? { eventIds: [], latest: payload };
      group.eventIds.push(row.id);
      group.latest = payload;
      groups.set(payload.identityKey, group);
    }

    return [...groups.entries()]
      .filter(([identityKey, group]) => group.eventIds.length >= 2 && !hidden.has(identityKey))
      .map(([itemIdentityKey, group]) => ({
        itemIdentityKey,
        message: suggestionMessage(group.latest),
        sourceEventIds: group.eventIds,
      }));
  }

  setSuggestionFeedback(
    householdId: string,
    identityKey: string,
    status: 'accepted' | 'dismissed',
  ): { itemIdentityKey: string; status: 'accepted' | 'dismissed' } {
    this.database.prepare(`
      INSERT INTO household_suggestion_feedback
        (household_id, identity_key, status, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(household_id, identity_key) DO UPDATE SET
        status = excluded.status,
        updated_at = excluded.updated_at
    `).run(householdId, identityKey, status, this.clock().toISOString());
    if (status === 'accepted') {
      const events = this.database.prepare(`
        SELECT id, payload FROM shopping_item_events
        WHERE household_id = ? AND type IN ('created', 'merged', 'quantity_adjusted')
        ORDER BY created_at ASC, id ASC
      `).all(householdId) as Array<{ id: string; payload: string }>;
      const supporting = events.flatMap((event) => {
        const payload = parseSuggestionEventPayload(event.payload);
        return payload?.identityKey === identityKey ? [event.id] : [];
      });
      const latest = events.flatMap((event) => {
        const payload = parseSuggestionEventPayload(event.payload);
        return payload?.identityKey === identityKey ? [payload] : [];
      }).at(-1);
      if (latest && supporting.length > 0) {
        this.saveLearnedSemanticEntry({
          id: `suggestion:${householdId}:${identityKey}`,
          householdId,
          kind: 'quantity_preference',
          value: { identityKey, requestedQuantity: latest.requestedQuantity ?? 0, unit: latest.unit ?? '', packageSize: latest.packageSize ?? 0, packageUnit: latest.packageUnit ?? '' },
          supportingEventIds: supporting,
          status: 'active',
        });
      }
    }
    return { itemIdentityKey: identityKey, status };
  }

  restoreSuggestion(
    householdId: string,
    identityKey: string,
  ): { itemIdentityKey: string; status: 'restored' } {
    this.database.prepare(`
      DELETE FROM household_suggestion_feedback
      WHERE household_id = ? AND identity_key = ?
    `).run(householdId, identityKey);
    this.database.prepare(`
      UPDATE household_semantic_learning SET status = 'active', updated_at = ?
      WHERE household_id = ? AND id = ?
    `).run(this.clock().toISOString(), householdId, `suggestion:${householdId}:${identityKey}`);
    return { itemIdentityKey: identityKey, status: 'restored' };
  }

  backfillBrandNames(hints: readonly BrandHint[]): void {
    const update = this.database.prepare(`
      UPDATE shopping_items
      SET brand_name = ?
      WHERE brand_name IS NULL
        AND (normalized_name = ? OR normalized_name LIKE ?)
    `);
    for (const hint of hints) {
      const label = hint.label.trim();
      for (const alias of hint.aliases) {
        const normalizedAlias = normalizeName(alias);
        if (!label || !normalizedAlias) continue;
        update.run(label, normalizedAlias, `${normalizedAlias} %`);
      }
    }
  }

  create(
    householdId: string,
    capture: ItemIntent,
    confirmedUnit?: string,
    product?: ResolvedRegionalProduct,
    shoppingListId = this.getDefaultShoppingList(householdId).id,
    itemId: string = randomUUID(),
  ): ShoppingItem {
    const now = this.clock().toISOString();
    const displayName = product?.displayName ?? capture.itemName;
    const normalizedName = normalizeName(displayName);
    const explicitUnit = confirmedUnit?.trim() ?? capture.unit;
    const historicalUnit = explicitUnit === null
      ? this.findLatestConfirmedUnit(householdId, normalizedName)
      : null;
    const unit = explicitUnit ?? historicalUnit;
    const semantic = resolveSemanticItem({
      captureText: capture.captureText,
      name: displayName,
      quantity: capture.quantity,
      unit,
      packageSize: capture.packageSize,
      packageUnit: capture.packageUnit,
    }, this.semanticRuntime).item;
    const classification = classifyShoppingItem(semantic, this.semanticRuntime);
    const classifiedQuantity = classification.defaultedQuantity.value;
    const classifiedUnit = classification.defaultedUnitId.value;
    const classifiedUnitSource = unitSourceForCreation(
      explicitUnit,
      historicalUnit,
      classification.defaultedUnitId.source,
    );
    const semanticDuplicate = this.findActiveVariantByFields(
      householdId,
      semantic.identity.variantKey,
      classifiedUnit,
      capture.packageSize,
      capture.packageUnit,
      shoppingListId,
    );
    if (semanticDuplicate) throw new DuplicateShoppingItemError(semanticDuplicate.id);
    const item = {
      id: itemId,
      householdId,
      shoppingListId,
      captureText: capture.captureText,
      name: displayName,
      normalizedName,
      quantity: classifiedQuantity,
      unit: classifiedUnit,
      packageSize: capture.packageSize,
      packageUnit: capture.packageUnit,
      semanticVariantKey: semantic.identity.variantKey,
      categoryId: classification.automaticCategory.value ?? 'unknown',
      categoryConfidence: classification.automaticCategory.confidence,
      attributes: Object.fromEntries(Object.entries(semantic.attributes).map(([id, value]) => [id, value.value])),
      ...(capture.brandName ? { brandName: capture.brandName } : {}),
      brandId: product?.brandId ?? null,
      productId: product?.productId ?? null,
      conceptId: product?.conceptId ?? null,
      quantitySource: classification.defaultedQuantity.source,
      unitSource: classifiedUnitSource,
      unitConfirmedAt: classifiedUnitSource === 'explicit' ? now : null,
      attentionReasons: attentionReasonsForFields('active', classifiedQuantity, classifiedUnitSource),
      status: 'active' as const,
      removedAt: null,
      createdAt: now,
      updatedAt: now,
      version: 1,
    };

    try {
      this.database
        .prepare(
          `INSERT INTO shopping_items
           (id, household_id, shopping_list_id, capture_text, name, normalized_name, quantity, unit, package_size,
            package_unit, category_id, category_confidence, attributes_json, semantic_variant_key, brand_name, brand_id, product_id, concept_id, quantity_source, unit_source, unit_confirmed_at, status,
            removed_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          item.id,
          item.householdId,
          item.shoppingListId,
          item.captureText,
          item.name,
          item.normalizedName,
          item.quantity,
          item.unit,
          item.packageSize,
          item.packageUnit,
          item.categoryId,
          item.categoryConfidence,
          JSON.stringify(item.attributes),
          item.semanticVariantKey ?? semanticVariantIdentityKey(item),
          item.brandName ?? null,
          item.brandId,
          item.productId,
          item.conceptId,
          item.quantitySource,
          item.unitSource,
          item.unitConfirmedAt,
          item.status,
          item.removedAt,
          item.createdAt,
          item.updatedAt,
        );
    } catch (error) {
      if (error instanceof Error && error.message.includes('UNIQUE constraint failed')) {
        const existing = this.database
          .prepare(
            `SELECT id FROM shopping_items
             WHERE household_id = ? AND normalized_name = ? AND status = 'active'`,
          )
          .get(householdId, item.normalizedName) as { id: string } | undefined;
        if (existing) throw new DuplicateShoppingItemError(existing.id);
      }
      throw error;
    }

    return this.applyAutomaticClassification(item, semantic, now, false);
  }

  private findLatestConfirmedUnit(householdId: string, normalizedName: string): string | null {
    const row = this.database.prepare(
      `SELECT unit FROM shopping_items
       WHERE household_id = ? AND normalized_name = ?
         AND status <> 'removed'
         AND unit IS NOT NULL AND unit_source = 'explicit' AND unit_confirmed_at IS NOT NULL
       ORDER BY unit_confirmed_at DESC, created_at DESC, id DESC
       LIMIT 1`,
    ).get(householdId, normalizedName) as { unit: string } | undefined;
    return row?.unit ?? null;
  }

  private repairLegacySemanticRows(): void {
    const rows = this.database.prepare(`
      SELECT id, household_id, capture_text, name, normalized_name, quantity, unit, package_size,
             package_unit, product_id, unit_source, unit_confirmed_at, status, updated_at
      FROM shopping_items
      WHERE status <> 'removed'
    `).all() as Array<{
      id: string;
      household_id: string;
      capture_text: string;
      name: string;
      normalized_name: string;
      quantity: number | null;
      unit: string | null;
      package_size: number | null;
      package_unit: string | null;
      product_id: string | null;
      unit_source: ShoppingItemUnitSource | null;
      unit_confirmed_at: string | null;
      status: ShoppingItemStatus;
      updated_at: string;
    }>;
    const update = this.database.prepare(`
      UPDATE shopping_items
      SET name = ?, normalized_name = ?, quantity = ?, unit = ?, package_size = ?, package_unit = ?,
          unit_source = ?, unit_confirmed_at = ?, semantic_variant_key = ?
      WHERE id = ?
    `);
    const findActiveCollision = this.database.prepare(`
      SELECT id FROM shopping_items
      WHERE household_id = ? AND normalized_name = ? AND status = 'active' AND id <> ?
      LIMIT 1
    `);
    const removeRepairedDuplicate = this.database.prepare(`
      UPDATE shopping_items
      SET name = ?, normalized_name = ?, quantity = ?, unit = ?, package_size = ?, package_unit = ?,
          unit_source = ?, unit_confirmed_at = ?, semantic_variant_key = ?, status = 'removed', removed_at = ?
      WHERE id = ?
    `);

    for (const row of rows) {
      try {
        let correctedName = row.name;
        try {
          correctedName = reconcileItemCorrection({
            captureText: row.capture_text,
            itemName: row.name,
            quantity: row.quantity,
            unit: row.unit,
            packageSize: row.package_size,
            packageUnit: row.package_unit,
            locale: 'en-IN',
            countryCode: 'IN',
            source: 'api',
            runtime: this.semanticRuntime,
          }).itemName;
        } catch (error) {
          if (!(error instanceof ItemCorrectionConflictError)) throw error;
        }

        const intent = interpretItem({
          text: row.capture_text,
          locale: 'en-IN',
          countryCode: 'IN',
          source: 'api',
          runtime: this.semanticRuntime,
        });
        const hasStructuredDetails = intent.quantity !== null || intent.unit !== null
          || intent.packageSize !== null || intent.packageUnit !== null;
        const correctedStoredDetails = normalizeName(correctedName) !== normalizeName(row.name);
        if (!hasStructuredDetails && !correctedStoredDetails) continue;

        const nameKey = normalizeName(row.name);
        const captureKey = normalizeName(row.capture_text);
        const captureWithoutLeadingQuantity = captureKey.replace(/^\S+\s+/u, '');
        const isRecognizedName = nameKey === intent.identityKey;
        const isKnownLegacyName = nameKey === captureKey
          || (nameKey.startsWith('of ') && nameKey.includes(intent.identityKey))
          || (nameKey === captureWithoutLeadingQuantity && nameKey.includes(intent.identityKey));
        const isContainerPrefixedLegacyName = intent.unit !== null
          && (nameKey === `${intent.unit} ${intent.identityKey}` || nameKey === `${intent.unit} of ${intent.identityKey}`);
        if (!correctedStoredDetails && !isRecognizedName && !isKnownLegacyName && !isContainerPrefixedLegacyName) continue;

        const name = row.product_id
          ? row.name
          : correctedStoredDetails
            ? correctedName
            : (isKnownLegacyName || isContainerPrefixedLegacyName)
              ? intent.itemName
              : row.name;
        const parsedSemantic = resolveSemanticItem({
          captureText: row.capture_text,
          name: intent.itemName,
          quantity: intent.quantity,
          unit: intent.unit,
          packageSize: intent.packageSize,
          packageUnit: intent.packageUnit,
        }, this.semanticRuntime).item;
        const parsedPackage = parsedSemantic.packageMeasure.value ?? null;
        const duplicatesNetContentAsRequest = parsedPackage !== null
          && parsedSemantic.requestedCount.value === null
          && parsedSemantic.requestedUnitId.value === null
          && row.quantity === parsedPackage.value
          && row.unit === parsedPackage.unitId;
        const useParsedDetails = isContainerPrefixedLegacyName || duplicatesNetContentAsRequest;
        const quantity = useParsedDetails ? parsedSemantic?.requestedCount.value ?? null : row.quantity ?? intent.quantity;
        const unit = useParsedDetails ? parsedSemantic?.requestedUnitId.value ?? null : row.unit ?? intent.unit;
        const packageSize = useParsedDetails ? parsedPackage?.value ?? null : row.package_size ?? intent.packageSize;
        const packageUnit = useParsedDetails ? parsedPackage?.unitId ?? null : row.package_unit ?? intent.packageUnit;
        const learnedExplicitUnit = isContainerPrefixedLegacyName || (row.unit === null && unit !== null);
        const normalizedName = normalizeName(name);
        const updatedSemantic = resolveSemanticItem({
          captureText: row.capture_text,
          name,
          quantity,
          unit,
          packageSize,
          packageUnit,
        }, this.semanticRuntime).item;
        const semanticVariantKey = updatedSemantic.identity.variantKey;
        const activeCollision = row.status === 'active' && normalizedName !== row.normalized_name
          ? findActiveCollision.get(row.household_id, normalizedName, row.id)
          : undefined;
        if (activeCollision) {
          removeRepairedDuplicate.run(
            name,
            normalizedName,
            quantity,
            unit,
            packageSize,
            packageUnit,
            learnedExplicitUnit ? 'explicit' : row.unit_source,
            learnedExplicitUnit ? row.updated_at : row.unit_confirmed_at,
            semanticVariantKey,
            row.updated_at,
            row.id,
          );
          continue;
        }
        update.run(
          name,
          normalizedName,
          quantity,
          unit,
          packageSize,
          packageUnit,
          learnedExplicitUnit ? 'explicit' : row.unit_source,
          learnedExplicitUnit ? row.updated_at : row.unit_confirmed_at,
          semanticVariantKey,
          row.id,
        );
        const updated = this.get(row.household_id, row.id);
        if (updated) this.applyAutomaticClassification(updated, updatedSemantic, row.updated_at, false);
      } catch (error) {
        if (error instanceof Error && error.message.includes('UNIQUE constraint failed')) continue;
        if (error instanceof InvalidCaptureError) continue;
        throw error;
      }
    }
  }

  private findActiveExactVariant(householdId: string, intent: ItemIntent): ShoppingItem | undefined {
    return this.findActiveVariantByFields(
      householdId,
      intent.identityKey,
      intent.unit,
      intent.packageSize,
      intent.packageUnit,
    );
  }

  private findActiveVariantByFields(
    householdId: string,
    normalizedName: string,
    unit: string | null,
    packageSize: number | null,
    packageUnit: string | null,
    shoppingListId = this.getDefaultShoppingList(householdId).id,
  ): ShoppingItem | undefined {
    const row = this.database.prepare(`
      SELECT id, household_id, shopping_list_id, capture_text, name, quantity, unit, package_size, package_unit,
             category_id, category_confidence, attributes_json, semantic_variant_key, brand_name, brand_id, product_id, concept_id, unit_source, unit_confirmed_at,
             status, removed_at, created_at, updated_at, version
      FROM shopping_items
      WHERE household_id = ? AND shopping_list_id = ? AND status = 'active'
        AND (semantic_variant_key = ? OR normalized_name = ?)
        AND IFNULL(unit, '') = IFNULL(?, '')
        AND IFNULL(package_size, -1) = IFNULL(?, -1)
        AND IFNULL(package_unit, '') = IFNULL(?, '')
      LIMIT 1
    `).get(
      householdId,
      shoppingListId,
      normalizedName,
      normalizeName(normalizedName),
      unit,
      packageSize,
      packageUnit,
    ) as unknown as ShoppingItemRow | undefined;
    return row ? toShoppingItem(row, this.semanticRuntime) : undefined;
  }

  update(
    householdId: string,
    itemId: string,
    patch: {
      captureText?: string;
      name?: string;
      status?: ShoppingItemStatus;
      quantity?: number | null;
      confirmedUnit?: string | null;
      packageSize?: number | null;
      packageUnit?: string | null;
      brandName?: string | null;
    },
    expectedVersion: number,
  ): ShoppingItem | undefined {
    const updatedAt = this.clock().toISOString();
    const fields: string[] = [];
    const values: Array<string | number | null> = [];
    const currentBeforeUpdate = patch.name !== undefined || patch.status !== undefined
      || patch.packageSize !== undefined || patch.packageUnit !== undefined
      ? this.get(householdId, itemId)
      : undefined;
    if (patch.status !== undefined && !currentBeforeUpdate) return undefined;
    if (patch.captureText !== undefined) {
      fields.push('capture_text = ?');
      values.push(patch.captureText.trim());
    }
    if (patch.name !== undefined) {
      fields.push('name = ?', 'normalized_name = ?');
      if (currentBeforeUpdate && normalizeName(currentBeforeUpdate.name) !== normalizeName(patch.name)) {
        if (patch.brandName === undefined) fields.push('brand_name = NULL');
        fields.push('brand_id = NULL', 'product_id = NULL', 'concept_id = NULL');
      }
      values.push(patch.name.trim(), normalizeName(patch.name));
    }
    if (patch.name !== undefined || patch.packageSize !== undefined || patch.packageUnit !== undefined) {
      const semanticName = patch.name?.trim() ?? currentBeforeUpdate!.name;
      if (patch.name !== undefined) {
        const exactNameDuplicate = this.database.prepare(`
          SELECT id FROM shopping_items
          WHERE household_id = ? AND shopping_list_id = ? AND normalized_name = ? AND status = 'active' AND id <> ?
          LIMIT 1
        `).get(householdId, currentBeforeUpdate!.shoppingListId, normalizeName(semanticName), itemId) as { id: string } | undefined;
        if (exactNameDuplicate) throw new DuplicateShoppingItemError(exactNameDuplicate.id);
      }
      const semanticPackageSize = patch.packageSize !== undefined
        ? patch.packageSize
        : currentBeforeUpdate!.packageSize;
      const resolved = resolveSemanticItem({
        captureText: patch.captureText?.trim() ?? semanticName,
        name: semanticName,
        quantity: currentBeforeUpdate!.quantity,
        unit: currentBeforeUpdate!.unit,
        packageSize: semanticPackageSize,
        packageUnit: patch.packageUnit !== undefined ? patch.packageUnit : currentBeforeUpdate!.packageUnit,
      }, this.semanticRuntime).item;
      assertSemanticItemCompatible(resolved, this.semanticRuntime);
      const duplicate = this.findActiveVariantByFields(
        householdId,
        resolved.identity.variantKey,
        currentBeforeUpdate!.unit,
        semanticPackageSize,
        patch.packageUnit !== undefined ? patch.packageUnit : currentBeforeUpdate!.packageUnit,
        currentBeforeUpdate!.shoppingListId,
      );
      if (duplicate && duplicate.id !== itemId) throw new DuplicateShoppingItemError(duplicate.id);
      fields.push('semantic_variant_key = ?');
      values.push(resolved.identity.variantKey);
      fields.push('category_id = ?', 'category_confidence = ?', 'attributes_json = ?');
      values.push(
        resolved.categoryId.value ?? 'unknown',
        resolved.categoryId.confidence,
        JSON.stringify(Object.fromEntries(Object.entries(resolved.attributes).map(([id, value]) => [id, value.value]))),
      );
    }
    if (patch.status !== undefined) {
      const transition = currentBeforeUpdate!.status === patch.status
        ? { status: currentBeforeUpdate!.status, removedAt: currentBeforeUpdate!.removedAt }
        : transitionItem(
          { status: currentBeforeUpdate!.status, removedAt: currentBeforeUpdate!.removedAt },
          lifecycleAction(currentBeforeUpdate!.status, patch.status),
          updatedAt,
        );
      fields.push('status = ?', 'removed_at = ?');
      values.push(transition.status, transition.removedAt);
    }
    if (patch.quantity !== undefined) {
      fields.push('quantity = ?');
      values.push(patch.quantity);
    }
    if (patch.confirmedUnit !== undefined) {
      fields.push('unit = ?', 'unit_source = ?', 'unit_confirmed_at = ?');
      if (patch.confirmedUnit === null) {
        values.push(null, null, null);
      } else {
        values.push(patch.confirmedUnit.trim(), 'explicit', updatedAt);
      }
    }
    if (patch.packageSize !== undefined) {
      fields.push('package_size = ?');
      values.push(patch.packageSize);
    }
    if (patch.packageUnit !== undefined) {
      fields.push('package_unit = ?');
      values.push(patch.packageUnit?.trim() || null);
    }
    if (patch.brandName !== undefined) {
      fields.push('brand_name = ?');
      values.push(patch.brandName?.trim() || null);
    }
    fields.push('updated_at = ?', 'version = version + 1');
    values.push(updatedAt, itemId, householdId, expectedVersion);
    let result: { changes: number };
    try {
      result = this.database
        .prepare(
          `UPDATE shopping_items SET ${fields.join(', ')}
           WHERE id = ? AND household_id = ? AND version = ?`,
        )
        .run(...values) as { changes: number };
    } catch (error) {
      if (error instanceof Error && error.message.includes('UNIQUE constraint failed')
        && (patch.name !== undefined || patch.status === 'active')) {
        const normalizedName = patch.name !== undefined
          ? normalizeName(patch.name)
          : normalizeName(currentBeforeUpdate!.name);
        const existing = this.database.prepare(
          `SELECT id FROM shopping_items
           WHERE household_id = ? AND normalized_name = ? AND status = 'active' AND id <> ?`,
        ).get(householdId, normalizedName, itemId) as { id: string } | undefined;
        if (existing) throw new DuplicateShoppingItemError(existing.id);
      }
      throw error;
    }
    if (Number(result.changes) === 0) {
      const current = this.get(householdId, itemId);
      if (current && current.version !== expectedVersion) throw new ItemVersionConflictError(current);
      return undefined;
    }

    return this.get(householdId, itemId);
  }

  private get(householdId: string, itemId: string): ShoppingItem | undefined {
    const row = this.database.prepare(
      `SELECT id, household_id, shopping_list_id, capture_text, name, quantity, unit, package_size, package_unit,
              category_id, category_confidence, attributes_json, brand_name, brand_id, product_id, concept_id,
              quantity_source, unit_source, unit_confirmed_at,
              status, removed_at, created_at, updated_at, version
       FROM shopping_items WHERE id = ? AND household_id = ?`,
    ).get(itemId, householdId) as unknown as ShoppingItemRow | undefined;
    return row ? this.withEffectiveShopTypes(toShoppingItem(row, this.semanticRuntime)) : undefined;
  }

  private withEffectiveShopTypes(item: ShoppingItem): ShoppingItem {
    const assignments = this.database.prepare(`
      SELECT assignments.tag_id, assignments.origin, assignments.decision, definitions.label
      FROM item_tag_assignments AS assignments
      LEFT JOIN tag_definitions AS definitions ON definitions.id = assignments.tag_id
      WHERE assignments.item_id = ? AND assignments.active = 1
      ORDER BY assignments.origin ASC, assignments.tag_id ASC
    `).all(item.id) as Array<{
      tag_id: string;
      origin: 'automatic' | 'user';
      decision: 'include' | 'exclude';
      label: string | null;
    }>;
    const effective = new Map<string, ShoppingItemShopType>();
    assignments.filter((assignment) => assignment.origin === 'automatic' && assignment.decision === 'include')
      .forEach((assignment) => effective.set(assignment.tag_id, {
        id: assignment.tag_id,
        label: assignment.label ?? assignment.tag_id,
      }));
    assignments.filter((assignment) => assignment.origin === 'user').forEach((assignment) => {
      if (assignment.decision === 'exclude') effective.delete(assignment.tag_id);
      else effective.set(assignment.tag_id, { id: assignment.tag_id, label: assignment.label ?? assignment.tag_id });
    });
    return { ...item, shopTypes: [...effective.values()] };
  }

  private classificationAssignments(itemId: string): Array<{
    tagId: string;
    origin: 'automatic' | 'user';
    decision: 'include' | 'exclude';
    confidence: 'confirmed' | 'inferred' | 'unknown' | null;
    evidenceJson: string;
    semanticIdentityKey: string;
    runtimeVersionsJson: string;
    active: number;
  }> {
    return this.database.prepare(`
      SELECT tag_id, origin, decision, confidence, evidence_json, semantic_identity_key,
             runtime_versions_json, active
      FROM item_tag_assignments WHERE item_id = ? ORDER BY tag_id ASC, origin ASC
    `).all(itemId).map((row) => {
      const assignment = row as {
        tag_id: string; origin: 'automatic' | 'user'; decision: 'include' | 'exclude';
        confidence: 'confirmed' | 'inferred' | 'unknown' | null; evidence_json: string;
        semantic_identity_key: string; runtime_versions_json: string; active: number;
      };
      return {
        tagId: assignment.tag_id,
        origin: assignment.origin,
        decision: assignment.decision,
        confidence: assignment.confidence,
        evidenceJson: assignment.evidence_json,
        semanticIdentityKey: assignment.semantic_identity_key,
        runtimeVersionsJson: assignment.runtime_versions_json,
        active: assignment.active,
      };
    });
  }

  private automaticClassificationIdentityKey(itemId: string): string | null {
    const row = this.database.prepare(`
      SELECT semantic_identity_key FROM item_tag_assignments
      WHERE item_id = ? AND origin = 'automatic' AND active = 1
      ORDER BY tag_id ASC LIMIT 1
    `).get(itemId) as { semantic_identity_key: string } | undefined;
    return row?.semantic_identity_key ?? null;
  }

  private restoreClassificationAssignments(
    itemId: string,
    assignments: readonly {
      tagId: string; origin: 'automatic' | 'user'; decision: 'include' | 'exclude';
      confidence: 'confirmed' | 'inferred' | 'unknown' | null; evidenceJson: string;
      semanticIdentityKey: string; runtimeVersionsJson: string; active: number;
    }[],
    now: string,
  ): void {
    this.database.prepare('DELETE FROM item_tag_assignments WHERE item_id = ?').run(itemId);
    const insert = this.database.prepare(`
      INSERT INTO item_tag_assignments
        (item_id, tag_id, origin, decision, confidence, evidence_json, semantic_identity_key,
         runtime_versions_json, active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    assignments.forEach((assignment) => insert.run(
      itemId, assignment.tagId, assignment.origin, assignment.decision, assignment.confidence,
      assignment.evidenceJson, assignment.semanticIdentityKey, assignment.runtimeVersionsJson,
      assignment.active, now, now,
    ));
  }

  saveLearnedSemanticEntry(entry: LearnedSemanticEntry): LearnedSemanticEntry {
    if (entry.supportingEventIds.length === 0) throw new Error('Learned semantic entries require provenance');
    this.database.prepare(`
      INSERT INTO household_semantic_learning
        (id, household_id, kind, value_json, supporting_event_ids_json, status, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        household_id = excluded.household_id,
        kind = excluded.kind,
        value_json = excluded.value_json,
        supporting_event_ids_json = excluded.supporting_event_ids_json,
        status = excluded.status,
        updated_at = excluded.updated_at
    `).run(
      entry.id,
      entry.householdId,
      entry.kind,
      JSON.stringify(entry.value),
      JSON.stringify(entry.supportingEventIds),
      entry.status,
      this.clock().toISOString(),
    );
    return entry;
  }

  applyBrainResult(envelope: BrainCaptureEnvelope, result: BrainResult): AppliedBrainResult {
    const saved: BrainOutputFacts['saved'][number][] = [];
    const merged: BrainOutputFacts['merged'][number][] = [];
    const drafts: BrainOutputFacts['drafts'][number][] = [];
    const undo: BrainOutputFacts['undo'][number][] = [];
    const committedEventIds: string[] = [];
    const now = this.clock().toISOString();
    const sessionId = `brain:${envelope.contextId}`;

    result.operations.forEach((operation, index) => {
      if (operation.kind === 'draft') {
        drafts.push({ ...operation.draft, draftId: `brain:${envelope.inputId}:draft:${index}` });
        return;
      }
      if (operation.kind === 'create') {
        const itemId = `brain:${envelope.inputId}:${index}`;
        const created = this.create(
          envelope.householdId,
          semanticItemToIntent(envelope.text, operation.item),
          undefined,
          undefined,
          envelope.shoppingListId,
          itemId,
        );
        const item = this.applyAutomaticClassification(created, operation.item, now);
        this.upsertBrainSemantic(envelope, itemId, operation.item);
        const event = this.insertShoppingItemEvent(
          envelope.householdId,
          sessionId,
          itemId,
          'created',
          JSON.stringify({
            schemaVersion: 2,
            before: null,
            after: item,
            semanticBefore: null,
            semanticAfter: operation.item,
            identityKey: operation.item.identity.variantKey,
          }),
          now,
        );
        committedEventIds.push(event.id);
        saved.push({ itemId, item: operation.item });
        return;
      }

      const before = this.get(envelope.householdId, operation.targetItemId);
      if (!before || before.shoppingListId !== envelope.shoppingListId || before.status !== 'active') {
        throw new Error(`Brain operation target is not active in the capture list: ${operation.targetItemId}`);
      }
      const semanticBefore = this.getBrainSemantic(operation.targetItemId);
      if (!semanticBefore) throw new Error(`Brain operation target has no semantic snapshot: ${operation.targetItemId}`);
      const mergedSemantic = operation.kind === 'correct'
        ? correctSemanticState(semanticBefore, operation.item)
        : mergeSemanticState(semanticBefore, operation.item);
      const semanticAfter = normalizeSemanticItemForRuntime({
        ...mergedSemantic,
        identity: createItemIdentity(mergedSemantic, this.semanticRuntime),
      }, this.semanticRuntime);
      const after = this.applyAutomaticClassification(
        this.replaceFromBrainSemantic(before, semanticAfter, now),
        semanticAfter,
        now,
      );
      this.upsertBrainSemantic(envelope, after.id, semanticAfter);
      const event = this.insertShoppingItemEvent(
        envelope.householdId,
        sessionId,
        after.id,
        'merged',
        JSON.stringify({
          schemaVersion: 2,
          operationKind: operation.kind,
          before,
          after,
          semanticBefore,
          semanticAfter,
          identityKey: semanticAfter.identity.variantKey,
          previousQuantity: before.quantity,
        }),
        now,
      );
      committedEventIds.push(event.id);
      merged.push({ itemId: after.id, item: semanticAfter });
      undo.push({ eventId: event.id, itemId: after.id });
    });

    return {
      facts: { saved, merged, drafts, undo, warnings: result.warnings },
      committedEventIds,
    };
  }

  private getBrainSemantic(itemId: string): SemanticItem | null {
    const table = this.database.prepare(`
      SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'brain_item_semantics'
    `).get();
    if (!table) return null;
    const row = this.database.prepare('SELECT semantic_json FROM brain_item_semantics WHERE item_id = ?')
      .get(itemId) as { semantic_json: string } | undefined;
    return row ? upcastSemanticItem(JSON.parse(row.semantic_json) as SemanticItem) : null;
  }

  private semanticFromShoppingItem(item: ShoppingItem): SemanticItem {
    const evidence: SemanticEvidence[] = [{ kind: 'source_span', sourceStart: 0, sourceEnd: item.captureText.length, ref: item.id }];
    const semanticValue = <T>(value: T, confidence: SemanticValue<T>['confidence'] = 'confirmed'): SemanticValue<T> => ({ value, confidence, evidence });
    const semantic: SemanticItem = {
      itemName: semanticValue(item.name),
      conceptId: semanticValue(item.conceptId, item.conceptId ? 'confirmed' : 'unknown'),
      brandId: semanticValue(item.brandId, item.brandId ? 'confirmed' : 'unknown'),
      productId: semanticValue(item.productId, item.productId ? 'confirmed' : 'unknown'),
      categoryId: semanticValue(item.categoryId, item.categoryConfidence),
      requestedCount: semanticValue(item.quantity, item.quantity === null ? 'unknown' : 'confirmed'),
      requestedUnitId: semanticValue(item.unit, item.unit ? 'confirmed' : 'unknown'),
      packageMeasure: semanticValue(item.packageSize !== null && item.packageUnit
        ? { value: item.packageSize, unitId: item.packageUnit }
        : null, item.packageSize !== null && item.packageUnit ? 'confirmed' : 'unknown'),
      attributes: Object.fromEntries(Object.entries(item.attributes).map(([id, value]) => [id, semanticValue(value)])),
      semanticVersion: 3,
      identity: { conceptKey: item.conceptId ?? item.name, variantKey: item.semanticVariantKey ?? semanticVariantIdentityKey(item), requestKey: item.semanticVariantKey ?? semanticVariantIdentityKey(item) },
    };
    return { ...semantic, identity: createItemIdentity(semantic, this.semanticRuntime) };
  }

  private upsertBrainSemantic(envelope: BrainCaptureEnvelope, itemId: string, item: SemanticItem): void {
    this.upsertBrainSemanticSnapshot(envelope.householdId, envelope.shoppingListId, itemId, item, envelope.occurredAt);
  }

  private upsertBrainSemanticSnapshot(
    householdId: string,
    shoppingListId: string,
    itemId: string,
    item: SemanticItem,
    occurredAt: string,
  ): void {
    assertSemanticItemCompatible(item, this.semanticRuntime);
    const snapshot = upcastSemanticItem(item);
    this.database.prepare(`
      INSERT INTO brain_item_semantics (
        item_id, household_id, shopping_list_id, semantic_json, original_semantic_json,
        semantic_schema_version, concept_key, variant_key, request_key, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(item_id) DO UPDATE SET
        semantic_json = excluded.semantic_json,
        semantic_schema_version = excluded.semantic_schema_version,
        concept_key = excluded.concept_key,
        variant_key = excluded.variant_key,
        request_key = excluded.request_key,
        updated_at = excluded.updated_at
    `).run(
      itemId,
      householdId,
      shoppingListId,
      JSON.stringify(snapshot),
      JSON.stringify(item),
      snapshot.semanticVersion ?? 3,
      snapshot.identity.conceptKey,
      snapshot.identity.variantKey,
      snapshot.identity.requestKey,
      occurredAt,
    );
  }

  private applyAutomaticClassification(
    item: ShoppingItem,
    semantic: SemanticItem,
    now: string,
    incrementVersion = true,
  ): ShoppingItem {
    assertSemanticItemCompatible(semantic, this.semanticRuntime);
    const classification = classifyShoppingItem(semantic, this.semanticRuntime);
    const automaticCategoryId = classification.automaticCategory.value ?? 'unknown';
    const semanticIdentityKey = semantic.identity.variantKey;
    const unitSource = item.unitSource === 'history' && classification.defaultedUnitId.source === 'explicit'
      ? 'history'
      : classification.defaultedUnitId.source;
    this.database.prepare(`
      UPDATE item_tag_assignments SET active = 0, updated_at = ?
      WHERE item_id = ? AND origin = 'user' AND active = 1 AND semantic_identity_key <> ?
    `).run(now, item.id, semanticIdentityKey);
    this.database.prepare(`
      UPDATE shopping_items
      SET quantity = ?, unit = ?, quantity_source = ?, unit_source = ?, unit_confirmed_at = ?,
          category_automatic_id = ?, category_id = COALESCE(category_override_id, ?),
          category_confidence = ?, classification_runtime_versions = ?, attributes_json = ?,
          brand_id = ?, product_id = ?, concept_id = ?, semantic_variant_key = ?, updated_at = ?,
          version = CASE WHEN ? THEN version + 1 ELSE version END
      WHERE id = ? AND household_id = ? AND version = ?
    `).run(
      classification.defaultedQuantity.value,
      classification.defaultedUnitId.value,
      classification.defaultedQuantity.source,
      unitSource,
      unitSource === 'explicit' ? now : null,
      automaticCategoryId,
      automaticCategoryId,
      classification.automaticCategory.confidence,
      JSON.stringify(classification.automaticShopTypes[0]?.runtimeVersions ?? this.semanticRuntime.versions),
      JSON.stringify(Object.fromEntries(Object.entries(semantic.attributes).map(([id, value]) => [id, value.value]))),
      semantic.brandId.value,
      semantic.productId?.value ?? null,
      semantic.conceptId.value,
      semantic.identity.variantKey,
      now,
      incrementVersion ? 1 : 0,
      item.id,
      item.householdId,
      item.version,
    );
    this.database.prepare(`
      UPDATE item_tag_assignments SET active = 0, updated_at = ?
      WHERE item_id = ? AND origin = 'automatic' AND active = 1
    `).run(now, item.id);
    const upsert = this.database.prepare(`
      INSERT INTO item_tag_assignments
        (item_id, tag_id, origin, decision, confidence, evidence_json, semantic_identity_key,
         runtime_versions_json, active, created_at, updated_at)
      VALUES (?, ?, 'automatic', 'include', ?, ?, ?, ?, 1, ?, ?)
      ON CONFLICT(item_id, tag_id, origin) DO UPDATE SET
        decision = excluded.decision,
        confidence = excluded.confidence,
        evidence_json = excluded.evidence_json,
        semantic_identity_key = excluded.semantic_identity_key,
        runtime_versions_json = excluded.runtime_versions_json,
        active = 1,
        updated_at = excluded.updated_at
    `);
    classification.automaticShopTypes.forEach((recommendation) => upsert.run(
      item.id,
      recommendation.tagId,
      recommendation.confidence,
      JSON.stringify(recommendation.evidence),
      recommendation.semanticIdentityKey,
      JSON.stringify(recommendation.runtimeVersions),
      now,
      now,
    ));
    return this.get(item.householdId, item.id)!;
  }

  private replaceFromBrainSemantic(before: ShoppingItem, semantic: SemanticItem, now: string): ShoppingItem {
    assertSemanticItemCompatible(semantic, this.semanticRuntime);
    const attributes = Object.fromEntries(Object.entries(semantic.attributes).map(([id, value]) => [id, value.value]));
    const result = this.database.prepare(`
      UPDATE shopping_items
      SET capture_text = ?, name = ?, normalized_name = ?, quantity = ?, unit = ?,
          package_size = ?, package_unit = ?, category_id = ?, category_confidence = ?,
          attributes_json = ?, brand_id = ?, product_id = ?, concept_id = ?, semantic_variant_key = ?, updated_at = ?, version = version + 1
      WHERE id = ? AND household_id = ? AND shopping_list_id = ? AND version = ?
    `).run(
      before.captureText,
      semantic.itemName.value,
      normalizeName(semantic.itemName.value),
      semantic.requestedCount.value,
      semantic.requestedUnitId.value,
      semantic.packageMeasure.value?.value ?? null,
      semantic.packageMeasure.value?.unitId ?? null,
      semantic.categoryId.value ?? 'unknown',
      semantic.categoryId.confidence,
      JSON.stringify(attributes),
      semantic.brandId.value,
      semantic.productId?.value ?? null,
      semantic.conceptId.value,
      semantic.identity.variantKey,
      now,
      before.id,
      before.householdId,
      before.shoppingListId,
      before.version,
    ) as { changes: number };
    if (Number(result.changes) !== 1) {
      const current = this.get(before.householdId, before.id);
      if (current) throw new ItemVersionConflictError(current);
      throw new Error(`Brain operation target disappeared: ${before.id}`);
    }
    return this.get(before.householdId, before.id)!;
  }

  listLearnedSemanticEntries(householdId: string, includeInactive = false): LearnedSemanticEntry[] {
    const rows = this.database.prepare(`
      SELECT id, household_id, kind, value_json, supporting_event_ids_json, status
      FROM household_semantic_learning
      WHERE household_id = ? ${includeInactive ? '' : "AND status = 'active'"}
      ORDER BY id ASC
    `).all(householdId) as Array<{
      id: string;
      household_id: string;
      kind: LearnedSemanticEntry['kind'];
      value_json: string;
      supporting_event_ids_json: string;
      status: LearnedSemanticEntry['status'];
    }>;
    return rows.map((row) => ({
      id: row.id,
      householdId: row.household_id,
      kind: row.kind,
      value: JSON.parse(row.value_json) as Readonly<Record<string, string | number>>,
      supportingEventIds: JSON.parse(row.supporting_event_ids_json) as string[],
      status: row.status,
    }));
  }

  setLearnedSemanticEntryStatus(
    householdId: string,
    id: string,
    status: LearnedSemanticEntry['status'],
  ): LearnedSemanticEntry | null {
    this.database.prepare(`
      UPDATE household_semantic_learning SET status = ?, updated_at = ?
      WHERE id = ? AND household_id = ?
    `).run(status, this.clock().toISOString(), id, householdId);
    return this.listLearnedSemanticEntries(householdId, true).find((entry) => entry.id === id) ?? null;
  }

  undoShoppingItemEvent(
    householdId: string,
    eventId: string,
  ): { item: ShoppingItem; event: ShoppingItemEvent } {
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const original = this.database.prepare(`
        SELECT id, session_id, item_id, type, inverse_of_event_id, payload, created_at
        FROM shopping_item_events
        WHERE id = ? AND household_id = ?
      `).get(eventId, householdId) as {
        id: string;
        session_id: string;
        item_id: string;
        type: ShoppingItemEvent['type'];
        inverse_of_event_id: string | null;
        payload: string;
        created_at: string;
      } | undefined;
      if (!original) throw new ShoppingItemEventNotFoundError();
      if (original.type !== 'merged' && original.type !== 'quantity_adjusted') {
        throw new ShoppingItemEventNotUndoableError();
      }
      const reversal = this.database.prepare(`
        SELECT id FROM shopping_item_events
        WHERE household_id = ? AND inverse_of_event_id = ?
        LIMIT 1
      `).get(householdId, eventId);
      if (reversal) throw new ShoppingItemEventAlreadyUndoneError();

      const item = this.get(householdId, original.item_id);
      if (!item) throw new ShoppingItemEventNotFoundError();
      const payload = JSON.parse(original.payload) as {
        schemaVersion?: number;
        before?: ShoppingItem;
        semanticBefore?: SemanticItem | null;
        semanticAfter?: SemanticItem;
        previousQuantity: number | null;
        assignmentsBefore?: Array<{
          tagId: string; origin: 'automatic' | 'user'; decision: 'include' | 'exclude';
          confidence: 'confirmed' | 'inferred' | 'unknown' | null; evidenceJson: string;
          semanticIdentityKey: string; runtimeVersionsJson: string; active: number;
        }>;
      };
      const now = this.clock().toISOString();
      if (payload.schemaVersion === 2 && payload.before) {
        const before = payload.before;
        this.database.prepare(`
          UPDATE shopping_items
          SET capture_text = ?, name = ?, normalized_name = ?, quantity = ?, unit = ?,
              package_size = ?, package_unit = ?, category_id = ?, category_confidence = ?,
              attributes_json = ?, semantic_variant_key = ?, brand_name = ?, brand_id = ?, product_id = ?, concept_id = ?,
              unit_source = ?, unit_confirmed_at = ?, status = ?, removed_at = ?,
              updated_at = ?, version = version + 1
          WHERE id = ? AND household_id = ?
        `).run(
          before.captureText,
          before.name,
          normalizeName(before.name),
          before.quantity,
          before.unit,
          before.packageSize,
          before.packageUnit,
          before.categoryId,
          before.categoryConfidence,
          JSON.stringify(before.attributes),
          before.semanticVariantKey ?? semanticVariantIdentityKey(before),
          before.brandName ?? null,
          before.brandId,
          before.productId,
          before.conceptId,
          before.unitSource,
          before.unitConfirmedAt,
          before.status,
          before.removedAt,
          now,
          item.id,
          householdId,
        );
      } else {
        this.database.prepare(`
          UPDATE shopping_items
          SET quantity = ?, updated_at = ?, version = version + 1
          WHERE id = ? AND household_id = ?
        `).run(payload.previousQuantity, now, item.id, householdId);
      }
      if (payload.assignmentsBefore) {
        this.restoreClassificationAssignments(item.id, payload.assignmentsBefore, now);
      }
      const updated = this.get(householdId, item.id)!;
      if (payload.semanticBefore) {
        this.database.prepare(`
          UPDATE brain_item_semantics
          SET semantic_json = ?, concept_key = ?, variant_key = ?, request_key = ?, updated_at = ?
          WHERE item_id = ? AND household_id = ?
        `).run(
          JSON.stringify(payload.semanticBefore),
          payload.semanticBefore.identity.conceptKey,
          payload.semanticBefore.identity.variantKey,
          payload.semanticBefore.identity.requestKey,
          now,
          item.id,
          householdId,
        );
      }
      const event = this.insertShoppingItemEvent(
        householdId,
        original.session_id,
        item.id,
        'reversed',
        JSON.stringify({
          schemaVersion: 2,
          before: item,
          after: payload.before ?? { ...item, quantity: payload.previousQuantity },
          semanticBefore: payload.semanticAfter ?? null,
          semanticAfter: payload.semanticBefore ?? null,
          restoredQuantity: payload.before?.quantity ?? payload.previousQuantity,
        }),
        now,
        original.id,
      );
      this.database.exec('COMMIT');
      return { item: updated, event };
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  close(): void {
    this.database.close();
  }
}

export function normalizeName(name: string): string {
  return normalizeItemName(name);
}

function toConversationSession(row: {
  id: string;
  household_id: string;
  shopping_list_id: string;
  context_id: string | null;
  status: 'active' | 'idle' | 'close_pending' | 'closed';
  created_at: string;
  updated_at: string;
  closed_at: string | null;
}): ConversationSession {
  return {
    id: row.id,
    householdId: row.household_id,
    shoppingListId: row.shopping_list_id,
    contextId: row.context_id,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    closedAt: row.closed_at,
  };
}

function toPendingConversationAction(row: PendingConversationActionRow): PendingConversationAction {
  return {
    id: row.id,
    householdId: row.household_id,
    shoppingListId: row.shopping_list_id,
    contextId: row.context_id,
    sessionId: row.session_id,
    type: row.type,
    origin: row.origin,
    previousStatus: row.previous_status,
    status: row.status,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at,
  };
}

function toClarificationDraft(row: {
  id: string;
  household_id: string;
  session_id: string;
  text: string;
  reason: ClarificationDraft['reason'];
  status: ClarificationDraft['status'];
  created_at: string;
  updated_at: string;
}): ClarificationDraft {
  return {
    id: row.id,
    householdId: row.household_id,
    sessionId: row.session_id,
    text: row.text,
    reason: row.reason,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

interface SuggestionEventPayload {
  identityKey: string;
  requestedQuantity: number | null;
  unit: string | null;
  packageSize: number | null;
  packageUnit: string | null;
}

function semanticVariantIdentityKey(item: Pick<
  ShoppingItem,
  'name' | 'unit' | 'packageSize' | 'packageUnit'
>): string {
  return JSON.stringify([
    normalizeName(item.name),
    item.unit,
    item.packageSize,
    item.packageUnit,
  ]);
}

function parseSuggestionEventPayload(payload: string): SuggestionEventPayload | undefined {
  try {
    const parsed = JSON.parse(payload) as Partial<SuggestionEventPayload>;
    return typeof parsed.identityKey === 'string'
      ? {
        identityKey: parsed.identityKey,
        requestedQuantity: typeof parsed.requestedQuantity === 'number' ? parsed.requestedQuantity : null,
        unit: typeof parsed.unit === 'string' ? parsed.unit : null,
        packageSize: typeof parsed.packageSize === 'number' ? parsed.packageSize : null,
        packageUnit: typeof parsed.packageUnit === 'string' ? parsed.packageUnit : null,
      }
      : undefined;
  } catch {
    return undefined;
  }
}

function suggestionMessage(payload: SuggestionEventPayload): string {
  const quantity = payload.requestedQuantity;
  const unit = payload.unit;
  const count = quantity !== null && unit !== null
    ? `${quantity} ${pluralizeUnit(unit, quantity)}`
    : 'the same item';
  const packageDetails = payload.packageSize !== null && payload.packageUnit !== null
    ? ` · ${payload.packageSize} ${payload.packageUnit} each`
    : '';
  return `Usually: ${count}${packageDetails}`;
}

function pluralizeUnit(unit: string, quantity: number): string {
  if (quantity === 1) return unit;
  if (unit.endsWith('s')) return unit;
  if (unit.endsWith('ch') || unit.endsWith('sh') || unit.endsWith('x')) return `${unit}es`;
  if (unit.endsWith('y')) return `${unit.slice(0, -1)}ies`;
  return `${unit}s`;
}

function toShoppingItem(row: ShoppingItemRow, runtime?: SemanticRuntime): ShoppingItem {
  const category = runtime?.categories.get(row.category_id ?? '');
  const attributes = projectAttributes(parseAttributes(row.attributes_json), category);
  return {
    id: row.id,
    householdId: row.household_id,
    shoppingListId: row.shopping_list_id,
    captureText: row.capture_text,
    name: row.name,
    quantity: row.quantity,
    unit: row.unit,
    packageSize: row.package_size,
    packageUnit: row.package_unit,
    categoryId: row.category_id ?? 'unknown',
    categoryConfidence: row.category_confidence ?? 'unknown',
    attributes,
    ...(row.semantic_variant_key ? { semanticVariantKey: row.semantic_variant_key } : {}),
    ...(row.brand_name ? { brandName: row.brand_name } : {}),
    brandId: row.brand_id,
    productId: row.product_id,
    conceptId: row.concept_id,
    quantitySource: row.quantity_source ?? null,
    unitSource: row.unit_source,
    unitConfirmedAt: row.unit_confirmed_at,
    attentionReasons: attentionReasonsForFields(row.status, row.quantity, row.unit_source),
    status: row.status,
    removedAt: row.removed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    version: row.version,
  };
}

function projectAttributes(
  attributes: Readonly<Record<string, string | number>>,
  category: import('@duckworth/shopping-intelligence').CategoryDefinition | undefined,
): Readonly<Record<string, string | number>> {
  if (!category) return attributes;
  const allowed = new Set([
    ...category.relevantAttributeIds,
    ...Object.values(category.measureAttributeIds ?? {}),
  ]);
  const roles = new Set(Object.values(category.unitRoles ?? {}));
  return Object.fromEntries(Object.entries(attributes).filter(([attributeId]) => {
    if (attributeId.startsWith('measure:')) return roles.has(attributeId.slice('measure:'.length));
    return allowed.has(attributeId);
  }));
}

function parseAttributes(value: string | undefined): Readonly<Record<string, string | number>> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed as Readonly<Record<string, string | number>>;
  } catch {
    return {};
  }
}

function toShoppingListArchive(row: ShoppingListArchiveRow): ShoppingListArchive {
  return {
    id: row.id,
    householdId: row.household_id,
    status: row.reopened_at === null ? 'archived' : 'reopened',
    items: JSON.parse(row.items_json) as ShoppingItem[],
    createdAt: row.created_at,
    reopenedAt: row.reopened_at,
  };
}

export class ShoppingItemEventNotFoundError extends Error {}
export class ShoppingItemEventAlreadyUndoneError extends Error {}
export class ShoppingItemEventNotUndoableError extends Error {}
export class ShoppingListArchiveNotFoundError extends Error {}
export class ShoppingListNotFoundError extends Error {}
export class EmptyShoppingListArchiveError extends Error {}

function lifecycleAction(current: ShoppingItemStatus, next: ShoppingItemStatus): ItemLifecycleAction {
  if (current === 'active' && next === 'purchased') return 'purchase';
  if (current === 'purchased' && next === 'active') return 'reopen';
  if (current === 'active' && next === 'removed') return 'remove';
  if (current === 'removed' && next === 'active') return 'restore';
  throw new InvalidItemTransitionError();
}

function attentionReasonsForFields(
  status: ShoppingItemStatus,
  quantity: number | null,
  unitSource: ShoppingItemUnitSource | null,
): ShoppingItemAttentionReason[] {
  if (status !== 'active') return [];
  const reasons: ShoppingItemAttentionReason[] = [];
  if (quantity === null) reasons.push('missing_quantity');
  if (unitSource === 'history') reasons.push('unconfirmed_historical_unit');
  return reasons;
}

function unitSourceForCreation(
  explicitUnit: string | null,
  historicalUnit: string | null,
  automaticSource: ShoppingItemUnitSource,
): ShoppingItemUnitSource {
  if (explicitUnit !== null) return 'explicit';
  if (historicalUnit !== null) return 'history';
  return automaticSource;
}

function semanticItemToIntent(captureText: string, item: SemanticItem): ItemIntent {
  return {
    captureText,
    itemName: item.itemName.value,
    identityKey: item.identity.requestKey,
    quantity: item.requestedCount.value,
    unit: item.requestedUnitId.value,
    packageSize: item.packageMeasure.value?.value ?? null,
    packageUnit: item.packageMeasure.value?.unitId ?? null,
    ...(item.categoryId.value
      ? { category: { id: item.categoryId.value, confidence: item.categoryId.confidence } }
      : {}),
    attributes: Object.fromEntries(Object.entries(item.attributes).map(([id, value]) => [id, value.value])),
  };
}

function mergeSemanticState(before: SemanticItem, requested: SemanticItem): SemanticItem {
  const requestedCount = requested.requestedCount.value === null
    ? before.requestedCount
    : {
        ...requested.requestedCount,
        value: (before.requestedCount.value ?? 0) + requested.requestedCount.value,
      };
  return {
    itemName: preferKnown(requested.itemName, before.itemName),
    conceptId: preferKnown(requested.conceptId, before.conceptId),
    brandId: preferKnown(requested.brandId, before.brandId),
    productFamilyId: mergeOptionalSemanticValue(requested.productFamilyId, before.productFamilyId),
    productId: mergeOptionalSemanticValue(requested.productId, before.productId),
    categoryId: preferKnown(requested.categoryId, before.categoryId),
    requestedCount,
    requestedUnitId: requested.requestedUnitId.value === null
      ? before.requestedUnitId
      : requested.requestedUnitId,
    packageMeasure: requested.packageMeasure.value === null
      ? before.packageMeasure
      : requested.packageMeasure,
    attributes: { ...before.attributes, ...requested.attributes },
    semanticVersion: 3,
    measures: requested.measures?.length ? requested.measures : before.measures,
    packaging: requested.packaging?.length ? requested.packaging : before.packaging,
    descriptorMentions: mergeDescriptorMentions(before.descriptorMentions, requested.descriptorMentions),
    commercialRoles: requested.commercialRoles?.length ? requested.commercialRoles : before.commercialRoles,
    identity: requested.identity,
  };
}

function correctSemanticState(before: SemanticItem, requested: SemanticItem): SemanticItem {
  return {
    itemName: preferKnown(requested.itemName, before.itemName),
    conceptId: preferKnown(requested.conceptId, before.conceptId),
    brandId: preferKnown(requested.brandId, before.brandId),
    productFamilyId: mergeOptionalSemanticValue(requested.productFamilyId, before.productFamilyId),
    productId: mergeOptionalSemanticValue(requested.productId, before.productId),
    categoryId: preferKnown(requested.categoryId, before.categoryId),
    requestedCount: requested.requestedCount.value === null ? before.requestedCount : requested.requestedCount,
    requestedUnitId: requested.requestedUnitId.value === null ? before.requestedUnitId : requested.requestedUnitId,
    packageMeasure: requested.packageMeasure.value === null ? before.packageMeasure : requested.packageMeasure,
    attributes: { ...before.attributes, ...requested.attributes },
    semanticVersion: 3,
    measures: requested.measures?.length ? requested.measures : before.measures,
    packaging: requested.packaging?.length ? requested.packaging : before.packaging,
    descriptorMentions: mergeDescriptorMentions(before.descriptorMentions, requested.descriptorMentions),
    commercialRoles: requested.commercialRoles?.length ? requested.commercialRoles : before.commercialRoles,
    identity: requested.identity,
  };
}

function mergeOptionalSemanticValue<T>(
  requested: SemanticValue<T> | undefined,
  before: SemanticValue<T> | undefined,
): SemanticValue<T> | undefined {
  if (!requested) return before;
  return requested.confidence === 'unknown' ? (before ?? requested) : requested;
}

function mergeDescriptorMentions(
  before: SemanticItem['descriptorMentions'],
  requested: SemanticItem['descriptorMentions'],
): SemanticItem['descriptorMentions'] {
  const merged = [...(before ?? []), ...(requested ?? [])];
  const seen = new Set<string>();
  return merged.filter((mention) => {
    const key = `${mention.sourceStart}:${mention.sourceEnd}:${mention.role}:${mention.normalized}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function preferKnown<T>(requested: SemanticValue<T>, before: SemanticValue<T>): SemanticValue<T> {
  return requested.confidence === 'unknown' ? before : requested;
}
