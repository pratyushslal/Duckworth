# Plan 002: Commercial Identity and Descriptor Semantics

## Problem

The current model has a concept, one brand ID, one product ID, and generic attributes. It cannot truthfully represent `noodles` as the item concept, `Maggi noodles` as a product family, `Maggi` as the consumer brand, and Nestle entities in owner/manufacturer/marketer roles. It also cannot distinguish `low-fat` (identity-bearing) from `big` in `big pack` (packaging qualifier) or an unknown descriptive phrase.

## Model decision

Use explicit roles rather than a single “manufacturer brand” field:

- `Concept`: what the thing is, e.g. noodles or milk.
- `Brand`: consumer-facing brand, optionally hierarchical.
- `ProductFamily`: marketed family under a brand.
- `ProductVariant`: optional catalog-resolved variant/SKU-level identity.
- `Organization`: legal/commercial entity.
- `CommercialRole`: owner, manufacturer, marketer, licensee, etc., scoped by country and effective dates.
- `DescriptorMention`: a source span classified as `identity_attribute`, `preference`, `packaging_qualifier`, `display_only`, or `unknown`.

Canonical capitalization comes from locale labels (`Maggi`, `Nestle`, `iPhone`, `50-50`), never a title-case algorithm. Unknown free text keeps the user's spelling except safe whitespace normalization.

## Processing contract

1. Parser emits scalar fields plus all captured spans, including container and qualifier mentions.
2. Resolver produces candidates for concept, brand, product family/variant, organization roles, and descriptors.
3. Runtime policy classifies descriptor roles by concept/category applicability and evidence.
4. Identity recipe determines which resolved fields participate in merge identity.
5. Unresolved meaningful spans remain in display text and become warnings/drafts; they are never dropped.
6. Persistence stores stable IDs, semantic snapshot version, evidence/runtime versions, and optional denormalized labels only as display caches.

## Implementation tasks

### Task 1 — Characterization and defect containment

1. RED/GREEN focused fix: preserve `productId` through semantic merge, correction, and undo.
2. Build a product-data-free evaluation fixture format, with test fixtures supplied through catalogs rather than TypeScript conditionals.
3. Add cases for Maggi/Maggie noodles, low-fat/whole milk, big/family pack, unknown adjectives, multiple products under one brand/concept, numeric brand names, capitalization, correction, undo, catalog upgrades, and negative near-neighbours.

### Task 2 — Strict catalog schema and referential validation

**Files:** semantic catalog JSON Schemas, pack builder, semantic runtime compiler.

Add typed definitions and checks for:

- unique IDs and foreign keys;
- brand parent cycles;
- locale label/alias completeness and collisions;
- product-to-concept/brand relations;
- commercial role type, country, and effective-date validity;
- attribute value IDs, aliases, concept/category applicability, cardinality, and identity participation;
- versioned identity recipes;
- deterministic alias precedence and ambiguity reporting.

No pack promotes if validation produces an error. Ambiguous valid aliases remain explicit candidates.

### Task 3 — Versioned semantic contract and upcasters

1. Give `SemanticItem` snapshots their own version rather than relying only on envelope version.
2. Add optional/backward-compatible v3 fields, then pure v2-to-v3 upcasters and strict read validation.
3. Preserve original v2 envelope/result JSON. Store v3 projections separately so historical decisions remain replayable.
4. Run a dry migration that reports unknown fields and prospective identity collisions before any write migration.

### Task 4 — Span-preserving parser contract

Extend parser output with immutable mentions: source start/end, surface text, normalized candidate, syntactic role, and evidence. Preserve `packQualifier` and `packageContainerUnit` presently captured then discarded.

Add the invariant:

> Each non-connector meaningful source span must belong to a committed semantic value, a retained descriptor, a warning, or a clarification draft.

Test reordered grammar, punctuation, Unicode offsets, repeated terms, and correction replay.

### Task 5 — Data-driven descriptor resolution

1. Generate descriptor candidates from reviewed runtime aliases/values and source syntax.
2. Assign roles only where catalog applicability permits.
3. Treat `low-fat` for milk as a canonical identity attribute when the runtime says so.
4. Treat `big` attached to `pack` as packaging language unless a specific product/variant catalog match proves otherwise.
5. Keep unsupported descriptors attached as `unknown`, preserve them in display, and avoid exact merge until required identity participants are resolved.

Do not create an adjective stop list. The same surface word may have a different role by concept and syntax.

### Task 6 — Versioned identity recipe and persistence

Identity includes concept, product family/variant when known, consumer brand, normalized package, and every runtime-declared identity attribute. Each required participant has three states: known, confirmed absent, unresolved.

- Exact merge only when all required participants are resolved and keys match.
- Similar/unresolved items prompt or remain separate; never destructive auto-merge.
- Persist `semantic_variant_key`, recipe version, and snapshot version.
- Replace normalized-display-name uniqueness with semantic identity after a collision-reporting migration.
- Keep quantity/request fields out of product variant identity but in request/event identity.

### Task 7 — API/UI projection

Return structured concept, product family, brand, organization roles, descriptors, evidence/confidence, and canonical display labels. The UI initially presents a compact explanation and edit path; it need not expose ontology jargon. For example: `Maggi noodles` with secondary detail `Noodles - Maggi` and organization provenance only in details.

## Acceptance criteria

- `maggie noodles` can resolve by reviewed alias to canonical `Maggi noodles`, concept `noodles`, brand `Maggi`, and configured organization role(s).
- `low-fat milk` remains distinct from whole/unspecified milk when runtime identity policy says so.
- `1 big pack of 8 pieces` preserves `big` as packaging evidence without changing item identity.
- Unknown adjectives stay visible and do not cause silent merge.
- Merge/correct/undo preserves the full entity graph, including `productId`.
- Old stored captures remain readable after upgrade and original provenance is unchanged.
- No product-specific conditional is introduced into TypeScript.

