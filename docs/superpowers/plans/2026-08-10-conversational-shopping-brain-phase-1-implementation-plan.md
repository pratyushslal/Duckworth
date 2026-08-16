# Conversational Shopping Brain Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add one local-first, durable conversation session per household that can save multiple clear shopping items from one capture and preserve only unresolved fragments as drafts.

**Architecture:** Extend `@duckworth/shopping-intelligence` with pure conversation segmentation, category profiles, follow-up resolution, and channel-neutral results. Fastify persists the brain's accepted item/draft/event decisions atomically; Angular renders the result and remains an adapter. Existing single-item capture remains a supported one-clause path.

**Tech Stack:** TypeScript 6, Angular 22 signals, Fastify 5, Node SQLite, Vitest, Angular TestBed.

## Global Constraints

- Text, voice transcripts, API commands, and future assistant adapters must use the same brain command and receive the same decision.
- Phase 1 has exactly one active conversation session per household; it closes explicitly by default and never closes or archives the shopping list.
- The brain saves high-confidence clauses immediately and persists ambiguous fragments as drafts.
- Local deterministic interpretation is the default. Cloud interpretation is a future opt-in per-draft adapter; do not make network calls in this phase.
- Category is inferred and optional. Grocery package data is never required for electronics, apparel, pharmacy, general, or unknown items.
- Store/display meaningful requested pack scales. Canonical values support comparison only; do not replace `4 pouches · 1 litre each` with `4,000 ml`.
- Merge only one exact semantic variant; record it as an additive event and make that adjustment individually undoable.
- Learning is household-local, confirmed-event-based, visible, advisory, and reversible. It must not silently alter explicit input.
- Keep retailer routing, prices, carts, payments, ordering, medical advice, cloud calls, and Phase 2 multi-context implementation out of scope.
- Before any Phase 2 plan, reopen the design's mandatory concurrent speaker/device context gate.
- Use red → green public-boundary tests and commit each independently testable task. Do not configure or contact an online Git remote.

---

## File structure

- Create `packages/shopping-intelligence/src/conversation.ts`: pure conversation types, deterministic clause segmentation, category profile resolution, follow-up/merge decisions, and result events.
- Modify `packages/shopping-intelligence/src/index.ts`: export the conversation public boundary while retaining `interpretItem`, correction, and lifecycle APIs.
- Create `packages/shopping-intelligence/src/conversation.spec.ts`: public source-neutral conversation contracts.
- Modify `duckworth-api/src/shopping-items.ts`: schema migration, one-session repository operations, atomic capture application, draft/event persistence, and additive undo.
- Modify `duckworth-api/src/app.ts`: HTTP contracts for conversation capture, session state, drafts, and undo.
- Modify `duckworth-api/test/shopping-items*.test.ts`: public HTTP and migration contracts.
- Create `duckworth-web/src/app/core/conversation.service.ts` and tests: typed API adapter.
- Modify `duckworth-web/src/app/app.ts`, `app.html`, `app.scss`, and `app.spec.ts`: multi-item summaries, needs-clarification drafts, session controls, and adjustment undo.
- Create/modify `duckworth-web/src/app/core/household-learning.*`: advisory local suggestions from confirmed events only.

### Task 1: Establish pure category-aware conversation contracts

**Files:**
- Create: `packages/shopping-intelligence/src/conversation.ts`
- Create: `packages/shopping-intelligence/src/conversation.spec.ts`
- Modify: `packages/shopping-intelligence/src/index.ts`

**Interfaces:**

```ts
export type ItemCategoryId = 'grocery' | 'electronics' | 'apparel' | 'pharmacy' | 'general' | 'unknown';
export interface ConversationCaptureCommand extends Omit<CaptureCommand, 'source'> {
  householdId: string;
  sessionId?: string;
  occurredAt: string;
  source?: 'text' | 'voice' | 'api' | 'assistant';
}
export interface ConversationItemIntent extends ItemIntent {
  category: { id: ItemCategoryId; confidence: 'confirmed' | 'inferred' | 'unknown' };
  attributes: Readonly<Record<string, string | number>>;
}
export interface ConversationInterpretation {
  captureText: string;
  items: ConversationItemIntent[];
  unresolved: Array<{ text: string; reason: 'ambiguous_clause' | 'ambiguous_reference' }>;
}
export function interpretConversation(command: ConversationCaptureCommand): ConversationInterpretation;
```

- [x] **Step 1: Write the failing category contracts**

```ts
expect(interpretConversation(command('Add Apple iPhone and 4 milk pouches of 1 litre each'))).toMatchObject({
  items: [
    { itemName: 'Apple iPhone', category: { id: 'electronics' }, packageSize: null, packageUnit: null },
    { itemName: 'milk', category: { id: 'grocery' }, quantity: 4, unit: 'pouch', packageSize: 1, packageUnit: 'l' },
  ],
  unresolved: [],
});
```

- [x] **Step 2: Run the focused contract red**

Run: `pnpm --dir duckworth-web exec vitest run packages/shopping-intelligence/src/conversation.spec.ts --root .. --globals`

Expected: FAIL because `interpretConversation` is not exported.

- [x] **Step 3: Implement the smallest pure conversation module**

Split only on deterministic separators (`and`, commas, semicolons, and a leading command prefix). Call existing `interpretItem` once per clause. Classify recognised grocery package details as `grocery`; classify `iphone`, `tablet`, and `phone` wording as `electronics`; otherwise return `unknown` without rejecting the item.

- [x] **Step 4: Run the focused contract green**

Run: `pnpm --dir duckworth-web shared:build && pnpm --dir duckworth-web exec vitest run packages/shopping-intelligence/src/conversation.spec.ts --root .. --globals`

Expected: PASS with the two literal item intents and no network activity.

- [x] **Step 5: Commit**

```bash
git add packages/shopping-intelligence/src
git commit -m "feat: add category-aware conversation interpretation"
```

### Task 2: Persist a durable single household conversation session and drafts

**Files:**
- Modify: `duckworth-api/src/shopping-items.ts`
- Modify: `duckworth-api/src/app.ts`
- Test: `duckworth-api/test/shopping-items-migration.test.ts`
- Test: `duckworth-api/test/shopping-items.test.ts`

**Interfaces:**

```ts
interface ConversationSession { id: string; householdId: string; status: 'active' | 'closed'; closedAt: string | null; }
interface ClarificationDraft { id: string; sessionId: string; text: string; reason: 'ambiguous_clause' | 'ambiguous_reference'; status: 'open' | 'resolved' | 'dismissed'; }
```

- [x] **Step 1: Write the migration/API red test**

POST `/api/v1/households/household-demo/conversation-captures` with `Add Apple iPhone and 4 milk pouches of 1 litre each`; expect one active session, two saved list items, and no drafts. POST a capture containing an unresolved clause; expect saved clear items plus one `open` draft.

- [x] **Step 2: Run the focused API test red**

Run: `pnpm --dir duckworth-api test --run test/shopping-items.test.ts`

Expected: FAIL with route not found.

- [x] **Step 3: Add transactional session/draft tables and repository operation**

Create `conversation_sessions`, `conversation_drafts`, and `shopping_item_events` tables. Implement `captureConversation(command)` to find/create the household's active session, apply each clear item creation in one transaction, persist every unresolved draft, and return the complete channel-neutral result.

- [x] **Step 4: Add the Fastify route and response schema**

Route: `POST /api/v1/households/:householdId/conversation-captures`.

```ts
payload: { text: string; source?: 'text' | 'voice' | 'api' | 'assistant'; sessionId?: string }
response: { session, saved, merged, drafts, undo: [] }
```

- [x] **Step 5: Run migration and API tests green**

Run: `pnpm --dir duckworth-api test --run test/shopping-items-migration.test.ts test/shopping-items.test.ts`

- [x] **Step 6: Commit**

```bash
git add duckworth-api/src duckworth-api/test
git commit -m "feat: persist household conversation sessions and drafts"
```

### Task 3: Resolve follow-up references, preserve variants, and make merges undoable

**Files:**
- Modify: `packages/shopping-intelligence/src/conversation.ts`
- Modify: `packages/shopping-intelligence/src/conversation.spec.ts`
- Modify: `duckworth-api/src/shopping-items.ts`
- Modify: `duckworth-api/src/app.ts`
- Test: `duckworth-api/test/shopping-items.test.ts`

**Interfaces:**

```ts
export type ConversationDecision =
  | { kind: 'create'; item: ConversationItemIntent }
  | { kind: 'merge'; itemId: string; delta: ConversationItemIntent }
  | { kind: 'draft'; text: string; reason: 'ambiguous_reference' };

interface ShoppingItemEvent {
  id: string;
  itemId: string;
  sessionId: string;
  type: 'created' | 'quantity_adjusted' | 'merged' | 'reversed';
  inverseOfEventId: string | null;
  payload: string;
  createdAt: string;
}
```

- [x] **Step 1: Write failing resolver and API contracts**

Add contracts for all of the following:

```ts
// One matching active item: update that item.
expect(resolveFollowUp('make Amul butter two packs', [amulButter])).toMatchObject({ kind: 'merge' });

// More than one active semantic match: do not guess.
expect(resolveFollowUp('make butter two packs', [amulButter, britanniaButter]))
  .toMatchObject({ kind: 'draft', reason: 'ambiguous_reference' });

// Same exact item/brand/package merges. A changed brand, package size, or package unit creates a separate variant.
```

At the HTTP boundary, submit one exact duplicate then undo its returned event ID. Expect the original requested count again and a durable reversal event. Verify that undoing one merge does not remove any earlier adjustment.

- [x] **Step 2: Run focused tests red**

Run: `pnpm --dir duckworth-web exec vitest run packages/shopping-intelligence/src/conversation.spec.ts --root .. --globals` and `pnpm --dir duckworth-api test --run test/shopping-items.test.ts`

Expected: FAIL because resolver decisions, semantic variant identity, event persistence, and undo route do not yet exist.

- [x] **Step 3: Implement deterministic resolution and semantic identity**

Build the comparison key from normalized item name, optional brand, category-relevant variant attributes, requested unit, and package size/unit. Keep the display text as entered/corrected—not canonicalized totals. Resolve a follow-up only with one exact active semantic candidate. Otherwise emit a draft.

Use an append-only event row for every create, adjustment, and merge. Apply and reverse event deltas in the same transaction. Do not mutate past events or use broad “undo last item” behaviour.

- [x] **Step 4: Expose a narrow undo route and response**

Route: `POST /api/v1/households/:householdId/shopping-item-events/:eventId/undo`.

Reject a second undo of the same event with a stable validation response; return the updated item and the new reversal event. Do not permit undo across households or sessions.

- [x] **Step 5: Run focused tests green**

Run: `pnpm --dir duckworth-web shared:build && pnpm --dir duckworth-web exec vitest run packages/shopping-intelligence/src/conversation.spec.ts --root .. --globals && pnpm --dir duckworth-api test --run test/shopping-items.test.ts`

Expected: PASS. Include the previously reported forms: `1 pack of Amul Butter 500 gms`, `100 grams of Amul butter 1 pac`, and `2 pacs of 50g of Amul butter`; each must identify `Amul butter` rather than leave `of`/`pacs` in the item name.

- [x] **Step 6: Commit**

```bash
git add packages/shopping-intelligence/src duckworth-api/src duckworth-api/test
git commit -m "feat: resolve conversation updates with undoable merges"
```

### Task 4: Close, inspect, and recover the one active conversation session

**Files:**
- Modify: `duckworth-api/src/shopping-items.ts`
- Modify: `duckworth-api/src/app.ts`
- Test: `duckworth-api/test/shopping-items.test.ts`

**Interfaces:**

```ts
POST /api/v1/households/:householdId/conversation-sessions/:sessionId/close
GET  /api/v1/households/:householdId/conversation-sessions/active
GET  /api/v1/households/:householdId/conversation-sessions/:sessionId/drafts
POST /api/v1/households/:householdId/conversation-drafts/:draftId/resolve
POST /api/v1/households/:householdId/conversation-drafts/:draftId/dismiss
```

- [x] **Step 1: Write the failing lifecycle contracts**

Prove that a session stays active after a day boundary and is only closed by the close endpoint. Assert that closing a conversation changes no shopping item’s lifecycle, purchase status, or archive status. Assert that an open draft remains reviewable, can be resolved into an item, and can be explicitly dismissed.

- [x] **Step 2: Run the focused API test red**

Run: `pnpm --dir duckworth-api test --run test/shopping-items.test.ts`

Expected: FAIL due to missing lifecycle/draft routes.

- [x] **Step 3: Implement explicit close and draft recovery**

Enforce exactly one active session per household at the data boundary. Once closed, a subsequent capture creates a new session; it does not carry reference context forward. Draft resolution must submit a normalized command back through the same brain path, not directly construct a shopping item in the route handler.

- [x] **Step 4: Run the focused API test green**

Run: `pnpm --dir duckworth-api test --run test/shopping-items.test.ts`

- [x] **Step 5: Commit**

```bash
git add duckworth-api/src duckworth-api/test
git commit -m "feat: add explicit conversation close and draft recovery"
```

### Task 5: Add household-controlled behaviour and advisory local learning

**Files:**
- Modify: `duckworth-api/src/shopping-items.ts`
- Modify: `duckworth-api/src/app.ts`
- Test: `duckworth-api/test/shopping-items.test.ts`
- Create: `duckworth-web/src/app/core/household-settings.service.ts`
- Create: `duckworth-web/src/app/core/household-learning.service.ts`
- Test: corresponding `*.spec.ts`

**Interfaces:**

```ts
interface HouseholdCaptureSettings {
  automaticConversationClose: 'off' | 'after_idle';
  cloudDraftAssist: 'disabled' | 'ask_before_each_use';
  suggestions: 'enabled' | 'disabled';
}
interface HouseholdSuggestion {
  itemIdentityKey: string;
  message: string;
  sourceEventIds: string[];
}
```

- [x] **Step 1: Write failing settings and learning tests**

Verify defaults are `off`, `disabled`, and `enabled`. Seed confirmed event history for a repeatedly chosen variant and assert a visible advisory suggestion is returned. Assert unconfirmed drafts and an explicit conflicting capture never train or override the learned suggestion.

- [x] **Step 2: Run tests red**

Run: `pnpm --dir duckworth-api test --run test/shopping-items.test.ts` and `pnpm --dir duckworth-web test -- --watch=false household-learning`

Expected: FAIL because settings and suggestion projections are absent.

- [x] **Step 3: Implement local-only, reversible learning**

Persist only the inputs needed to explain a suggestion: confirmed event IDs and the semantic identity they support. Offer suggestion acceptance/dismissal as explicit user events. Do not call external services and do not auto-create or mutate an item from learned history.

- [x] **Step 4: Run tests green**

Run: `pnpm --dir duckworth-api test --run test/shopping-items.test.ts && pnpm --dir duckworth-web test -- --watch=false household-learning`

- [x] **Step 5: Commit**

```bash
git add duckworth-api/src duckworth-api/test duckworth-web/src/app/core
git commit -m "feat: add local household capture preferences and suggestions"
```

### Task 6: Make the Angular screen a conversation output adapter

**Files:**
- Create: `duckworth-web/src/app/core/conversation.service.ts`
- Create: `duckworth-web/src/app/core/conversation.service.spec.ts`
- Modify: `duckworth-web/src/app/app.ts`
- Modify: `duckworth-web/src/app/app.html`
- Modify: `duckworth-web/src/app/app.scss`
- Modify: `duckworth-web/src/app/app.spec.ts`

- [x] **Step 1: Write failing UI/service contracts**

Write a service test that posts only `{ text, source: 'text' }` and maps the common brain response. Write component tests proving that one utterance can show saved/merged/draft results together; an open draft has “Review” and “Dismiss”; an adjustment confirmation offers “Undo”; and “Close conversation” affects context only.

- [x] **Step 2: Run focused UI tests red**

Run: `pnpm --dir duckworth-web test -- --watch=false app conversation.service`

Expected: FAIL because the frontend only calls its legacy one-item capture path.

- [x] **Step 3: Implement the thin adapter and responsive presentation**

Keep parsing, duplicate decisions, and session state out of components. Submit current text via `ConversationService`, render the returned structured summary, and refresh the projected shopping list. Use a stacked responsive layout for draft/detail controls; no overlapping quantity, unit, package-size, or action fields. Retain the legacy one-clause endpoint only as compatibility plumbing until all callers migrate.

- [x] **Step 4: Run focused UI tests green**

Run: `pnpm --dir duckworth-web test -- --watch=false app conversation.service`

- [x] **Step 5: Manually verify in a browser**

Run the API and web app, then verify:

1. `Add Apple iPhone and 4 milk pouches of 1 litre each` creates two rows with meaningful display units.
2. The Amul butter forms from Task 3 retain `Amul butter` as the item identity and merge correctly.
3. An ambiguous reference creates a reviewable draft without losing clear items.
4. Undo reverses only the last adjustment.
5. Closing a conversation does not purchase, remove, or archive list entries.

- [x] **Step 6: Commit**

```bash
git add duckworth-web/src/app
git commit -m "feat: present conversation capture results in the web app"
```

### Task 7: Explicit list archive and review/reopen flow

**Files:**
- Modify: `duckworth-api/src/shopping-items.ts`
- Modify: `duckworth-api/src/app.ts`
- Test: `duckworth-api/test/shopping-items.test.ts`
- Modify: `duckworth-web/src/app/core/shopping-items.service.ts`
- Modify: `duckworth-web/src/app/app.ts`
- Modify: `duckworth-web/src/app/app.html`
- Modify: `duckworth-web/src/app/app.spec.ts`

- [x] **Step 1: Write failing snapshot contracts**

Archive an explicit active-list snapshot. Assert that it remains reviewable, can be reopened, and can be copied into a new active list. Assert it does not mark any item purchased or ordered and does not close the conversation session.

- [x] **Step 2: Run tests red**

Run: `pnpm --dir duckworth-api test --run test/shopping-items.test.ts` and `pnpm --dir duckworth-web test -- --watch=false app`

Expected: FAIL because a shopping-list archive is not a first-class snapshot yet.

- [x] **Step 3: Implement archive snapshots separately from item lifecycle**

Use an immutable snapshot plus explicit review/reopen/copy operations. Do not overload the existing purchased/removed flags. Keep this action explicitly user initiated.

- [x] **Step 4: Run tests green and commit**

Run: `pnpm --dir duckworth-api test --run test/shopping-items.test.ts && pnpm --dir duckworth-web test -- --watch=false app`

```bash
git add duckworth-api/src duckworth-api/test duckworth-web/src/app
git commit -m "feat: add reviewable shopping list archives"
```

### Task 8: Run full validation and preserve the Phase 2 release gate

**Files:**
- Modify: `README.md` or the existing product/architecture document only if actual behaviour differs from it.

- [x] **Step 1: Run the complete repository suite**

Run: `pnpm --dir duckworth-web shared:build && pnpm --dir duckworth-web exec vitest run packages/shopping-intelligence/src --root .. --globals && pnpm --dir duckworth-api test -- --run && pnpm --dir duckworth-web test -- --watch=false && pnpm --dir duckworth-api build && pnpm --dir duckworth-web build`

Expected: PASS.

- [x] **Step 2: Inspect the final diff and migrations**

Run: `git diff --check` and `git status --short`.

Confirm every migration works from a fresh database and an existing database; verify no remote is configured, added, or contacted.

- [x] **Step 3: Update documentation where implementation establishes a new contract**

Document the exact Phase 1 boundary and add a clearly labelled “Mandatory Phase 2 release gate” link to the multi-speaker/device requirements in `docs/superpowers/specs/2026-08-10-local-first-conversational-shopping-brain-design.md`. Do not implement any multi-context routing in this phase.

- [x] **Step 4: Make the final implementation commit**

```bash
git add README.md docs duckworth-api duckworth-web packages
git commit -m "docs: record conversational shopping phase one boundary"
```

## Phase 2 mandatory release gate (do not demote to backlog)

Before any Phase 2 execution plan or release, explicitly design and validate concurrent, independently routed speaker/device contexts. The gate must cover context identity/routing, overlapping references, write conflicts, privacy, session controls, and cross-context isolation tests. Phase 2 must not launch merely because Phase 1 has shipped.
