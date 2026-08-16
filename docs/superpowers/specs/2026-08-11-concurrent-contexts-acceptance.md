# Phase 2 Concurrent Contexts Acceptance Gate

**Purpose:** Decide whether simultaneous device/speaker contexts are safe to
release.
**Release rule:** Every scenario marked **Required** must have a passing API,
migration, or browser test. A partial foundation is not a release approval.

## Acceptance matrix

| # | Scenario | Expected result | Current status |
|---|---|---|---|
| 1 | Two registered devices capture items at the same time | Both writes reach the shared list; each response uses its own context session. | Foundation exists; dedicated concurrency test required |
| 2 | Two speakers follow up on similarly named items | Each follow-up resolves only against its authorized context and exact shared candidate rules. | Required isolation test |
| 3 | Context A closes while context B remains active | A closes; B remains active; list items are unchanged. | Context routes exist; explicit cross-context test required |
| 4 | Same capture is replayed with the same idempotency key | Original result is returned; no duplicate item or event is created. | Implemented and covered by API replay test |
| 5 | Correction uses an obsolete item version | `409` conflict returns the authoritative item; newer value is never overwritten. | Item version protection exists; context-scoped recovery test required |
| 6 | Context A hands off to a named target | Token expires, is target-bound, can be claimed once, and preserves the context audit trail. | Handoff route and API coverage exist; browser flow required |
| 7 | Context A uses context B’s token or draft | Authorization error; no cross-context state is revealed or changed. | Token denial exists; draft denial test required |
| 8 | Equivalent text/voice/API/assistant captures | Same brain interpretation and persistence decision; source only changes metadata. | Core source-neutral behavior exists; matrix test required |
| 9 | Existing Phase 1 database is opened | Items, brands, pack sizes, sessions, drafts, events, and list ownership survive migration. | Migration coverage exists; final release audit required |

## Required browser walkthrough

1. Open two isolated browser contexts.
2. Register device A and device B in the same household.
3. Add `milk` from A and `bread` from B.
4. Verify both items appear in the shared list.
5. Create an unresolved draft in A.
6. Verify B cannot see, resolve, or dismiss A’s draft.
7. Close A and verify B remains active.
8. Handoff A to a named target and verify one-time claim and expiry.
9. Refresh both contexts and verify each restores only its own session state.

## Explicit non-goals

This gate does not authorize retailer routing, pricing, carts, ordering,
payment, cloud interpretation, medical advice, or vendor-specific Alexa or
Google SDK work.

## Review decision

Approve Phase 2 release only after all required scenarios are green. Until then,
the implementation remains a development checkpoint, not a released feature.
