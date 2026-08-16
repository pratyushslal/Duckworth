# Plan 004: Governed Household Learning

## Problem

Every successful item currently becomes household and personal spelling evidence, although a successful database write is not confirmation of correctness. The literal profile `local-device` is shared by a browser origin, personal records are not lane/household scoped, and accepting an existing household suggestion does not actually affect future resolution.

## Decision

Learning is a proposal ledger with evidence and lifecycle, not a mutable dictionary. Raw captures remain audit data. Only eligible, reviewed, reversible entries may influence future low-confidence resolution; they never override explicit current input or reviewed unambiguous catalog identity.

## Ledger model

Each proposal records:

- proposal type and semantic delta;
- scope: device, member (when identity exists), or household;
- lane and household;
- supporting and contradicting event IDs;
- runtime versions and identity recipe;
- confidence/support count and last-supported time;
- status: `candidate`, `reviewed`, `active`, `suppressed`, `cleared`, `expired`;
- created/reviewed actor and timestamps;
- reversible activation/clear events.

## Implementation tasks

### Task 1 — Stop poisoning before adding new intelligence

1. RED: a new typo row does not immediately outrank reviewed vocabulary for another family member.
2. Stop projecting every item name/raw capture as “confirmed” assistance.
3. Keep raw input in brain capture audit/history, but require explicit evidence state for spelling recommendations.
4. Quarantine existing local vocabulary records during migration; do not silently promote them.

### Task 2 — Correct local scope and privacy controls

1. Key browser records by verified lane/instance + household + device/profile + locale.
2. Until member accounts exist, label these preferences “This device”, not “Personal”.
3. Give users view, disable, clear, and export controls; show persistence failure.
4. Bound text length, record count, and retention. Never sync raw observations without explicit consent.

### Task 3 — Typed proposal generation

Generate proposals only from evidence-bearing events such as:

- explicit suggestion/correction acceptance;
- explicit edit followed by retained use;
- repeated, non-contradicted high-confidence catalog resolution;
- user keep-separate/dismiss actions;
- undo/removal/contradiction as negative evidence.

Thresholds, decay, and ambiguity margins come from runtime policy. No product-specific learning rule belongs in code.

### Task 4 — Make review actions real and reversible

1. Acceptance transactionally creates/activates the scoped learning entry and marks the proposal applied.
2. Dismiss hides that proposal without suppressing unrelated alternatives.
3. Keep-separate creates an explicit suppression pair.
4. Clear deactivates future influence but preserves the historical event trail.
5. Restore creates a new reversal event; it never rewrites prior evidence.

Add before/after/clear/restore tests proving behavior changes only for future eligible captures.

### Task 5 — Family-facing governance UI

Provide a small “Duckworth learned” surface showing plain-language suggestions, evidence summary, scope, and actions. Keep prompts non-blocking and sparse. Do not ask users to tag or categorize ordinary entries; auto-resolution remains default and governance appears only when useful or ambiguous.

### Task 6 — Ranking integration and conflict policy

- Active reviewed device/household entries contribute bounded ranking features.
- Reviewed exact catalog identity remains authoritative over a fuzzy learned string.
- Contradictory active proposals create a clarification, not arbitrary precedence.
- Catalog upgrades re-evaluate proposals without mutating their original evidence.
- Explicit input and user-selected current candidate always win for the current capture.

## Acceptance criteria

- A one-off typo cannot poison family suggestions.
- An accepted correction affects future eligible captures and can be cleared/restored.
- Sandbox evidence never appears in live, including browser-local assistance.
- Shared-browser data is described honestly as device-scoped.
- Raw pharmacy/grocery observations have visible retention and deletion controls.
- Every behavior-changing learning decision is explainable by event IDs and reversible.

