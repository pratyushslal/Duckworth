# Shopping Brain Plan Loophole Audit

**Status:** Proposed for user review

**Reviewed on:** 2026-08-12

## Conclusion

The earlier eight-task proposal had the correct direction, but it was not yet
sufficient to call the brain complete. Its largest weakness was treating
category vocabulary as the main hardcoding problem while leaving other
changeable knowledge in TypeScript: English separators and command words,
number words, unit aliases and roles, category identifiers, attribute names,
country/locale defaults, and phrase-specific regular expressions.

Duckworth cannot safely promise that every possible utterance will be fully
understood. It can provide a universal processing contract: accept any Unicode
item wording, use validated data packs for supported language/domain knowledge,
save clear facts, retain raw evidence, and draft anything that cannot be
resolved without guessing. New locales, categories, units, brands, attributes,
and products must be addable through data or learned overlays without changing
brain algorithms.

## Loopholes found

| Area | Loophole in the earlier plan | Required correction |
| --- | --- | --- |
| Brain contract | No source spans, alternatives, evidence, warnings, provenance, pack version, or engine version | Add a versioned input envelope and a replayable semantic result |
| “No hardcoding” | Only category/attribute vocabularies were proposed as data | Move language, units, grammar templates, category/attribute definitions, aliases, display labels, and confidence weights to validated packs |
| Extensibility | Categories and units are closed TypeScript unions | Use stable string identifiers resolved through registries; code validates capabilities, not product names |
| Grammar | English `and`, `of`, command prefixes, number words, and phrase families remain embedded in regexes | Compile bounded declarative grammar templates from the active locale pack |
| Units | Canonicalization does not model dimension, role, conversion, or meaningful display scale | Separate requested container count from package measure and store both original and normalized comparison values |
| Attributes | `Record<string, string | number>` has no definitions, types, cardinality, or compatibility | Define data-driven attribute schemas and preserve unknown wording rather than inventing fields |
| Confidence | `confirmed/inferred/unknown` has no evidence rules or clarification threshold | Return evidence, alternatives, warnings, and deterministic decision reasons; thresholds come from versioned policy data |
| Brands | Brand hints are supplied, but ambiguity, alias collisions, provenance, and household learning are not fully specified | Resolve brand candidates with IDs, scope, evidence, and explicit confirmation rules |
| Duplicates | “Same item” is not enough for products with brand, model, size, colour, form, or package variants | Separate concept identity, variant identity, and request adjustment; never auto-merge an uncertain variant |
| Merge/undo | Quantity merges can omit newly learned semantic fields, and undo may restore only the number | Persist before/after semantic snapshots and make the entire accepted change compensatable |
| Follow-ups | One exact name suffix is insufficient for pronouns, later quantities, multiple items, and competing contexts | Resolve references from scoped discourse entities; ambiguous matches become drafts with candidates |
| Partial success | “Save clear clauses” lacks an explicit transaction/event model | Persist the capture, accepted operations, drafts, and idempotency receipt atomically |
| Learning | Confirmed-event learning can still learn corrections, removals, or temporary mistakes incorrectly | Add eligibility, support counts, decay, suppression, provenance, review, and reversible clearing |
| Persistence | Category/attributes are stored, but semantic provenance and historical interpretation are not replayable | Store raw input, source spans, semantic snapshot, engine/pack versions, and event payload schema version |
| Input parity | Comparing a `source` label does not prove real adapters behave equivalently | Add adapter contract tests for normalization, locale/context propagation, idempotency, and alternative transcripts |
| Output parity | UI/API/assistant outputs could reinterpret fields or invent prose facts | Return channel-neutral facts and require output adapters to render without parsing raw text |
| Locale routing | Several production paths still default directly to `en-IN` and `IN` | Resolve household/device locale and country at the API boundary, record the resolved pack chain, and reject invalid combinations safely |
| Pack updates | Schema validation alone does not cover incompatible or corrupt updates | Add checksum, compatibility, atomic activation, last-known-good rollback, and migration tests |
| Quality gates | Example fixtures alone can overfit the implementation | Add metamorphic, property, fuzz, replay, migration, performance, and negative cross-context tests |
| Safety | Input length, Unicode normalization, unsafe regex construction, and malformed packs are unspecified | Add bounded parsing, safe compiled templates, resource limits, and fail-closed pack validation |
| Universal fallback | Unsupported language/category behavior is undefined | Always retain a valid generic item or clarification draft; never discard or fabricate structured data |

## Hardcoding boundary

The following may remain in code because they are stable system policy rather
than changeable shopping data:

- decision kinds such as `accept`, `draft`, and `reject`;
- lifecycle and transaction invariants;
- maximum resource limits and validation safety checks;
- the algorithms that tokenize, match, score, resolve, persist, and replay;
- schema-version compatibility rules.

The following must not remain in brain code:

- product, brand, category, unit, colour, material, dosage-form, or model words;
- locale-specific number words, separators, command prefixes, or connectors;
- country-specific default units or display labels;
- category-specific field relevance and duplicate/variant policies;
- confidence weights or clarification thresholds that need tuning.

## Recommended architecture

Use a deterministic engine supplied with an immutable `SemanticRuntime` built
from validated core, locale, country, regional-product, and household-learning
layers. The engine has no default shopping vocabulary. If a layer is missing or
ambiguous, it produces a generic interpretation or clarification draft with
raw spans intact. The API remains authoritative; clients may run the same
runtime for previews, but only the server commits events.

## Approaches considered

1. **Validated data-driven engine (recommended).** Predictable and fast for
   supported packs, locally testable, safely extensible, and able to degrade to
   drafts. It requires a disciplined pack schema and evaluation corpus.
2. **Continue adding code-level phrase rules.** Smaller initial edits, but every
   locale, unit, category, and product family creates new divergent branches.
   This does not meet the no-hardcoded-domain-data requirement.
3. **Send every capture to a general cloud model.** Broad language coverage,
   but slower, non-deterministic, privacy-sensitive, network-dependent, and
   inconsistent with the approved local-first design. A future consented cloud
   fallback may propose candidates, but it cannot become the authority.

The detailed work is in the
[Data-driven Shopping Brain Completion Implementation Plan](../plans/2026-08-12-data-driven-shopping-brain-completion-plan.md).

## Input and output closure matrix

| Boundary | Required behavior | Plan coverage |
| --- | --- | --- |
| Typed text | Preserve exact Unicode text and spans; interpret through active runtime | Tasks 1–5 |
| Voice transcript | Treat transcript as text plus provenance; retain optional alternatives | Tasks 1 and 10 |
| External API | Require the same envelope, locale, context, and idempotency semantics | Tasks 1, 7, and 10 |
| Assistant adapter | Submit the same envelope and receive the same facts | Task 10 |
| Multi-item capture | Account for every meaningful source span; save clear facts and draft the remainder | Tasks 3–5 and 12 |
| Follow-up/correction | Resolve only inside the explicit context/list and only with sufficient evidence | Tasks 5, 6, and 11 |
| Unsupported locale/data | Use declared fallback or return generic item/draft without fabrication | Tasks 2, 8, and 12 |
| Duplicate/retry | Distinguish variant similarity from exact merge and enforce idempotency | Tasks 6, 7, and 11 |
| Concurrent devices/speakers | Share only intended list state; isolate references and drafts | Task 11 |
| Brain result | Return versioned operations, evidence, warnings, alternatives, and source spans | Tasks 1 and 4 |
| Database | Atomically store raw capture, result, events, drafts, versions, and undo state | Tasks 6 and 7 |
| Web/mobile/tablet | Render structured facts without parsing raw text | Task 10 |
| Spoken/assistant reply | Compose confirmation from facts and mention unresolved parts only | Task 10 contract; interaction adapter implementation follows brain completion |
| Learning | Produce explainable suggestions only from eligible confirmed history | Task 9 |
| Audit/replay | Reconstruct why a decision was made under the exact runtime version | Tasks 7, 8, and 12 |
