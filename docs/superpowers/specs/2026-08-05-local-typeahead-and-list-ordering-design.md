# Local Typeahead Assistance and List Ordering Design

**Status:** Approved

**Date:** 2026-08-05

## Goal

Make Duckworth faster to use in repeated, distracted shopping moments. The capture box should offer useful full-text completions, spelling clarification, quantity/unit assistance, and multilingual grocery vocabulary without making a network request per keystroke or silently rewriting intent. Newly added items should appear at the top by default, while people who prefer another order can select and retain it.

The experience must remain light under poor or unavailable networking. Server-delivered language packs improve the local engine, but free-text capture and the last cached assistance state must continue working when a pack service is unavailable.

## Scope

This slice includes:

- A local typeahead engine for item names, recognized units, and explicitly learned full captures.
- Conservative spelling suggestions and a later-entry clarification flow.
- A personal correction dictionary that does not contaminate household or official vocabulary.
- Versioned server-delivered application-language and grocery-dictionary packs.
- Initial India packs for English (`en-IN`) and Latin-script Hinglish (`hi-Latn-IN`).
- Atomic enabling of additional language bundles.
- Acceptance of all OS-supported Unicode input, including scripts without an installed dictionary.
- Newest-added-first default list ordering and a locally persisted sort selector.
- API, schema, Angular, accessibility, caching, synchronization, and live-browser tests.

This slice excludes:

- Runtime machine translation or unreviewed automatic publication of translations.
- A universal product, brand, SKU, retailer, or restaurant catalog.
- Uploading personal vocabulary or raw typed text for global learning.
- Authentication or cross-device synchronization of personal corrections.
- Voice capture, AI inference, retailer routing, ordering, and payments.
- Manual price entry, price discovery, currency conversion, and price anomaly detection.

## Product Decisions

### Assistance remains advisory

Duckworth never silently changes an item name, quantity, or ambiguous unit. Suggestions are visible and require acceptance. Only whitespace/display normalization may occur automatically.

The assistance list contains at most five ranked full-text suggestions. It can complete:

- An item name: `bisc` to `biscuits`.
- A unit token: `biscuits 2 pc` to `biscuits 2 pcs`.
- A previously confirmed capture: `att` to `atta 5 kg`.
- A probable spelling correction: `biscut` to **Did you mean biscuits?**

Duckworth does not invent quantities. A quantity can appear in a suggestion only when the user already typed it or when a clearly labelled household-history suggestion contains a previously confirmed quantity and the user explicitly accepts the whole capture.

### Ranking

Suggestions are ranked in this order, with deterministic scoring and stable tie-breakers:

1. The current user's accepted vocabulary and correction redirects.
2. Confirmed household item and capture history.
3. Exact and prefix matches in the active locale dictionary.
4. Exact and prefix matches in enabled fallback dictionaries.
5. Conservative fuzzy candidates from those same sources.

Within a source, exact token matches outrank prefixes, prefixes outrank edit-distance matches, and more recently confirmed household choices outrank older choices. Canonical identifier and display label provide deterministic final tie-breakers.

### Keyboard and accessibility behavior

The capture input becomes an accessible combobox controlling a listbox:

- Up/Down moves through visible suggestions.
- Tab or Right Arrow accepts the highlighted completion.
- Enter accepts a highlighted suggestion; when no suggestion is highlighted, Enter submits the capture as it does today.
- Escape closes the listbox without changing the draft.
- Pointer selection is supported without removing keyboard behavior.

The accepted text is copied into the input and parsed by the existing shared capture parser. Screen readers receive the number of results, the highlighted suggestion, its source, and whether it represents a correction. Highlighting and text labels communicate meaning without color alone.

### Misspelling detection and personal clarification

Raw typed entries do not enter a permanent suggestion dictionary automatically. Duckworth records a bounded local observation only for comparison with later entries.

When a later spelling is sufficiently similar and contextual evidence suggests both spellings may represent the same item, Duckworth asks a non-blocking clarification such as:

> Are “biscut” and “biscuit” the same item?

The user can:

- Prefer the dictionary or later spelling.
- Prefer the earlier spelling as a legitimate personal term.
- Keep the two entries separate.
- Dismiss the clarification for now.

After confirmation, only the preferred spelling enters the display suggestion vocabulary. A private redirect may retain the rejected variant solely so future instances can be recognized and corrected; it is never displayed as a recommended spelling or promoted into household/official packs. A keep-separate decision creates a suppression record so the same question is not repeatedly asked.

The initial implementation keys corrections to a local device profile plus locale. This satisfies “only for him” on the current unauthenticated product. A future authenticated profile adapter may synchronize these records without changing the matching interfaces.

### Language packs and setup

Official grocery vocabulary uses stable, language-neutral canonical identifiers, for example:

```json
{
  "id": "grocery.flour.wheat",
  "category": "staples",
  "compatibleUnits": ["kg", "g", "pack"]
}
```

Locale entries map those identifiers to reviewed labels, aliases, and transliterations:

```json
{
  "id": "grocery.flour.wheat",
  "locale": "hi-Latn-IN",
  "primary": "atta",
  "aliases": ["aata", "gehun atta", "wheat flour"]
}
```

Each downloadable language bundle contains:

- Application UI strings.
- Grocery item labels and aliases.
- Transliteration aliases.
- Unit labels and formatting metadata.
- Fallback-locale references.

A country manifest configures default or bridge-language packs without assuming that every country has one legally defined national language. For India, the first manifest exposes `en-IN` and `hi-Latn-IN`. The initial seed contains a deliberately small reviewed set of common generic grocery concepts; the pack format allows more Indian language packs and entries to be published independently of application releases.

Enabling a language is atomic. Duckworth downloads the UI and dictionary artifacts, validates schema/version/checksums, stores them locally, and switches the active language only after the complete bundle succeeds. Failure retains the current language and exposes Retry. Disabling a language removes it from matching/ranking; validated cached artifacts may remain for quick reactivation.

All Unicode input remains valid regardless of installed packs. Missing dictionary support reduces assistance only; it never blocks capture.

### Dictionary production and evolution

Locale packs are built through a controlled content pipeline:

1. Maintain a reviewed canonical concept list with stable IDs.
2. Generate translation/transliteration drafts for a target locale.
3. Validate IDs, schemas, scripts, aliases, unit metadata, and duplicates.
4. Require editorial or native-speaker approval.
5. Publish immutable versioned artifacts with checksums.
6. Add reviewed concepts and aliases in later versions without reusing IDs.

Machine translation may prepare drafts but cannot publish directly. Household learning remains private and separate from the official catalog. Any future catalog contribution or telemetry requires its own explicit privacy design and consent.

### List ordering

The default list order is **Latest added**. Newly created items and SSE-created items appear at the top immediately.

The selector offers:

- Latest added.
- Oldest added.
- Item name A–Z.
- Needs attention first.

Sorting is a pure local projection over authoritative items. It does not mutate item state or make an HTTP request. The selected mode is stored per household/device profile and restored on reload. `createdAt`, normalized name, attention rank, and item ID provide deterministic comparison/tie-breaking. Purchased-state styling and row-local edit state remain attached to item IDs while order changes.

## Architecture

### Pure assistance package

A new dependency-free TypeScript package under `packages/` owns:

- Language-pack and catalog types.
- Unicode-safe normalization for matching while preserving display text.
- Prefix and conservative Damerau-Levenshtein matching.
- Suggestion scoring, ranking, deduplication, and stable tie-breakers.
- Correction-candidate detection.
- Public suggestion and clarification types.

It does not depend on Angular, Fastify, SQLite, browser storage, network APIs, or UI components. The package consumes already-loaded vocabulary and history records and returns deterministic results.

The existing `@duckworth/item-capture` package remains the sole authority for parsing accepted text into item, quantity, and unit fields. Assistance proposes text; capture parsing decides its structured meaning.

### Pack source and serving

Pack source files and their JSON schemas live in a focused catalog area. A build/validation command creates immutable artifacts and a country manifest. Fastify serves manifests and pack artifacts under `/api/v1/language-packs` in local development and future deployments.

Pack endpoints are cacheable reads. They do not participate in per-keystroke assistance. OpenAPI describes manifest and pack metadata, while artifact payload validation is protected by schema/build tests.

### Browser pack repository

Angular uses a `LanguagePackRepository` boundary backed by IndexedDB for artifacts and a small local preference record for active/enabled locale IDs. It provides:

- Read currently active validated bundle synchronously from the in-memory snapshot.
- Install a complete bundle into a staging key.
- Verify manifest version and checksums.
- Atomically promote staging to active.
- Retain the previous active bundle until promotion succeeds.
- Enable/disable matching sources without deleting user captures.

The application starts with the last validated local state. Network reconciliation runs in the background and never blocks typing.

### Personal and household vocabulary

Three stores remain distinct:

1. Official locale pack vocabulary, immutable for a pack version.
2. Household-confirmed history, derived from authoritative item responses and SSE updates.
3. Personal observations, preferred spellings, redirects, and suppressions, stored locally by profile and locale.

An Angular assistance facade builds an in-memory index from these sources and calls the pure package on input changes. Index rebuilds occur only when a source changes, not on every keystroke.

### UI boundaries

The current root component is already large. This slice extracts focused units instead of adding all behavior to `App`:

- Capture assistance facade/service for index and suggestion state.
- Accessible capture combobox component.
- Spelling clarification component.
- Language settings/install component.
- Pure list sort function and compact sort selector.

The root continues to own list orchestration initially but consumes these boundaries through narrow inputs/outputs.

## Data Flow

### Startup and pack reconciliation

1. Load enabled locale metadata and the last active validated bundle locally.
2. Render the existing capture UI immediately.
3. Build the assistance index from local bundle, personal records, and cached household history.
4. Fetch the country manifest in the background.
5. If a newer enabled pack exists, download to staging, validate, then atomically promote.
6. Rebuild the in-memory index and announce that assistance vocabulary was refreshed; do not replace a draft the user has already accepted.

### Typing and acceptance

1. Input changes are passed to the local assistance facade.
2. The pure engine returns at most five suggestions without HTTP traffic.
3. Angular renders the accessible listbox and the existing structured preview.
4. Acceptance replaces the draft with suggestion text.
5. The shared capture parser recomputes the preview.
6. Submission uses the existing API, optimistic state, and error handling.

### Learning and clarification

1. Successful authoritative item responses create/update bounded observation evidence.
2. Later similar spellings are compared locally against personal, household, and locale vocabulary.
3. Strong but non-unique evidence creates a clarification prompt rather than a correction.
4. The user's answer updates preferred, redirect, or suppression records.
5. The index rebuilds and future suggestions display only the preferred spelling.

### Sorting

1. Authoritative list/SSE updates change the item signal.
2. A computed projection applies the selected comparator.
3. Latest-first is used when no valid preference exists.
4. Changing the selector reorders immediately and persists only the preference.

## Error Handling and Safety

- Missing/invalid pack: ignore it, retain the last valid bundle, and keep free-text capture available.
- Pack download failure: show row/settings-level Retry; never block the shopping list.
- Unsupported locale: keep the current active language and explain that the requested pack is unavailable.
- IndexedDB unavailable/quota exceeded: use an in-memory bundle for the session and show non-blocking persistence feedback.
- Corrupt personal records: discard only invalid records; never discard shopping items.
- Ambiguous fuzzy match: show multiple choices or no correction; never auto-rewrite.
- Invalid/unsafe pack strings: schemas accept plain text only; UI never interprets pack values as HTML or code.
- Stale household data: existing API/SSE reconciliation remains authoritative.
- Sort preference corruption: fall back to Latest added.
- In-flight row edits: track by item ID so sorting cannot attach a draft/error to another row.

## Price Safety Deferral

No manual price-entry subsystem will be added. Price safety must be raised again only when Duckworth has:

- Authoritative order history.
- Store or restaurant identity.
- Automatically discovered line/unit prices.
- Currency codes and currency-aware comparison boundaries.
- Enough confirmed item/store samples to identify meaningful deviations.

At that maturity point, a separate design may add store-specific, currency-aware `suspicious_total_price` attention. This deferred capability must remain visible in product documentation but must not leak placeholder price fields into current models or UI.

## Testing Strategy

Implementation follows red-green-refactor through public boundaries:

- Pure package tests for normalization, ranking, Unicode, typo distance, quantity safety, deduplication, and deterministic ordering.
- Pack schema/build tests for canonical IDs, aliases, checksums, fallbacks, and invalid content.
- Fastify HTTP/OpenAPI tests for manifests, pack lookup, missing locale, and immutable caching metadata.
- Browser repository tests for offline startup, staged validation, atomic activation, fallback, and corrupt storage.
- Angular component tests for combobox semantics, keyboard use, source labels, no per-keystroke HTTP, clarification decisions, and draft preservation.
- Sort tests for every mode, stable ties, reload preference, SSE insertion, and edits attached by ID.
- Playwright checks for English/Hinglish suggestions, spelling clarification, offline cached assistance, atomic language failure, keyboard-only capture, and newest-first behavior across two tabs.

## Acceptance Criteria

- Typing remains synchronous and creates no request per keystroke.
- `bisc` can offer `biscuits`; `biscuits 2 pc` can offer a valid unit completion.
- Suggestions never invent a quantity or silently replace ambiguous text.
- English-India and Latin Hinglish packs are versioned, validated, server-delivered, cached, and usable offline.
- Enabling a language activates UI and dictionary content atomically; failure keeps the previous language.
- All Unicode input remains capturable without a dictionary.
- A probable repeated misspelling triggers user clarification; only the chosen spelling is displayed afterward for that profile.
- Personal corrections never alter official or household-wide vocabulary.
- New items appear at the top by default, including SSE-created items.
- The four sort modes are deterministic, immediate, and persisted per household/profile.
- Existing parsing, unit history, optimistic concurrency, SSE, OpenAPI, accessibility, and independent frontend/backend commands remain green.
- No price fields, manual price workflow, retailer integration, cloud publication, or online Git remote are introduced.
