# Data-driven Shopping Brain Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete Duckworth's application brain as a source-neutral, data-driven, locally deterministic system that safely interprets supported shopping language, preserves unresolved meaning without guessing, persists replayable decisions, and exposes identical facts to every input and output adapter.

**Architecture:** Replace embedded shopping/language vocabularies with a validated `SemanticRuntime` composed from versioned core, locale, country, regional-product, and household-learning layers. A pure staged engine consumes a versioned capture envelope and emits evidence-bearing semantic operations; the API atomically stores raw capture, decisions, drafts, events, and projections. Output adapters receive facts and render them without reinterpreting raw language.

**Tech Stack:** TypeScript 6, JSON Schema 2020-12, Node 24 SQLite, Fastify 5, Angular 22, Vitest, Angular TestBed, existing catalog build pipeline.

## Global constraints

- No product, brand, category, unit, attribute, locale-specific number word, connector, separator, command prefix, display label, confidence weight, or category relevance rule may be embedded in brain TypeScript.
- Tests may contain explicit example fixtures, and catalog/database files intentionally contain data; the prohibition applies to production algorithms, routes, and UI components.
- Stable algorithms, decision/lifecycle kinds, schema compatibility rules, transaction invariants, and resource-safety limits may remain code constants.
- Text, voice transcripts, APIs, and assistants must submit the same capture envelope. `source` is provenance only and cannot change semantic decisions.
- The API and database are authoritative. Browser storage may cache packs, context credentials, previews, and an offline outbox, but never owns committed shopping state.
- Clear clauses are committed immediately; unresolved or conflicting clauses become durable drafts with raw spans and candidate alternatives.
- Requested count/container and package size/measure remain separate. Normalized comparison values never replace the user's meaningful scale or wording.
- An unknown category, brand, unit, or attribute must not invalidate an otherwise valid item and must not be fabricated.
- Auto-merge is permitted only for one high-confidence exact variant. Similar or uncertain variants are returned as candidates.
- Every accepted merge/correction is fully undoable from persisted before/after semantic state.
- Cloud interpretation remains an unimplemented optional port. No cloud call, retailer routing, pricing, cart, ordering, payment, medical advice, or online Git operation is in scope.
- Multi-device/speaker context isolation remains a mandatory release gate and is tested before brain completion is declared.
- Every task follows red → green → focused regression → commit. Preserve unrelated worktree changes.

---

## File structure

### Catalog and runtime data

- Create `catalog/schema/semantic-core.schema.json`: dimensions, canonical units, value types, and stable capabilities.
- Create `catalog/schema/semantic-locale.schema.json`: locale grammar templates, number lexicon, aliases, labels, and fallback chain.
- Create `catalog/schema/semantic-country.schema.json`: country policies, category profiles, attribute definitions, and regional compatibility.
- Create `catalog/source/semantic/core.json`, `en-IN.json`, and `IN.json`: the first validated runtime data migrated from existing code.
- Modify `catalog/scripts/build-packs.mjs`: validate, checksum, compile, and emit immutable semantic artifacts.

### Pure brain

- Create `packages/shopping-intelligence/src/contracts.ts`: versioned capture, semantic result, evidence, operation, draft, and error contracts.
- Create `packages/shopping-intelligence/src/semantic-runtime.ts`: validated runtime types, layering, fallback resolution, and immutable indexes.
- Create `packages/shopping-intelligence/src/pipeline.ts`: staged orchestration with no vocabulary.
- Create `packages/shopping-intelligence/src/segmentation.ts`: source-span-preserving generic segmentation driven by runtime templates.
- Create `packages/shopping-intelligence/src/entity-resolution.ts`: concepts, brands, categories, attributes, measurements, and alternatives.
- Create `packages/shopping-intelligence/src/reference-resolution.ts`: context-scoped follow-ups and ambiguity decisions.
- Create `packages/shopping-intelligence/src/identity.ts`: concept, variant, request, duplicate, and merge identities.
- Modify `packages/item-capture/src/index.ts`: replace embedded lexicons and phrase-specific defaults with runtime-provided grammar and unit indexes.
- Modify `packages/shopping-intelligence/src/index.ts` and `conversation.ts`: expose the new facade and retain compatibility wrappers only until callers migrate.

### API, persistence, and adapters

- Create `duckworth-api/src/semantic-runtime-registry.ts`: load last-known-good artifacts and resolve household locale/country runtime.
- Create `duckworth-api/src/brain-captures.ts`: persistence for capture envelopes, semantic snapshots, versions, drafts, and idempotency.
- Modify `duckworth-api/src/shopping-items.ts`: apply semantic operations and full-state compensating events.
- Modify `duckworth-api/src/app.ts`: versioned brain endpoint and locale/context routing.
- Create `duckworth-web/src/app/core/brain-adapter.ts`: typed input and output adapter with no interpretation logic.
- Modify generated OpenAPI artifacts after every public contract change.

### Verification

- Create `catalog/test/semantic-packs.test.mjs`.
- Create `packages/shopping-intelligence/src/*.spec.ts` beside each new module.
- Create `packages/shopping-intelligence/test-fixtures/brain-evaluation.json`.
- Create `duckworth-api/test/brain-contract.test.ts`, `brain-persistence.test.ts`, and `brain-context-isolation.test.ts`.
- Create `duckworth-web/src/app/core/brain-adapter.spec.ts`.
- Create `tools/architecture/check-brain-boundary.mjs` and `tools/architecture/brain-boundary.json`.

---

### Task 1: Freeze the versioned input and output boundary

**Files:**
- Create: `packages/shopping-intelligence/src/contracts.ts`
- Create: `packages/shopping-intelligence/src/contracts.spec.ts`
- Modify: `packages/shopping-intelligence/src/index.ts`

**Interfaces:**

```ts
export interface BrainCaptureEnvelope {
  schemaVersion: 2;
  inputId: string;
  householdId: string;
  contextId: string;
  shoppingListId: string;
  source: { kind: string; deviceId?: string; speakerId?: string };
  text: string;
  alternatives?: readonly { text: string; confidence?: number }[];
  locale: string;
  countryCode: string;
  occurredAt: string;
  idempotencyKey: string;
}

export interface SemanticEvidence {
  kind: 'source_span' | 'catalog_match' | 'household_confirmation' | 'grammar_rule';
  sourceStart?: number;
  sourceEnd?: number;
  ref?: string;
}

export interface SemanticValue<T> {
  value: T;
  confidence: 'confirmed' | 'inferred' | 'unknown';
  evidence: readonly SemanticEvidence[];
}

export interface SemanticMeasurement {
  value: number;
  unitId: string;
  comparisonValue?: number;
  comparisonUnitId?: string;
}

export interface SemanticItem {
  itemName: SemanticValue<string>;
  conceptId: SemanticValue<string | null>;
  brandId: SemanticValue<string | null>;
  categoryId: SemanticValue<string | null>;
  requestedCount: SemanticValue<number | null>;
  requestedUnitId: SemanticValue<string | null>;
  packageMeasure: SemanticValue<SemanticMeasurement | null>;
  attributes: Readonly<Record<string, SemanticValue<string | number>>>;
  identity: { conceptKey: string; variantKey: string; requestKey: string };
}

export interface BrainDraft {
  reasonCode: string;
  text: string;
  sourceStart: number;
  sourceEnd: number;
  candidateIds: readonly string[];
}

export interface BrainWarning {
  code: string;
  sourceStart?: number;
  sourceEnd?: number;
}

export type BrainOperation =
  | { kind: 'create'; item: SemanticItem }
  | { kind: 'merge'; targetItemId: string; item: SemanticItem }
  | { kind: 'correct'; targetItemId: string; item: SemanticItem }
  | { kind: 'draft'; draft: BrainDraft };

export interface BrainResult {
  schemaVersion: 2;
  engineVersion: string;
  runtimeVersions: Readonly<Record<string, string>>;
  capture: { inputId: string; text: string };
  operations: readonly BrainOperation[];
  warnings: readonly BrainWarning[];
}
```

- [ ] **Step 1: Write the failing contract tests**

Assert JSON-safe round trips, arbitrary source kinds, Unicode text, source-span bounds, non-empty version provenance, and rejection of an operation that has neither evidence nor an explicit `unknown` confidence.

- [ ] **Step 2: Run the focused test red**

Run: `pnpm --dir duckworth-web exec vitest run packages/shopping-intelligence/src/contracts.spec.ts --root .. --globals`

Expected: FAIL because the v2 contracts and validators do not exist.

- [ ] **Step 3: Implement the contracts and pure validators**

Keep identifiers open strings; do not use unions containing grocery, apparel, pharmacy, brand names, units, or attributes. Preserve stable operation and evidence kinds as system policy.

- [ ] **Step 4: Run focused and existing brain tests green**

Run: `pnpm --dir duckworth-web shared:build && pnpm --dir duckworth-web exec vitest run packages/shopping-intelligence/src --root .. --globals`

- [ ] **Step 5: Commit**

```powershell
git add packages/shopping-intelligence/src
git commit -m "feat: define versioned shopping brain contract"
```

### Task 2: Build validated semantic data packs and runtime layering

**Files:**
- Create: `catalog/schema/semantic-core.schema.json`
- Create: `catalog/schema/semantic-locale.schema.json`
- Create: `catalog/schema/semantic-country.schema.json`
- Create: `catalog/source/semantic/core.json`
- Create: `catalog/source/semantic/en-IN.json`
- Create: `catalog/source/semantic/IN.json`
- Modify: `catalog/scripts/build-packs.mjs`
- Create: `catalog/test/semantic-packs.test.mjs`
- Create: `packages/shopping-intelligence/src/semantic-runtime.ts`
- Create: `packages/shopping-intelligence/src/semantic-runtime.spec.ts`

**Interfaces:**

```ts
export interface SemanticRuntime {
  versions: Readonly<Record<string, string>>;
  grammar: CompiledGrammar;
  numerals: ReadonlyMap<string, number>;
  units: ReadonlyMap<string, UnitDefinition>;
  categories: ReadonlyMap<string, CategoryDefinition>;
  attributes: ReadonlyMap<string, AttributeDefinition>;
  concepts: ConceptIndex;
  brands: BrandIndex;
  policy: BrainPolicy;
}

export interface CompiledGrammar {
  templates: readonly CompiledTemplate[];
  separators: readonly string[];
  commandPrefixes: readonly string[];
}

export interface UnitDefinition {
  id: string;
  capability: 'measure' | 'container' | 'both';
  dimensionId?: string;
  factorToBase?: number;
}

export interface AttributeDefinition {
  id: string;
  valueType: 'string' | 'number';
  cardinality: 'one' | 'many';
}

export interface CategoryDefinition {
  id: string;
  relevantAttributeIds: readonly string[];
  variantAttributeIds: readonly string[];
}

export interface BrainPolicy {
  acceptThreshold: number;
  ambiguityMargin: number;
  maximumSegments: number;
  maximumCandidatesPerEntity: number;
}

export function compileSemanticRuntime(
  layers: readonly ValidatedSemanticLayer[],
): SemanticRuntime;
```

- [ ] **Step 1: Write red schema and layering tests**

Cover duplicate aliases, conflicting unit dimensions, cyclic fallbacks, unknown attribute references, incompatible schema versions, checksum failure, household override precedence, and immutable compiled indexes.

- [ ] **Step 2: Run red**

Run: `pnpm --dir duckworth-api language-packs:test`

Expected: FAIL because semantic schemas and artifacts are missing.

- [ ] **Step 3: Implement schemas, compiler, and the first data migration**

Move every current unit alias, number word, command prefix, connector, separator, category signal, colour/material/form word, display label, and category field rule from TypeScript into the three initial semantic source files. The compiler must reject ambiguous aliases unless the data explicitly supplies a precedence rule.

- [ ] **Step 4: Run pack and runtime tests green**

Run: `pnpm --dir duckworth-api language-packs:build && pnpm --dir duckworth-api language-packs:test && pnpm --dir duckworth-web exec vitest run packages/shopping-intelligence/src/semantic-runtime.spec.ts --root .. --globals`

- [ ] **Step 5: Commit**

```powershell
git add catalog packages/shopping-intelligence/src
git commit -m "feat: compile versioned semantic runtime packs"
```

### Task 3: Replace embedded parser data with a generic bounded engine

**Files:**
- Modify: `packages/item-capture/src/index.ts`
- Modify: `packages/item-capture/src/index.spec.ts`
- Create: `packages/shopping-intelligence/src/segmentation.ts`
- Create: `packages/shopping-intelligence/src/segmentation.spec.ts`

**Interfaces:**

```ts
export interface SourceSegment { text: string; start: number; end: number; }
export function segmentCapture(text: string, runtime: SemanticRuntime): readonly SourceSegment[];
export function interpretCapture(text: string, runtime: SemanticRuntime): CaptureInterpretation;
```

- [ ] **Step 1: Write characterization and data-substitution red tests**

Retain every existing parser example, then construct a synthetic locale pack whose number words, connectors, separators, and unit aliases do not occur in production data. Assert the same engine parses it without code changes. Assert item names containing separator words or numeric product identities are not split incorrectly.

- [ ] **Step 2: Run red**

Run: `pnpm --dir duckworth-web exec vitest run packages/item-capture/src/index.spec.ts packages/shopping-intelligence/src/segmentation.spec.ts --root .. --globals`

Expected: FAIL because the current parser owns English lexicons and patterns.

- [ ] **Step 3: Implement generic tokenization and template execution**

Compile only bounded template operators such as `literal`, `number`, `unit(role)`, `text(minTokens)`, `optional`, and `repeat(max)`. Do not compile arbitrary regular expressions supplied by data. Preserve source spans and original casing.

- [ ] **Step 4: Run parser regressions and a resource-bound test**

Run: `pnpm --dir duckworth-web shared:build && pnpm --dir duckworth-web exec vitest run packages/item-capture/src packages/shopping-intelligence/src/segmentation.spec.ts --root .. --globals`

Expected: all existing phrases pass; a 10,000-character adversarial capture returns a bounded validation result without catastrophic backtracking.

- [ ] **Step 5: Commit**

```powershell
git add packages/item-capture packages/shopping-intelligence/src
git commit -m "refactor: drive capture parsing from semantic runtime"
```

### Task 4: Resolve concepts, brands, categories, units, and typed attributes

**Files:**
- Create: `packages/shopping-intelligence/src/entity-resolution.ts`
- Create: `packages/shopping-intelligence/src/entity-resolution.spec.ts`
- Modify: `packages/shopping-intelligence/src/conversation.ts`
- Modify: `packages/shopping-intelligence/src/conversation.spec.ts`

**Interfaces:**

```ts
export interface EntityCandidate<T> {
  value: T;
  score: number;
  evidence: readonly SemanticEvidence[];
}

export interface SemanticItemAlternative {
  item: SemanticItem;
  reasonCode: string;
}

export function resolveSemanticItem(
  capture: CaptureInterpretation,
  runtime: SemanticRuntime,
): { item: SemanticItem; alternatives: readonly SemanticItemAlternative[]; warnings: readonly BrainWarning[] };
```

- [ ] **Step 1: Write red positive and negative entity tests**

Use test-pack data for branded groceries, numeric product variants, electronics models, apparel size/colour, pharmacy form, an unknown Unicode item, alias collisions, incompatible attributes, and a word that can be both a brand and ordinary item text. Assert exact evidence and alternatives; do not assert private scoring arithmetic.

- [ ] **Step 2: Run red**

Run: `pnpm --dir duckworth-web exec vitest run packages/shopping-intelligence/src/entity-resolution.spec.ts --root .. --globals`

- [ ] **Step 3: Implement ordered candidate resolution**

Resolve exact reviewed product/concept IDs first, then reviewed aliases, confirmed household overlays, and deterministic grammar evidence. Category profiles determine relevant attributes, but unknown attributes remain in raw item text. Confidence thresholds and precedence come from runtime policy data.

- [ ] **Step 4: Run entity and source-equivalence tests green**

Run: `pnpm --dir duckworth-web exec vitest run packages/shopping-intelligence/src/entity-resolution.spec.ts packages/shopping-intelligence/src/conversation.spec.ts --root .. --globals`

- [ ] **Step 5: Commit**

```powershell
git add packages/shopping-intelligence/src
git commit -m "feat: add evidence-based semantic entity resolution"
```

### Task 5: Implement multi-item discourse and conservative follow-up resolution

**Files:**
- Create: `packages/shopping-intelligence/src/reference-resolution.ts`
- Create: `packages/shopping-intelligence/src/reference-resolution.spec.ts`
- Modify: `packages/shopping-intelligence/src/pipeline.ts`
- Create: `packages/shopping-intelligence/src/pipeline.spec.ts`

**Interfaces:**

```ts
export interface DiscourseContext {
  contextId: string;
  shoppingListId: string;
  recentEntities: readonly ContextEntity[];
  openDrafts: readonly ContextDraft[];
}

export interface ContextEntity {
  itemId: string;
  conceptKey: string;
  variantKey: string;
  mentionedAt: string;
}

export interface ContextDraft {
  draftId: string;
  candidateItemIds: readonly string[];
}

export function runShoppingBrain(
  envelope: BrainCaptureEnvelope,
  runtime: SemanticRuntime,
  context: DiscourseContext,
): BrainResult;
```

- [ ] **Step 1: Write red conversation matrices**

Cover one item, multiple items, details stated later in the same capture, a later capture that updates exactly one item, competing brand variants, pronouns, reordered clauses, omitted punctuation, corrections, unsupported text, and clear clauses beside an ambiguous remainder. Assert each source span is consumed once or returned in a draft.

- [ ] **Step 2: Run red**

Run: `pnpm --dir duckworth-web exec vitest run packages/shopping-intelligence/src/reference-resolution.spec.ts packages/shopping-intelligence/src/pipeline.spec.ts --root .. --globals`

- [ ] **Step 3: Implement scoped reference decisions**

Rank candidates only inside the supplied context and shopping list. Accept a follow-up only when one candidate clears the policy margin; otherwise return a draft containing stable candidate IDs and the unresolved source span. Never carry references across a closed or different context.

- [ ] **Step 4: Run conversation tests green**

Run: `pnpm --dir duckworth-web exec vitest run packages/shopping-intelligence/src --root .. --globals`

- [ ] **Step 5: Commit**

```powershell
git add packages/shopping-intelligence/src
git commit -m "feat: resolve multi-item conversation context safely"
```

### Task 6: Separate concept, variant, request, duplicate, and merge identity

**Files:**
- Create: `packages/shopping-intelligence/src/identity.ts`
- Create: `packages/shopping-intelligence/src/identity.spec.ts`
- Modify: `duckworth-api/src/shopping-items.ts`
- Modify: `duckworth-api/test/shopping-items.test.ts`

**Interfaces:**

```ts
export interface ItemIdentity {
  conceptKey: string;
  variantKey: string;
  requestKey: string;
}

export type DuplicateDecision =
  | { kind: 'exact_merge'; targetItemId: string }
  | { kind: 'similar'; candidateItemIds: readonly string[] }
  | { kind: 'distinct' };
```

- [ ] **Step 1: Write red identity and undo tests**

Prove casing and aliases converge; different brands/models/colours/forms/package sizes remain distinct; missing brand does not silently merge into a branded item; equivalent unit aliases compare canonically while preserving display scale; one merge is undoable without removing earlier adjustments; undo restores category, brand, attributes, package data, and quantity.

- [ ] **Step 2: Run red**

Run: `pnpm --dir duckworth-web exec vitest run packages/shopping-intelligence/src/identity.spec.ts --root .. --globals && pnpm --dir duckworth-api test -- --run test/shopping-items.test.ts`

- [ ] **Step 3: Implement data-driven identity and full semantic event payloads**

Category profiles declare which attributes participate in `variantKey`. Persist an event payload schema version plus before/after semantic snapshots. Reject automatic merge when any identity participant is unresolved or has insufficient confidence.

- [ ] **Step 4: Run identity/API tests green**

Run: `pnpm --dir duckworth-web exec vitest run packages/shopping-intelligence/src/identity.spec.ts --root .. --globals && pnpm --dir duckworth-api test -- --run test/shopping-items.test.ts`

- [ ] **Step 5: Commit**

```powershell
git add packages/shopping-intelligence/src duckworth-api/src/shopping-items.ts duckworth-api/test/shopping-items.test.ts
git commit -m "feat: make semantic identity and merges fully reversible"
```

### Task 7: Persist replayable brain captures and migrate existing databases

**Files:**
- Create: `duckworth-api/src/brain-captures.ts`
- Create: `duckworth-api/test/brain-persistence.test.ts`
- Modify: `duckworth-api/src/shopping-items.ts`
- Modify: `duckworth-api/test/shopping-items-migration.test.ts`

**Interfaces:**

```ts
export interface StoredBrainCapture {
  envelope: BrainCaptureEnvelope;
  result: BrainResult;
  committedEventIds: readonly string[];
  createdAt: string;
}

export interface BrainCaptureStore {
  commit(envelope: BrainCaptureEnvelope, result: BrainResult): StoredBrainCapture;
  findByIdempotencyKey(contextId: string, key: string): StoredBrainCapture | null;
  get(inputId: string): StoredBrainCapture | null;
}
```

- [ ] **Step 1: Write red durability tests**

Create a file-backed database, commit a mixed clear/draft capture, close and reopen the API, and assert identical semantic snapshots, event IDs, source spans, runtime versions, and drafts. Replay the same idempotency key and assert no new event. Migrate a pre-v2 database and assert legacy rows become `unknown` with migration provenance rather than guessed semantics.

- [ ] **Step 2: Run red**

Run: `pnpm --dir duckworth-api test -- --run test/brain-persistence.test.ts test/shopping-items-migration.test.ts`

- [ ] **Step 3: Implement atomic capture persistence and replay**

Persist raw envelope JSON, result JSON, engine version, runtime versions, and committed event IDs in the same transaction as item projections and drafts. Store pack artifacts/checksums separately so historical decisions remain explainable even after pack activation changes.

- [ ] **Step 4: Run persistence tests green**

Run: `pnpm --dir duckworth-api test -- --run test/brain-persistence.test.ts test/shopping-items-migration.test.ts`

- [ ] **Step 5: Commit**

```powershell
git add duckworth-api/src duckworth-api/test
git commit -m "feat: persist replayable shopping brain decisions"
```

### Task 8: Add safe pack activation, fallback, and rollback

**Files:**
- Create: `duckworth-api/src/semantic-runtime-registry.ts`
- Create: `duckworth-api/test/semantic-runtime-registry.test.ts`
- Modify: `duckworth-api/src/app.ts`

**Interfaces:**

```ts
export interface RuntimeSelection {
  runtime: SemanticRuntime;
  resolvedLocale: string;
  resolvedCountryCode: string;
  fallbackChain: readonly string[];
}

export class SemanticRuntimeRegistry {
  resolve(locale: string, countryCode: string): RuntimeSelection;
  activate(artifactPath: string): Promise<void>;
}
```

- [ ] **Step 1: Write red registry tests**

Cover valid activation, missing requested locale with declared fallback, invalid locale/country combination, bad checksum, incompatible schema, alias collision, untrusted external publisher, interrupted activation, process restart, and rollback to last-known-good runtime.

- [ ] **Step 2: Run red**

Run: `pnpm --dir duckworth-api test -- --run test/semantic-runtime-registry.test.ts`

- [ ] **Step 3: Implement atomic registry activation**

Validate and compile before swapping the active immutable runtime. Do not partially merge invalid layers. Bundled artifacts are trusted by the application build; externally supplied artifacts require a valid signature from deployment-configured trust roots. Resolve locale/country from household settings plus request metadata; remove production `en-IN`/`IN` literals from interpretation paths.

- [ ] **Step 4: Run registry and API type checks green**

Run: `pnpm --dir duckworth-api test -- --run test/semantic-runtime-registry.test.ts && pnpm --dir duckworth-api typecheck`

- [ ] **Step 5: Commit**

```powershell
git add duckworth-api/src duckworth-api/test
git commit -m "feat: activate semantic runtimes with safe rollback"
```

### Task 9: Govern household learning as a reversible runtime overlay

**Files:**
- Create: `packages/shopping-intelligence/src/learning-overlay.ts`
- Create: `packages/shopping-intelligence/src/learning-overlay.spec.ts`
- Modify: `duckworth-api/src/shopping-items.ts`
- Modify: `duckworth-api/test/shopping-items.test.ts`

**Interfaces:**

```ts
export interface LearnedSemanticEntry {
  id: string;
  householdId: string;
  kind: 'alias' | 'brand_preference' | 'variant_preference' | 'quantity_preference';
  value: Readonly<Record<string, string | number>>;
  supportingEventIds: readonly string[];
  status: 'active' | 'suppressed' | 'cleared';
}
```

- [ ] **Step 1: Write red eligibility and poisoning tests**

Assert that accepted corrections and repeated confirmed events may support a suggestion; drafts, removed mistakes, undone merges, rejected spelling changes, and one-off contradictory captures cannot. Assert explicit new input always wins and clearing an entry removes its runtime influence without deleting event history.

- [ ] **Step 2: Run red**

Run: `pnpm --dir duckworth-web exec vitest run packages/shopping-intelligence/src/learning-overlay.spec.ts --root .. --globals && pnpm --dir duckworth-api test -- --run test/shopping-items.test.ts`

- [ ] **Step 3: Implement the overlay and provenance projection**

Compile active learned entries as the lowest-authority reviewed runtime layer above generic locale aliases but below explicit accepted product references. Keep tuning thresholds in country policy data.

- [ ] **Step 4: Run learning regressions green**

Run: `pnpm --dir duckworth-web exec vitest run packages/shopping-intelligence/src/learning-overlay.spec.ts --root .. --globals && pnpm --dir duckworth-api test -- --run test/shopping-items.test.ts`

- [ ] **Step 5: Commit**

```powershell
git add packages/shopping-intelligence/src duckworth-api/src duckworth-api/test
git commit -m "feat: make household semantic learning governed and reversible"
```

### Task 10: Enforce input and output adapter equivalence

**Files:**
- Create: `duckworth-api/test/brain-contract.test.ts`
- Modify: `duckworth-api/src/app.ts`
- Modify: `duckworth-api/openapi/duckworth-v1.json`
- Create: `duckworth-web/src/app/core/brain-adapter.ts`
- Create: `duckworth-web/src/app/core/brain-adapter.spec.ts`
- Modify: `duckworth-web/src/app/api/generated/schema.d.ts`

**Interfaces:**

```ts
export interface BrainOutputFacts {
  saved: readonly SemanticItemFact[];
  merged: readonly SemanticItemFact[];
  drafts: readonly BrainDraftFact[];
  undo: readonly UndoFact[];
  warnings: readonly BrainWarning[];
}

export interface SemanticItemFact {
  itemId: string;
  item: SemanticItem;
}

export interface BrainDraftFact extends BrainDraft { draftId: string; }
export interface UndoFact { eventId: string; itemId: string; }
```

- [ ] **Step 1: Write red adapter conformance tests**

Send the same text through text, voice-transcript, API, and assistant envelopes with different input IDs. Strip provenance and assert identical operations, identities, confidence, evidence spans, drafts, and warnings. Verify transcript alternatives are recorded but cannot override a higher-confidence clear primary input without policy evidence. Assert the web adapter posts facts and never imports parser/entity-resolution modules.

- [ ] **Step 2: Run red**

Run: `pnpm --dir duckworth-api test -- --run test/brain-contract.test.ts && pnpm --dir duckworth-web test -- --watch=false brain-adapter`

- [ ] **Step 3: Add the v2 endpoint and thin adapter**

Expose `POST /api/v2/households/:householdId/brain/captures`. Return channel-neutral facts plus provenance. Keep v1 compatibility as a translation adapter that calls v2; do not duplicate parsing. Regenerate OpenAPI types.

- [ ] **Step 4: Run contract and type checks green**

Run: `pnpm --dir duckworth-api openapi:write && Copy-Item duckworth-api/openapi/duckworth-v1.json duckworth-web/openapi/duckworth-v1.json -Force && pnpm --dir duckworth-web api:generate && pnpm --dir duckworth-api typecheck && pnpm --dir duckworth-web typecheck && pnpm --dir duckworth-api test -- --run test/brain-contract.test.ts`

- [ ] **Step 5: Commit**

```powershell
git add duckworth-api duckworth-web
git commit -m "feat: enforce source-neutral brain adapter contracts"
```

### Task 11: Prove context isolation under simultaneous devices and speakers

**Files:**
- Create: `duckworth-api/test/brain-context-isolation.test.ts`
- Modify: `duckworth-api/src/conversation-contexts.ts`
- Modify: `duckworth-api/src/shopping-items.ts`

**Interfaces:**

Use the existing context registration, scoped capture, handoff, and claim contracts. No UI context-management buttons are added.

- [ ] **Step 1: Write red concurrent-context tests**

Register four contexts for one household and one separate household. Submit overlapping captures, drafts, follow-ups, duplicate adjustments, stale edits, handoff, and retries concurrently. Assert shared list visibility where intended, isolated recent entities/drafts, no cross-context reference resolution, no cross-household access, deterministic optimistic conflicts, and idempotent retries.

- [ ] **Step 2: Run red**

Run: `pnpm --dir duckworth-api test -- --run test/brain-context-isolation.test.ts`

- [ ] **Step 3: Correct routing only at the context boundary**

Pass explicit `contextId` and `shoppingListId` into `DiscourseContext`; never infer them from browser storage or the most recent household session. Use database uniqueness/version checks for writes.

- [ ] **Step 4: Run context and full API tests green**

Run: `pnpm --dir duckworth-api test -- --run test/brain-context-isolation.test.ts && pnpm --dir duckworth-api test -- --run`

- [ ] **Step 5: Commit**

```powershell
git add duckworth-api/src duckworth-api/test
git commit -m "test: close shopping brain context isolation gate"
```

### Task 12: Establish the evaluation, architecture, and release gates

**Files:**
- Create: `packages/shopping-intelligence/test-fixtures/brain-evaluation.json`
- Create: `packages/shopping-intelligence/src/evaluation.spec.ts`
- Create: `tools/architecture/check-brain-boundary.mjs`
- Create: `tools/architecture/brain-boundary.json`
- Modify: `packages/shopping-intelligence/package.json`
- Modify: `duckworth-api/package.json`
- Modify: `duckworth-web/package.json`
- Modify: `docs/superpowers/reviews/2026-08-12-brain-status.md`
- Modify: `docs/REVIEW-START-HERE.md`

**Interfaces:**

The fixture schema records input envelope, runtime fixture ID, expected operations, expected unresolved spans, and invariants. It does not expose private score values.

- [ ] **Step 1: Add failing evaluation and architecture gates**

Include ordinary, branded, unknown, Unicode, numeric-identity, reordered, multi-item, follow-up, contradiction, unsupported-locale, adversarial-length, duplicate, undo, and cross-context cases. Add metamorphic checks for whitespace, casing, harmless punctuation, equivalent aliases, and source-kind changes. Add property checks that every non-whitespace source span is accepted, warned, or drafted; quantities are positive finite numbers; and result serialization is deterministic.

The architecture checker must fail if Angular imports item capture, semantic runtime internals, entity resolution, identity, or reference resolution; if API routes call low-level parsing instead of the brain facade; if production brain modules construct a runtime implicitly; or if an AST scan finds locale/domain matcher literals in production engine files outside the reviewed structural-policy allowlist in `tools/architecture/brain-boundary.json`. Synthetic-pack substitution tests remain mandatory because a literal scan alone cannot prove data independence.

- [ ] **Step 2: Run gates red**

Run: `pnpm --dir duckworth-web exec vitest run packages/shopping-intelligence/src/evaluation.spec.ts --root .. --globals && node tools/architecture/check-brain-boundary.mjs`

- [ ] **Step 3: Complete the corpus and boundary configuration**

Migrate every reported user failure into named fixtures and add synthetic-pack cases proving that new vocabulary does not require code edits. Record a local single-item median and p95 latency budget using a deterministic fixture run; fail only against a documented, stable threshold measured in CI after a baseline is committed.

- [ ] **Step 4: Run the complete release gate**

Run:

```powershell
pnpm --dir duckworth-api language-packs:build
pnpm --dir duckworth-api language-packs:test
pnpm --dir duckworth-web shared:build
pnpm --dir duckworth-web exec vitest run packages/item-capture/src packages/shopping-intelligence/src packages/local-assistance/src --root .. --globals
pnpm --dir duckworth-api test -- --run
pnpm --dir duckworth-web test -- --watch=false
pnpm --dir duckworth-api typecheck
pnpm --dir duckworth-web typecheck
pnpm --dir duckworth-api build
pnpm --dir duckworth-web build
node tools/architecture/check-brain-boundary.mjs
git diff --check
git status --short
```

Expected: every command passes; no production interpretation path contains embedded domain/language vocabulary; no online remote is contacted.

- [ ] **Step 5: Update completion evidence and commit**

Update the brain status document with implemented scope, supported runtime packs, corpus totals, latency baseline, migration/restart proof, context-isolation proof, and explicit unsupported behavior. Do not use the word “universal” to imply guaranteed understanding; describe universal extensibility and safe fallback.

```powershell
git add packages tools docs duckworth-api/package.json duckworth-web/package.json
git commit -m "test: establish shopping brain completion gates"
```

---

## Completion definition

The application brain is complete for its declared runtime packs only when all
of the following are proven together:

1. A new synthetic locale, category, unit, brand, or attribute is supported by
   adding validated data, with no brain-code change.
2. Every input adapter produces the same semantic operations for equivalent
   content.
3. Every output adapter consumes facts and performs no interpretation.
4. Every meaningful input span is accepted, warned, or drafted; none disappears.
5. Ambiguous identity, variant, reference, or measurement is never silently
   merged or fabricated.
6. Raw input, evidence, runtime versions, decisions, events, drafts, and undo
   state survive restart and migration.
7. Browser state is never authoritative for committed shopping data.
8. Household learning is explainable, reversible, and unable to override
   explicit current input.
9. Simultaneous contexts cannot resolve or mutate each other's conversational
   drafts or references accidentally.
10. The full example, negative, metamorphic, property, migration, replay,
    concurrency, architecture, and performance gates pass.

Anything outside an active runtime pack still remains usable as a generic item
or a clarification draft. That safe fallback—not guessing—is the universal
behavior Duckworth guarantees.
