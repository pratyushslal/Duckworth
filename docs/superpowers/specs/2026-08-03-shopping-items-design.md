# Shopping Items Vertical Slice Design

## Goal

Add the first useful household workflow: a person can view active shopping items, add an item, mark it purchased, and receive a clear duplicate warning.

## Scope

- SQLite persistence in `duckworth-api`.
- One seeded household context for the POC, represented by a stable household identifier at the API boundary.
- Active items only in the main Angular view; purchased items remain stored but are excluded from the default list.
- Text entry only in this slice. Voice, tap suggestions, enrichment, and destination routing remain deferred.

## API contract

- `GET /api/households/:householdId/items` returns active items ordered by creation time.
- `POST /api/households/:householdId/items` accepts `{ name: string }` and returns `201` with the created item.
- A normalized duplicate in the same household returns `409` with the existing item identifier.
- `PATCH /api/households/:householdId/items/:itemId` accepts `{ status: "active" | "purchased" }`.
- Invalid names return `400`; unknown item identifiers return `404`. Household identifiers are treated as partition keys for this POC; membership and authorization checks are deferred until household identity is introduced.

## Data model

`shopping_items` stores `id`, `household_id`, `name`, `normalized_name`, `status`, `created_at`, and `updated_at`. A unique constraint on `(household_id, normalized_name)` prevents races from creating duplicates. Normalization trims whitespace and compares case-insensitively.

## Frontend behavior

The Angular screen loads the active list, provides an add form, displays each item with a purchased action, and shows inline feedback for success, validation, duplicate, and unavailable-API states. The existing API status checkpoint remains visible.

## Verification

- API integration tests cover list, create, duplicate conflict, and purchase update through Fastify's public HTTP interface.
- Angular tests cover loading, adding, duplicate feedback, and marking purchased with HTTP testing.
- A Playwright flow verifies a user can add an item, see it in the list, and mark it purchased against the live API.
