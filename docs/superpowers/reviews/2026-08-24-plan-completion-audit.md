# Duckworth plan-completion audit

Date: 2026-08-24

This audit is the current source of truth for deciding whether an old checklist
still represents unfinished application work. Several historical plan files
predate the implementation and still contain unchecked task boxes; an unchecked
box in one of those files is not, by itself, evidence that the feature is absent.

## Current core release

| Area | Result | Evidence |
|---|---|---|
| Shopping list, structured capture, lifecycle, and concurrency protection | Complete | Existing API/web suites, browser foundation/lifecycle/concurrency/SSE checks, and release-gate evidence in `docs/superpowers/plans/2026-08-16-phase-2-release-gate-implementation-plan.md` |
| Semantic learning, corrections, provenance, migration, and safe runtime lanes | Complete for the supported local `en-IN`/`IN` boundary | `docs/superpowers/reviews/2026-08-12-brain-status.md` and `docs/release/2026-08-13-semantic-correction-v2.md` |
| Dynamic shop-type classification and filtering | Implemented | `tools/architecture/check-shop-classification-boundary.mjs`, API/web tests, and current release-gate checks |
| Unresolved-item review | Complete | `9c63a52`, `0fe1d9f`, `2bc70be`, component regression tests, and `duckworth-web/e2e/unresolved_review_check.py` |
| Package-size display deduplication | Implemented in the current source line | `App.semanticDetails()` and current web regression coverage |

## Deliberately deferred work

These are not missing bugs in the current core release:

- Camera/gallery photo capture is explicitly planned for a later release in
  `docs/TODO.md` and remains unimplemented.
- Household membership, invitations, multiple household access, and owner
  member management are explicitly parked by the product decision recorded in
  `docs/TODO.md` and `f0f221d`.
- Retailer routing, pricing, ordering, payment, cloud interpretation, medical
  advice, and vendor voice SDK integrations remain outside the approved scope.

## Checklist hygiene

The older implementation plans are historical execution records, not a second
source of requirements. Their unchecked boxes should not be offered as current
work when the corresponding feature is already present and covered by the
release evidence above. New work should start from a dated plan and cite the
tests and commit that prove completion.

## Remaining human action

The engineering work is complete for the current core scope. The remaining
release action is human acceptance on the authenticated family device: open the
current family URL, confirm the existing list is visible, and perform the
read-only visual smoke check in the release runbook. This is an acceptance step,
not an unimplemented code task.
