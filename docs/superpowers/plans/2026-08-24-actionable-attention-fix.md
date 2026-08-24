# Actionable Attention Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use test-driven development to implement this plan task-by-task.

**Goal:** Make the attention counter and review list contain only user-actionable missing quantity or unit data, while keeping AI category uncertainty non-blocking until a proper category workflow exists.

**Architecture:** Use one shared frontend predicate for actionable unresolved items and align the backend learning metric SQL with the same rule. The existing shop-type classification remains independent. The review panel and row badges will display the exact missing fields instead of a generic category/review message.

**Tech Stack:** Angular, TypeScript, Fastify, SQLite, Vitest.

## Global Constraints

- Do not treat `category_confidence = 'unknown'` as a user task without a category confirmation control.
- Do not make shop-type confirmation mutate item category data.
- Preserve the existing quantity/unit editing and shop-type classification workflows.
- Add regression tests before implementation changes.

---

### Task 1: Lock the actionable unresolved definition in tests

**Files:**
- Modify: `duckworth-web/src/app/core/shopping-item-sort.spec.ts`
- Modify: `duckworth-web/src/app/app.spec.ts`
- Modify: `duckworth-api/test/shopping-items.test.ts`

**Interfaces:**
- Tests observe `sortShoppingItems`, the rendered review panel, and `ShoppingItemRepository.getHouseholdQualityMetrics` through public behavior.

- [x] **Step 1: Write the failing tests**
  - Assert an active item with known quantity/unit but unknown category is not placed in attention mode.
  - Assert the review panel shows only `Quantity missing` and/or `Unit missing` for actionable items.
  - Assert backend metrics do not count a category-only unknown item.

- [x] **Step 2: Run focused tests to verify they fail**

  Run:

  ```powershell
  pnpm test -- --watch=false --include src/app/app.spec.ts --include src/app/core/shopping-item-sort.spec.ts
  pnpm test --filter duckworth-api -- shopping-items.test.ts
  ```

  Expected: the new assertions fail because category uncertainty is currently counted.

### Task 2: Implement the actionable attention behavior

**Files:**
- Modify: `duckworth-web/src/app/core/shopping-item-sort.ts`
- Modify: `duckworth-web/src/app/app.ts`
- Modify: `duckworth-web/src/app/app.html`
- Modify: `duckworth-api/src/shopping-items.ts`

**Interfaces:**
- `isUnresolvedShoppingItem(item)` remains the shared frontend predicate and will return true only for active items with `quantity === null` or `unit === null`.
- `getHouseholdQualityMetrics(householdId)` will count active rows where quantity or unit is null.

- [x] **Step 1: Update the shared predicate and exact reason list**
  - Remove `categoryConfidence` from the actionable predicate.
  - Remove `Category not confirmed` from `unresolvedReasons`.
  - Keep quantity and unit reasons explicit.

- [x] **Step 2: Make the row action match the predicate**
  - Show the attention badge text as the exact missing reason(s).
  - Show `Add details` for any actionable unresolved item, including unit-only cases.
  - Do not show a review badge for category-only uncertainty.

- [x] **Step 3: Align the backend metric**
  - Change the SQL condition from category-or-quantity-or-unit to quantity-or-unit only.
  - Leave shop-type assignments and category confidence untouched.

- [x] **Step 4: Run focused tests to verify they pass**

  Run the focused web and API tests from Task 1. Expected: all pass.

### Task 3: Full verification and handoff

**Files:**
- No new source files.

- [x] **Step 1: Run full tests and type checks**

  ```powershell
  pnpm test
  pnpm typecheck
  pnpm lint
  git diff --check
  ```

- [x] **Step 2: Confirm repository state**

  ```powershell
  git status --short
  ```

  Expected: only the intended implementation and test files are changed before commit.

- [x] **Step 3: Commit the verified fix**

  ```powershell
  git add duckworth-web/src/app duckworth-api/src/shopping-items.ts duckworth-api/test/shopping-items.test.ts docs/superpowers/plans/2026-08-24-actionable-attention-fix.md
  git commit -m "fix: make attention items actionable"
  ```
