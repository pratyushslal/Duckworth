# Package Size Display Deduplication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hide duplicate `measure:net_content` text from the live item summary when package size is already visible, while preserving fallback display and stored data.

**Architecture:** Keep the change in the frontend presentation helper `App.semanticDetails()`. The helper will filter only the redundant net-content attribute when both package-size fields are present; API payloads, persistence, edit controls, and other semantic attributes remain unchanged.

**Tech Stack:** Angular 22, TypeScript, Vitest, existing Duckworth frontend test harness.

## Global Constraints

- Keep the package-size representation as the primary visible value.
- Suppress a `measure:net_content` semantic detail when both `packageSize` and `packageUnit` are present.
- Continue showing `measure:net_content` when package size is unavailable.
- Preserve the attribute in the API/database response; this is presentation-only.
- Apply the rule to every shop type and product.
- Do not change parsing, persistence, edit-form fields, ordering, or shop classification.

---

### Task 1: Add regression coverage for semantic-detail deduplication

**Files:**
- Modify: `duckworth-web/src/app/app.spec.ts`

**Interfaces:**
- Consumes: `App.semanticDetails(item)` and the existing Angular TestBed setup.
- Produces: regression tests proving the summary suppresses only redundant net content.

- [ ] **Step 1: Write the failing tests**

Add these tests inside the existing `describe('App', ...)` block:

```ts
it('hides duplicate net content when package size is already displayed', () => {
  const fixture = TestBed.createComponent(App);
  const app = fixture.componentInstance as unknown as {
    semanticDetails: (item: {
      categoryId: string;
      packageSize: number | null;
      packageUnit: string | null;
      attributes: Record<string, unknown>;
    }) => string[];
  };

  expect(app.semanticDetails({
    categoryId: 'grocery',
    packageSize: 1,
    packageUnit: 'l',
    attributes: {
      'measure:net_content': '1 l',
      strength: '40 mg',
    },
  })).toEqual(['40 mg strength']);
});

it('keeps net content when package size is unavailable', () => {
  const fixture = TestBed.createComponent(App);
  const app = fixture.componentInstance as unknown as {
    semanticDetails: (item: {
      categoryId: string;
      packageSize: number | null;
      packageUnit: string | null;
      attributes: Record<string, unknown>;
    }) => string[];
  };

  expect(app.semanticDetails({
    categoryId: 'grocery',
    packageSize: null,
    packageUnit: null,
    attributes: { 'measure:net_content': '1 l' },
  })).toEqual(['1 l net content']);
});
```

The `strength` attribute uses the existing fallback label, so the test verifies that filtering is selective: net content is absent while another semantic detail remains.

- [ ] **Step 2: Run the focused tests and verify the new regression fails**

Run from the live worktree:

```bash
pnpm test -- --run duckworth-web/src/app/app.spec.ts
```

Expected: the new duplicate-net-content test fails because `semanticDetails()` currently returns the `measure:net_content` entry.

### Task 2: Implement the presentation filter

**Files:**
- Modify: `duckworth-web/src/app/app.ts` in `App.semanticDetails()`

**Interfaces:**
- Consumes: `ShoppingItem.packageSize`, `ShoppingItem.packageUnit`, and `ShoppingItem.attributes`.
- Produces: the same `string[]` semantic-detail contract, excluding only redundant net content.

- [ ] **Step 1: Add the minimal filter**

At the start of the `Object.entries(item.attributes ?? {}).flatMap(...)` callback, add:

```ts
if (
  key === 'measure:net_content'
  && item.packageSize !== null
  && typeof item.packageUnit === 'string'
  && item.packageUnit.trim().length > 0
) {
  return [];
}
```

Leave the existing label resolution and all other attribute handling unchanged. This means the API continues returning the attribute and items without a package size still show it.

- [ ] **Step 2: Run the focused tests and verify they pass**

Run:

```bash
pnpm test -- --run duckworth-web/src/app/app.spec.ts
```

Expected: PASS, including the two new tests and the existing summary/edit tests.

### Task 3: Verify the frontend build and live display

**Files:**
- No additional source files.

- [ ] **Step 1: Run typecheck/build validation**

Run from `duckworth-web`:

```bash
pnpm build
```

Expected: the Angular production build completes without TypeScript or template errors.

- [ ] **Step 2: Verify the live 4300 page**

Reload `http://192.168.0.102:4300/` and confirm the Thums Up row reads:

```text
thums up · 1 litre · 5 bottles · Grocery
```

Confirm that the item’s edit form still shows package size and package unit, and that no `net content` text appears when package size is present.

- [ ] **Step 3: Commit the implementation**

```bash
git add duckworth-web/src/app/app.ts duckworth-web/src/app/app.spec.ts
git commit -m "fix: hide duplicate net content display"
```
