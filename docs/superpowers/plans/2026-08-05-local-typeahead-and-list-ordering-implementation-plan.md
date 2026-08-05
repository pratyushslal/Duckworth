# Local Typeahead Assistance and List Ordering — Implementation Plan

**Status:** Approved for implementation

**Date:** 2026-08-05

**Design source:** `docs/superpowers/specs/2026-08-05-local-typeahead-and-list-ordering-design.md`

## Objective

Deliver a local-first assistance slice that offers fast, conservative full-text suggestions for item names, quantities already supplied by the user, and units; learns private spelling preferences through explicit clarification; installs reviewed locale vocabulary as atomic downloadable bundles; and displays newly added shopping items first by default with optional persisted sort modes.

Typing, ranking, sorting, and cached-pack startup must not depend on network availability. The existing `@duckworth/item-capture` parser remains the only authority for turning accepted text into structured item data.

## Delivery rules

- Follow the tasks in order and keep every checkpoint locally runnable.
- Within each task, use one red-green-refactor cycle at a time: add one public behavior test, observe the expected failure, implement the smallest passing change, then rerun the focused test.
- Do not batch all tests before implementation and do not refactor while a focused test is red.
- Keep the pure assistance package free of Angular, Fastify, SQLite, browser storage, and network dependencies.
- Do not make HTTP requests from input-change handlers. Network work is limited to background pack reconciliation and ordinary shopping-item mutations.
- Preserve display text. Matching normalization must never silently rewrite the capture.
- Never invent a quantity, auto-accept a correction, or promote raw personal text into an official/shared dictionary.
- Preserve household isolation, optimistic concurrency, SSE behavior, row-scoped drafts/errors, and independent API/frontend commands.
- Keep manual price entry, automatic price discovery, currency conversion, price anomalies, runtime machine translation, authentication, and online publication out of this slice.
- Do not configure or contact an online Git remote.

## Public boundaries selected for TDD

### Assistance package

```ts
export interface SuggestionRequest {
  input: string;
  activeLocale: string;
  enabledLocales: readonly string[];
  limit?: number;
}

export interface CaptureSuggestion {
  text: string;
  source: 'personal' | 'household' | 'active-locale' | 'fallback-locale';
  kind: 'completion' | 'history' | 'correction';
  canonicalId?: string;
}

export interface ClarificationCandidate {
  earlier: string;
  later: string;
  locale: string;
  confidence: number;
}

export function createAssistanceIndex(sources: AssistanceSources): AssistanceIndex;
export function suggest(index: AssistanceIndex, request: SuggestionRequest): CaptureSuggestion[];
export function detectClarification(
  index: AssistanceIndex,
  observation: SpellingObservation,
): ClarificationCandidate | null;
```

The exact internal score is private. Deterministic source precedence, match-class precedence, maximum result count, stable ties, Unicode handling, and quantity safety are public behavior.

### Language-pack HTTP reads

```text
GET /api/v1/language-packs/countries/{countryCode}/manifest
GET /api/v1/language-packs/{locale}/{version}
```

The manifest identifies the complete application-language bundle, checksums, fallbacks, and immutable artifact URL/version. Pack strings are plain text. No endpoint receives keystrokes, personal observations, or household vocabulary.

### Sorting

```ts
export type ShoppingItemSort = 'latest' | 'oldest' | 'name-asc' | 'attention';
export function sortShoppingItems(
  items: readonly ShoppingItem[],
  mode: ShoppingItemSort,
): ShoppingItem[];
```

Sorting returns a new array and never mutates authoritative item objects.

## Task 1 — Ship newest-first as the first tracer bullet

**Outcome:** Newly created and SSE-created items appear at the top immediately, while the user can select and retain another deterministic order.

### Files

- `duckworth-web/src/app/core/shopping-item-sort.ts`
- `duckworth-web/src/app/core/shopping-item-sort.spec.ts`
- `duckworth-web/src/app/core/list-preferences.ts`
- `duckworth-web/src/app/core/list-preferences.spec.ts`
- `duckworth-web/src/app/app.ts`
- `duckworth-web/src/app/app.html`
- `duckworth-web/src/app/app.scss`
- `duckworth-web/src/app/app.spec.ts`

### TDD cycles

1. **RED:** Public `sortShoppingItems` defaults to descending `createdAt`, with item ID as a stable final tie-breaker, and leaves its input unchanged.  
   **GREEN:** Implement the pure latest comparator and immutable projection.
2. **RED/GREEN:** Add `oldest`, normalized item-name A–Z, and attention-first modes one at a time. Attention ties fall back to latest-first.
3. **RED:** An absent, malformed, or unknown stored preference resolves to `latest`.  
   **GREEN:** Add a narrow versioned local preference adapter scoped by household/device profile.
4. **RED:** The UI exposes a labelled four-option sort control, selects Latest added initially, changes order without an HTTP request, and restores a valid saved choice.  
   **GREEN:** Feed a computed sorted projection to the template and persist only the mode.
5. **RED:** A successful create and an item received through SSE both appear first under Latest added.  
   **GREEN:** Keep all authoritative merge logic unchanged and sort only at the render projection.
6. **RED:** A row draft, row error, or pending action stays attached to its item ID when order changes.  
   **GREEN:** Remove any index-based row state or tracking exposed by the new order.

### Verify

```text
cd duckworth-web
pnpm test --watch=false
pnpm build
```

## Task 2 — Build the pure local assistance engine

**Outcome:** One dependency-free package returns deterministic suggestions from already-loaded sources without network or framework coupling.

### Files

- `packages/local-assistance/package.json`
- `packages/local-assistance/tsconfig.json`
- `packages/local-assistance/src/index.ts`
- `packages/local-assistance/src/index.spec.ts`
- `duckworth-web/package.json`
- `duckworth-web/pnpm-lock.yaml`

### Setup

1. Add a private ESM package exporting compiled JavaScript and declarations from `dist/`.
2. Add it to the frontend as a local `link:` dependency with the same automatic pre-build pattern used by `@duckworth/item-capture`.
3. Keep its public inputs serializable so browser repositories and future profile adapters can supply data without leaking storage details into the engine.

### TDD cycles

1. **RED:** Unicode normalization matches canonically equivalent text while preserving the reviewed display label exactly.  
   **GREEN:** Add NFKC matching keys, whitespace normalization, and locale-aware case folding without changing output strings.
2. **RED:** `bisc` returns `biscuits` from the active locale and caps results at five.  
   **GREEN:** Add token/prefix matching and the result limit.
3. **RED:** Personal accepted vocabulary outranks household history, which outranks the active pack, which outranks fallback packs.  
   **GREEN:** Implement explicit source bands.
4. **RED:** Within a source, exact matches outrank prefixes, prefixes outrank conservative Damerau-Levenshtein candidates, and ties are stable across calls.  
   **GREEN:** Add bounded fuzzy matching and deterministic tie-breakers.
5. **RED:** Duplicate labels/aliases across sources return one best suggestion.  
   **GREEN:** Deduplicate by normalized suggestion text and preserve the strongest provenance.
6. **RED:** `biscuits 2 pc` can complete to `biscuits 2 pcs`, but `bisc` never gains a quantity and an existing quantity is never changed.  
   **GREEN:** Complete only recognized trailing unit tokens and explicitly confirmed whole captures; add a quantity-safety guard.
7. **RED:** Unsupported-script and mixed-script inputs do not throw and remain eligible for exact personal/household matches.  
   **GREEN:** Make matching Unicode-safe without transliterating user input implicitly.
8. **RED:** Similar observations produce a clarification candidate only above conservative thresholds; ambiguous, short, numeric, and suppressed pairs do not.  
   **GREEN:** Add candidate detection as advisory output only.

### Verify

```text
cd duckworth-web
pnpm test --watch=false
pnpm typecheck
pnpm build
```

## Task 3 — Define and validate canonical locale packs

**Outcome:** Reviewed English-India and Latin Hinglish seeds are generated from stable language-neutral concepts into immutable, validated artifacts.

### Files

- `catalog/schema/canonical-catalog.schema.json`
- `catalog/schema/locale-pack.schema.json`
- `catalog/schema/country-manifest.schema.json`
- `catalog/source/canonical-items.json`
- `catalog/source/en-IN.json`
- `catalog/source/hi-Latn-IN.json`
- `catalog/scripts/build-packs.mjs`
- `catalog/test/build-packs.test.mjs`
- generated artifacts under `duckworth-api/language-packs/`
- root or API package scripts used to build/verify artifacts

### TDD cycles

1. **RED:** A representative canonical concept with stable ID, category, and compatible units validates and produces deterministic output.  
   **GREEN:** Add minimal schemas and a deterministic generator.
2. **RED:** Duplicate/reused IDs, missing locale labels, unknown canonical references, duplicate aliases, invalid fallback cycles, and HTML-like content fail the build with actionable paths.  
   **GREEN:** Add validations one at a time.
3. **RED:** `en-IN` and `hi-Latn-IN` contain the same required seed concepts while allowing locale-specific aliases and transliterations.  
   **GREEN:** Add a deliberately small reviewed grocery seed, including the biscuit and unit examples.
4. **RED:** Every artifact has a content checksum, schema version, locale, immutable content version, and fallback metadata; two unchanged builds are byte-identical.  
   **GREEN:** Emit canonicalized JSON and a country manifest for `IN`.
5. **RED:** Unit aliases point only to units already understood by `@duckworth/item-capture`.  
   **GREEN:** Validate the pack-to-parser compatibility boundary rather than creating a second unit grammar.

Machine-generated translations may be staged outside published source, but only reviewed source files are build inputs. Do not add runtime translation.

### Verify

```text
cd duckworth-api
pnpm language-packs:build
pnpm language-packs:test
```

## Task 4 — Serve cacheable pack manifests and artifacts

**Outcome:** The local API exposes immutable pack reads without receiving personal text or participating in typeahead keystrokes.

### Files

- `duckworth-api/src/language-packs.ts`
- `duckworth-api/src/app.ts`
- `duckworth-api/src/openapi.ts`
- `duckworth-api/test/language-packs.test.ts`
- `duckworth-api/test/openapi.test.ts`
- `duckworth-api/openapi/duckworth-v1.json`
- `duckworth-web/openapi/duckworth-v1.json`
- `duckworth-web/src/app/api/generated/schema.d.ts`

### TDD cycles

1. **RED:** The India manifest endpoint returns enabled/default/bridge locales, artifact versions, checksums, fallbacks, and cache metadata.  
   **GREEN:** Add a read-only manifest route over generated artifacts.
2. **RED:** A known locale/version returns the exact immutable pack with long-lived cache headers and ETag; a missing/invalid locale or version returns the established problem shape without path traversal.  
   **GREEN:** Add allowlisted artifact lookup and conditional responses.
3. **RED:** Pack data containing application UI strings, grocery labels/aliases, transliterations, units, and fallback references conforms to runtime response validation.  
   **GREEN:** Register focused response schemas.
4. **RED:** OpenAPI describes manifest metadata and artifact retrieval, and generated Angular types update without unrelated drift.  
   **GREEN:** Regenerate and synchronize both snapshots and frontend declarations.
5. **RED:** Route tests prove no mutation endpoint exists for raw observations, personal corrections, or crowdsourced publication.  
   **GREEN:** Keep the service read-only.

### Verify

```text
cd duckworth-api
pnpm test --run test/language-packs.test.ts
pnpm test --run test/openapi.test.ts
pnpm typecheck
pnpm build

cd ../duckworth-web
pnpm api:generate
pnpm test --watch=false
pnpm build
```

## Task 5 — Cache, validate, and atomically activate bundles

**Outcome:** Duckworth starts from its last valid local bundle, stages updates safely, and continues free-text capture when storage or networking fails.

### Files

- `duckworth-web/src/app/core/language-pack-repository.ts`
- `duckworth-web/src/app/core/language-pack-repository.spec.ts`
- `duckworth-web/src/app/core/language-pack-api.service.ts`
- `duckworth-web/src/app/core/language-pack-api.service.spec.ts`
- `duckworth-web/src/app/core/language-preferences.ts`
- `duckworth-web/src/app/core/language-preferences.spec.ts`

### TDD cycles

1. **RED:** A validated cached active bundle is available to the application before any reconciliation request completes.  
   **GREEN:** Add a repository boundary with an in-memory snapshot and IndexedDB adapter.
2. **RED:** Installing a bundle writes to staging, validates schema/version/checksum/completeness, then promotes all UI and dictionary artifacts together.  
   **GREEN:** Add atomic pointer promotion; never partially change the active language.
3. **RED:** Invalid checksum, corrupt data, missing artifact, quota error, or interrupted install leaves the previous bundle active and exposes a retryable result.  
   **GREEN:** Contain staging failures and retain the last-good pointer.
4. **RED:** IndexedDB unavailable falls back to an in-memory session bundle and never blocks capture.  
   **GREEN:** Add the non-persistent adapter/fallback.
5. **RED:** Startup manifest reconciliation runs once in the background, uses conditional HTTP, and never delays capture rendering.  
   **GREEN:** Add the API adapter and background orchestration.
6. **RED:** Disabling a locale excludes it from matching but leaves validated cache data reusable; corrupt preferences fall back to `en-IN`.  
   **GREEN:** Separate enabled/active preferences from artifact storage.

### Verify

```text
cd duckworth-web
pnpm test --watch=false
pnpm build
```

## Task 6 — Assemble official, household, and personal indexes

**Outcome:** An Angular facade serves synchronous suggestions from separate local sources and rebuilds only when source data changes.

### Files

- `duckworth-web/src/app/core/capture-assistance.service.ts`
- `duckworth-web/src/app/core/capture-assistance.service.spec.ts`
- `duckworth-web/src/app/core/personal-vocabulary-store.ts`
- `duckworth-web/src/app/core/personal-vocabulary-store.spec.ts`
- `duckworth-web/src/app/core/household-vocabulary.ts`
- `duckworth-web/src/app/core/household-vocabulary.spec.ts`

### TDD cycles

1. **RED:** Active/fallback pack entries, authoritative household items, confirmed captures, and personal choices remain distinguishable when assembled.  
   **GREEN:** Add source-specific projections into `createAssistanceIndex`.
2. **RED:** An input change returns suggestions synchronously and `HttpTestingController` observes no request.  
   **GREEN:** Keep the facade entirely in-memory after source loading.
3. **RED:** List/create/SSE success refreshes household vocabulary, while a keystroke does not rebuild the index.  
   **GREEN:** Rebuild only on source-version changes.
4. **RED:** A local profile/locale can store a preferred display spelling, hidden redirect key, and keep-separate suppression; another profile or locale cannot read it.  
   **GREEN:** Add a versioned, defensively decoded personal store.
5. **RED:** Raw observations are bounded by count/age, are not returned as display suggestions, and are never sent over HTTP.  
   **GREEN:** Add an observation ledger with eviction and no network dependency.
6. **RED:** Invalid personal records are skipped individually without dropping valid vocabulary or shopping items.  
   **GREEN:** Decode records independently and expose non-blocking diagnostics.

### Verify

```text
cd duckworth-web
pnpm test --watch=false
pnpm build
```

## Task 7 — Deliver the accessible capture combobox

**Outcome:** Item/unit/history/correction suggestions are quick to accept by keyboard or pointer and always flow through the existing parser before submission.

### Files

- `duckworth-web/src/app/capture-assistance/capture-combobox.ts`
- `duckworth-web/src/app/capture-assistance/capture-combobox.html`
- `duckworth-web/src/app/capture-assistance/capture-combobox.scss`
- `duckworth-web/src/app/capture-assistance/capture-combobox.spec.ts`
- `duckworth-web/src/app/app.ts`
- `duckworth-web/src/app/app.html`
- `duckworth-web/src/app/app.spec.ts`

### TDD cycles

1. **RED:** Typing `bisc` renders no more than five options with combobox/listbox roles, accessible names, source/kind text, and active-descendant state.  
   **GREEN:** Extract the focused component and bind the local facade.
2. **RED/GREEN:** Implement Down/Up highlight, Tab/Right Arrow acceptance, Enter acceptance-or-existing-submit, Escape dismissal, and pointer selection one behavior at a time.
3. **RED:** Accepting a suggestion copies its full display text into the input and recomputes the structured preview through `@duckworth/item-capture`; it does not submit automatically.  
   **GREEN:** Emit accepted text to the existing capture state.
4. **RED:** A correction is labelled “Did you mean”, a historical capture is labelled as history, and meaning remains clear without color.  
   **GREEN:** Add semantic source/kind labels and contrast-safe styling.
5. **RED:** Changing suggestions never overwrites the draft, moves focus unexpectedly, or creates an HTTP request.  
   **GREEN:** Keep suggestion state advisory and input-owned.
6. **RED:** Screen readers receive result count/highlight changes without announcing every keystroke twice.  
   **GREEN:** Add one restrained live-region message.
7. **RED:** `biscuits 2 pcs` and all Unicode text remain submittable when no dictionary candidate exists.  
   **GREEN:** Preserve free-text capture as the primary path.

### Verify

```text
cd duckworth-web
pnpm test --watch=false
pnpm build
```

## Task 8 — Add explicit spelling clarification and private learning

**Outcome:** Duckworth notices likely spelling variants, asks once, and thereafter displays only the user's chosen spelling without polluting shared vocabulary.

### Files

- `duckworth-web/src/app/spelling-clarification/spelling-clarification.ts`
- `duckworth-web/src/app/spelling-clarification/spelling-clarification.html`
- `duckworth-web/src/app/spelling-clarification/spelling-clarification.scss`
- `duckworth-web/src/app/spelling-clarification/spelling-clarification.spec.ts`
- `duckworth-web/src/app/core/capture-assistance.service.ts`
- `duckworth-web/src/app/core/capture-assistance.service.spec.ts`
- `duckworth-web/src/app/app.ts`
- `duckworth-web/src/app/app.spec.ts`

### TDD cycles

1. **RED:** After authoritative entries resembling `biscut` then `biscuit`, a non-blocking prompt asks whether they are the same; a single raw spelling never becomes a permanent suggestion.  
   **GREEN:** Observe successful captures and surface conservative candidates.
2. **RED:** Choosing the later/dictionary spelling creates a preferred display record plus a hidden redirect; future `biscut` input offers only `biscuit`.  
   **GREEN:** Apply the personal decision and rebuild the index.
3. **RED:** Choosing the earlier spelling makes it the profile's displayed preference but changes neither official nor household-wide pack data.  
   **GREEN:** Store preference only in the profile/locale store.
4. **RED:** Keep separate suppresses that normalized pair and does not prompt again; Dismiss may prompt only after new evidence and a cooldown.  
   **GREEN:** Add pair suppression and bounded cooldown metadata.
5. **RED:** The rejected raw spelling never appears in suggestion output, settings vocabulary, or language-pack serialization.  
   **GREEN:** Expose redirect keys only to matching internals.
6. **RED:** The prompt is operable by keyboard, does not block item actions, and explains each outcome without relying on color.  
   **GREEN:** Complete accessible markup and row-independent state.

### Verify

```text
cd duckworth-web
pnpm test --watch=false
pnpm build
```

## Task 9 — Add complete language enablement settings

**Outcome:** Enabling an additional application language downloads and activates its UI/dictionary bundle together, with safe retry and no loss of capture capability.

### Files

- `duckworth-web/src/app/language-settings/language-settings.ts`
- `duckworth-web/src/app/language-settings/language-settings.html`
- `duckworth-web/src/app/language-settings/language-settings.scss`
- `duckworth-web/src/app/language-settings/language-settings.spec.ts`
- `duckworth-web/src/app/app.ts`
- `duckworth-web/src/app/app.spec.ts`

### TDD cycles

1. **RED:** Settings list India-supported bundles from the cached/remote manifest with installed, active, downloading, failed, and retry states.  
   **GREEN:** Bind settings to repository state without coupling it to capture input.
2. **RED:** Enabling Hinglish stages both UI strings and dictionary, then exposes it to matching only after complete validation.  
   **GREEN:** Call the atomic repository install/enable operation.
3. **RED:** A failed UI or dictionary artifact leaves the prior application language and enabled matching sources unchanged and offers Retry.  
   **GREEN:** Render the repository's contained failure state.
4. **RED:** Enabling an additional installed locale retains existing enabled locales as fallbacks; disabling removes it from ranking without deleting user captures.  
   **GREEN:** Update only locale preferences.
5. **RED:** An unavailable OS-input language remains valid free text and shows neutral “dictionary assistance unavailable” guidance only in settings.  
   **GREEN:** Never gate capture on the manifest.

Only `en-IN` and `hi-Latn-IN` ship in this slice. The contract and tests must allow later reviewed Indic-script packs without frontend code changes.

### Verify

```text
cd duckworth-web
pnpm test --watch=false
pnpm build
```

## Task 10 — Prove offline, live, and two-tab behavior

**Outcome:** Real-browser checks demonstrate a snappy local experience, correct synchronization, accessible interaction, and safe degradation.

### Files

- new focused Playwright/Python browser checks under `duckworth-web/e2e/`
- `duckworth-api/README.md`
- `duckworth-web/README.md`
- `PRODUCT.md`

### Browser scenarios

1. With API responses delayed, type `bisc`, navigate/accept `biscuits`, and verify immediate suggestions and preview with no keystroke requests.
2. Type and submit `biscuits 2 pcs`; verify it parses and the created item appears at the top.
3. Change each sort mode, reload, and verify the saved order; verify row drafts stay attached by item ID.
4. Open two household tabs; create an item in one and verify SSE places it first in the other under Latest added.
5. Cache the India packs, take the pack/API network offline, reload, and verify cached English/Hinglish assistance and free-text capture still work.
6. Simulate an invalid/incomplete Hinglish bundle and verify atomic activation retains the former UI/dictionary and offers Retry.
7. Create a likely spelling variant, resolve the clarification, and verify only the preferred spelling is offered afterward for that local profile.
8. Use keyboard-only and forced dark/light color schemes to verify combobox, clarification, settings, sort control, focus, and text contrast.

### Documentation

- Document local pack build/serve/validation commands and the editorial review requirement.
- Document assistance ranking, quantity safety, privacy boundaries, locale enablement, offline behavior, sorting, and supported initial locales.
- Record price safety as deferred until authoritative order history, store/restaurant identity, automatic line prices, currency metadata, and sufficient samples exist. Do not add placeholder price models or UI.
- Keep all commands local and state that no online Git remote is required or configured.

### Verify

```text
cd duckworth-api
pnpm language-packs:build
pnpm language-packs:test
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

Run the new focused browser checks in the same live local stack after the unit/integration gate.

## Final acceptance gate

- [ ] Latest added is the default and applies immediately to local creates and SSE events.
- [ ] Latest, oldest, A–Z, and attention sort modes are deterministic, local, and persisted per household/device profile.
- [ ] Input changes make no HTTP request and return at most five stable suggestions from the in-memory index.
- [ ] Ranking respects personal, household, active-locale, fallback-locale, and conservative fuzzy precedence.
- [ ] Suggestions never invent/change quantity or silently rewrite capture text.
- [ ] Accepted text is always reinterpreted by the existing shared capture parser.
- [ ] `en-IN` and `hi-Latn-IN` packs use stable canonical IDs, pass build validation, are served immutably, and work from cache offline.
- [ ] Application strings and dictionary content activate atomically; failed installs retain the previous language.
- [ ] All Unicode input remains valid without an installed dictionary.
- [ ] Likely variants ask for explicit clarification; only the chosen spelling is displayed for that profile afterward.
- [ ] Raw observations and private redirects never become shared/official suggestions or leave the device.
- [ ] Combobox, clarification, settings, and sorting pass keyboard, screen-reader semantics, contrast, and responsive-browser checks.
- [ ] API/frontend typechecks, tests, builds, OpenAPI generation, live lifecycle, SSE, and offline checks are green.
- [ ] Price safety remains documented and completely absent from current data-entry, models, API, and UI.
- [ ] No online Git remote is configured or contacted.

## Commit checkpoints

1. Newest-first projection and persisted sort controls green.
2. Pure local-assistance package green.
3. Validated India locale artifacts and cacheable API reads green.
4. Browser repository and atomic offline bundle activation green.
5. Source-separated assistance facade and accessible combobox green.
6. Private spelling clarification and language settings green.
7. Live/offline/two-tab checks and documentation green.

Each checkpoint contains only its tested slice and leaves all relevant local suites green.
