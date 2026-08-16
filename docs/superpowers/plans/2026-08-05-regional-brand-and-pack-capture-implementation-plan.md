# Regional Brand and Pack-Aware Capture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make first-run local assistance usable, record container quantity and package size separately, and offer reviewed India regional-product assistance without retailer or price behavior.

**Architecture:** Keep generic locale packs, regional product packs, and household/personal vocabulary as distinct local sources. The shared parser owns measurement grammar; the API validates an explicitly accepted product ID and derives identity; Angular renders the parser result and never waits on a request while typing. Both validated artifact classes are cached locally and activated atomically.

**Tech Stack:** TypeScript, Angular 22 signals and HttpClient, Fastify 5, SQLite, Node test runner, Vitest, IndexedDB, OpenAPI snapshots.

## Global Constraints

- Preserve the exact original capture text; suggestions are advisory and require explicit acceptance.
- Keep all typing and assistance local: no request per keystroke and no silent correction or invented numeric value.
- Keep locale, regional-product, household, and personal vocabulary sources distinct.
- Accept all Unicode input and all unknown brands as valid free text.
- Do not add retailer routing, ordering, price, currency, barcode, GTIN, authentication, or online Git behavior.
- The two-measure grammar accepts `name + purchase quantity + container unit + package size + mass/volume unit` and the user-observed reverse ordering `name + package size + mass/volume unit + purchase quantity + container unit`; no other two-measure form is inferred.
- Container units: `pack`, `packet`, `bottle`, `carton`, `can`, `box`, and `bag`; package-measure units: `g`, `kg`, `ml`, and `l`.
- Use TDD: write one failing public-boundary test, observe red, make the smallest change, rerun green, then commit each tracer bullet locally.

---

## File Structure

- `packages/item-capture/src/index.ts` remains the dependency-free grammar authority and exposes nullable package-size fields.
- `catalog/source/IN-products.json` becomes the reviewed India product source; `catalog/schema/regional-product-pack.schema.json` validates its artifact shape.
- `catalog/scripts/build-packs.mjs` emits both existing locale artifacts and checksummed regional-product artifacts; `catalog/source/IN.json` references the default product artifact.
- `duckworth-api/src/regional-product-packs.ts` loads immutable reviewed products, serves artifacts, and validates accepted IDs against captured item text.
- `duckworth-api/src/shopping-items.ts` owns the expanded SQLite migration, durable structured fields, and identity persistence.
- `duckworth-api/src/app.ts` owns HTTP validation, product resolution, and OpenAPI response schema changes.
- `packages/local-assistance/src/index.ts` ranks `regionalProducts` separately and returns accepted product metadata without UI dependencies.
- `duckworth-web/src/app/core/regional-product-pack-repository.ts` caches one validated product artifact with the same staged-promotion semantics as language packs.
- `duckworth-web/src/app/core/capture-assistance.service.ts` projects locale, regional, household, and personal sources into the pure assistance package.
- `duckworth-web/src/app/language-settings/*` bootstraps the country defaults on first run and reports truthful bundle status.
- `duckworth-web/src/app/app.ts`, `app.html`, and shopping-item service render package size and submit an accepted `productId`.

### Task 1: Extend the shared parser for package-aware capture

**Files:**
- Modify: `packages/item-capture/src/index.ts`
- Test: `duckworth-api/test/item-capture.test.ts`

**Interfaces:**
- Produces `CaptureInterpretation = { captureText, name, quantity, unit, packageSize, packageUnit }`.
- Consumed by the Fastify API and Angular preview.

- [ ] **Step 1: Write the failing parser tests**

```ts
it('parses a requested container and the package size independently', () => {
  expect(interpretCapture('amul butter 1 pack 500 gm')).toEqual({
    captureText: 'amul butter 1 pack 500 gm',
    name: 'amul butter', quantity: 1, unit: 'pack', packageSize: 500, packageUnit: 'g',
  });
});

it.each(['gm', 'gms'])('recognizes %s as grams', (unit) => {
  expect(interpretCapture(`500 ${unit} flour`)).toMatchObject({ quantity: 500, unit: 'g' });
});

it('does not turn an ambiguous second number into a package size', () => {
  expect(interpretCapture('milk 2 pack 500 pieces')).toMatchObject({
    name: 'milk 2 pack 500 pieces', quantity: null, unit: null, packageSize: null, packageUnit: null,
  });
});
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `pnpm test --run test/item-capture.test.ts` from `duckworth-api`.

Expected: FAIL because `CaptureInterpretation` lacks `packageSize` and `packageUnit`, and the parser returns a bare name.

- [ ] **Step 3: Add the minimal parser grammar**

```ts
export interface CaptureInterpretation {
  captureText: string; name: string; quantity: number | null; unit: CanonicalUnit | null;
  packageSize: number | null; packageUnit: CanonicalUnit | null;
}

const twoMeasure = /^(.+?)\s+(\d+(?:\.\d+)?)\s+(pack|packet|bottle|carton|can|box|bag)s?\s+(\d+(?:\.\d+)?)\s+(\S+)$/iu;
// Canonicalize only when the final token is g/kg/ml/l; otherwise fall through unchanged.
```

Add `gm: 'g'` and `gms: 'g'` to `UNIT_ALIASES`. Return null package fields from every existing grammar branch. Do not make the parser import product data.

- [ ] **Step 4: Run parser compatibility tests**

Run: `pnpm test --run test/item-capture.test.ts` from `duckworth-api`.

Expected: PASS, including every existing leading/trailing shorthand test.

- [ ] **Step 5: Commit the parser tracer bullet**

```bash
git add packages/item-capture/src/index.ts duckworth-api/test/item-capture.test.ts
git commit -m "feat: parse package-aware item captures"
```

### Task 2: Build and validate the reviewed India regional-product artifact

**Files:**
- Create: `catalog/schema/regional-product-pack.schema.json`
- Create: `catalog/source/IN-products.json`
- Modify: `catalog/source/canonical-items.json`
- Modify: `catalog/source/en-IN.json`
- Modify: `catalog/source/hi-Latn-IN.json`
- Modify: `catalog/source/IN.json`
- Modify: `catalog/scripts/build-packs.mjs`
- Modify: `catalog/test/build-packs.test.mjs`
- Modify: `duckworth-api/package.json`
- Test: `catalog/test/build-packs.test.mjs`

**Interfaces:**
- Produces `RegionalProductPack` with `{ schemaVersion, countryCode, version, products, checksum }`.
- Each product is `{ id, brandId, conceptId, primary, aliases, compatibleContainerUnits, compatiblePackageUnits }`.
- Emits `regional-products/IN/<version>.json` and a `regionalProducts` descriptor in `countries/IN/manifest.json`.

- [ ] **Step 1: Write failing artifact-build tests**

```js
assert.deepEqual(JSON.parse(artifacts['regional-products/IN/2026.08.05.1.json']).products[0], {
  id: 'product.amul.butter', brandId: 'brand.amul', conceptId: 'grocery.butter.dairy',
  primary: 'Amul Butter', aliases: ['amul butter'],
  compatibleContainerUnits: ['box', 'pack'], compatiblePackageUnits: ['g', 'kg'],
});
assert.throws(() => buildPackArtifacts({ ...input, regionalProductPacks: [{ ...pack, products: [{ ...product, conceptId: 'grocery.missing' }] }] }), /unknown canonical id/);
```

- [ ] **Step 2: Run the artifact test to verify it fails**

Run: `pnpm language-packs:test` from `duckworth-api`.

Expected: FAIL because `buildPackArtifacts` does not accept or emit regional product packs.

- [ ] **Step 3: Add source, schema, and deterministic build support**

Seed `grocery.butter.dairy` and reviewed `butter` labels. Add `gm` and `gms` to both India locale unit aliases. Seed exactly these first regional products:

```json
[
  { "id": "product.amul.butter", "brandId": "brand.amul", "conceptId": "grocery.butter.dairy", "primary": "Amul Butter", "aliases": ["amul butter"], "compatibleContainerUnits": ["box", "pack"], "compatiblePackageUnits": ["g", "kg"] },
  { "id": "product.britannia.50-50", "brandId": "brand.britannia", "conceptId": "grocery.biscuits.plain", "primary": "Britannia 50-50", "aliases": ["britannia 50 50", "50-50"], "compatibleContainerUnits": ["pack", "packet"], "compatiblePackageUnits": ["g", "kg"] },
  { "id": "product.dukes.bourbon", "brandId": "brand.dukes", "conceptId": "grocery.biscuits.plain", "primary": "Dukes Bourbon", "aliases": ["dukes bourbon", "bourbon biscuits"], "compatibleContainerUnits": ["pack", "packet"], "compatiblePackageUnits": ["g", "kg"] }
]
```

Reject duplicate normalized aliases, non-plain text, invalid units, duplicate product IDs, and unknown concept IDs. Sort products and alias arrays before checksumming. Extend `buildSourcePacks` to read `IN-products.json`, write the artifact, then regenerate committed API language-pack files and OpenAPI only after API routes are updated.

- [ ] **Step 4: Run catalog tests and artifact build**

Run: `pnpm language-packs:test` and `pnpm language-packs:build` from `duckworth-api`.

Expected: PASS; the generated India manifest references the exact regional artifact and its checksum.

- [ ] **Step 5: Commit the catalog tracer bullet**

```bash
git add catalog duckworth-api/language-packs duckworth-api/package.json
git commit -m "feat: publish reviewed India regional products"
```

### Task 3: Add a server-side regional-product registry and public read contract

**Files:**
- Create: `duckworth-api/src/regional-product-packs.ts`
- Modify: `duckworth-api/src/app.ts`
- Modify: `duckworth-api/src/openapi.ts`
- Modify: `duckworth-api/test/language-packs.test.ts`
- Modify: `duckworth-api/test/openapi.test.ts`
- Modify: `duckworth-api/openapi/duckworth-v1.json`
- Modify: `duckworth-web/openapi/duckworth-v1.json`
- Modify: `duckworth-web/src/app/api/generated/schema.d.ts`

**Interfaces:**
- Produces `RegionalProductCatalog.resolve(countryCode, productId, parsedName)` returning `{ productId, brandId, conceptId, displayName } | null`.
- Serves `GET /api/v1/regional-product-packs/:countryCode/:version` with immutable cache headers.
- Adds `regionalProducts` to the country-manifest OpenAPI type.

- [ ] **Step 1: Write failing Fastify route and resolver tests**

```ts
expect((await app.inject({ method: 'GET', url: '/api/v1/regional-product-packs/IN/2026.08.05.1' })).statusCode).toBe(200);
expect(catalog.resolve('IN', 'product.amul.butter', 'amul butter')).toEqual({
  productId: 'product.amul.butter', brandId: 'brand.amul', conceptId: 'grocery.butter.dairy', displayName: 'Amul Butter',
});
expect(catalog.resolve('IN', 'product.amul.butter', 'rice')).toBeNull();
```

- [ ] **Step 2: Run the focused tests to verify red**

Run: `pnpm test --run test/language-packs.test.ts test/openapi.test.ts` from `duckworth-api`.

Expected: FAIL because the regional route, generated manifest field, and resolver do not exist.

- [ ] **Step 3: Implement immutable artifact serving and validation**

Load only parsed artifacts whose content checksum, country, version, plain-text fields, and ID relationships validate. Match parsed input only against normalized primary/aliases. Never expose a mutation route. Register a `404 regional_product_pack_not_found` response for missing artifacts.

- [ ] **Step 4: Regenerate and verify API contract**

Run: `pnpm language-packs:build`, `pnpm openapi:write` from `duckworth-api`, then `pnpm api:generate` from `duckworth-web`.

Run: `pnpm test --run test/language-packs.test.ts test/openapi.test.ts` from `duckworth-api`.

Expected: PASS with matching committed API and frontend OpenAPI snapshots.

- [ ] **Step 5: Commit the API catalog boundary**

```bash
git add duckworth-api/src duckworth-api/test duckworth-api/openapi duckworth-api/language-packs duckworth-web/openapi duckworth-web/src/app/api/generated/schema.d.ts
git commit -m "feat: serve reviewed regional product packs"
```

### Task 4: Persist package metadata and accepted product identity safely

**Files:**
- Modify: `duckworth-api/src/shopping-items.ts`
- Modify: `duckworth-api/src/app.ts`
- Modify: `duckworth-api/test/shopping-items.test.ts`
- Modify: `duckworth-api/test/shopping-items-migration.test.ts`
- Modify: `duckworth-api/test/openapi.test.ts`

**Interfaces:**
- Extends `ShoppingItem` and OpenAPI response with nullable `packageSize`, `packageUnit`, `brandId`, `productId`, and `conceptId`.
- `POST` accepts optional `productId`; `PATCH` accepts optional `productId: string | null`.
- Produces `400 { error: 'invalid_product_reference' }` for a stale, unknown, or capture-mismatched product ID.

- [ ] **Step 1: Write failing migration and HTTP tests**

```ts
expect(created.json()).toMatchObject({
  captureText: 'amul butter 1 pack 500 gm', name: 'Amul Butter', quantity: 1, unit: 'pack',
  packageSize: 500, packageUnit: 'g', brandId: 'brand.amul', productId: 'product.amul.butter',
  conceptId: 'grocery.butter.dairy', attentionReasons: [],
});
expect((await app.inject({ method: 'POST', url, payload: { input: 'rice 1 pack 500 g', productId: 'product.amul.butter' } })).json())
  .toEqual({ error: 'invalid_product_reference' });
```

Include a migration fixture created with the current schema and assert all five new response fields are null after repository migration.

- [ ] **Step 2: Run the focused tests to verify red**

Run: `pnpm test --run test/shopping-items.test.ts test/shopping-items-migration.test.ts test/openapi.test.ts` from `duckworth-api`.

Expected: FAIL because new response fields, SQL columns, and `productId` handling do not exist.

- [ ] **Step 3: Rebuild the SQLite schema compatibly**

Generalize the existing rename-and-copy migration whenever any required column is missing. Copy current values with `NULL` fallbacks. Add checks for positive package size, paired package unit, and identity all-null/all-present. Pass an optional server-resolved product record to `ShoppingItemRepository.create` and `update`; derive display name, brand ID, and concept ID only inside the API boundary after catalog validation. Clear product identity when a rename is accepted without a replacement `productId`.

- [ ] **Step 4: Run API, migration, and contract tests**

Run: `pnpm openapi:write`, then `pnpm test --run test/shopping-items.test.ts test/shopping-items-migration.test.ts test/openapi.test.ts` from `duckworth-api`.

Expected: PASS. Existing historical-unit behavior and optimistic concurrency remain unchanged.

- [ ] **Step 5: Commit durable capture data**

```bash
git add duckworth-api/src duckworth-api/test duckworth-api/openapi duckworth-web/openapi duckworth-web/src/app/api/generated/schema.d.ts
git commit -m "feat: persist package-aware product captures"
```

### Task 5: Rank regional products locally and preserve typed measurement suffixes

**Files:**
- Modify: `packages/local-assistance/src/index.ts`
- Modify: `packages/local-assistance/src/index.spec.ts`
- Modify: `duckworth-web/src/app/core/capture-assistance.service.ts`
- Modify: `duckworth-web/src/app/core/capture-assistance.service.spec.ts`

**Interfaces:**
- Extends `AssistanceSources` with `regionalProducts`.
- Extends `CaptureSuggestion` with `source: 'regional-product'` and optional `productId`, `brandId`, `conceptId`.
- `suggest()` returns `Amul Butter 1 pack 500 g` for `amul butter 1 pack 500 gm` without changing 1 or 500.

- [ ] **Step 1: Write failing pure assistance tests**

```ts
const index = createAssistanceIndex({ personal: [], household: [], locale: [], regionalProducts: [{
  locale: 'en-IN', text: 'Amul Butter', aliases: ['amul butter'], kind: 'product',
  productId: 'product.amul.butter', brandId: 'brand.amul', conceptId: 'grocery.butter.dairy',
}] });
expect(suggest(index, { input: 'amul b', activeLocale: 'en-IN', enabledLocales: ['en-IN'] })[0])
  .toMatchObject({ text: 'Amul Butter', source: 'regional-product', productId: 'product.amul.butter' });
expect(suggest(index, { input: 'amul butter 1 pack 500 gm', activeLocale: 'en-IN', enabledLocales: ['en-IN'] })[0]?.text)
  .toBe('Amul Butter 1 pack 500 g');
```

- [ ] **Step 2: Run the focused tests to verify red**

Run: `pnpm assistance:test` from `duckworth-web`.

Expected: FAIL because `regionalProducts`, metadata, and suffix-preserving completion are absent.

- [ ] **Step 3: Implement the smallest source-aware matcher**

Split only a recognized trailing two-measure suffix before matching the item prefix. Reattach the same numeric lexemes with canonical unit labels after explicit product selection. Keep personal and household results above regional products; keep generic active-locale items below them; deduplicate by full displayed capture while preserving deterministic tie breakers.

- [ ] **Step 4: Project the validated product pack through Angular's facade**

Map only the active country product artifact into `regionalProducts`. Never promote household entries to regional products, and never make an HTTP call from `suggest()`.

- [ ] **Step 5: Run assistance tests and commit**

Run: `pnpm assistance:test` from `duckworth-web`.

Expected: PASS, including existing correction, Unicode, quantity-preservation, and tie-breaker tests.

```bash
git add packages/local-assistance duckworth-web/src/app/core/capture-assistance.service.ts duckworth-web/src/app/core/capture-assistance.service.spec.ts
git commit -m "feat: suggest reviewed regional products locally"
```

### Task 6: Bootstrap cached/default artifacts and report truthful language state

**Files:**
- Create: `duckworth-web/src/app/core/regional-product-pack-repository.ts`
- Create: `duckworth-web/src/app/core/regional-product-pack-repository.spec.ts`
- Create: `duckworth-web/src/app/core/regional-product-pack-api.service.ts`
- Create: `duckworth-web/src/app/core/regional-product-pack-api.service.spec.ts`
- Modify: `duckworth-web/src/app/core/language-pack-api.service.ts`
- Modify: `duckworth-web/src/app/core/language-pack-api.service.spec.ts`
- Modify: `duckworth-web/src/app/language-settings/language-settings.ts`
- Modify: `duckworth-web/src/app/language-settings/language-settings.html`
- Modify: `duckworth-web/src/app/language-settings/language-settings.spec.ts`
- Modify: `duckworth-web/src/app/app.ts`
- Modify: `duckworth-web/src/app/app.spec.ts`

**Interfaces:**
- Produces `RegionalProductPackRepository.active(): RegionalProductPack | null` with stage/validate/promote behavior.
- Extends `LanguageSettingsChange` to include `{ bundle?: LanguagePackBundle; regionalProductPack?: RegionalProductPack }`.
- On fresh startup, the settings component emits both validated defaults after background reconciliation.

- [ ] **Step 1: Write failing first-run component tests**

```ts
fixture.detectChanges();
http.expectOne('/api/v1/language-packs/countries/IN/manifest').flush(manifestWithRegionalProducts);
http.expectOne('/api/v1/language-packs/en-IN/2026.08.05.1').flush(JSON.stringify(enPack));
http.expectOne('/api/v1/regional-product-packs/IN/2026.08.05.1').flush(JSON.stringify(indiaProducts));
await vi.waitFor(() => expect(changed).toHaveBeenCalledWith(expect.objectContaining({ bundle: enPack, regionalProductPack: indiaProducts })));
expect(fixture.nativeElement.textContent).toContain('Active');
```

Add a test where either artifact is invalid: cached valid artifacts remain active, an empty first run leaves free-text capture usable, and the settings row says `Not downloaded` rather than `Active`.

- [ ] **Step 2: Run the focused web tests to verify red**

Run: `pnpm test --watch=false -- language-settings` from `duckworth-web`.

Expected: FAIL because startup only hydrates an existing language bundle and never installs a default or product pack.

- [ ] **Step 3: Implement atomic background bootstrap**

Reuse the language repository's checksum, staging, and fallback behavior in the product repository with independent IndexedDB keys. After hydrate, call one country-manifest reconciliation path exactly once. For a missing active locale, download and validate the manifest default; then independently download and validate the default regional product artifact. Emit only each successfully activated artifact, keep the current draft untouched, and retain manual optional-language enabling.

- [ ] **Step 4: Wire both active artifacts into `App`**

Store the active regional product pack in an Angular signal, call `configureAssistance()` after each successful activation, and pass it to the facade. Do not block `loadItems()`, API health, or typing on reconciliation.

- [ ] **Step 5: Run component and repository suites**

Run: `pnpm test --watch=false` from `duckworth-web`.

Expected: PASS with no request made by capture input events and with existing offline/atomic language tests still green.

- [ ] **Step 6: Commit startup and cache behavior**

```bash
git add duckworth-web/src/app/core duckworth-web/src/app/language-settings duckworth-web/src/app/app.ts duckworth-web/src/app/app.spec.ts
git commit -m "feat: bootstrap local regional assistance"
```

### Task 7: Submit accepted products and render package-aware list details

**Files:**
- Modify: `duckworth-web/src/app/core/shopping-items.service.ts`
- Modify: `duckworth-web/src/app/core/shopping-items.service.spec.ts`
- Modify: `duckworth-web/src/app/capture-assistance/capture-combobox.ts`
- Modify: `duckworth-web/src/app/capture-assistance/capture-combobox.html`
- Modify: `duckworth-web/src/app/capture-assistance/capture-combobox.spec.ts`
- Modify: `duckworth-web/src/app/app.ts`
- Modify: `duckworth-web/src/app/app.html`
- Modify: `duckworth-web/src/app/app.spec.ts`

**Interfaces:**
- `ShoppingItemsService.add(householdId, input, confirmedUnit?, productId?)` sends `productId` only after an explicit suggestion acceptance.
- Combobox emits `CaptureSuggestion | null` selection metadata separately from its string `valueChange`.
- Preview and item row render `quantity unit · name · packageSize packageUnit` when package fields exist.

- [ ] **Step 1: Write failing component tests**

```ts
input.value = 'amul'; input.dispatchEvent(new Event('input'));
fixture.detectChanges();
expect(fixture.nativeElement.textContent).toContain('Regional product');
// Accept the listbox option, then append the measurements.
expect(create.request.body).toEqual({ input: 'Amul Butter 1 pack 500 g', productId: 'product.amul.butter' });
fixture.componentInstance['items'].set([createdItem]); fixture.detectChanges();
expect(fixture.nativeElement.textContent).toContain('1 pack · Amul Butter · 500 g');
expect(fixture.nativeElement.textContent).not.toContain('Needs details');
```

Add an unknown-brand test asserting `{ input: 'Local dairy butter 1 pack 500 gm' }` is sent without `productId` while its parsed preview still has package size.

- [ ] **Step 2: Run the focused component tests to verify red**

Run: `pnpm test --watch=false -- app.spec.ts capture-combobox.spec.ts shopping-items.service.spec.ts` from `duckworth-web`.

Expected: FAIL because suggestions do not retain product metadata, the service cannot send `productId`, and the template renders only one measurement.

- [ ] **Step 3: Implement explicit acceptance state and display formatting**

Clear accepted-product state on direct draft edits, Escape, submission success, and a nonmatching suggestion. Keep selected product state when the accepted suggestion text is extended only by recognized trailing measurements. Render package size only when both fields are non-null. Existing inline quantity/unit details remain unchanged; package size is read-only in this correction slice.

- [ ] **Step 4: Run the full frontend suite and build**

Run: `pnpm test --watch=false` and `pnpm build` from `duckworth-web`.

Expected: PASS and a successful production build.

- [ ] **Step 5: Commit the user-visible correction**

```bash
git add duckworth-web/src/app
git commit -m "feat: capture and display regional package details"
```

### Task 8: Verify end-to-end behavior and regression boundaries

**Files:**
- Modify: `docs/superpowers/specs/2026-08-05-regional-brand-and-pack-capture-design.md` only if observed behavior requires a specification correction.
- Test: live local API and web application.

**Interfaces:**
- Verifies the public browser/API contracts produced by Tasks 1–7.

- [ ] **Step 1: Run all automated checks from clean artifact output**

Run in `duckworth-api`:

```bash
pnpm typecheck
pnpm language-packs:test
pnpm test --run
pnpm build
```

Run in `duckworth-web`:

```bash
pnpm api:generate
pnpm typecheck
pnpm test --watch=false
pnpm build
```

- [ ] **Step 2: Start the local API and frontend, then use a clean browser profile**

Verify API `/health` returns `{ "status": "ok" }`. Clear only Duckworth's local browser storage for the test profile, reload, and wait for default artifact reconciliation. Do not contact any online remote.

- [ ] **Step 3: Execute the acceptance flow**

1. Type `tom`; confirm a reviewed-vocabulary suggestion for `tomatoes`.
2. Type `milk 2 k`; confirm the local unit completion `milk 2 kg` and no capture-input HTTP request.
3. Type `amul`; confirm **Amul Butter** is labelled **Regional product**.
4. Accept it, enter `1 pack 500 gm`, and confirm preview **1 pack · Amul Butter · 500 g**.
5. Submit and confirm no **Needs details** badge.
6. Reload and confirm the row retains both measurements and brand display.
7. Add `Local dairy butter 1 pack 500 gm`; confirm it remains valid without a brand suggestion or product identity.
8. Disable networking after cached artifacts load; confirm assistance and free-text capture remain usable.

- [ ] **Step 4: Check regression behavior**

Verify keyboard combobox selection, language settings retry after an invalid artifact, personal spelling clarification, newest-first sorting, SSE-created rows, optimistic-conflict feedback, and Unicode free-text capture still work.

- [ ] **Step 5: Commit only documentation changes, if any**

```bash
git status --short
# If and only if Task 8 changed the approved spec to correct an observed contradiction:
git add docs/superpowers/specs/2026-08-05-regional-brand-and-pack-capture-design.md
git commit -m "docs: clarify regional capture verification"
```
