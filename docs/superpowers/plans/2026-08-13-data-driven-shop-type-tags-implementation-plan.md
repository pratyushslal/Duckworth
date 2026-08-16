# Data-driven Shop-type Tags Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use inline task-by-task execution with strict red → green → focused regression → commit. Do not start a later task until the current task commit exists.

**Goal:** Add dynamic multi-shop classification and filtering to one canonical household shopping item without duplicate rows or inflated counts.

**Architecture:** Extend the semantic runtime with controlled shop-type policy and quantity-default provenance. Persist automatic and user classification data separately, derive effective category/tags atomically, expose distinct item views, then render dynamic filters and corrections in Angular.

**Tech Stack:** TypeScript, Node SQLite, Fastify, Angular, Vitest, existing semantic-pack compiler and local browser test tooling.

## Global constraints

- Work locally only; never configure, contact, or push an online Git remote.
- Preserve unrelated `duckworth-web/angular.json` analytics configuration changes.
- No production domain data, locale copy, labels, defaults, example products, or category/shop IDs outside validated runtime packs.
- Each task begins with a focused public-seam test run red, adds the smallest production change, reruns green, runs its focused regression, and commits only its files.
- All views and counts use canonical item IDs. Filter queries use deduplicating `EXISTS`/`DISTINCT` logic.
- User tag exclusions persist, and user overrides never disappear because a runtime is re-executed.

---

### Task 1: Define data-driven shop classification and default contracts

**Files:**
- Modify: `packages/shopping-intelligence/src/contracts.ts`, `packages/shopping-intelligence/src/index.ts`
- Test: `packages/shopping-intelligence/src/contracts.spec.ts`

**Produces:** `ShopTypeRecommendation`, `CategoryClassification`, `QuantityProvenance`, `ItemClassification`, and JSON-safe validators with no domain-specific unions.

- [ ] Write a failing contract test that round-trips a synthetic shop-tag recommendation, accepts an arbitrary tag ID, rejects duplicate tag IDs and non-positive default quantities, and accepts a user exclusion with no automatic evidence.
- [ ] Run: `pnpm --dir duckworth-web exec vitest run packages/shopping-intelligence/src/contracts.spec.ts --root .. --globals`; expect failure for missing classification contracts.
- [ ] Add immutable structural contracts and validators; stable origin/decision/provenance values are permitted code constants.
- [ ] Rerun the focused test and `pnpm --dir duckworth-web shared:build`.
- [ ] Commit: `git commit -m "feat: define shop classification contracts"`.

### Task 2: Extend semantic runtime packs and classify deterministically

**Files:**
- Modify: `catalog/schema/semantic-country.schema.json`, `catalog/schema/semantic-locale.schema.json`, `catalog/source/semantic/IN.json`, `catalog/source/semantic/en-IN.json`
- Modify: `packages/shopping-intelligence/src/semantic-runtime.ts`, `packages/shopping-intelligence/src/entity-resolution.ts`
- Test: `catalog/test/semantic-packs.test.mjs`, `packages/shopping-intelligence/src/semantic-runtime.spec.ts`, `packages/shopping-intelligence/src/entity-resolution.spec.ts`

**Produces:** validated controlled shop types, category/product/concept/scoped-brand eligibility, default policy, locale hint templates, and an evidence-bearing `classifyShoppingItem` result.

- [ ] Add a failing synthetic-pack test proving an unseen shop-type ID, category policy, labels, and default unit/quantity work without TypeScript changes; add a negative test proving a bare brand cannot assign a shop tag.
- [ ] Run the focused pack/runtime/entity tests red.
- [ ] Implement schema validation, immutable compiled indexes, exact product/concept precedence, scoped brand participation, category fallback, and no-tag low-confidence outcome. Add only synthetic fixture data needed by tests, not real examples from the requirements.
- [ ] Run `pnpm --dir duckworth-api language-packs:build`, `pnpm --dir duckworth-api language-packs:test`, and the focused Vitest files green.
- [ ] Commit: `git commit -m "feat: classify shopping items with runtime shop types"`.

### Task 3: Persist canonical classification state and migration safely

**Files:**
- Modify: `duckworth-api/src/shopping-items.ts`
- Test: `duckworth-api/test/shopping-items-migration.test.ts`, `duckworth-api/test/shopping-items.test.ts`

**Produces:** migration-safe `tag_definitions` and `item_tag_assignments`, category override/provenance fields, relaxed nullable semantic identifiers, and snapshot mapping.

- [ ] Add a failing migration/restart test for an existing item with only a concept ID, one automatic multi-tag finding, and a historical archive snapshot; assert no duplicate items and preserved archive data.
- [ ] Run: `pnpm --dir duckworth-api exec vitest run test/shopping-items-migration.test.ts test/shopping-items.test.ts --globals`; expect failure.
- [ ] Implement transactional additive migration and idempotent table initialization. Store classification records separately, use unique constraints, update item/event/archive mappers, and remove only the over-restrictive all-or-none identifier check.
- [ ] Rerun focused tests green and a restart regression.
- [ ] Commit: `git commit -m "feat: persist canonical shop classifications"`.

### Task 4: Apply automatic and user classification decisions atomically

**Files:**
- Modify: `duckworth-api/src/shopping-items.ts`, `duckworth-api/src/brain-captures.ts`
- Test: `duckworth-api/test/shopping-items.test.ts`, `duckworth-api/test/brain-persistence.test.ts`

**Produces:** creation/edit recomputation, effective-tag derivation, category override derivation, identity-anchor retirement, and full undo snapshots.

- [ ] Add failing behavior tests: automatic Grocery+Pharmacy-like synthetic tags produce one item; explicit exclusion survives reclassification; clearing it restores automatic inclusion; a semantic identity change retires the override; a default quantity has `policy_default` provenance.
- [ ] Run the focused API tests red.
- [ ] Implement a transaction-level classification application service. On edit, compare resolved identity anchors, retain only compatible overrides, and write before/after event state in the same transaction.
- [ ] Rerun focused tests and all brain persistence tests green.
- [ ] Commit: `git commit -m "feat: apply reversible item classification decisions"`.

### Task 5: Provide distinct filtered views and safe classification editing APIs

**Files:**
- Modify: `duckworth-api/src/app.ts`, `duckworth-api/src/openapi.ts`, generated `duckworth-web/src/app/api/generated/schema.d.ts`
- Test: `duckworth-api/test/shopping-items.test.ts`, `duckworth-api/test/openapi.test.ts`

**Produces:** dynamic classification response fields, `shopTypeId` filtered list facets, and an optimistic individual-decision patch endpoint.

- [ ] Write failing HTTP tests asserting all-items count is one for an item with two tags, each facet count is one, a filtered result contains one row, foreign/inactive tags fail, and a stale expected version returns a conflict without erasing an unrelated decision.
- [ ] Run focused API/OpenAPI tests red.
- [ ] Remove hardcoded category enums from public schemas. Add dynamic response contracts, a `GET` filtered list/view contract, and a `PATCH` classification contract that operates on individual decisions inside one transaction.
- [ ] Regenerate OpenAPI artifacts, rerun focused tests green, and run the API typecheck.
- [ ] Commit: `git commit -m "feat: expose distinct shop-filtered list views"`.

### Task 6: Preserve classifications across lifecycle operations

**Files:**
- Modify: `duckworth-api/src/shopping-items.ts`
- Test: `duckworth-api/test/shopping-items.test.ts`, `duckworth-api/test/brain-persistence.test.ts`

**Produces:** purchase, archive, copy, and undo behaviour that remains one-item-per-request and preserves explainable historical classifications.

- [ ] Add failing tests that purchase a multi-tag item once from a filtered view, exclude it from both active facets, archive effective labels, copy one new canonical item, and undo a tag edit without duplicating assignments.
- [ ] Run focused tests red.
- [ ] Add complete classification snapshots to lifecycle events; make archive labels immutable, make copy recompute automation while carrying compatible explicit decisions, and restore assignments atomically during undo.
- [ ] Rerun focused tests green and the full API suite.
- [ ] Commit: `git commit -m "feat: retain classification through item lifecycle"`.

### Task 7: Render dynamic filters, correction controls, and default guidance

**Files:**
- Modify: `duckworth-web/src/app/core/shopping-items.service.ts`, `duckworth-web/src/app/app.ts`, `duckworth-web/src/app/app.html`, `duckworth-web/src/app/app.scss`
- Create: `duckworth-web/src/app/core/classification-hints.ts`
- Test: `duckworth-web/src/app/core/shopping-items.service.spec.ts`, `duckworth-web/src/app/app.spec.ts`, `duckworth-web/src/app/core/classification-hints.spec.ts`

**Produces:** one-at-a-time dynamic shop chips, canonical count display, optional category/tag correction editor, and pack-backed contextual default hint receipts.

- [ ] Add failing Angular tests for a two-tag item appearing once under each selected filter, All staying at one, purchase disappearing from every active filter, exclusion UI changing only that item, and a once-per-context default hint.
- [ ] Run focused Angular tests red.
- [ ] Implement typed API mapping, selected-filter signal, derived visible unique items, accessible controls, optimistic conflict recovery, and message-code/template resolution. Do not embed named shop/category/hint copy or example items.
- [ ] Rerun focused Angular tests and the web typecheck/build green.
- [ ] Commit: `git commit -m "feat: add dynamic shop filters and corrections"`.

### Task 8: Establish anti-regression, accessibility, and real-browser release gates

**Files:**
- Create: `tools/architecture/check-shop-classification-boundary.mjs`, `tools/architecture/shop-classification-boundary.json`
- Modify: package scripts and test configuration only where necessary
- Test: architecture script, existing API/browser test harnesses

**Produces:** static data-boundary gate, deterministic distinct-count property cases, and local browser proof of the complete user journey.

- [ ] Add a failing architecture test that detects category/shop/hint strings outside permitted runtime fixture paths, plus property cases covering arbitrary overlapping tags and count invariants.
- [ ] Run the architecture/property command red.
- [ ] Implement the narrow static rule and test fixture allowlist. Add a real local-browser flow: name-only add, inferred filter visibility, optional correction, purchase, archive/copy, undo, and keyboard access.
- [ ] Run all relevant pack, shared, API, web, typecheck, build, architecture, and browser suites green. Record exact commands and results in the final verification report.
- [ ] Commit: `test: enforce shop classification release gates`.

## Final verification

- [ ] Inspect `git status --short` and verify only intentional task commits changed tracked application files; leave the pre-existing Angular analytics edit untouched.
- [ ] Run the complete local test/typecheck/build/browser matrix from Task 8.
- [ ] Confirm no Git remote was configured or contacted.
- [ ] Provide the user a concise local test walkthrough with expected observations for defaults, multi-shop filtering, counts, corrections, purchase, archive/copy, undo, and unknown items.
