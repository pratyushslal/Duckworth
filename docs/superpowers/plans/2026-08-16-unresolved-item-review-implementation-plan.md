# Unresolved Item Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status:** Implemented and browser-verified in the current release line.

**Goal:** Make the household learning panel explain and open the exact active shopping items counted as unresolved, with a direct path to review each item.

**Architecture:** Reuse the already-loaded authoritative shopping items in the Angular app rather than adding a new API endpoint. The frontend derives the same unresolved conditions used by the API metric—missing quantity or missing unit—then renders an expandable review list. Category uncertainty remains non-blocking until a dedicated category confirmation workflow exists. Existing row detail editing remains the resolution mechanism, and the learning metric refreshes after item changes.

**Tech Stack:** Angular 20, TypeScript, Vitest, Angular HTTP testing utilities, existing Duckworth shopping-item API.

## Global Constraints

- Keep the server-side metric and frontend predicate aligned: active items with missing quantity or unit are unresolved.
- Do not modify family-live data during tests.
- Keep household learning rules, correction history, and unresolved item review visibly separate.
- Preserve the existing row-level edit, save, validation, optimistic-concurrency, and error behavior.
- Add user-visible labels for each unresolved reason; do not expose database field names.

---

### Task 1: Add the failing component acceptance test

**Files:**
- Modify: `duckworth-web/src/app/app.spec.ts`

**Interfaces:**
- Consumes: the existing `App` component, HTTP test controller, and shopping-item fixture shape.
- Produces: a user-facing regression test for opening the unresolved review list and identifying each missing detail.

- [x] **Step 1: Add a test fixture with unresolved conditions**

Create a test with one active item whose `categoryConfidence` is `unknown`, `quantity` is `null`, and `unit` is `null`, plus one complete active item. Flush the learning-control response with `unresolvedCount: 1` and no learned entries or corrections.

- [x] **Step 2: Run the focused test and verify it fails**

Run: `pnpm --dir duckworth-web test -- --run src/app/app.spec.ts`

Expected: FAIL because the learning metrics do not expose an unresolved-review control or item explanation.

- [x] **Step 3: Define the observable assertions**

Assert that the user can click the unresolved metric, sees the unresolved item name, sees plain-language reasons such as `Quantity missing`, `Unit missing`, and `Category not confirmed`, and sees a `Review item` action for that item.

### Task 2: Implement the unresolved review panel

**Files:**
- Modify: `duckworth-web/src/app/app.ts`
- Modify: `duckworth-web/src/app/app.html`
- Modify: `duckworth-web/src/app/app.scss`

**Interfaces:**
- Consumes: `items()` and `learningMetrics()` already loaded by `loadItems()` and `loadLearning()`.
- Produces: `unresolvedItems()`, `unresolvedReviewOpen()`, `toggleUnresolvedReview()`, and plain-language reason formatting used by the template.

- [x] **Step 1: Add unresolved-item derivation**

Add a computed view that includes only active items with `categoryConfidence === 'unknown'`, `quantity === null`, or `unit === null`. Derive stable user-facing reason labels from those conditions.

- [x] **Step 2: Make the metric actionable**

Render the unresolved count as a button when the count is greater than zero. Give it an accessible expanded state and toggle the review panel without changing the existing learned-preferences button.

- [x] **Step 3: Render the review list**

Render each unresolved item with its name, one or more reason labels, and a `Review item` button that calls the existing `beginDetails(item)` method. Render a clear empty state if the server count is non-zero but the currently loaded list has not yet exposed matching rows.

- [x] **Step 4: Add focused styling**

Add styles for the metric button, review panel, reason labels, and item action using the existing Duckworth visual language. Keep the panel readable on narrow screens and preserve keyboard focus visibility.

- [x] **Step 5: Run the focused test and verify it passes**

Run: `pnpm --dir duckworth-web test -- --run src/app/app.spec.ts`

Expected: the new unresolved-review test and all existing `app.spec.ts` tests pass.

### Task 3: Refresh the count after resolution and run the full gate

**Files:**
- Modify: `duckworth-web/src/app/app.ts`
- Modify: `duckworth-web/src/app/app.spec.ts`

**Interfaces:**
- Consumes: successful row updates from `saveDetails()`, semantic correction saves, item removal/status changes, and the existing `loadLearning()` request.
- Produces: a learning metric that reflects the current item state after a user resolves or removes an unresolved item.

- [x] **Step 1: Add the count-refresh assertion**

Extend the component test so the user reviews an unresolved item, saves complete quantity and unit details, and then the app requests refreshed learning metrics and renders the updated unresolved count.

- [x] **Step 2: Implement refresh after successful item changes**

Call `loadLearning()` after successful detail/correction updates and active-item lifecycle changes that can alter unresolved status. Do not call it on failed requests.

- [x] **Step 3: Run the full web test suite**

Run: `pnpm --dir duckworth-web test -- --run`

Expected: all web tests pass with no regressions.

- [x] **Step 4: Run type checking; no web lint script is configured**

Run: `pnpm --dir duckworth-web typecheck` and `pnpm --dir duckworth-web lint`

Expected: both commands pass.

- [x] **Step 5: Verify the disposable browser flow**

Use the existing disposable lane/browser acceptance workflow to confirm: open learned panel → click unresolved count → see exact item/reasons → open item review → save details → count refreshes. Do not perform mutation tests against family-live.

- Evidence: `duckworth-web/e2e/unresolved_review_check.py` passed in a fresh `api-test` lane after rebuilding the current web bundle. The test confirms the exact missing-field labels, review navigation, successful detail save, and the count changing to `0 unresolved`.

- [x] **Step 6: Commit the verified slice**

```powershell
git add duckworth-web/src/app/app.ts duckworth-web/src/app/app.html duckworth-web/src/app/app.scss duckworth-web/src/app/app.spec.ts docs/superpowers/plans/2026-08-16-unresolved-item-review-implementation-plan.md
git commit -m "feat: make unresolved items reviewable"
```

The review workflow was committed in `9c63a52`, navigation was hardened in `0fe1d9f`, and the actionable quantity/unit definition was corrected in `2bc70be`.
