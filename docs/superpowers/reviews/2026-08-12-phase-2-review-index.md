# Phase 2 Review Pack

This is the starting point for reviewing the concurrent device/speaker work.

Before reviewing Phase 2, read the [brain-first checkpoint](2026-08-12-brain-status.md)
for the semantic boundary and durable-storage decision.

## Read in this order

1. [Design: what Phase 2 means](../specs/2026-08-11-concurrent-contexts-design.md)
2. [Acceptance gate: what must pass](../specs/2026-08-11-concurrent-contexts-acceptance.md)
3. [Implementation plan: how it will be delivered](../plans/2026-08-11-phase-2-concurrent-contexts-implementation-plan.md)

## Decision requested

Please confirm:

- Multiple devices/speakers share one household shopping list.
- Their sessions, drafts, and follow-up references remain isolated.
- Phase 2 is not released until the acceptance matrix is green.

## Current position

The repository already contains the context contract, registration and token
boundary, handoff foundation, scoped list/session ownership, automatic browser
restoration, idempotency receipts, and migration support. The remaining work is
primarily proof and release hardening: two-browser tests, context-isolated draft
and conflict tests, adapter-equivalence tests, and the final web presentation.

No retailer, ordering, payment, pricing, cloud interpretation, medical advice,
or vendor SDK work is included.
