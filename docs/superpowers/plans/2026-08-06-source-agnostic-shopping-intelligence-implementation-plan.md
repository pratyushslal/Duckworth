# Source-Agnostic Shopping Intelligence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reliably interpret realistic natural-language shopping items through one source-neutral brain, then provide atomic correction and recoverable removal in the API and Angular application.

**Architecture:** Add a small `@duckworth/shopping-intelligence` facade over the existing dependency-free capture and assistance packages. Text, voice-transcript, and API adapters supply the same command; Fastify authoritatively persists one validated intent. SQLite stores immutable initial capture plus current interpretation, while Angular uses the same brain for preview and exposes one complete editor and soft-removal recovery.

**Tech Stack:** TypeScript 6, Angular 22 signals and HttpClient, Fastify 5, Node SQLite, Vitest, Angular TestBed, OpenAPI, local browser testing.

## Global Constraints

- Parsing, semantic identity, correction reconciliation, and lifecycle policy must be agnostic of text, voice, and API sources.
- Preserve unknown brands and Unicode free text; do not silently map or rewrite an unaccepted product.
- Never invent shopping count or package-size numbers; numeric characters inside reviewed product identity are not shopping quantities.
- Keep typing and assistance local with no request per keystroke.
- Use one red public-boundary test, minimum green implementation, and green checkpoint per phrase family.
- Preserve optimistic concurrency, SSE, sorting, offline assistance, and accessibility.
- Do not implement price safety, currency, retailers, carts, ordering integrations, remote lookup, or online Git behavior.

---

## File Structure

- `packages/shopping-intelligence/src/index.ts` is the source-neutral public facade and correction/lifecycle policy boundary.
- `packages/item-capture/src/index.ts` remains the low-level deterministic measurement grammar used by the facade.
- `packages/local-assistance/src/index.ts` remains the low-level deterministic local ranking engine.
- `duckworth-api/src/app.ts` adapts HTTP commands to the brain and publishes responses/events.
- `duckworth-api/src/shopping-items.ts` persists validated intent and performs versioned atomic writes; it does not parse text.
- `duckworth-web/src/app/app.ts` and `app.html` adapt user interaction to the same brain and API.
- `catalog/source/IN-products.json` owns reviewed product aliases; generated artifacts are rebuilt, not hand-edited.

### Task 1: Establish the source-neutral interpretation seam

**Files:**
- Create: `packages/shopping-intelligence/package.json`
- Create: `packages/shopping-intelligence/tsconfig.json`
- Create: `packages/shopping-intelligence/src/index.ts`
- Create: `packages/shopping-intelligence/src/index.spec.ts`
- Modify: `duckworth-api/package.json`
- Modify: `duckworth-web/package.json`

**Interfaces:**
- Produces `interpretItem(command: CaptureCommand): ItemIntent`.
- `CaptureCommand.source` is metadata and cannot affect the returned interpretation.
- Consumes `interpretCapture` and `normalizeItemName` from `@duckworth/item-capture`.

- [ ] **Step 1: Write the red source-parity test**

```ts
it.each(['text', 'voice', 'api'] as const)('interprets the same transcript from %s', (source) => {
  expect(interpretItem({
    text: 'Amul Butter 500 gms 1 pac', locale: 'en-IN', countryCode: 'IN', source,
  })).toEqual({
    captureText: 'Amul Butter 500 gms 1 pac', itemName: 'Amul Butter',
    identityKey: 'amul butter', quantity: 1, unit: 'pack', packageSize: 500, packageUnit: 'g',
  });
});
```

- [ ] **Step 2: Run the focused test and verify red**

Run: `pnpm exec vitest run packages/shopping-intelligence/src/index.spec.ts --root .. --globals`

Expected: FAIL because `@duckworth/shopping-intelligence` does not exist.

- [ ] **Step 3: Add the minimal facade**

```ts
export function interpretItem(command: CaptureCommand): ItemIntent {
  const parsed = interpretCapture(command.text);
  return {
    captureText: parsed.captureText,
    itemName: parsed.name,
    identityKey: normalizeItemName(parsed.name),
    quantity: parsed.quantity,
    unit: parsed.unit,
    packageSize: parsed.packageSize,
    packageUnit: parsed.packageUnit,
  };
}
```

- [ ] **Step 4: Build shared packages and rerun green**

Run from `duckworth-web`: `pnpm shared:build && pnpm intelligence:test`

Expected: PASS for all three sources with exactly equal outputs.

- [ ] **Step 5: Commit**

```bash
git add packages/shopping-intelligence duckworth-api/package.json duckworth-web/package.json
git commit -m "feat: add source-neutral shopping intelligence"
```

### Task 2: Expand the conservative natural-language grammar

**Files:**
- Modify: `packages/item-capture/src/index.ts`
- Test: `packages/shopping-intelligence/src/index.spec.ts`
- Test: `duckworth-api/test/item-capture.test.ts`

**Interfaces:**
- Keeps `interpretItem(CaptureCommand): ItemIntent` unchanged.
- Extends only deterministic recognized phrase families; ambiguous text remains a bare name.

- [ ] **Step 1: Add the leading-container red test**

```ts
expect(interpretItem({
  text: '1 pack of Amul Butter 500 gms', locale: 'en-IN', countryCode: 'IN', source: 'text',
})).toMatchObject({
  itemName: 'Amul Butter', quantity: 1, unit: 'pack', packageSize: 500, packageUnit: 'g',
});
```

- [ ] **Step 2: Run red and confirm the current name is `of Amul Butter 500 gms`**

Run from `duckworth-api`: `pnpm test --run test/item-capture.test.ts`

- [ ] **Step 3: Match connector grammar before generic leading quantity**

Add a branch equivalent to:

```ts
const countOfPackage = /^(\d+(?:\.\d+)?)\s+(\S+)\s+of\s+(.+?)\s+(\d+(?:\.\d+)?)\s+(\S+)$/iu.exec(captureText);
```

Accept it only when the first unit is a container, the final unit is a package measure, both numbers are positive finite values, and the item span is non-empty.

- [ ] **Step 4: Add one phrase family at a time**

Add literal expectations for:

```ts
[
  ['2 bottles of orange juice 1 litre', 'orange juice', 2, 'bottle', 1, 'l'],
  ['3 packets of Britannia 50-50 100 gm', 'Britannia 50-50', 3, 'packet', 100, 'g'],
  ['Dukes Bourbon 50 g 1 pack', 'Dukes Bourbon', 1, 'pack', 50, 'g'],
  ['Dukes Bourbon 1 pack 50 grams', 'Dukes Bourbon', 1, 'pack', 50, 'g'],
];
```

Run the focused test after every row and make only that row green.

- [ ] **Step 5: Add ambiguity guards**

Assert `Formula 1`, `Vitamin B12`, `7UP 2L`, `milk for 2 days`, and `box of memories` are not reinterpreted as two-measure captures unless the complete recognized grammar is present.

- [ ] **Step 6: Run both parser and facade suites green, then commit**

```bash
git add packages/item-capture/src/index.ts packages/shopping-intelligence/src/index.spec.ts duckworth-api/test/item-capture.test.ts
git commit -m "fix: understand natural container and package phrases"
```

### Task 3: Make product assistance identity-aware

**Files:**
- Modify: `packages/local-assistance/src/index.ts`
- Test: `packages/local-assistance/src/index.spec.ts`
- Modify: `catalog/source/IN-products.json`
- Test: `catalog/test/build-packs.test.mjs`
- Regenerate: `duckworth-api/language-packs/regional-products/IN/*.json`

**Interfaces:**
- Keeps `suggest(index, request): CaptureSuggestion[]`.
- A regional product entry may complete numbers within its reviewed identity, but structural numbers already entered outside the matched identity span are preserved exactly.

- [ ] **Step 1: Add the numeric-identity red test**

```ts
expect(suggest(indexWithBritannia, request('Britannia 5'))[0]).toMatchObject({
  text: 'Britannia 50-50', productId: 'product.britannia.50-50', source: 'regional-product',
});
```

- [ ] **Step 2: Run red and verify `preservesQuantities` suppresses the result**

Run from `duckworth-web`: `pnpm assistance:test`

- [ ] **Step 3: Scope quantity preservation to structural suffix/prefix values**

Regional product identity digits are compared through reviewed label matching. Quantities parsed outside the matched product label must be identical in the accepted suggestion.

- [ ] **Step 4: Add reviewed natural aliases and artifact validation**

Add `britannia 50-50 biscuit` and `britannia 50-50 biscuits` to the source product aliases, rebuild artifacts, and assert the artifact contains both exactly once.

- [ ] **Step 5: Add preservation tests**

Assert:

```ts
suggest(indexWithBritannia, request('Britannia 50-50 biscuit'));
suggest(indexWithBritannia, request('Britannia 50-50 2 pack 100 g'));
```

The first attaches the reviewed product; the second preserves `2` and `100` when completing the product span.

- [ ] **Step 6: Run assistance and catalog tests green, then commit**

```bash
git add packages/local-assistance catalog/source/IN-products.json catalog/test duckworth-api/language-packs
git commit -m "fix: distinguish product numbers from shopping quantities"
```

### Task 4: Persist one authoritative current interpretation

**Files:**
- Modify: `duckworth-api/src/shopping-items.ts`
- Modify: `duckworth-api/src/app.ts`
- Test: `duckworth-api/test/shopping-items-migration.test.ts`
- Test: `duckworth-api/test/shopping-items.test.ts`
- Modify: `duckworth-api/openapi/duckworth-v1.json`
- Modify: `duckworth-web/openapi/duckworth-v1.json`
- Regenerate: `duckworth-web/src/app/api/generated/schema.d.ts`

**Interfaces:**
- `ShoppingItem` adds `initialCaptureText`, current `captureText`, and `identityKey`.
- Repository `create` consumes a validated `ItemIntent`; it never invokes the parser.
- Active uniqueness and duplicate errors use `identityKey`.

- [ ] **Step 1: Add a migration red test**

Create a legacy row whose capture and name differ, open the repository, and expect initial capture to preserve the old capture while identity follows the best current item name.

- [ ] **Step 2: Run red**

Run: `pnpm test --run test/shopping-items-migration.test.ts`

- [ ] **Step 3: Add migration columns and authoritative identity**

Add `initial_capture_text`, `identity_key`, and `removed_at`, backfill them transactionally, and replace parser-based duplicate lookup with an indexed identity lookup.

- [ ] **Step 4: Adapt HTTP create through `interpretItem`**

Build `CaptureCommand` from the request and pass the returned intent to the repository. Add a contract test that text, voice, and API `source` metadata do not change the response fields.

- [ ] **Step 5: Update OpenAPI and generated types**

Run from `duckworth-api`: `pnpm openapi:write`.

Copy the snapshot to the web project and run from `duckworth-web`: `pnpm api:generate`.

- [ ] **Step 6: Run API tests and typechecks green, then commit**

```bash
git add duckworth-api duckworth-web/openapi duckworth-web/src/app/api/generated/schema.d.ts
git commit -m "refactor: persist authoritative shopping intent"
```

### Task 5: Add atomic item correction

**Files:**
- Modify: `packages/shopping-intelligence/src/index.ts`
- Test: `packages/shopping-intelligence/src/index.spec.ts`
- Modify: `duckworth-api/src/shopping-items.ts`
- Modify: `duckworth-api/src/app.ts`
- Test: `duckworth-api/test/shopping-items.test.ts`

**Interfaces:**
- Produces `reconcileItemCorrection(command: CorrectionCommand): ItemIntent`.
- HTTP `PATCH /items/:itemId` accepts all current interpretation fields together with `expectedVersion`.

```ts
export interface CorrectionCommand {
  captureText: string;
  itemName: string;
  quantity: number | null;
  unit: CanonicalUnit | null;
  packageSize: number | null;
  packageUnit: CanonicalUnit | null;
  locale: string;
  countryCode: string;
  acceptedProductId?: string;
  source?: 'text' | 'voice' | 'api';
}
```

- [ ] **Step 1: Add the duplicated-details red test**

```ts
expect(reconcileItemCorrection({
  captureText: 'Britannia 50-50 biscuit 1 pack', itemName: 'Britannia 50-50 biscuit 1 pack',
  quantity: 1, unit: 'pack', packageSize: null, packageUnit: null,
  locale: 'en-IN', countryCode: 'IN',
})).toMatchObject({ itemName: 'Britannia 50-50 biscuit', quantity: 1, unit: 'pack' });
```

- [ ] **Step 2: Run red, then implement exact-duplicate reconciliation**

Only strip a recognized terminal pair when it exactly equals the structured fields. Throw a domain conflict when values disagree.

- [ ] **Step 3: Add the HTTP atomicity test**

Patch name, quantity, unit, package size, and package unit once; assert every returned field and `captureText` agree and version increments once. Assert a stale version changes nothing.

- [ ] **Step 4: Run facade and API suites green, then commit**

```bash
git add packages/shopping-intelligence duckworth-api
git commit -m "feat: correct shopping items atomically"
```

### Task 6: Add soft removal, undo, and restore

**Files:**
- Modify: `packages/shopping-intelligence/src/index.ts`
- Test: `packages/shopping-intelligence/src/index.spec.ts`
- Modify: `duckworth-api/src/shopping-items.ts`
- Modify: `duckworth-api/src/app.ts`
- Test: `duckworth-api/test/shopping-items.test.ts`
- Test: `duckworth-api/test/shopping-items-migration.test.ts`

**Interfaces:**
- `ShoppingItemStatus` becomes `active | purchased | removed`.
- `transitionItem(item, 'remove' | 'restore' | 'purchase' | 'reopen')` validates transitions.
- List supports `includeRemoved=true` independently of `includePurchased=true`.

```ts
export type ItemLifecycleAction = 'purchase' | 'reopen' | 'remove' | 'restore';
export interface ItemLifecycleState {
  status: 'active' | 'purchased' | 'removed';
  removedAt: string | null;
}
```

- [ ] **Step 1: Add lifecycle red tests**

Assert active→removed, removed→active, active→purchased, purchased→active, and rejection of purchased→removed without reopen.

- [ ] **Step 2: Implement pure transition policy and run green**

Set or clear `removedAt` only for remove/restore transitions.

- [ ] **Step 3: Add API removal and restoration tests**

Verify removed items leave the active list, can be restored, do not block a new active item with the same identity, and return duplicate conflict if restoration would create two active identities.

- [ ] **Step 4: Prove learning exclusions**

Verify removed items are excluded from server-side unit history and from list projections consumed by household vocabulary.

- [ ] **Step 5: Run API suites green, then commit**

```bash
git add packages/shopping-intelligence duckworth-api
git commit -m "feat: add recoverable shopping-item removal"
```

### Task 7: Deliver one complete Angular editor and removal recovery

**Files:**
- Modify: `duckworth-web/src/app/app.ts`
- Modify: `duckworth-web/src/app/app.html`
- Modify: `duckworth-web/src/app/app.scss`
- Modify: `duckworth-web/src/app/app.spec.ts`
- Modify: `duckworth-web/src/app/core/shopping-items.service.ts`
- Modify: `duckworth-web/src/app/core/household-vocabulary.ts`
- Modify: `duckworth-web/src/app/core/unit-history-cache.ts`

**Interfaces:**
- Every row exposes **Edit item**, **Remove**, and the existing purchase action when applicable.
- One editor owns item name, count/unit, and package size/unit drafts.
- A live region exposes **Undo** after removal; **Recently removed** exposes **Restore**.

- [ ] **Step 1: Add the complete-item editor red test**

Load a complete packaged item, activate **Edit item**, and assert all five logical fields are present with current values.

- [ ] **Step 2: Implement the smallest unified editor and run green**

Submit one atomic correction request; preserve drafts on validation, network, duplicate, or version-conflict failure.

- [ ] **Step 3: Add the removal/undo red test**

Click **Remove**, expect the row to leave the active list and an accessible **Undo removal** action to appear; click Undo and expect the same item to return.

- [ ] **Step 4: Add Recently removed restore coverage**

Reload with a removed item, expand **Recently removed**, restore it, and assert it is excluded from active count until restoration succeeds.

- [ ] **Step 5: Exclude removed records from local learning**

Update household vocabulary and unit-history cache tests so removed records never become suggestions or confirmed history.

- [ ] **Step 6: Run Angular tests, typecheck, and build green, then commit**

```bash
git add duckworth-web
git commit -m "feat: unify item correction and removal recovery"
```

### Task 8: Stress-test realistic capture combinations in the live application

**Files:**
- Modify tests or implementation only when a newly reproduced failure requires it.
- Add a durable matrix fixture under `packages/shopping-intelligence/src/index.spec.ts` for every discovered grammar regression.

**Interfaces:**
- Verifies the public browser and API behavior produced by Tasks 1–7.

- [ ] **Step 1: Run full automated gates**

From `duckworth-api`:

```bash
pnpm typecheck
pnpm language-packs:test
pnpm test --run
pnpm build
```

From `duckworth-web`:

```bash
pnpm typecheck
pnpm test --watch=false
pnpm build
```

- [ ] **Step 2: Start local API and web servers without contacting a remote**

Verify `/health` and the app URL respond before browser actions.

- [ ] **Step 3: Exercise a human-language matrix**

Use at least these captures plus variations discovered during testing:

```text
1 pack of Amul Butter 500 gms
Amul Butter 1 pack 500 gm
Amul Butter 500 grams 2 packs
2 packets of Britannia 50-50 biscuit 100 g
Britannia 50-50 biscuits 200 gms 1 pkt
Dukes Bourbon 50 g 1 pack
3 bottles of orange juice 1 litre
olive oil 2 bottles 750 ml
2 dozen eggs
rice 5 kg
Formula 1
Vitamin B12 tablets 1 bottle
स्थानीय आटा 2 kg
```

For every submission, verify the preview and saved row independently show the intended item, count/unit, and package size/unit. Use unique names or remove only records created by this verification; never delete existing user data.

- [ ] **Step 4: Turn each discovered failure into red then green**

Before changing logic, add the exact phrase to the public domain matrix with literal expected fields. Rerun focused tests, implement only that grammar or identity distinction, then rerun the live phrase.

- [ ] **Step 5: Verify correction and recovery**

Correct a packaged item's count and package size, reload, remove it, Undo, remove again, reload, and restore it from **Recently removed**.

- [ ] **Step 6: Perform the completion audit**

Map every acceptance criterion in the design to automated output or live-browser evidence. Keep the goal active if any phrase family, adapter parity, edit, removal, or regression requirement lacks direct evidence.
