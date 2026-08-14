# Package Size Display Deduplication Design

**Status:** Approved

**Date:** 2026-08-14

## Goal

Prevent a product's package size from appearing twice in the item summary when the same value is also present as a derived `measure:net_content` attribute.

## Current behavior

For an item such as `5 bottles of thums up 1 l`, the authoritative item response contains both:

- `packageSize: 1` and `packageUnit: "l"`
- `attributes["measure:net_content"]: "1 l"`

The summary renders package size as `1 litre`, then renders the semantic attribute as `1 l net content`, producing duplicate information. The edit form exposes the package-size fields but not the generic semantic attribute, so the second value disappears during editing.

## Approved behavior

- Keep the package-size representation as the primary visible value.
- Suppress a `measure:net_content` semantic detail when both `packageSize` and `packageUnit` are present.
- Continue showing `measure:net_content` when package size is unavailable, so the only available product-size information is not lost.
- Preserve the attribute in the API/database response; this is a presentation-only deduplication.
- Apply the rule to every shop type and product, not only grocery items.
- Do not change parsing, persistence, edit-form fields, ordering, or shop classification.

## Data flow

The item API remains authoritative. The frontend summary receives package fields and semantic attributes, formats package size first, then filters semantic details through a presentation helper. The helper removes only the redundant net-content detail under the condition above.

## Error handling

Malformed or missing package fields do not suppress the semantic detail. A net-content attribute remains visible unless both package fields are valid and present. Other semantic attributes, such as medicine strength or cable length, remain unchanged.

## Verification

- A grocery item with `packageSize: 1`, `packageUnit: "l"`, and `measure:net_content: "1 l"` displays only one size value.
- An item with net content but no package size still displays net content.
- A medicine strength attribute remains visible.
- The edit form continues to edit package size without introducing a duplicate net-content field.
- Existing frontend tests, typecheck, and build remain green.
