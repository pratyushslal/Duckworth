# Phase 2 Concurrent Speaker and Device Contexts Implementation Plan

## Reader guide and current status

This is the execution checklist for the approved Phase 2 design. It is not a
claim that every checkbox is already complete. Read it together with the
[design](../specs/2026-08-11-concurrent-contexts-design.md) and the
[acceptance gate](../specs/2026-08-11-concurrent-contexts-acceptance.md).

### Already implemented in this repository

- Source-neutral context contract.
- Context registration, token authorization, close, handoff, and claim routes.
- Durable shopping-list and conversation ownership boundaries.
- Automatic context restoration and scoped lifecycle hydration.
- Capture idempotency receipts and migration support.

### Remaining release work

1. Prove simultaneous contexts with dedicated API and two-browser tests.
2. Prove context-isolated drafts, follow-ups, stale corrections, and privacy.
3. Prove text/voice/API/assistant equivalence through the same brain boundary.
4. Finish the thin web presentation for context/handoff state.
5. Run the final migration, build, typecheck, and browser release audit.

### How to review this plan

- `[x]` means the checkpoint is complete and committed.
- `[ ]` means it remains planned work.
- A scenario is not accepted because code exists; it is accepted only when its
  observable test passes.
- No item in this plan adds retailer routing, pricing, ordering, payment, cloud
  interpretation, medical advice, or vendor SDK integration.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Phase 1's single household conversation context with independently routed, concurrently usable speaker/device contexts while keeping one shared shopping list and the source-agnostic shopping brain.

**Architecture:** Input adapters attach an opaque context reference and idempotency key to the existing channel-neutral capture command. The brain continues to interpret language without knowing whether it came from text, voice, API, or an assistant; the persistence layer uses the context only to select the correct session, draft candidates, and access boundary. All contexts write to the same household list through serialized event transactions, with additive merges, optimistic correction checks, and explicit handoff/closure.

**Tech Stack:** TypeScript 6, `@duckworth/shopping-intelligence`, Fastify 5, Node SQLite, Angular 22 signals, Vitest, and Playwright browser tests.

## Global Constraints

- Phase 2 must pass the approved mandatory gate for context identity/routing, concurrent reference resolution, simultaneous-edit conflicts, privacy boundaries, handoff/closure UX, and cross-context isolation tests before release.
- The shopping brain remains source-agnostic; no interpretation, duplicate detection, or context policy is implemented in Angular or an input adapter.
- One shared household shopping list remains the projection target; contexts isolate conversation references and drafts, not household inventory.
- The same capture text with the same locale, country, and candidate list produces the same interpretation regardless of `source` or device.
- Additive merges are serialized and individually undoable; stale corrections return current state and never overwrite another context's change.
- Context access uses opaque server-issued tokens; raw speaker identity is not placed in shopping item text or suggestion messages.
- Phase 2 does not add retailer routing, prices, carts, ordering, payment, cloud interpretation, medical advice, or vendor-specific Alexa/Google SDK calls.
- Local deterministic interpretation remains the default and no network call is made by the brain.
- Existing Phase 1 callers without context metadata continue through a clearly marked legacy context until all shipped adapters migrate.
- Use red → green public-boundary tests and commit each independently testable task. Do not configure or contact an online Git remote.

---

## Release-gate design decisions

The following decisions are fixed for this phase:

```ts
export interface ConversationContextRef {
  contextId: string;
  deviceId: string;
  speakerId: string | null;
}

export interface ContextualConversationCaptureCommand {
  householdId: string;
  context: ConversationContextRef;
  sessionId?: string;
  text: string;
  locale: string;
  countryCode: string;
  source: 'text' | 'voice' | 'api' | 'assistant';
  occurredAt: string;
  idempotencyKey: string;
}
```

- A context is the pair `(deviceId, speakerId)`, represented by a server-issued `contextId`. A missing speaker is represented by `null`, not an invented speaker name.
- Each context has at most one active conversation session. A household can have many active contexts and sessions.
- Context references and open drafts are never resolved against another context's draft. Follow-ups may update a shared item only after the brain finds exactly one semantic candidate in the household projection.
- Two additive quantity merges are both accepted in commit order. A correction carrying an obsolete item version returns `409 context_conflict` with the current item and leaves a clarification draft available to the originating context.
- A context can be explicitly closed without changing item lifecycle state. Handoff creates a short-lived transfer token and does not silently merge conversation history.

## File map

- Create `docs/superpowers/specs/2026-08-11-concurrent-contexts-design.md`: the reviewed Phase 2 gate, threat model, wire contracts, and invariants.
- Create `packages/shopping-intelligence/src/conversation-context.ts` and its spec: source-neutral context envelopes, validation, and partition-key helpers.
- Modify `packages/shopping-intelligence/src/index.ts`: export only the public context contract.
- Modify `duckworth-api/src/shopping-items.ts`: context registry, token hashes, session scoping, idempotency records, migration, and transactional conflict rules.
- Modify `duckworth-api/src/app.ts`: context registration/list/close/handoff routes and context-aware capture/undo contracts.
- Modify `duckworth-api/test/shopping-items-migration.test.ts` and `duckworth-api/test/shopping-items.test.ts`: fresh/legacy migration, isolation, replay, conflict, and handoff contracts.
- Create `duckworth-web/src/app/core/conversation-context.service.ts` and its spec: register and persist the local device context, attach tokens, and expose context state.
- Modify `duckworth-web/src/app/core/conversation.service.ts`, `app.ts`, `app.html`, and `app.scss`: use the context adapter and render context/handoff state without parsing language.
- Create `duckworth-web/e2e/concurrent-contexts.spec.ts`: two-browser-context acceptance tests.
- Modify `docs/superpowers/specs/2026-08-10-local-first-conversational-shopping-brain-design.md` and `README.md`: link the Phase 2 design and record the released boundary.

### Task 1: Write and approve the concurrent-context gate

**Files:**
- Create: `docs/superpowers/specs/2026-08-11-concurrent-contexts-design.md`
- Test artifact: `docs/superpowers/specs/2026-08-11-concurrent-contexts-acceptance.md`

- [ ] **Step 1: Write the failing gate checklist**

Record literal scenarios: two devices adding items simultaneously; two speakers saying follow-ups to similarly named items; one context closing while another remains active; a replayed request; a stale correction; a handoff; and an attempted cross-context draft access. Each scenario must name the expected context, session, item, draft, and HTTP result.

- [ ] **Step 2: Review the gate against the approved Phase 1 design**

Confirm the document explicitly covers context identity/routing, overlapping references, write conflicts, privacy, handoff/closure, and isolation. Confirm it does not authorize cloud, retailer, payment, or vendor SDK work.

- [ ] **Step 3: Commit the gate documents**

```bash
git add docs/superpowers/specs/2026-08-11-concurrent-contexts-design.md docs/superpowers/specs/2026-08-11-concurrent-contexts-acceptance.md
git commit -m "docs: define phase two concurrent context gate"
```

### Task 2: Establish the source-neutral context contract

**Files:**
- Create: `packages/shopping-intelligence/src/conversation-context.ts`
- Create: `packages/shopping-intelligence/src/conversation-context.spec.ts`
- Modify: `packages/shopping-intelligence/src/index.ts`

**Interfaces:**

```ts
export function normalizeConversationContext(ref: ConversationContextRef): ConversationContextRef;
export function conversationContextKey(ref: ConversationContextRef): string;
export function contextualizeCapture(command: ContextualConversationCaptureCommand): ContextualConversationCaptureCommand;
```

- [ ] **Step 1: Write the failing public-boundary tests**

```ts
expect(conversationContextKey({ contextId: 'ctx-a', deviceId: 'tablet-1', speakerId: 'speaker-1' }))
  .toBe('ctx-a');
expect(normalizeConversationContext({ contextId: ' ctx-a ', deviceId: ' tablet-1 ', speakerId: '' }))
  .toEqual({ contextId: 'ctx-a', deviceId: 'tablet-1', speakerId: null });
expect(contextualizeCapture({ ...command, source: 'voice' }).text).toBe(command.text);
```

Also assert missing IDs, whitespace-only IDs, and an empty idempotency key throw a stable validation error. Assert that changing `source` or device metadata never changes `interpretConversation(command)` output.

- [ ] **Step 2: Run the focused contract red**

Run: `pnpm --dir duckworth-web exec vitest run packages/shopping-intelligence/src/conversation-context.spec.ts --root .. --globals`

Expected: FAIL because the context module and exports do not exist.

- [ ] **Step 3: Implement the smallest pure contract**

Trim and validate identifiers, convert an empty speaker to `null`, preserve the raw text and locale fields, and return a stable context key. Do not import Angular, Fastify, SQLite, or a voice SDK.

- [ ] **Step 4: Run the focused contract green**

Run: `pnpm --dir duckworth-web shared:build && pnpm --dir duckworth-web exec vitest run packages/shopping-intelligence/src/conversation-context.spec.ts --root .. --globals`

- [ ] **Step 5: Commit**

```bash
git add packages/shopping-intelligence/src
git commit -m "feat: add source-neutral conversation context contract"
```

### Task 3: Add context registry, token boundaries, and migration

**Files:**
- Modify: `duckworth-api/src/shopping-items.ts`
- Modify: `duckworth-api/src/app.ts`
- Test: `duckworth-api/test/shopping-items-migration.test.ts`
- Test: `duckworth-api/test/shopping-items.test.ts`

**Interfaces:**

```ts
interface ConversationContext {
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

POST /api/v1/households/:householdId/conversation-contexts
  -> { context: ConversationContext; accessToken: string }
GET  /api/v1/households/:householdId/conversation-contexts
  -> ConversationContext[]
POST /api/v1/households/:householdId/conversation-contexts/:contextId/close
  -> ConversationContext
```

- [ ] **Step 1: Write migration and route tests red**

Assert a fresh database creates the context and token tables. Assert a Phase 1 database with one household session migrates it to a deterministic `legacy-household` context without changing its session ID or drafts. Registering the same `(deviceId, speakerId)` twice returns the same context. A token for context A cannot list, close, or capture in context B.

- [ ] **Step 2: Run focused tests red**

Run: `pnpm --dir duckworth-api test --run test/shopping-items-migration.test.ts test/shopping-items.test.ts -t "context"`

Expected: FAIL because the tables and routes do not exist.

- [ ] **Step 3: Add the schema and migration**

Create `conversation_contexts` with a unique `(household_id, device_id, speaker_key)` constraint and `conversation_context_tokens` containing only a salted hash. Add `context_id` to `conversation_sessions`, backfill existing rows to the deterministic legacy context, and replace the one-active-per-household index with one-active-per-context. Keep drafts/events linked to their session.

- [ ] **Step 4: Implement token-checked context operations**

Generate the raw token once on registration, store only its hash, compare hashes with a constant-time check, and require household plus context ownership on every operation. Return `404` for an unknown context and `403` for a token belonging to another context.

- [ ] **Step 5: Run migration and route tests green**

Run: `pnpm --dir duckworth-api test --run test/shopping-items-migration.test.ts test/shopping-items.test.ts -t "context"`

- [ ] **Step 6: Commit**

```bash
git add duckworth-api/src duckworth-api/test
git commit -m "feat: add isolated household conversation contexts"
```

### Task 4: Scope sessions, drafts, and follow-ups by context

**Files:**
- Modify: `packages/shopping-intelligence/src/conversation.ts`
- Modify: `duckworth-api/src/shopping-items.ts`
- Modify: `duckworth-api/src/app.ts`
- Test: `packages/shopping-intelligence/src/conversation.spec.ts`
- Test: `duckworth-api/test/shopping-items.test.ts`

- [ ] **Step 1: Write failing isolation tests**

Create context A with an Amul butter item and context B with a Britannia butter item. A follow-up from A must update only Amul; a follow-up from B must update only Britannia. If one context has an unresolved draft, the other context's capture must not resolve, dismiss, or list that draft. A shared item may be updated only when the brain finds one exact household candidate.

- [ ] **Step 2: Run the focused tests red**

Run: `pnpm --dir duckworth-web exec vitest run packages/shopping-intelligence/src/conversation.spec.ts --root .. --globals && pnpm --dir duckworth-api test --run test/shopping-items.test.ts -t "context isolation"`

Expected: FAIL because capture and draft lookup currently select the household's single active session.

- [ ] **Step 3: Pass context through the brain boundary without changing interpretation**

Add `contextId` only to session/draft resolution inputs. Keep `interpretConversation` and `resolveFollowUp` pure; they receive an explicit candidate set and cannot read a database or infer a context from `source`.

- [ ] **Step 4: Select the context session transactionally**

Change `captureConversation`, draft resolution, draft dismissal, close, and undo to require an authorized context. Find/create the active session for that context, and reject a session ID belonging to another context even when the household matches.

- [ ] **Step 5: Run focused tests green and commit**

```bash
pnpm --dir duckworth-web shared:build
pnpm --dir duckworth-web exec vitest run packages/shopping-intelligence/src/conversation.spec.ts --root .. --globals
pnpm --dir duckworth-api test --run test/shopping-items.test.ts -t "context isolation"
git add packages/shopping-intelligence/src duckworth-api/src duckworth-api/test
git commit -m "feat: scope conversation references to their context"
```

### Task 5: Make concurrent writes idempotent and conflict-safe

**Files:**
- Modify: `duckworth-api/src/shopping-items.ts`
- Modify: `duckworth-api/src/app.ts`
- Test: `duckworth-api/test/shopping-items.test.ts`

- [ ] **Step 1: Write failing replay and conflict tests**

Send the same capture twice with the same context and `idempotencyKey`; assert one event and one result are returned. Send two different additive merges concurrently; assert both deltas are present and each has its own undo token. Submit a correction with an old item version; assert `409 context_conflict`, the current item, and an open draft for the originating context.

- [ ] **Step 2: Run the focused tests red**

Run: `pnpm --dir duckworth-api test --run test/shopping-items.test.ts -t "idempot|concurrent|conflict"`

Expected: FAIL because captures have no idempotency record and corrections do not return context-aware conflicts.

- [ ] **Step 3: Add idempotency and transaction guards**

Create `conversation_capture_receipts(context_id, idempotency_key, result_json, created_at)` with a unique key. In the existing `BEGIN IMMEDIATE` transaction, return the stored result before interpreting a replay. Record context ID on events and keep additive merges as separate rows.

- [ ] **Step 4: Preserve stale corrections as recoverable drafts**

Use the existing item version check. On conflict, return the authoritative current item and persist a draft containing the attempted text, context ID, and `concurrent_edit` reason; never overwrite the current item.

- [ ] **Step 5: Run focused tests green and commit**

```bash
pnpm --dir duckworth-api test --run test/shopping-items.test.ts -t "idempot|concurrent|conflict"
git add duckworth-api/src duckworth-api/test
git commit -m "feat: make multi-context writes idempotent and conflict-safe"
```

### Task 6: Add explicit handoff and context lifecycle UX

**Files:**
- Modify: `duckworth-api/src/shopping-items.ts`
- Modify: `duckworth-api/src/app.ts`
- Test: `duckworth-api/test/shopping-items.test.ts`
- Create: `duckworth-web/src/app/core/conversation-context.service.ts`
- Create: `duckworth-web/src/app/core/conversation-context.service.spec.ts`
- Modify: `duckworth-web/src/app/core/conversation.service.ts`

**Interfaces:**

```ts
POST /api/v1/households/:householdId/conversation-contexts/:contextId/handoff
  payload: { targetDeviceId: string; targetSpeakerId?: string; accessToken: string }
  -> { handoffToken: string; expiresAt: string }
POST /api/v1/households/:householdId/conversation-contexts/claim
  payload: { handoffToken: string; deviceId: string; speakerId?: string }
  -> { context: ConversationContext; accessToken: string }
```

- [ ] **Step 1: Write failing handoff and service tests**

Assert a handoff token expires after 10 minutes, can be claimed once by the named target device/speaker, cannot be claimed by another device, and preserves open drafts while retaining the original context audit trail. Assert closing context A leaves context B active.

- [ ] **Step 2: Run focused tests red**

Run: `pnpm --dir duckworth-api test --run test/shopping-items.test.ts -t "handoff|context close" && pnpm --dir duckworth-web exec vitest run src/app/core/conversation-context.service.spec.ts --root . --globals`

Expected: FAIL because no handoff routes or context service exist.

- [ ] **Step 3: Implement short-lived handoff tokens**

Store only a hash, target device/speaker, source context, expiry, and claimed timestamp. Claiming returns a new access token for the same context; it does not copy drafts or create a second active session.

- [ ] **Step 4: Implement the Angular context adapter**

Register one local web device profile, persist the access token in device-scoped storage, attach `contextId` and `idempotencyKey` through `ConversationService`, and expose context status/handoff observables. Keep all language interpretation in the API brain.

- [ ] **Step 5: Run focused tests green and commit**

```bash
pnpm --dir duckworth-api test --run test/shopping-items.test.ts -t "handoff|context close"
pnpm --dir duckworth-web exec vitest run src/app/core/conversation-context.service.spec.ts --root . --globals
git add duckworth-api/src duckworth-api/test duckworth-web/src/app/core
git commit -m "feat: support explicit context handoff and closure"
```

### Task 7: Present context state without moving brain policy into Angular

**Files:**
- Modify: `duckworth-web/src/app/app.ts`
- Modify: `duckworth-web/src/app/app.html`
- Modify: `duckworth-web/src/app/app.scss`
- Modify: `duckworth-web/src/app/app.spec.ts`
- Test: `duckworth-web/e2e/concurrent-contexts.spec.ts`

- [ ] **Step 1: Write failing UI and browser tests**

Assert the page shows the current device/context label, keeps the existing shared list visible, shows drafts only for the current context, and offers Close, Switch context, and Handoff actions with accessible names. In two browser contexts, add `milk` from one and `bread` from the other; both rows appear in the shared list while each conversation summary remains isolated.

- [ ] **Step 2: Run focused tests red**

Run: `pnpm --dir duckworth-web test -- --watch=false app` and `pnpm --dir duckworth-web exec playwright test e2e/concurrent-contexts.spec.ts`

Expected: FAIL because the page has no context state or multi-browser fixture.

- [ ] **Step 3: Add the thin output adapter**

Render server-returned context/session/draft state. Do not add parsing, candidate matching, duplicate checks, or conflict decisions to the component. Keep the responsive form layout stacked for context controls and existing item details.

- [ ] **Step 4: Run browser and component tests green**

Run: `pnpm --dir duckworth-web test -- --watch=false app && pnpm --dir duckworth-web exec playwright test e2e/concurrent-contexts.spec.ts`

- [ ] **Step 5: Commit**

```bash
git add duckworth-web/src/app duckworth-web/e2e
git commit -m "feat: show isolated conversation contexts in the web adapter"
```

### Task 8: Prove adapter equivalence, migration safety, and release readiness

**Files:**
- Modify: `duckworth-api/test/shopping-items.test.ts`
- Modify: `duckworth-web/e2e/concurrent-contexts.spec.ts`
- Modify: `docs/superpowers/specs/2026-08-10-local-first-conversational-shopping-brain-design.md`
- Modify: `README.md`

- [ ] **Step 1: Write the final gate tests**

For the same capture and candidate list, submit `source: 'text'`, `'voice'`, `'api'`, and `'assistant'` through separate contexts and assert the same saved/merged/draft decisions. Assert a context cannot read or mutate another context's drafts, sessions, or tokens. Assert a migrated Phase 1 database preserves the legacy list and session.

- [ ] **Step 2: Run the complete validation suite**

Run:

```bash
pnpm --dir duckworth-web shared:build
pnpm --dir duckworth-web exec vitest run packages/shopping-intelligence/src --root .. --globals
pnpm --dir duckworth-api test -- --run
pnpm --dir duckworth-api typecheck
pnpm --dir duckworth-web typecheck
pnpm --dir duckworth-web exec playwright test e2e/concurrent-contexts.spec.ts
pnpm --dir duckworth-api build
pnpm --dir duckworth-web build
```

- [ ] **Step 3: Review the final migration and privacy diff**

Run `git diff --check`, inspect every SQLite migration from both fresh and existing databases, confirm tokens are never logged or returned after registration, and confirm no online remote is configured or contacted.

- [ ] **Step 4: Update the released boundary documentation**

Document the context envelope, legacy-context compatibility, handoff expiry, conflict semantics, and the fact that vendor voice SDKs remain adapter work outside this release.

- [ ] **Step 5: Commit the release boundary**

```bash
git add docs README.md duckworth-api duckworth-web packages
git commit -m "docs: record phase two concurrent context release"
```

## Phase 2 acceptance criteria

- Two or more devices/speakers in one household can hold active contexts at the same time.
- The same household list receives clear items from every context without leaking drafts or references between contexts.
- A follow-up resolves only within its authorized context unless the brain finds exactly one shared household candidate.
- Replaying an idempotency key creates no duplicate item or event.
- Concurrent additive merges are both retained and individually undoable.
- A stale correction cannot overwrite a newer version and produces a recoverable context-scoped draft.
- Context registration, token checks, handoff, close, and claim are covered by API tests and cross-context denial tests.
- Text, voice transcript, API, and assistant adapters use the same brain decision for equivalent captures.
- A Phase 1 database migrates without losing items, sessions, drafts, events, or brand/package data.
- No cloud calls, retailer/ordering behavior, price safety, medical advice, or vendor SDK integration is shipped as part of this phase.
