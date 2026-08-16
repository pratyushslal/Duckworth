# Automatic Conversation Lifecycle and List Scope Implementation Plan

> **For agentic workers:** Execute this plan task-by-task with red → green → refactor checkpoints. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Replace technical context/session controls with source-agnostic, context-safe conversation lifecycle intelligence while introducing the durable shopping-list boundary required for future multiple lists.

**Architecture:** The pure shopping brain classifies shopping and lifecycle intent. The API resolves authorized household/list/context scope, persists events and lifecycle actions atomically, and returns projections. Angular automatically restores context and renders those projections; it contains no interpretation or duplicate/session policy.

**Tech Stack:** TypeScript 6, Angular 22 signals, Fastify 5, Node SQLite, Vitest, Angular TestBed, browser E2E.

## Global Constraints

- Default closure is explicit close intent plus confirmation; inactivity alone never closes.
- Automatic idle closure is opt-in, warned, grace-period based, and non-destructive.
- Every modern operation is scoped by household, shopping list, context, session where applicable, and idempotency key.
- Clear clauses persist immediately; ambiguous remainder becomes a durable draft.
- Item, brand, unit, locale, country, device, speaker, and household data are data-driven, not hardcoded.
- Context revocation, session closure, list archival, item removal, and purchase are separate lifecycle operations.
- Preserve meaningful package units; never replace requested scales with aggregated base-unit totals.
- No retailer routing, price safety, ordering, payment, cloud calls, medical advice, or vendor SDK integration.
- Do not configure or contact an online Git remote.
- Each task ends with focused tests and a commit.

## File map

- Create `packages/shopping-intelligence/src/conversation-lifecycle.ts`: pure lifecycle states, close-intent classification, pending-action transitions.
- Modify `packages/shopping-intelligence/src/index.ts`: export lifecycle contracts.
- Create `packages/shopping-intelligence/src/conversation-lifecycle.spec.ts`: public brain seam tests.
- Modify `duckworth-api/src/shopping-items.ts`: list table, scoped columns, lifecycle/pending-action persistence, migrations, transactional guards.
- Modify `duckworth-api/src/conversation-contexts.ts`: context revocation semantics and authorization helpers.
- Modify `duckworth-api/src/app.ts`: scoped routes, close-intent capture responses, pending-action confirmation, settings/list projections.
- Modify `duckworth-api/test/shopping-items.test.ts` and `duckworth-api/test/shopping-items-migration.test.ts`: API, concurrency, and migration contracts.
- Modify `duckworth-web/src/app/core/conversation.service.ts`: scope and lifecycle API adapter.
- Modify `duckworth-web/src/app/core/conversation-context.service.ts`: automatic restore/register/revocation behavior.
- Create `duckworth-web/src/app/core/conversation-lifecycle.service.ts`: server-state hydration and temporary close prompt state.
- Modify `duckworth-web/src/app/app.ts`, `app.html`, `app.scss`: remove technical controls and render authoritative status/prompt.
- Create `duckworth-web/src/app/core/conversation-lifecycle.service.spec.ts`.
- Modify `duckworth-web/src/app/app.spec.ts` and add browser E2E coverage under the existing web test structure.
- Modify OpenAPI snapshots and `PROJECT_OVERVIEW.md` only when contracts change.

### Task 1: Add the pure lifecycle decision contract

**Files:** create `packages/shopping-intelligence/src/conversation-lifecycle.ts`, create `conversation-lifecycle.spec.ts`, modify `src/index.ts`.

**Interfaces:**

```ts
export type ConversationSessionStatus = 'active' | 'idle' | 'close_pending' | 'closed';
export type CloseActionOrigin = 'explicit_intent' | 'configured_idle_policy';
export interface ConversationLifecycleState {
  status: ConversationSessionStatus;
  pendingActionId: string | null;
  pendingOrigin: CloseActionOrigin | null;
  pendingPreviousStatus: 'active' | 'idle' | null;
}
export type LifecycleDecision =
  | { kind: 'no_action'; state: ConversationLifecycleState }
  | { kind: 'start_or_resume'; state: ConversationLifecycleState }
  | { kind: 'request_close'; state: ConversationLifecycleState; origin: CloseActionOrigin }
  | { kind: 'cancel_close'; state: ConversationLifecycleState }
  | { kind: 'confirm_close'; state: ConversationLifecycleState };
export function decideConversationLifecycle(input: string, state: ConversationLifecycleState, now: string): LifecycleDecision;
```

- [x] Write failing tests for positive close phrases, negation, item-scoped completion, ambiguous language, confirmation without pending action, expired pending actions, and new shopping input cancelling a pending close.
- [x] Run `pnpm --dir duckworth-web exec vitest run packages/shopping-intelligence/src/conversation-lifecycle.spec.ts --root .. --globals`; verify red because the module is absent.
- [x] Implement deterministic normalization, negation checks, target-scope checks, pending expiry, and state transitions without database or Angular imports.
- [x] Run the focused test and the existing intelligence tests; verify green.
- [x] Commit `feat: add source-neutral conversation lifecycle decisions`.

### Task 2: Introduce and migrate the shopping-list boundary

**Files:** modify `duckworth-api/src/shopping-items.ts`; tests in `shopping-items-migration.test.ts` and `shopping-items.test.ts`.

**Interfaces:**

```ts
interface ShoppingList { id: string; householdId: string; name: string; status: 'active' | 'archived'; isDefault: boolean; }
interface ConversationScope { householdId: string; shoppingListId: string; contextId: string; sessionId?: string; }
```

- [x] Write a migration test that starts from the current schema, opens the repository, and asserts exactly one default list, preserved item/event/draft/session ownership, and rerunnable migration.
- [x] Run `pnpm --dir duckworth-api test --run test/shopping-items-migration.test.ts`; verify red because `shopping_lists` and ownership columns are absent.
- [x] Add `shopping_lists`, `shopping_list_id` columns, scoped indexes, and transactional backfill. Add repository methods `getDefaultShoppingList`, `listShoppingLists`, and `resolveShoppingList`.
- [x] Update item projections and active variant ownership to include list scope; remaining session/event/draft scoping is Task 3.
- [x] Run migration and existing shopping-item tests; verify green.
- [x] Commit `feat: add durable shopping list ownership`.

### Task 3: Enforce context/list-scoped session authorization

**Files:** modify `shopping-items.ts`, `conversation-contexts.ts`, `app.ts`; add API tests.

- [x] Write failing tests proving a capture without modern context cannot select an arbitrary active session, a context token cannot access another context, and a session-close request lacking the owning context is rejected.
- [x] Run `pnpm --dir duckworth-api test --run test/shopping-items.test.ts`; verify red against current household-wide lookup/close behavior.
- [x] Require authorized context and resolved list for modern capture, scope active-session lookup to `(householdId, shoppingListId, contextId)`, and add the scoped list/session projection contract.
- [x] Make context revocation migration-ready for list-scoped sessions; never affect list items.
- [x] Add stable 403/404/409 error contracts and idempotent close behavior.
- [x] Run focused API tests plus existing context tests; verify green.
- [x] Commit `feat: enforce scoped conversation ownership`.

### Task 4: Persist pending close actions and confirmation

**Files:** modify `shopping-items.ts`, `app.ts`; add lifecycle API tests.

**Routes:**

```text
POST /api/v1/households/:householdId/conversation-captures
POST /api/v1/households/:householdId/conversation-pending-actions/:actionId/confirm
POST /api/v1/households/:householdId/conversation-pending-actions/:actionId/cancel
GET  /api/v1/households/:householdId/conversation-state?shoppingListId=...&contextId=...
```

- [x] Write failing API tests for explicit close intent → pending, valid confirmation → closed, rejection → previous active/idle state, expiry → previous state, repeated confirmation → original result, and new shopping input cancelling pending close.
- [x] Run the focused tests red.
- [x] Add `conversation_pending_actions`, lifecycle status columns, `previous_status`, `origin`, expiry, and resolution timestamps. Apply session/pending transitions transactionally with idempotency receipts.
- [x] Route close-intent results through the brain lifecycle decision; do not close directly from the route handler.
- [x] Run API tests green and commit `feat: add safe conversation close confirmation`.

### Task 5: Add automatic context/session restoration in the web adapter

**Files:** modify `conversation-context.service.ts`, `conversation.service.ts`; create `conversation-lifecycle.service.ts` and its spec; modify `app.ts`.

- [x] Write failing service/component tests proving startup restores a valid context, invalid authorization retries safely, page load does not open a session, and refresh hydrates list/session/drafts/pending action.
- [x] Run the focused Angular tests red.
- [x] Implement automatic context initialization, scoped state hydration, retry handling, and server-state signals. Do not reintroduce a household-wide fallback for a failed modern context.
- [x] Run the focused Angular tests green.
- [x] Commit `feat: restore scoped conversation state automatically`.

### Task 6: Remove permanent technical controls and add the temporary safety prompt

**Files:** modify `app.html`, `app.scss`, `app.ts`, `app.spec.ts`.

- [x] Write failing UI tests proving the context panel, “Use this browser context,” “Close context,” and permanent “Close conversation” controls are absent; prove a temporary close prompt appears only for `close_pending` and list content remains after closure.
- [x] Run `pnpm --dir duckworth-web exec ng test --watch=false --include src/app/app.spec.ts`; verify red.
- [x] Remove technical controls, render concise session/list status, wire confirmation/cancel actions to `ConversationService`, and preserve accessible names and responsive layout.
- [x] Run focused Angular tests and the UI detector/browser check; verify green.
- [x] Commit `feat: hide technical lifecycle controls behind safe automation`.

### Task 7: Implement settings and optional idle-close policy

**Files:** modify settings schema/repository/routes; create or modify web settings service/component and tests.

- [x] Write failing tests for defaults (`automatic closure: off`), configured threshold/grace policy, warning state, cancellation by new input, and automatic close after grace.
- [x] Run API and Angular settings tests red.
- [x] Persist explicit settings: closure mode, idle threshold, grace period, warning policy, suggestions, and cloud-draft permission. Add a deterministic scheduler/service that only acts on opted-in sessions and never mutates list items.
- [x] Run settings tests green and commit `feat: add safe conversation behavior settings`.

### Task 8: Complete positive, negative, concurrency, migration, and browser gates

**Files:** API and web test suites; OpenAPI snapshots; docs only where behavior differs.

- [x] Add table-driven negative tests for “not done,” “enough milk,” “close to finishing,” silence, refresh, expired confirmation, wrong context, and revoked device.
- [x] Add concurrency tests for capture-versus-close ordering, replayed idempotency keys, two contexts sharing one list, and future two-list isolation.
- [x] Add browser checks for two tabs, refresh, temporary confirmation, list visibility after close, and absence of permanent technical controls.
- [x] Add regression cases for `1 pack of Amul Butter 500 gms`, `100 grams of Amul butter 1 pac`, `2 pacs of 50g of Amul butter`, `Britannia 50-50 biscuit`, `Dukes Bourbon`, and meaningful lowercase full-unit display.
- [x] Run `pnpm --dir duckworth-api test`, `pnpm --dir duckworth-web test`, both typechecks/builds, `git diff --check`, and migration tests from fresh/legacy databases.
- [x] Update OpenAPI snapshots and documentation, inspect the diff, and commit `test: close automatic lifecycle acceptance gates`.
