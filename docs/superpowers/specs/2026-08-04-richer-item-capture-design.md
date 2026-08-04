# Richer Typed Item Capture Design

## Goal

Make typed item capture faster and safer without turning it into a form. Duckworth interprets conservative quantity-and-unit shorthand immediately, saves bare items instead of blocking them, makes incomplete intent visible, and uses the household's most recently confirmed unit as an editable suggestion.

The interaction must remain light and responsive under slow or unavailable networking. Typing and interpretation never wait for an API response.

## Scope

This slice includes:

- Deterministic parsing for a leading quantity, an optional recognized unit, and an item name.
- Immediate local interpretation in Angular.
- Structured quantity and unit persistence in SQLite.
- Non-blocking attention reasons for missing quantity and an unconfirmed historical unit.
- Household-scoped unit history based only on explicit user choices.
- Inline completion and unit-acceptance controls.
- API, OpenAPI, generated Angular type, component, and live-browser coverage.

This slice excludes price data, price anomaly detection, retailer integration, ordering, voice input, AI enrichment, authentication, and multi-household membership. The attention model is deliberately extensible so later ordering work can add a `suspicious_total_price` reason when authoritative price and order data exist.

## Product decisions

### Capture and completeness

- Bare input such as `milk` is saved immediately.
- An active item without an explicit quantity has the `missing_quantity` attention reason and is presented as **Needs details**.
- A positive explicit quantity is enough to make the item complete; a unit is optional because many grocery items are naturally counted.
- Attention never blocks ordinary item actions in this slice.

### Parser boundary

The first parser is deliberately conservative. It recognizes:

1. A leading positive integer or decimal quantity.
2. An optional recognized unit or alias.
3. A required item name.

Examples:

| Input | Quantity | Unit | Name |
| --- | ---: | --- | --- |
| `milk` | — | — | `milk` |
| `2 milk` | 2 | — | `milk` |
| `1.5 kg potatoes` | 1.5 | `kg` | `potatoes` |
| `2 dozen eggs` | 2 | `dozen` | `eggs` |

Natural phrases such as `half a kilo onions`, `milk for the week`, and `enough apples for four` remain ordinary item names in this slice. Zero, negative, non-finite, or quantity-only input is invalid.

The canonical vocabulary is `g`, `kg`, `ml`, `l`, `piece`, `pack`, `packet`, `bottle`, `carton`, `can`, `box`, `bag`, and `dozen`. Singular/plural spelling variants and common abbreviations normalize to those values: for example, `grams` to `g`, `kilograms` and `kgs` to `kg`, `litres` and `liters` to `l`, and `pcs` to `piece`.

The parser preserves the user's item-name casing after trimming and collapsing whitespace. Manual unit entry remains a trimmed free-text field of 32 characters or fewer so uncommon but legitimate units are not blocked. Custom units are not inferred from shorthand in this slice; for example, `2 trays eggs` becomes quantity `2` and name `trays eggs` until the user edits the structured fields.

### Historical unit behavior

- Explicit shorthand always wins over history.
- When shorthand has no unit and confirmed history exists, Duckworth prefills the most recently confirmed unit for the same normalized item name in the same household.
- A historical unit is stored on the new item with source `history` and remains visibly unconfirmed.
- An inferred value never reinforces itself. It becomes confirmed history only when the user clicks a value-specific action such as **Accept cartons** or edits the unit.
- Accepting or editing writes the unit with source `explicit`. Removing a unit writes `null` and does not create a historical choice.
- Conflicting historical values are resolved by the most recently explicitly confirmed value, making the rule predictable as **From last time**.

## Architecture

### Shared local parser

A small dependency-free TypeScript package under the repository packages area owns parsing, normalization, unit aliases, and the public `CaptureInterpretation` type. Both `duckworth-web` and `duckworth-api` consume this module.

Angular executes it synchronously on input changes. Fastify executes the same code before persistence. The browser therefore provides immediate feedback without per-keystroke requests, while the API remains authoritative without maintaining a second grammar.

The shared package must not depend on Angular, Fastify, SQLite, browser APIs, or application services. Each frontend and backend remains separately runnable from its existing directory within the repository.

### Local history cache and reconciliation

Angular builds a household unit-history map from the last successful list response and SSE updates. A small versioned `localStorage` cache keyed by household seeds that map on later loads so poor networking does not delay a known suggestion. The cache contains only normalized item names, confirmed units, and confirmation timestamps; it is replaced after each successful reconciliation.

Cached history is advisory:

- If the user explicitly accepts or edits the cached unit, the submitted confirmation is authoritative.
- If the user does not confirm it, the API applies current server-side history and its response replaces stale local state.
- Reconciliation is visible when it changes the suggested value; Duckworth does not silently replace a confirmed choice.

### Attention rules

Attention is exposed as derived reasons instead of persisted booleans. For active items:

- `missing_quantity` applies when quantity is `null`.
- `unconfirmed_historical_unit` applies when `unitSource` is `history`.

Purchased items do not demand current attention. Reopening an item derives its applicable reasons again. This boundary can later accept price- or order-related reasons without changing capture semantics.

## Data model and migration

`shopping_items` adds:

- `capture_text TEXT NOT NULL`: the original typed input, retained for correction and traceability.
- `quantity REAL NULL`: a positive finite number when supplied.
- `unit TEXT NULL`: canonical parsed unit, historical suggestion, or explicit free-text unit.
- `unit_source TEXT NULL`: `explicit`, `history`, or `NULL`.
- `unit_confirmed_at TEXT NULL`: the time an explicit unit was entered, changed, or accepted.

API responses derive `attentionReasons`; they are not stored.

Existing rows migrate with `capture_text = name`, `quantity = NULL`, `unit = NULL`, `unit_source = NULL`, and `unit_confirmed_at = NULL`. Existing active items therefore surface as missing quantity, while purchased items remain free of active attention.

The current table-level uniqueness on `(household_id, normalized_name, status)` prevents retaining repeated purchase history. The migration replaces it with a partial unique index on `(household_id, normalized_name)` where `status = 'active'`. This continues to prevent simultaneous active duplicates while allowing multiple historical purchases of the same normalized item.

Historical lookup selects the newest row for the household and normalized name whose unit source is `explicit`, unit is non-null, and confirmation timestamp is non-null. Ordering uses `unit_confirmed_at`, with creation time and identifier as deterministic tie-breakers. Status and name-only updates do not make an old unit appear newly confirmed.

## API contract

All routes remain under `/api/v1`.

### Create item

`POST /api/v1/households/:householdId/items` accepts exactly one capture field:

- `input: string` for the richer client, or
- legacy `name: string` for compatibility during migration.

Sending neither or both returns `400`. The API parses the capture, applies current household history when no explicit unit exists, persists the item, publishes the normal SSE creation event, and returns the enriched item.

The optional `confirmedUnit` field records a unit that the user explicitly accepted or entered before creation. It overrides parsed and historical units and is stored with source `explicit`.

### Update item

`PATCH /api/v1/households/:householdId/items/:itemId` retains `expectedVersion` and existing name/status behavior. It additionally accepts:

- `quantity: number | null`
- `confirmedUnit: string | null`

A non-null `confirmedUnit` is trimmed and stored with source `explicit`; `null` removes the current unit and source. Sending the same value as an inferred unit is how the one-click acceptance action confirms it. Quantity must be positive and finite when non-null.

Updates retain optimistic concurrency, duplicate-name protection, row-local conflicts, and SSE publication. Rename updates do not reinterpret or discard existing structured details.

### Item response

The existing item response adds:

- `captureText: string`
- `quantity: number | null`
- `unit: string | null`
- `unitSource: "explicit" | "history" | null`
- `unitConfirmedAt: string | null`
- `attentionReasons: ("missing_quantity" | "unconfirmed_historical_unit")[]`

OpenAPI snapshots in the API and frontend, generated Angular types, and contract tests change together.

## Frontend experience

### Immediate assistance

The add input remains a single text field. Beneath it, a compact preview renders the local interpretation, for example **1.5 kg · Potatoes**. Input changes do not create HTTP traffic.

Empty or structurally invalid input cannot be submitted. Bare named input remains valid and saves immediately.

### Incomplete items

An active item with no quantity shows **Needs details** and an inline **Add details** action. Activating it expands a focused quantity field and optional unit field in that row. Saving uses the existing optimistic version and keeps failures beside the row.

### Historical units

A historical unit is prefilled but visually distinct:

- The field uses a high-contrast amber treatment.
- A text callout says **From last time · Check before ordering**.
- A value-specific action says **Accept cartons** rather than using an ambiguous icon.
- Accepting removes the warning after the server confirms the update.
- Editing the field confirms the replacement.
- Leaving the suggestion unconfirmed does not block edit, purchase, reopen, or other list actions.

The treatment uses text and structure in addition to color, remains keyboard-operable, is announced accessibly, and explicitly defines foreground, background, placeholder, focus, and dark-theme contrast.

### Responsive network behavior

The current global busy flag is replaced with operation-scoped pending state. Only the affected form or row is disabled. The rest of the list remains interactive.

During creation, the input and preview remain visible and the add action changes to **Saving…**. Success clears the draft. Failure preserves it and offers a direct retry. Repeated submissions for the same in-flight action are suppressed.

Parser failures are local and immediate. API validation, duplicate, conflict, and availability errors retain the established inline and row-local error patterns. A stale unit suggestion returned by the server is reconciled visibly.

## Error handling

- Empty or quantity-only capture: local validation and API `400`.
- Non-positive or invalid quantity: local validation and API `400`.
- Duplicate active normalized name: existing API `409` and clear duplicate feedback.
- Stale update: existing version-conflict `409`, latest item replacement, and row-local retry guidance.
- Slow or unavailable API: input and preview continue working; draft and item edits are preserved.
- Stale cached history: authoritative create/update response wins unless the user explicitly confirmed a value.
- Invalid custom unit: local validation and API `400`; no history is written.

## TDD and verification

Implementation proceeds as vertical red-green tracer bullets, one behavior at a time:

1. The shared public parser interprets `1.5 kg potatoes`.
2. Parser behavior expands incrementally to bare names, quantities without units, aliases, invalid quantities, and custom names.
3. The public HTTP API persists structured capture and returns derived attention reasons.
4. API integration tests cover most-recent confirmed history, explicit override, one-click acceptance, legacy `name`, SQLite migration, repeated purchase history, duplicates, and optimistic conflicts.
5. Angular component tests prove typing renders a preview without HTTP traffic.
6. Component tests cover incomplete rows, highlighted history, acceptance and replacement, scoped pending state, preserved failed drafts, and reconciliation.
7. OpenAPI snapshot and generated-type checks protect the contract.
8. Playwright establishes confirmed history, captures shorthand without a unit, verifies the highlighted suggestion, accepts it, captures a bare item, and resolves quantity inline.
9. A delayed-network browser check confirms typing, preview, and unrelated row actions remain responsive during a save.

Tests exercise public parser, HTTP, component, and browser interfaces rather than internal helpers. Every cycle writes one failing behavior test, implements only enough to pass it, then refactors while green.

## Acceptance criteria

- Typing shorthand produces an immediate preview without an HTTP request.
- `1.5 kg potatoes` persists as name `potatoes`, quantity `1.5`, and explicit unit `kg`.
- `milk` saves successfully and appears as needing quantity details.
- `2 milk` uses the household's latest explicitly confirmed milk unit when one exists.
- A historical unit is clearly highlighted, editable, and accepted with one value-specific action.
- Unaccepted historical units never become confirmed history and never block ordinary item actions.
- Failed saves preserve the user's draft, do not freeze the list, and can be retried.
- Existing `name` create callers remain functional during migration.
- Multiple purchases of the same item can be retained while simultaneous active duplicates remain prevented.
- API, typecheck, unit/component tests, builds, OpenAPI generation, and the live lifecycle check pass locally.
