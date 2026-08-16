# Source-Agnostic Shopping Intelligence and Item Correction Design

**Status:** Approved through the user's instruction to test and correct the application until natural-language item capture is reliable.

**Date:** 2026-08-06

## Goal

Make Duckworth reliably interpret realistic household shopping requests regardless of whether the request originated as typed text, a voice transcript, or an API command. The same input must produce the same item identity, requested count, container unit, package size, and package measure through every channel.

This design also gives users one coherent way to correct an item and a recoverable way to remove an accidental item. It preserves the approved boundaries: shopping-list capture only, no retailer routing, ordering integration, price safety, currency, or online lookup.

## Confirmed Public Test Seams

TDD exercises behavior only through these public boundaries:

1. The source-neutral shopping-intelligence API used by all adapters.
2. The reviewed local-assistance suggestion API.
3. Fastify's public HTTP create, update, remove, restore, and list routes.
4. Angular's rendered capture, edit, remove, undo, and restore interactions.
5. A live browser connected to the local API.

Tests do not target private parser helpers, SQLite implementation details, or Angular internals.

## Observed Failures and Root Causes

### Leading container phrases stop too early

`1 pack of Amul Butter 500 gms` currently matches the generic leading `quantity + unit + remainder` branch. The parser returns `of Amul Butter 500 gms` as the item name and never evaluates the package-size grammar. Parser precedence and the missing connector grammar are the cause.

### Numeric product identities are mistaken for shopping quantities

Local assistance applies quantity preservation to every number in an item label. The two `50` tokens in `Britannia 50-50` are product identity, not shopping quantities, but they suppress prefix suggestions while the user types the variant. Whole-string matching also rejects the reviewed product after a legitimate generic suffix such as `biscuit` is entered.

### Corrections can create contradictory representations

The UI exposes name editing and quantity/unit editing as separate operations. The API patches those columns independently and leaves `captureText` unchanged. The live Britannia record consequently has initial capture `Britannia 50-50 biscuit`, current name `Britannia 50-50 biscuit 1 pack`, and structured count `1 pack`. Duplicate checking reparses old capture text, so it can disagree with the current name.

### Complete items cannot edit their structured details

The details editor is exposed only for missing quantity or an unconfirmed historical unit. The ordinary **Edit** action changes only the name. Package size and package measure have no update contract.

### Accidental items have no removal lifecycle

The only lifecycle action is **Purchased**. Using it for a mistake would pollute purchase history and household learning. Permanent deletion would be too easy to trigger accidentally and would prevent recovery.

## Approaches Considered

### Add phrase-specific parser and UI patches

This would address the three reported examples quickly, but interpretation and correction policy would remain distributed. New input channels and new word orders would repeat the same failures.

### Add a source-neutral domain facade over the existing pure packages

This is selected. The existing dependency-free parser and assistance implementations remain useful internal components. A shared shopping-intelligence boundary owns interpretation, correction reconciliation, semantic identity, and lifecycle decisions. Angular and Fastify become adapters rather than policy owners.

### Rewrite the application around a full domain aggregate

A comprehensive rewrite could impose the boundary cleanly, but it would broaden migration risk and delay the requested capture reliability. The focused facade removes the active risks without unrelated restructuring.

## Architecture

### Input adapters

Text, voice, and API adapters reduce their input to the same command:

```ts
export interface CaptureCommand {
  text: string;
  locale: string;
  countryCode: string;
  acceptedProductId?: string;
  source?: 'text' | 'voice' | 'api';
}
```

`source` is diagnostic metadata only. It cannot alter interpretation. Speech recognition remains outside the brain; the transcript enters through `text`.

### Shopping-intelligence boundary

The shared domain returns one validated interpretation:

```ts
export interface ItemIntent {
  captureText: string;
  itemName: string;
  identityKey: string;
  quantity: number | null;
  unit: CanonicalUnit | null;
  packageSize: number | null;
  packageUnit: CanonicalUnit | null;
}
```

Its public operations are:

- `interpretItem(command)` for new captures and previews.
- `reconcileItemCorrection(command)` for atomic corrections.
- `itemIdentity(intent)` for duplicate comparison and household learning.
- `transitionItem(item, action)` for `purchase`, `reopen`, `remove`, and `restore` policy.

Regional products are supplied as validated data. Network, Angular, Fastify, SQLite, browser storage, microphones, and retailer concepts are forbidden dependencies.

The client runs the pure boundary for immediate preview. The API runs the same boundary authoritatively before persistence.

### Conservative natural-language grammar

The brain recognizes these unambiguous families:

- `item + count + container + package size + measure`
- `item + package size + measure + count + container`
- `count + container + of + item + package size + measure`
- Existing single-measure leading and trailing forms.

Connector parsing is deliberately narrow. `of` is removed only between a recognized count/container pair and a non-empty item phrase. Ambiguous phrases remain free text rather than being guessed.

Examples that must converge:

| Capture | Item | Count | Container | Package size | Measure |
| --- | --- | ---: | --- | ---: | --- |
| `Amul Butter 1 pack 500 gm` | Amul Butter | 1 | pack | 500 | g |
| `Amul Butter 500 gms 1 pac` | Amul Butter | 1 | pack | 500 | g |
| `1 pack of Amul Butter 500 gms` | Amul Butter | 1 | pack | 500 | g |
| `Dukes Bourbon 50 g 1 pack` | Dukes Bourbon | 1 | pack | 50 | g |
| `2 bottles of orange juice 1 litre` | orange juice | 2 | bottle | 1 | l |
| `rice 5 kg` | rice | 5 | kg | — | — |
| `2 dozen eggs` | eggs | 2 | dozen | — | — |
| `Formula 1` | Formula 1 | — | — | — | — |

Aliases are canonicalized only for structured values. Unknown item text remains valid and retains its casing.

### Identity-aware local assistance

Assistance separates product-identity numbers from structural shopping numbers. Completing `Britannia 5` to `Britannia 50-50` is allowed because `50-50` belongs to a reviewed product identity. Assistance must never invent a count or package size outside the accepted product span.

Reviewed aliases include natural category wording such as `Britannia 50-50 biscuit` and `Britannia 50-50 biscuits`. Exact accepted aliases retain the user's capture text while attaching reviewed product identity. Prefix acceptance replaces only the product span and preserves surrounding counts and measurements.

The five-result limit, local-only lookup, deterministic order, explicit acceptance, and separate personal/household/regional/locale provenance remain unchanged.

### Atomic correction

One **Edit item** interaction replaces separate rename and details actions. It exposes:

- Item name.
- Number wanted.
- Container/unit.
- Package size.
- Package measure.

The form opens for every active or purchased item. A visible summary previews the exact result before save.

Correction reconciliation handles duplicated measurement text conservatively. When a recognized terminal pair in the name exactly equals the structured quantity and unit, the pair is removed from the name. When the text and structured fields conflict, Duckworth does not guess; the row shows a resolvable validation message.

The API saves the current capture representation and every structured field atomically under the existing expected-version check. The initial capture remains immutable for traceability. Duplicate checks use the current authoritative `identityKey`, never stale raw text.

### Recoverable removal

`removed` is a lifecycle state distinct from `purchased`.

- **Remove** performs one soft-removal action without a confirmation modal.
- The success message includes an immediate **Undo** action.
- A compact **Recently removed** section allows later restoration.
- Removed records do not appear in the active count, purchase history, assistance, unit history, or active duplicate checks.
- Restore uses optimistic concurrency and fails clearly if another active item now owns the same identity.
- This workflow does not permanently delete records.

## Persistence and API

`shopping_items` gains:

- `initial_capture_text TEXT NOT NULL`
- Current `capture_text`, updated only by an atomic correction.
- `identity_key TEXT NOT NULL`
- Status value `removed`.
- `removed_at TEXT NULL`

Existing rows migrate with `initial_capture_text = capture_text`, an identity derived from the best current item name, and null `removed_at`.

Create accepts the existing `input` shape and uses the shared brain. Correction accepts a complete source-neutral correction payload plus `expectedVersion`. Lifecycle updates remain versioned. List requests expose active/purchased items as before and optionally include recently removed items.

The response includes both initial and current capture text so debugging and user-visible corrections never rely on hidden stale state.

## Error Handling

- Empty, quantity-only, non-positive, or non-finite captures remain invalid.
- Ambiguous grammar remains free text and can be corrected through **Edit item**.
- A stale accepted product ID returns `invalid_product_reference` while preserving the draft.
- A correction whose name embeds conflicting structured measurements returns a specific validation error without changing the row.
- Duplicate create, edit, or restore returns the existing item identifier.
- Version conflict returns the current item and keeps the user's edit draft.
- Offline assistance and preview remain available from locally validated artifacts.

## TDD and Verification

Implementation proceeds as vertical red-green slices:

1. Source-neutral parser contract for the leading `pack of` example.
2. A table of realistic word orders, aliases, plural forms, decimals, and ambiguity guards.
3. Identity-aware assistance for `Britannia 50-50` and reviewed category aliases.
4. HTTP create parity for text, simulated voice transcript, and API source metadata.
5. Atomic correction and representation-consistency tests.
6. Removed/undo/restore lifecycle tests and learning exclusions.
7. Angular interaction tests for the unified editor and removal recovery.
8. Live-browser matrix using branded and unknown products across count-first, item-first, and reverse-measure phrases.

Every parser example is asserted with independent literal expectations. The broad matrix is added incrementally: one failing behavior, minimum implementation, green checkpoint, then the next phrase family.

## Acceptance Criteria

- The same natural-language request yields the same `ItemIntent` for text, voice-transcript, and API adapters.
- `1 pack of Amul Butter 500 gms` produces `Amul Butter · 500 g · 1 pack`.
- Item-first and reverse two-measure orders continue to work.
- `Britannia 50-50` receives assistance while its numeric identity is typed.
- `Britannia 50-50 biscuit` is recognized as the reviewed product without treating `50-50` as quantity.
- Manual correction cannot leave name, capture text, structured details, and duplicate identity contradictory.
- Every item exposes one discoverable editor for name, quantity/unit, and package size/unit.
- Accidental items can be removed, immediately undone, or restored later without becoming purchases or learned vocabulary.
- Unknown brands, Unicode text, and ambiguous product names remain valid free text.
- Existing sorting, SSE, offline assistance, optimistic concurrency, and accessibility behavior remain green.
- No price, currency, retailer, cart, ordering, remote lookup, or online Git behavior is introduced.
