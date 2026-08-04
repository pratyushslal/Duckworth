# Richer Typed Item Capture — Implementation Plan

**Status:** Pending user approval

**Date:** 2026-08-04

**Design source:** `docs/superpowers/specs/2026-08-04-richer-item-capture-design.md`

## Objective

Deliver a bounded, local-first typed-capture slice in which Duckworth interprets quantity/unit shorthand immediately, persists structured intent, saves incomplete items without blocking, suggests the household's most recently confirmed unit, and makes that inferred value easy to accept or replace.

The Angular experience must remain responsive under delayed or unavailable networking. No application code in this plan contacts an online service or requires a Git remote.

## Delivery rules

- Follow the tasks in order.
- Within each task, run one red-green cycle at a time: add one observable behavior test, verify the expected failure, implement the minimum passing behavior, and rerun the focused test.
- Do not write all tests before implementation.
- Test public package, HTTP, Angular, and browser interfaces rather than private helpers.
- Do not refactor while a focused test is red.
- Run the relevant broader suite after each green task and commit only green checkpoints.
- Keep price, ordering, retailer, voice, AI, authentication, and membership work out of this slice.
- Preserve the existing `/api/v1` lifecycle, household scoping, duplicate protection, optimistic concurrency, SSE behavior, and independently runnable API/frontend commands.

## Public interfaces selected for TDD

### Shared capture package

```ts
export interface CaptureInterpretation {
  captureText: string;
  name: string;
  quantity: number | null;
  unit: CanonicalUnit | null;
}

export function interpretCapture(input: string): CaptureInterpretation;
export function normalizeItemName(name: string): string;
```

Invalid capture throws a narrow exported validation error. Unit aliases remain internal; the public name normalizer gives API duplicate/history queries and browser cache keys one exact rule.

### HTTP creation

```json
{
  "input": "2 milk",
  "confirmedUnit": "cartons"
}
```

`input` is the new capture field; legacy `{ "name": "..." }` remains accepted. Exactly one capture field is required.

### HTTP structured update

```json
{
  "quantity": 2,
  "confirmedUnit": "cartons",
  "expectedVersion": 3
}
```

`quantity` and `confirmedUnit` are independently optional patch members. `null` removes the corresponding structured value. Existing name/status patches continue to work.

## Task 1 — Build the shared parser as the first tracer bullet

**Outcome:** Both applications can consume one compiled, dependency-free parser; the parser's behavior is proved through its public export.

### Files

- `packages/item-capture/package.json`
- `packages/item-capture/tsconfig.json`
- `packages/item-capture/src/index.ts`
- `duckworth-api/package.json`
- `duckworth-api/pnpm-lock.yaml`
- `duckworth-api/test/item-capture.test.ts`

### Setup

1. Add a private ESM package exporting compiled JavaScript and declarations from `dist/`.
2. Add `@duckworth/item-capture` as a local `link:` dependency of the API.
3. Add an API `capture:build` script and pre-hooks so `dev`, `test`, `typecheck`, `build`, and `start` build the local package before consuming it.
4. Keep the package free of runtime dependencies and framework/browser/database imports.

### TDD cycles

1. **RED:** Through the package export, expect `1.5 kg potatoes` to return capture text, name `potatoes`, quantity `1.5`, and unit `kg`.
   **GREEN:** Implement only leading decimal, recognized unit, and remaining-name parsing.
2. **RED:** Expect bare `milk` to return a null quantity and unit.
   **GREEN:** Add bare-name handling.
3. **RED:** Expect `2 milk` to return quantity `2`, null unit, and name `milk`.
   **GREEN:** Make the unit optional.
4. **RED/GREEN one alias at a time:** Prove canonicalization for representative mass, volume, count, and package aliases, then complete the approved vocabulary.
5. **RED/GREEN one case at a time:** Reject empty, whitespace-only, zero, negative, non-finite, and quantity-only capture.
6. **RED:** Expect `2 trays eggs` to remain quantity `2`, null unit, and name `trays eggs`.
   **GREEN:** Ensure unknown unit-like words are not guessed.
7. **RED:** Expect item-name casing to be preserved while surrounding/repeated whitespace is normalized.
   **GREEN:** Add only that normalization.
8. **RED:** Expect the public `normalizeItemName` export to apply the same case-insensitive comparison rule used by duplicate and history lookup.
   **GREEN:** Extract and export the shared normalization boundary.

### Verify

```text
cd duckworth-api
pnpm test --run test/item-capture.test.ts
pnpm typecheck
pnpm build
```

## Task 2 — Persist structured capture and migrate SQLite safely

**Outcome:** The public item API stores capture text, quantity, unit source, and confirmation time without losing existing local data.

### Files

- `duckworth-api/src/shopping-items.ts`
- `duckworth-api/src/app.ts`
- `duckworth-api/test/shopping-items.test.ts`
- `duckworth-api/test/shopping-items-migration.test.ts`

### TDD cycles

1. **RED:** POST `{ input: "1.5 kg potatoes" }` returns structured fields, explicit unit source, `unitConfirmedAt`, empty attention reasons, and version `1`.
   **GREEN:** Integrate the shared parser at the create boundary and extend the public item mapping.
2. **RED:** POST `{ input: "milk" }` succeeds and returns `missing_quantity` for an active item.
   **GREEN:** Derive attention reasons from status, quantity, and source.
3. **RED:** A purchased item does not return active attention; reopening derives it again.
   **GREEN:** Make attention status-aware.
4. **RED:** A legacy database file created with the current schema opens and lists its rows through HTTP with safe structured defaults.
   **GREEN:** Implement an idempotent table-rebuild migration adding `capture_text`, `quantity`, `unit`, `unit_source`, and `unit_confirmed_at`.
5. **RED:** The same normalized item can be purchased repeatedly while two active duplicates still return `409`.
   **GREEN:** Replace table-level status uniqueness with the approved partial active-item index.
6. **RED:** Legacy `{ name: "Milk" }` still creates an item; neither/both capture fields return `400`.
   **GREEN:** Add explicit compatibility validation.
7. **RED/GREEN:** Validate positive finite quantities and units of at most 32 trimmed characters through HTTP.

Migration tests may create a legacy SQLite fixture as setup, but must verify migration behavior through Fastify's public HTTP interface.

### Verify

```text
cd duckworth-api
pnpm test --run test/shopping-items.test.ts
pnpm test --run test/shopping-items-migration.test.ts
pnpm typecheck
```

## Task 3 — Add confirmed unit history and structured updates

**Outcome:** Server-side history is deterministic, inferred values never reinforce themselves, and the acceptance UI has one unambiguous patch operation.

### Files

- `duckworth-api/src/shopping-items.ts`
- `duckworth-api/src/app.ts`
- `duckworth-api/test/shopping-items.test.ts`

### TDD cycles

1. **RED:** After purchasing `2 cartons milk`, creating `2 milk` returns unit `carton`, source `history`, and `unconfirmed_historical_unit`.
   **GREEN:** Query the latest explicit unit for the exact household and normalized item name during creation.
2. **RED:** A later explicit `bottle` choice supersedes an older `carton` choice.
   **GREEN:** Order by `unit_confirmed_at` with deterministic tie-breakers.
3. **RED:** Status and name-only changes do not refresh the unit confirmation timestamp.
   **GREEN:** Update that timestamp only for explicit unit creation, acceptance, or replacement.
4. **RED:** Explicit shorthand `2 bottles milk` overrides historical cartons.
   **GREEN:** Give parsed explicit units precedence.
5. **RED:** PATCH with the same `confirmedUnit` accepts a historical suggestion, changes its source to `explicit`, removes its attention reason, and increments the version.
   **GREEN:** Add unit confirmation patch behavior.
6. **RED:** PATCH with another confirmed unit replaces it and makes that replacement newest history.
   **GREEN:** Reuse the explicit confirmation path.
7. **RED:** PATCH with `confirmedUnit: null` clears the unit without creating history; quantity null/non-null adds/removes missing-quantity attention.
   **GREEN:** Add structured clearing and quantity updates.
8. **RED:** A stale structured patch returns the established current-item conflict and does not overwrite history.
   **GREEN:** Route structured changes through the existing compare-and-swap update.
9. **RED:** Another household's explicit unit is never suggested.
   **GREEN:** Keep every history lookup household-scoped.

### Verify

```text
cd duckworth-api
pnpm test --run test/shopping-items.test.ts
pnpm test --run
pnpm typecheck
pnpm build
```

## Task 4 — Publish the enriched OpenAPI contract

**Outcome:** Runtime validation, committed API snapshots, and generated Angular types describe the richer behavior together.

### Files

- `duckworth-api/src/app.ts`
- `duckworth-api/test/openapi.test.ts`
- `duckworth-api/openapi/duckworth-v1.json`
- `duckworth-web/openapi/duckworth-v1.json`
- `duckworth-web/src/app/api/generated/schema.d.ts`

### TDD cycles

1. **RED:** The OpenAPI test expects the new create members and enriched item fields, including nullable `unitConfirmedAt`.
   **GREEN:** Extend Fastify schemas and response requirements.
2. **RED:** The contract test expects structured patch members, nullable values, unit-source enum, and attention-reason enum.
   **GREEN:** Complete the patch and response schemas.
3. Regenerate the API snapshot, copy it to the frontend snapshot, regenerate Angular types, and confirm the generated diff matches the schema change only.

### Verify

```text
cd duckworth-api
pnpm openapi:write
pnpm test --run test/openapi.test.ts

cd ../duckworth-web
pnpm api:generate
pnpm test --watch=false
pnpm build
```

## Task 5 — Deliver immediate local preview without network traffic

**Outcome:** Every keystroke produces a synchronous preview while the API remains untouched until submission.

### Files

- `duckworth-web/package.json`
- `duckworth-web/pnpm-lock.yaml`
- `duckworth-web/src/app/app.ts`
- `duckworth-web/src/app/app.html`
- `duckworth-web/src/app/app.scss`
- `duckworth-web/src/app/app.spec.ts`
- `duckworth-web/src/app/core/shopping-items.service.ts`
- `duckworth-web/src/app/core/shopping-items.service.spec.ts`

### Setup

1. Add the shared package as a local `link:` dependency.
2. Add the same automatic shared-build pre-hooks used by the API.
3. Keep API DTOs projected from generated OpenAPI types; use the shared package only for local capture interpretation.

### TDD cycles

1. **RED:** Entering `1.5 kg potatoes` renders the structured preview during the next Angular change-detection turn and `HttpTestingController` observes no request.
   **GREEN:** Add a computed local preview using the shared parser.
2. **RED:** Bare `milk` previews as needing quantity but remains submittable.
   **GREEN:** Separate valid capture from complete capture.
3. **RED:** Invalid capture has accessible inline validation and does not call the API.
   **GREEN:** Map the narrow parser error to form feedback.
4. **RED:** The service sends `{ input }` rather than treating shorthand as a persisted name.
   **GREEN:** Update the service boundary.
5. **RED:** While create is in flight, the input/preview stay visible, the add action says `Saving…`, a repeat submit is suppressed, and unrelated row controls remain enabled.
   **GREEN:** Replace the global add lock with add-scoped pending state.
6. **RED:** A failed create preserves the draft and preview and exposes retry; success clears both.
   **GREEN:** Implement response-scoped state changes.

### Verify

```text
cd duckworth-web
pnpm test --watch=false
pnpm build
```

## Task 6 — Add inline details and explicit historical-unit acceptance

**Outcome:** Incomplete and inferred data are unmistakable, editable, accessible, and non-blocking.

### Files

- `duckworth-web/src/app/app.ts`
- `duckworth-web/src/app/app.html`
- `duckworth-web/src/app/app.scss`
- `duckworth-web/src/app/app.spec.ts`
- `duckworth-web/src/app/core/shopping-items.service.ts`
- `duckworth-web/src/app/core/shopping-items.service.spec.ts`

### TDD cycles

1. **RED:** An active `missing_quantity` item renders **Needs details** and **Add details**.
   **GREEN:** Render attention from the API item rather than recalculating it in the template.
2. **RED:** Add details expands a focused positive quantity field and optional unit field for only that row.
   **GREEN:** Add row-scoped detail draft state.
3. **RED:** Saving quantity sends its current version, replaces only that row from the response, and keeps other rows interactive.
   **GREEN:** Add structured service patch and row-scoped pending state.
4. **RED:** A historical unit uses explicit amber contrast, **From last time · Check before ordering**, and **Accept {value}** text.
   **GREEN:** Implement the approved callout without color-only meaning.
5. **RED:** Accept sends the current unit as `confirmedUnit`; editing sends the replacement; success removes the warning only after the server response.
   **GREEN:** Reuse one confirmation mutation path.
6. **RED:** An unaccepted historical unit does not disable edit, purchase, reopen, or unrelated controls.
   **GREEN:** Keep attention non-blocking.
7. **RED/GREEN:** Cover validation, duplicate, stale-version, missing-item, and network failures beside the affected row while retaining user drafts.
8. **RED:** Focus indicators, labels, live-region messages, placeholder text, and forced dark-theme rendering meet the explicit high-contrast states in the spec.
   **GREEN:** Complete the SCSS and semantic markup.

### Verify

```text
cd duckworth-web
pnpm test --watch=false
pnpm build
```

Manual check: use keyboard only to open details, enter quantity, accept/change a historical unit, and continue using another row while one update is delayed.

## Task 7 — Cache advisory history and reconcile household changes

**Outcome:** Known suggestions appear immediately after reload, remain household-scoped, and never override an explicit choice silently.

### Files

- `duckworth-web/src/app/core/unit-history-cache.ts`
- `duckworth-web/src/app/core/unit-history-cache.spec.ts`
- `duckworth-web/src/app/app.ts`
- `duckworth-web/src/app/app.spec.ts`
- `duckworth-web/src/app/core/shopping-events.service.spec.ts`

### TDD cycles

1. **RED:** A last-successful item list produces a versioned household cache containing only normalized names, explicit units, and confirmation timestamps.
   **GREEN:** Implement a narrow `localStorage` adapter with validation.
2. **RED:** Another household cannot read the cached map; malformed or unknown-version cache data is ignored.
   **GREEN:** Add household keys and defensive decoding.
3. **RED:** A later app load can apply cached history synchronously to a local preview before its list request completes.
   **GREEN:** Seed in-memory history from the cache.
4. **RED:** Successful list and SSE updates refresh the in-memory map and persisted cache.
   **GREEN:** Reconcile only explicit unit records.
5. **RED:** An authoritative create response may refresh an unconfirmed cached suggestion, but cannot overwrite a unit the user explicitly submitted.
   **GREEN:** Give submitted confirmation precedence and surface a visible refresh note otherwise.

### Verify

```text
cd duckworth-web
pnpm test --watch=false
pnpm build
```

## Task 8 — Extend live lifecycle and delayed-network verification

**Outcome:** A real browser proves the structured capture, history, incompleteness, synchronization, and responsiveness path against the live API.

### Files

- `duckworth-web/e2e/full_lifecycle_check.py`
- `duckworth-web/e2e/sse_check.py` if the enriched SSE assertion belongs in the existing focused check
- `duckworth-api/README.md`
- `duckworth-web/README.md`

### Browser scenarios

1. Add `2 cartons milk`, mark it purchased, then add `2 milk`.
2. Verify the row shows `carton`, the historical warning, and **Accept carton**.
3. Accept it and verify the warning clears after the response.
4. Add bare `rice`, verify **Needs details**, add quantity inline, and verify the attention clears.
5. Keep two household tabs open and verify structured updates synchronize through SSE.
6. Delay an add response in the browser and verify the input preview and an unrelated row action remain responsive; release/fail the response and verify draft-preservation behavior.
7. Verify the historical callout remains legible under the browser's dark color scheme.

Existing Python files remain test harnesses only; no Python application code is added.

### Documentation

- Document supported shorthand and examples.
- Document inferred-unit meaning, acceptance, and non-blocking attention.
- Document automatic local shared-package builds for each independently run app.
- Document local verification commands and keep remote publication explicitly deferred.

### Verify

```text
cd duckworth-api
pnpm typecheck
pnpm test --run
pnpm build

cd ../duckworth-web
pnpm api:generate
pnpm test --watch=false
pnpm build
python e2e/full_lifecycle_check.py
python e2e/sse_check.py
```

## Final acceptance gate

- [ ] Parser tests prove the approved deterministic grammar through the public shared package.
- [ ] Typing and previews perform no HTTP request.
- [ ] Structured capture, migration, repeated purchase history, unit memory, and confirmation pass through public HTTP tests.
- [ ] Legacy `name` creation remains functional.
- [ ] OpenAPI snapshots and generated Angular types are current.
- [ ] Missing quantity and unconfirmed historical unit are visible, accessible, and non-blocking.
- [ ] Failed mutations preserve drafts and never lock unrelated list actions.
- [ ] Cached history is household-scoped, advisory, versioned, and safely reconciled.
- [ ] API/frontend typechecks, tests, and builds pass independently.
- [ ] Live lifecycle, SSE, stale-conflict, and delayed-network checks pass.
- [ ] Price and ordering implementation remain deferred, with only the future attention-rule boundary documented.
- [ ] No online Git remote is configured or contacted.

## Commit checkpoints

1. Shared parser green.
2. Structured persistence and migration green.
3. Historical unit API and OpenAPI green.
4. Immediate Angular preview and scoped create state green.
5. Inline details, acceptance, and history cache green.
6. Browser verification and documentation green.

Each checkpoint must contain only its tested slice and must leave the repository's relevant suites green.
