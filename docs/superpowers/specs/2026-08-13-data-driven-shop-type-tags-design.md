# Data-driven shop-type tags design

## Goal

Let a household add each shopping request exactly once, automatically classify it without mandatory category entry, and reliably show that same canonical item in every eligible shop-focused view.

## Canonical model

An item has one immutable ID and one lifecycle status. Its intrinsic primary category answers what it is; controlled `shop_type` tags answer where it may be bought. Shop filters never materialize copies of an item.

```text
active total = DISTINCT active item IDs
shop total   = DISTINCT active item IDs having the selected effective shop tag
```

Tag facet totals must never be summed. A multi-shop item is intentionally included in more than one facet but counts once in the all-items total and is purchased once.

## Classification

The validated active semantic runtime supplies category, shop-type, product, concept, scoped-brand rules, confidence policy, defaults, labels, hint templates, and examples. Production TypeScript contains algorithms, structural names, validation, and message codes only; it contains no domain IDs, shop/category labels, brand/product data, quantity/unit defaults, examples, or user-facing hint copy.

Inference order is product, then concept plus scoped brand/context evidence, then category policy, then a pack-declared fallback. A brand alone never assigns a shop tag. A low-confidence item remains valid in All without an invented tag.

If quantity and unit are omitted, the runtime's default policy supplies a positive quantity and a generic unit. The saved field records whether each value is explicit, history-derived, catalog-default, or policy-default. No package size is invented.

## User authority

Automatic category and tag findings are retained separately from user decisions. Effective tags equal automatic inclusions less user exclusions plus user inclusions. Clearing a decision returns control to automation. Exclusions are persisted, so a future automatic run cannot silently restore a tag the household removed.

User corrections are anchored to the semantic identity. Editing a name that resolves to a new product/concept retires inappropriate overrides for audit and undo, then recomputes automation. A correction that retains the identity keeps its overrides.

Household custom shop types are household-scoped, normalized, safely displayed, and soft-deactivated when no longer offered. Personal/private tags are not introduced because the application has no reliable member identity model.

## Persistence and APIs

`shopping_items` retains automatic category data and gains an optional category override, derived effective category, classification runtime provenance, and quantity provenance. `item_tag_assignments` stores one unique assignment per item/tag/origin with inclusion/exclusion, evidence, confidence, identity anchor, and runtime versions. `tag_definitions` contains runtime and household-scoped controlled shop types.

Classification edits are a focused optimistic-concurrency patch containing individual tag decisions. The API does not accept a stale replacement array. List responses return unique canonical items plus one selected shop filter and distinct-count facets. SQL uses `EXISTS` or equivalent deduplicated filtering.

Archives and semantic event snapshots include effective classifications and labels needed to preserve historical meaning. Copy creates one fresh canonical item, carries valid explicit decisions, and allows automatic findings to be recomputed by the current runtime. Purchase, restore, archive, copy, and undo act on the one canonical record.

## UI and learning

The add flow asks only for an item name. It shows an accessible, non-blocking, locale-pack-provided hint when a default quantity is applied and an optional details editor for correction. Shop filters are dynamically rendered from returned facets. A selected filter changes the visible unique list without creating duplicate rows.

Hints are contextual, dismissible, rate-limited, and stored as device/context learning receipts rather than user identity. New user overrides affect the current item only; automatic cross-item learning is deferred until it can be governed by repeated, reversible confirmations.

## Safety and release criteria

Runtime packs are fully validated before activation. Existing classifications do not mutate merely because a pack changes; explicit migration/reclassification is idempotent and preserves user authority. Invalid, inactive, foreign-household, duplicate, and unsafe labels are rejected.

Release requires database migration/restart tests, distinct-count properties, conflict and isolation tests, archive/copy/undo tests, runtime pack validation, API/UI/browser tests, accessibility checks, and a static boundary test preventing domain knowledge and hint copy outside approved runtime data.
