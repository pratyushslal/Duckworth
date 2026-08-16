# Plan 003: Structured Capture Assistance

## Problem

Current suggestions are whole strings. Accepting one replaces the complete draft, source buckets outrank global match quality, identical display labels erase alternate identities, and fuzzy matching compares entire strings. This can erase typed quantities, prefer a learned typo over an exact catalog match, and fail on `maggie noo`.

## Intended outcome

Fast, local, token-aware assistance that preserves all typed structure, carries semantic identity, remains advisory, and is deterministically revalidated by the server.

## Suggestion contract

Introduce a versioned `SemanticSuggestion`:

- `suggestionId` and runtime/catalog versions;
- display label and source/trust class;
- match features and confidence/evidence;
- semantic candidate IDs: concept, brand, product family/variant, descriptor values;
- a bounded replacement edit `{start, end, replacementText}` rather than a full draft overwrite;
- preserved suffix/prefix assertions for quantity, unit, and package spans;
- ambiguity group ID when the same text maps to different identities;
- opaque acceptance reference suitable for server validation.

The server treats all client fields as untrusted hints and resolves the acceptance reference against the active household runtime.

## Implementation tasks

### Task 1 — Lock safety behavior before ranking changes

RED tests must prove:

- accepting `Maggi noodles` within `maggie noo 2 packs of 70 g` changes only the item span;
- every numeric token and recognized unit/package span survives acceptance byte-for-byte unless that exact span is the selected correction;
- identical labels with different identities are not silently deduplicated;
- exact reviewed catalog/product matches beat fuzzy unconfirmed history;
- unknown input remains submittable;
- no network request occurs per keystroke;
- IME composition does not accept or submit a suggestion.

### Task 2 — Token/range-aware candidate generation

1. Segment completed tokens, active token, numeric/unit spans, punctuation, and protected structured spans.
2. Require strong coverage of completed item tokens; use prefix matching for the active token.
3. Apply conservative locale-specific fuzzy/transliteration rules only to eligible item tokens.
4. Gate phonetic rules by reviewed locale metadata; do not use one universal sound-alike algorithm.
5. Produce a replacement edit for the misspelled/item span, never a whole-input string unless the suggestion is explicitly labelled full-capture history.

### Task 3 — Global ranking and ambiguity

Generate candidates from all sources, then globally rank with a deterministic score tuple:

1. semantic eligibility and protected-span preservation;
2. match class/token coverage;
3. reviewed identity confidence;
4. locale/script fit;
5. explicitly confirmed personal/device redirect;
6. governed household evidence and recency;
7. stable semantic ID and display tie-breakers.

Source trust is a feature, not the first bucket. Deduplicate by semantic identity plus normalized display. Same-label/different-identity candidates remain grouped and show distinguishing metadata.

### Task 4 — Bounded search index

Compile normalized immutable records once per source revision. Build prefix/token maps and a bounded fuzzy candidate index, preferably in a Web Worker when the target catalog size justifies it. Apply length and token gates before a banded/early-exit edit distance. Cap candidates before final scoring.

Set device-class budgets from measured data; initial release gates should include p95 keystroke response, index build time, and memory at representative small/medium/large packs.

### Task 5 — Accessible preview and acceptance

1. Render why a suggestion is offered and the resulting compact semantic preview.
2. Preserve keyboard behavior, add `compositionstart/end` guards, and retain the five-result cap.
3. Acceptance applies the replacement edit and stores the opaque structured reference separately from text.
4. Any subsequent edit outside the asserted candidate span invalidates or recomputes the reference.
5. Screen-reader output distinguishes correction, completion, history, and ambiguity without relying on color.

### Task 6 — Server validation and commit

1. Extend the brain capture envelope with optional accepted-candidate evidence.
2. Revalidate runtime version, identity, replacement range, original raw text, and protected spans.
3. If stale or ambiguous, return a non-destructive preview/draft; never silently fall back to a different product.
4. Persist raw input, applied edit, candidate provenance, engine/runtime versions, and final interpretation.
5. Keep offline capture valid: when validation is unavailable, commit as unresolved free text or queue a clearly marked deferred validation; do not pretend client identity is authoritative.

## Evaluation corpus

Use data fixtures, not application hardcoding. Cover typo/prefix pairs, negative near-neighbours, numeric brands, mixed scripts, brand collisions, low-fat/whole variants, quantity/package preservation, adversarial learned typos, stale catalog tokens, IME, and latency. Include `maggie noo -> Maggi noodles` only as a catalog fixture demonstrating the general mechanism.

## Acceptance criteria

- The desired spelling/product appears quickly when justified by reviewed catalog or governed evidence.
- Acceptance cannot erase or invent quantities/packages.
- Exact canonical candidates normally outrank fuzzy learned history.
- Ambiguous same-label identities remain choices rather than being dropped.
- Client tampering or stale runtime references cannot become database truth.
- Typing remains local-first and within measured performance budgets.

