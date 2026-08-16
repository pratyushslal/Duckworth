# Holistic Semantic Learning and Resolution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use test-driven development for every task. Execute tasks in order, committing each verified slice before starting the next.

**Goal:** Make Duckworth learn explicit household corrections as complete, reversible semantic knowledge—name, brand, product, descriptor, quantity, unit, package, category, and shop tags—while keeping all dynamic product/language knowledge in validated runtime data rather than application hardcoding.

**Architecture:** Keep the existing local-first capture pipeline, but make its runtime contract complete. A capture produces a raw immutable envelope, a structured interpretation, evidence spans, and a versioned semantic identity. Explicit corrections produce a provenance-bearing correction event. A governed household/device learning overlay can influence future low-confidence resolution, but current explicit input and reviewed catalog evidence always win. Unknown or conflicting interpretations remain visible and reversible instead of being silently guessed.

**Tech Stack:** TypeScript, Angular, Fastify, SQLite, Vitest, Node test runner, Playwright/Python E2E, JSON Schema catalog packs, generated OpenAPI clients.

## Global Constraints

- Product, brand, category, unit, shop, descriptor, capitalization, alias, and language knowledge belongs in catalog/runtime data, never product-specific TypeScript conditionals.
- Preserve raw capture text and prior interpretations; derived semantic projections are versioned and replayable.
- Explicit current input always outranks catalog defaults and learning overlays.
- Learning is scoped, evidence-backed, reversible, conflict-aware, and never promoted from an unconfirmed successful write alone.
- Live and sandbox remain separate processes, physical databases, origins, credentials, and browser-learning namespaces.
- Tests must mutate only an explicitly handshaken disposable sandbox.
- Preserve unrelated existing changes, including `duckworth-web/angular.json` (`analytics:false`) and `duckworth-web/proxy.conf.json`.

## Current baseline and known gaps

Already present and treated as dependencies: fail-closed sandbox harness, lane/database guards, semantic snapshot versions/upcasters, descriptor roles and span retention, product-family identity, indexed token-aware assistance, accepted-suggestion server validation, catalog-owned regional brand labels, raw capture retention/export/delete, governed learning status controls, and browser E2E gates.

Remaining gaps covered by this plan:

- canonical display labels and aliases are incomplete for brands/products/concepts;
- brand resolution depends too heavily on regional product hints;
- `mg` and `strip` are absent from the runtime unit vocabulary;
- frontend unit labels contain hardcoded English data;
- explicit edits do not create a complete semantic correction event;
- learning overlays apply only part of a correction and do not reliably learn package/category/shop semantics;
- unknown, conflicting, or ambiguous corrections need a safe review path;
- the exact Pepsi/Morish/Crocin and multi-field correction cases lack end-to-end regression coverage.

---

### Task 1: Characterize the three reported failures and the learning gap

**Files:**
- Modify: `duckworth-api/test/shopping-items.test.ts`
- Modify: `packages/item-capture/src/index.spec.ts`
- Modify: `packages/shopping-intelligence/src/entity-resolution.spec.ts`
- Modify: `packages/shopping-intelligence/src/learning-overlay.spec.ts`
- Create: `duckworth-api/test/semantic-learning-regressions.test.ts`

**Interfaces:** Use public capture, semantic-resolution, API correction, and runtime-overlay seams. Do not assert private helper implementation.

- [ ] Write failing tests for:
  - lowercase `pepsi` with a catalog fixture resolves to canonical `Pepsi` and Grocery;
  - lowercase `morish bread` resolves from a catalog fixture without code-specific product logic;
  - `crocin tablets 650 mg 1 strip` yields item `crocin tablets`, quantity `1`, unit `strip`, package size `650`, package unit `mg`;
  - an explicit correction changes future interpretation across all corrected fields;
  - clearing the learning entry restores the original unresolved behavior;
  - explicit current quantity/unit/package text defeats a learned default.
- [ ] Run the focused tests and record the red failures.
- [ ] Do not change production code in this task.
- [ ] Commit the characterization tests.

### Task 2: Expand and validate the runtime data contract

**Files:**
- Modify: `packages/shopping-intelligence/src/semantic-runtime.ts`
- Modify: `catalog/schema/semantic-core.schema.json`
- Modify: `catalog/schema/semantic-country.schema.json`
- Modify: `catalog/schema/semantic-locale.schema.json`
- Modify: `catalog/scripts/build-packs.mjs`
- Modify: `catalog/source/semantic/core.json`
- Modify: `catalog/source/semantic/IN.json`
- Modify: `catalog/source/semantic/en-IN.json`
- Modify: `catalog/source/IN-products.json`
- Test: `catalog/test/build-packs.test.mjs`, `packages/shopping-intelligence/src/semantic-runtime.spec.ts`

**Data contract:**

```text
Brand: id, canonical display label, aliases, optional parent brand
Concept: id, canonical display label, aliases, category, shop types
Product: id, canonical display label, brand, concept, aliases, shop types, default package/unit
Unit: id, capability, dimension, conversion, locale labels, singular/plural forms, aliases
Category: id, display label, evidence signals, shop types, descriptor applicability
```

- [ ] Add schema-required canonical labels and aliases where identity is resolved.
- [ ] Add `mg` as mass measure and `strip` as container data; add locale aliases `mg`, `milligram(s)`, `strip(s)`.
- [ ] Add data-only catalog fixtures for Pepsi, Morish bread, and Crocin tablets in test packs; production catalog publication remains reviewable data, not code.
- [ ] Validate duplicate IDs, alias collisions, unknown references, unit dimensions, label completeness, and shop-type references.
- [ ] Run catalog tests red-to-green and rebuild all artifacts.
- [ ] Commit the runtime contract/data slice.

### Task 3: Make parser output span-complete and package-aware

**Files:**
- Modify: `packages/item-capture/src/index.ts`
- Modify: `packages/item-capture/src/index.spec.ts`
- Modify: `catalog/source/semantic/en-IN.json`
- Modify: `catalog/source/semantic/hi-Latn-IN.json` or the active locale source path

- [ ] Add table-driven parser cases for `1 strip`, `650 mg`, `650 mg 1 strip`, plural aliases, mixed case, punctuation, and quantity-before/after-item forms.
- [ ] Assert every numeric/unit/package span is either captured, explicitly warned, or retained as an unresolved span.
- [ ] Ensure an unknown unit never silently becomes `piece` when an explicit unit token is present.
- [ ] Preserve `packQualifier`, package container, and source offsets through the public interpretation contract.
- [ ] Run item-capture tests red, implement the minimum grammar/data change, then run green.
- [ ] Commit the parser slice.

### Task 4: Resolve canonical identity and capitalization from runtime evidence

**Files:**
- Modify: `packages/shopping-intelligence/src/entity-resolution.ts`
- Modify: `packages/shopping-intelligence/src/index.ts`
- Modify: `packages/shopping-intelligence/src/contracts.ts`
- Modify: `duckworth-api/src/regional-product-packs.ts`
- Modify: `duckworth-web/src/app/core/display-formatters.ts`
- Test: `packages/shopping-intelligence/src/entity-resolution.spec.ts`, `duckworth-api/test/regional-product-packs.test.ts`, `duckworth-web/src/app/core/display-formatters.spec.ts`

- [ ] Compile independent indexes for product, product-family, concept, and brand aliases.
- [ ] Resolve a brand even when no complete regional product match exists, while retaining ambiguity when multiple identities match.
- [ ] Use catalog/runtime canonical labels for persisted/display names; never infer brand casing from the first token or generic title case.
- [ ] For unresolved text, preserve raw spelling and expose an advisory canonicalization candidate rather than silently changing the stored value.
- [ ] Remove the hardcoded `UNIT_LABELS` table from the UI; consume locale/runtime unit labels and plural forms through the existing language-pack contract.
- [ ] Add synthetic tests proving the algorithm works for arbitrary catalog entries, not only Pepsi/Morish/Crocin.
- [ ] Commit the identity/display slice.

### Task 5: Strengthen data-driven category and multi-shop classification

**Files:**
- Modify: `packages/shopping-intelligence/src/entity-resolution.ts`
- Modify: `packages/shopping-intelligence/src/semantic-runtime.ts`
- Modify: `duckworth-api/src/shopping-items.ts`
- Test: `packages/shopping-intelligence/src/entity-resolution.spec.ts`, `duckworth-api/test/shopping-items.test.ts`

- [ ] Define deterministic evidence scoring: product > concept > explicit brand/category rule > reviewed category signal > governed learning > unresolved.
- [ ] Support multiple shop tags as a set; never duplicate an item row or count when several tags apply.
- [ ] Persist evidence, confidence, runtime versions, and semantic identity for each automatic tag.
- [ ] Treat user include/exclude decisions as overrides scoped to the item/identity, not as edits to the global catalog.
- [ ] Return an unresolved/draft state for conflicting category evidence instead of assigning a false shop.
- [ ] Add tests for grocery-only Pepsi, pharmacy Crocin, dual-shop products, ambiguous labels, and count invariants.
- [ ] Commit the classification slice.

### Task 6: Capture complete semantic correction events

**Files:**
- Modify: `duckworth-api/src/shopping-items.ts`
- Modify: `duckworth-api/src/app.ts`
- Modify: `packages/shopping-intelligence/src/contracts.ts`
- Create or modify: SQLite migration for `semantic_correction_events`
- Test: `duckworth-api/test/semantic-learning-regressions.test.ts`, migration/restart tests

**Correction event payload:**

```text
eventId, householdId, device/profile scope, itemId, rawCapture,
beforeSemanticSnapshot, afterSemanticSnapshot, changedFieldMask,
source (explicit-edit | accepted-suggestion | tag-confirmation | unit-confirmation),
runtime versions, supporting event IDs, createdAt
```

- [ ] Emit an immutable event whenever a user explicitly corrects name, brand, product, descriptor, quantity, unit, package, category, or shop tags.
- [ ] Emit no learning event for a normal successful create unless the user explicitly confirms the interpretation.
- [ ] Validate complete correction payloads and reject partial package pairs or invalid units.
- [ ] Preserve correction events through restart, export, backup, migration, and replay.
- [ ] Commit the provenance slice.

### Task 7: Implement holistic governed learning overlay v2

**Files:**
- Modify: `packages/shopping-intelligence/src/learning-overlay.ts`
- Modify: `packages/shopping-intelligence/src/semantic-runtime.ts`
- Modify: `packages/shopping-intelligence/src/entity-resolution.ts`
- Modify: `duckworth-api/src/shopping-items.ts`
- Modify: `duckworth-api/src/app.ts`
- Test: `packages/shopping-intelligence/src/learning-overlay.spec.ts`, `duckworth-api/test/semantic-learning-regressions.test.ts`

- [ ] Replace the quantity-only promotion path with a typed semantic learning candidate containing alias, canonical identity, brand/product/concept, descriptors, package profile, category, shop tags, and confidence.
- [ ] Compile active entries into overlay indexes for aliases, identity defaults, package defaults, category preferences, and shop-tag preferences.
- [ ] Apply the precedence rule: explicit current input, reviewed catalog, active household learning, device learning, policy default.
- [ ] Require one explicit correction for promotion, or the configured support threshold for non-explicit repeated evidence.
- [ ] Suppress promotion for ambiguous, rejected, removed, or undone events.
- [ ] Detect conflicting active entries and produce a clarification draft with both alternatives.
- [ ] Version and upcast old learning entries without losing historical provenance.
- [ ] Commit only after tests prove before/after/clear/restore behavior.

### Task 8: Add correction review and learning governance UI

**Files:**
- Modify: `duckworth-web/src/app/app.ts`
- Modify: `duckworth-web/src/app/app.html`
- Modify: `duckworth-web/src/app/core/household-learning.service.ts`
- Modify: `duckworth-web/src/app/core/household-vocabulary.ts`
- Test: Angular app/learning/vocabulary specs and browser E2E

- [ ] Show a compact “Duckworth learned” review card with raw input, corrected interpretation, evidence, scope, and affected fields.
- [ ] Provide explicit actions: accept household learning, keep device-only, keep separate, suppress, clear, restore.
- [ ] Label unconfirmed text as “This device” and do not project typos/raw captures into household suggestions.
- [ ] Keep direct current edits authoritative without requiring users to understand learning internals.
- [ ] Show non-blocking natural hints for missing quantity/unit/package details; hints must come from runtime policy/UI copy, not product data.
- [ ] Add keyboard, touch, screen-reader, IME, narrow-layout, offline, and privacy tests.
- [ ] Commit the governance UI slice.

### Task 9: Make suggestions carry the complete semantic candidate

**Files:**
- Modify: `packages/local-assistance/src/index.ts`
- Modify: `packages/local-assistance/src/index.ts` (the package's exported public suggestion types)
- Modify: `duckworth-web/src/app/core/capture-assistance.service.ts`
- Modify: `duckworth-web/src/app/capture-assistance/capture-combobox.ts`
- Modify: `duckworth-api/src/app.ts`
- Test: local-assistance ranking/performance specs, combobox specs, API stale-candidate tests

- [ ] Include suggestion schema version, canonical display, product/family/brand/concept IDs, descriptor values, replacement range, protected spans, confidence, evidence, runtime versions, ambiguity group, and opaque acceptance reference.
- [ ] Rank globally by protected-span preservation, token coverage, reviewed identity confidence, locale fit, governed evidence, then stable identity—not by source bucket order.
- [ ] Deduplicate by semantic identity plus normalized display; retain same-label/different-identity alternatives.
- [ ] Revalidate candidate references server-side and return a safe draft/clarification if stale or ambiguous.
- [ ] Preserve quantities, units, package sizes, and suffix text byte-for-byte during acceptance.
- [ ] Commit the structured-assistance slice.

### Task 10: Make audit, privacy, and local learning boundaries complete

**Files:**
- Modify: `duckworth-api/src/brain-captures.ts`
- Modify: `duckworth-web/src/app/core/personal-vocabulary-store.ts`
- Modify: `duckworth-web/src/app/core/household-vocabulary.ts`
- Modify: capture-history/privacy UI and tests

- [ ] Retain raw capture history only under the configured retention policy; expose export/delete/expiry status.
- [ ] Scope device learning by server-issued lane/instance, household, device/profile, and locale.
- [ ] Never treat every successful list row or raw capture as confirmed spelling evidence.
- [ ] Bound record size/count, expose clear/disable controls, and visibly report persistence failures.
- [ ] Ensure corrupt local records cannot affect committed shopping-item truth.
- [ ] Commit the privacy boundary slice.

### Task 11: Verify lane isolation, recovery, and LAN operation

**Files:**
- Modify: `duckworth-api/src/config.ts`
- Modify: `duckworth-api/src/server.ts`
- Modify: `duckworth-web/package.json`
- Modify: `duckworth-web/e2e/runtime_guard.py`
- Test: lane isolation, backup/restore, migration, restart, runtime guard, and all browser E2E scripts
- Document: `docs/runbooks/duckworth-lanes-and-lan-testing.md`

- [ ] Test that test mode cannot select the family database, even through misleading environment variables.
- [ ] Test cross-household and cross-lane reads/writes, SSE, suggestions, learning, reset, backup, and restore.
- [ ] Run migration dry run with collision/loss ledger; quarantine mixed historical data rather than guessing ownership.
- [ ] Verify backup checksums, SQLite integrity, disposable restore, and restart replay.
- [ ] Start sandbox on `0.0.0.0:4300` and verify the LAN URL; document that plain HTTP is permitted only on a trusted LAN and HTTPS is required for untrusted networks.
- [ ] Keep family-live at port 4200 only after all mutating tests prove sandbox identity before mutation.
- [ ] Commit the operational verification slice.

### Task 12: Full release gate and acceptance corpus

**Files:**
- Create: product-data-free evaluation corpus under `packages/*/src/evaluation-fixtures/`
- Modify: `duckworth-api/package.json`
- Modify: `duckworth-web/package.json`
- Modify: `catalog/test/*.test.mjs` command documentation
- Modify: `docs/runbooks/duckworth-semantic-learning-release-checklist.md`
- Document: `docs/runbooks/duckworth-semantic-learning-release-checklist.md`

- [ ] Run API, web, item-capture, local-assistance, shopping-intelligence, catalog, typecheck, OpenAPI, build, migration, backup, and E2E suites from a clean configuration.
- [ ] Measure assistance p50/p95 latency, index build time, memory, API latency, and concurrent SSE behavior.
- [ ] Evaluate positive, negative, ambiguous, typo, Unicode, IME, adjective, package, multi-tag, stale-candidate, conflict, and replay cases.
- [ ] Verify exact count invariants when one item has multiple shop tags.
- [ ] Record manual acceptance evidence for Pepsi-style brand/category, Crocin-style `mg`/`strip`, low-fat descriptors, pack qualifiers, correction learning, clear/restore, and sandbox/live isolation.
- [ ] Commit the release checklist and final verified plan state.

### Task 13: Photo ingestion boundary (planned follow-up, not part of this semantic-learning release)

**Files:**
- Create: API/interface design document for camera/gallery ingestion
- Test: contract-only fixtures for image provenance and deferred OCR interpretation

- [ ] Define an input adapter that produces the same raw-capture envelope as typed/voice input.
- [ ] Preserve image provenance, consent, retention, redaction, OCR spans, and uncertainty.
- [ ] Route OCR output through the same parser, semantic resolver, correction event, and learning overlay; do not create a second intelligence path.
- [ ] Do not implement image ingestion until the text/voice semantic contract and privacy controls above are stable.

## Dependency order

`Task 1 → Task 2 → Task 3 → Task 4 → Task 5 → Task 6 → Task 7 → Task 8 → Task 9 → Task 10 → Task 11 → Task 12`.

Task 13 is intentionally deferred but its API boundary must remain compatible with the shared capture envelope.

## Definition of done

The plan is complete only when every explicit correction creates replayable provenance, the next matching capture reuses the complete reviewed semantic interpretation, conflicts remain visible, clear/restore works, no dynamic product/language data is hardcoded in application code, all release gates pass from a clean configuration, and family-live is never mutated by tests.
