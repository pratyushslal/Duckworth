# Responsive Minimal UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move existing application settings out of the shopping screen and establish a compact, responsive visual system for the main list, Settings, and Household Access screens.

**Architecture:** Keep the existing App component and services as the behavioural owner to avoid changing working shopping flows. Add a small page-state/navigation layer inside the app shell, render existing settings controls on the Settings screen, and add a Phase 2 Household Access UI shell without inventing backend behaviour. Use the existing Angular component and SCSS conventions with shared shell tokens and mobile-first layout rules.

**Tech Stack:** Angular 22, standalone components, Angular signals, native HTML controls, component-scoped SCSS, existing Vitest/Angular tests, Playwright browser checks.

## Global Constraints

- The main screen must prioritize capture, attention-needed items, and the active list.
- Settings must be grouped in one separate screen and must not appear above the list.
- Phase 2 Household Access UI must be visually complete but must not pretend that member or invitation APIs exist yet.
- Secondary information is hidden or compact on narrow screens; important warnings and actions remain visible.
- Preserve existing shopping, learning, privacy, language, pairing, and conversation behaviours.
- Keep controls keyboard-operable, labelled, contrast-safe, and usable at 320px width.

---

### Task 1: Add page navigation and compact application shell

**Files:**
- Modify: `duckworth-web/src/app/app.ts`
- Modify: `duckworth-web/src/app/app.html`
- Modify: `duckworth-web/src/app/app.scss`
- Test: `duckworth-web/src/app/app.spec.ts`

**Interfaces:**
- `AppPage = 'list' | 'settings' | 'household-access'`.
- `navigateTo(page: AppPage): void` updates the browser path and visible page without reloading.

- [ ] Add page-state tests for initial `/`, `/settings`, and `/household-access` paths plus navigation state changes.
- [ ] Run the focused app test and confirm the new tests fail before implementation.
- [ ] Add the page signal and `popstate` handling while preserving existing initialization and cleanup.
- [ ] Add a compact header with text navigation on wide screens and labelled compact controls on narrow screens.
- [ ] Wrap the existing shopping list in the list page and move the existing settings panels behind the Settings page state.
- [ ] Add a Household Access navigation entry and an explicit “Phase 2” state in its UI copy; do not call a nonexistent API.
- [ ] Replace the oversized hero copy with a short task-focused heading and compact connection status.
- [ ] Add responsive SCSS for 320px, 360px, and desktop widths, including focus states and no horizontal overflow.
- [ ] Run the focused app tests and confirm they pass.

### Task 2: Build the Phase 1 Settings screen from existing controls

**Files:**
- Modify: `duckworth-web/src/app/app.html`
- Modify: `duckworth-web/src/app/app.scss`
- Modify: `duckworth-web/src/app/household-settings/household-settings.html`
- Modify: `duckworth-web/src/app/language-settings/language-settings.html`
- Test: `duckworth-web/src/app/household-settings/household-settings.spec.ts`
- Test: `duckworth-web/src/app/language-settings/language-settings.spec.ts`

**Interfaces:**
- Existing `LanguageSettings` and `HouseholdSettings` inputs/outputs remain unchanged.
- Existing App methods continue to own personal vocabulary, capture privacy, and learning actions.

- [ ] Add or update template tests for the grouped sections: connection, language, conversation, optional assistance, personal spelling, privacy, and learned preferences.
- [ ] Make each settings group use a heading, one concise explanation, native controls, and one clear action area.
- [ ] Keep pairing visible only when the device needs pairing; show the connected state otherwise.
- [ ] Keep unresolved review details in Settings while leaving only the compact attention summary on the list screen.
- [ ] Add confirmation handling for destructive clear/delete actions without changing their services.
- [ ] Run the focused settings tests and confirm they pass.

### Task 3: Build the Phase 2 Household Access UI shell

**Files:**
- Modify: `duckworth-web/src/app/app.html`
- Modify: `duckworth-web/src/app/app.scss`
- Test: `duckworth-web/src/app/app.spec.ts`

**Interfaces:**
- Presentational Phase 2 sections only: household summary, invitation preview, pending requests, members, and connected devices.
- No new HTTP methods or persistence are introduced in this task.

- [ ] Add a clear Phase 2 label so users cannot mistake the preview UI for working member management.
- [ ] Render the clean access layout with one invite action, request rows, member rows, and owner-only action labels.
- [ ] Ensure the invitation preview communicates expiration and replacement of old codes without generating a real code.
- [ ] Ensure mobile layout stacks rows and keeps actions reachable without horizontal scrolling.
- [ ] Run app tests and confirm the Phase 2 shell does not alter list or settings behaviour.

### Task 4: Verify the complete responsive experience

**Files:**
- Modify: `duckworth-web/e2e/foundation_check.py` only if selectors need stable labels.
- Modify: `duckworth-web/src/app/app.spec.ts` only for missing interaction coverage.

- [ ] Run shared-package builds and Angular type checks.
- [ ] Run the full web unit test suite.
- [ ] Start the sandbox API and web server from the committed startup path.
- [ ] Test desktop and 320px/360px browser widths for list, Settings, and Household Access.
- [ ] Test adding an item, editing details, marking purchased, opening Settings, changing an existing setting, and returning to the list.
- [ ] Verify pairing-required, API-offline, empty-list, attention-needed, saved, loading, and destructive-action states.
- [ ] Check the browser console and network requests for errors or unexpected calls.
- [ ] Run the Impeccable detector once over changed UI files and fix mechanical findings.
- [ ] Run `git diff --check`, inspect the final diff, and commit the completed UI change.
