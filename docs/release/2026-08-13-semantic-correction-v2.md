# Semantic correction and household learning V2 — local release evidence

Date: 2026-08-13  
Lane used for automated browser verification: sandbox only

## Delivered slices

The revised implementation plan in `advisor-plans/006-holistic-semantic-correction-and-learning-v2.md` is implemented through Tasks 1–12. Each slice was test-first, independently verified, and committed locally:

| Task | Commit |
| --- | --- |
| 1. Evaluation matrix | `20b3762` |
| 2. Versioned correction command | `ae17f3a` |
| 3. Transactional correction events | `73193bd` |
| 4. Household-local identities | `a12447a` |
| 5. Package/container semantics | `44e786e` |
| 6. Typed overlay/cache | `b781092` |
| 7. Catalog reconciliation | `1fde42c` |
| 8. Correction UI | `a30db6e` |
| 9. Learning/typeahead safeguards | `ff6a278` |
| 10. Dynamic-knowledge boundary | `3c3d05d` |
| 11. Migration/control surface | `d935b3d` |

Task 12 is this release gate and evidence record.

## Automated verification

API (`duckworth-api`):

- `pnpm language-packs:test` — 20 passed.
- `pnpm typecheck` — passed.
- `pnpm test -- --run` — 23 files, 200 tests passed (final post-hardening rerun).
- Final post-plan hardening rerun: `pnpm test -- --run` — 25 files, 205 tests passed.
- `pnpm build` — passed.
- `pnpm openapi:write` — regenerated `openapi/duckworth-v1.json`.

Web (`duckworth-web`):

- `pnpm assistance:test` — 17 passed.
- `pnpm intelligence:test` — 72 passed.
- `pnpm test -- --watch=false` — 28 files, 131 tests passed.
- `pnpm typecheck` — passed.
- `pnpm architecture:brain` — passed.
- `pnpm architecture:shop-classification` — passed.
- `node ../tools/architecture/check-domain-knowledge-boundary.mjs` — passed from the web workspace (and from repository root).
- `pnpm build` — passed.

Browser smoke:

- Started an isolated sandbox API and Angular server on ports 3001 and 4300.
- Playwright loaded `http://127.0.0.1:4300/`, verified the main heading, API connected state, active-list surface, screenshot output, and zero console errors/warnings.
- Both test servers were stopped after the run; no family-live process or database was used.

## Migration/rollback controls

`dryRunDatabaseImport()` now reports table counts, lane/instance identity, active-item collisions, foreign-key violations, semantic snapshot versions, and quarantined snapshot rows. `backupDatabase()` and `restoreDatabase()` require absolute paths, integrity checks, lane/instance checks, and explicit disposable restore confirmation. The semantic correction transaction records complete before/after snapshots; undo appends a compensating event and suppresses effects rather than rewriting history. Confirmed canonical labels are compiled into the next capture runtime through a scoped, revisioned alias layer; explicit current text still wins.

The offline command is available as `pnpm maintenance:semantic-migration -- --database <absolute-path> [--quarantine <absolute-path>]`; it reports without importing by default and rejects relative or same-source quarantine paths.

## Manual family-live read-only smoke

Run this only from a second device after confirming the live URL and instance identity. Do not create, edit, remove, purchase, or clear learning while performing this check:

1. Open the family-live origin shown by the server configuration.
2. Confirm the page reports `API connected` and the expected live instance.
3. Confirm the existing list loads and tag filters do not change the distinct active total.
4. Open the learned-control panel and verify that entries are explainable and reversible.
5. Do not submit a mutation; close the tab.

## Known limits and rollback

- First-encounter products without reviewed runtime evidence remain addable but may be unresolved until explicitly corrected; no cloud product provider is authoritative in this phase.
- Camera/gallery ingestion remains deferred behind the shared capture-envelope seam.
- The local quality metrics are diagnostic only and are not sent externally.
- To roll back, stop the lane process, preserve the current database, restore the last verified backup into a new disposable path using `restoreDatabase(..., { disposable: true })`, verify integrity/lane/instance, then restart the matching lane. Never point live at a sandbox/test path.
