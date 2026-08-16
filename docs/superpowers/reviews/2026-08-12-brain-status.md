# Data-driven shopping brain completion status

## Implemented scope

The approved completion plan is implemented for the bundled `en-IN` locale
and `IN` country runtime. The engine is source-neutral and receives one
versioned capture envelope from text, transcript, API, or assistant adapters.
It returns evidence-bearing creates, merges, corrections, or durable drafts.
Unknown text remains a generic item or draft; it is never fabricated into a
known concept.

Semantic data now lives in validated, checksummed core, locale, and country
packs. A synthetic-pack substitution test proves that new numerals, units,
connectors, concepts, brands, categories, and attributes can be supplied by
data rather than production matcher changes. Runtime activation validates the
complete candidate before an atomic swap and reloads the last-known-good state
after restart. Unsigned external publishers are rejected.

SQLite stores raw v2 envelopes, semantic results, engine/runtime versions,
source spans, committed event IDs, drafts, projections, and full before/after
event snapshots. Idempotent replay survives restart. Pre-v2 rows are recorded
with `legacy-unknown` migration provenance rather than guessed semantics.
Accepted learning has supporting event IDs, requires the country-pack support
threshold, ignores poisoned event kinds, and may be cleared without deleting
history. Active entries are compiled into the household's request runtime;
clearing an entry removes that influence on the next request. Household
runtime settings take precedence over request metadata, while unsupported
locale/country selections fail closed.

The v1 capture routes are compatibility output translators over the v2 brain
facade, not separate parsers. Reviewed pack data governs reference, pronoun,
and correction prefixes. A correction replaces an explicitly supplied value,
while a normal follow-up remains additive and both produce fully reversible
semantic event snapshots.

The v2 endpoint requires context authorization before both execution and
replay. The simultaneous-context gate covers four contexts in one household
plus a separate household, overlapping drafts, concurrent additive
adjustments, isolated reference targeting, deterministic stale-edit conflicts,
handoff token rotation, shared-list visibility, idempotent retry, wrong-token
denial, and cross-household denial. The browser posts facts through a thin
adapter and has no parser, semantic-runtime, entity-resolution, identity, or
reference-resolution import.

## Verification evidence

- 18 semantic pack/schema tests pass.
- 22 evaluation checks pass across 19 named corpus cases covering ordinary,
  branded, unknown, Unicode, numeric-identity, reordered, multi-item,
  follow-up, contradiction, unsupported-locale, adversarial-length,
  duplicate, undo, source-kind, and cross-context behavior. Metamorphic checks
  cover aliases, source kind, whitespace, casing, and harmless punctuation;
  properties cover deterministic serialization, complete source accounting,
  and finite positive measurements.
- The committed local single-item budget is median under 10 ms and p95 under
  50 ms; the local fixture run is below both thresholds.
- 148 shared-package tests and 138 API tests pass, including restart/migration,
  real projection/event/draft persistence, source equivalence, household
  learning, registry rollback, correction, pronoun follow-up, undo, and
  context isolation.
- 15 local-assistance tests and 117 Angular tests pass. Web/API typechecks and
  production builds, regenerated OpenAPI contracts, and the TypeScript-AST
  architecture boundary all pass.
- A local isolated-server smoke check returned `health: ok`, persisted one
  clear item beside one durable draft over real HTTP, and rendered the app in
  installed headless Chrome with the visible `API connected` state.

## Supported and unsupported behavior

Completion means universal extensibility and safe fallback, not guaranteed
understanding of every language or shopping domain. The bundled reviewed
runtime is `en-IN`/`IN`; another locale/country must be supplied as a valid
activated pack before it can receive reviewed semantic recognition. Unknown
vocabulary inside an active runtime remains usable as generic text or a
clarification draft.

Cloud interpretation remains an unimplemented optional port. Retailer
routing, pricing, carts, ordering, payment, medical advice, and online Git
operations remain out of scope. The v1 endpoints remain a named local
compatibility adapter; new input adapters use the v2 brain contract.
