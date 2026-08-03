# Item Edit and Concurrency Design

## Goal

Allow household members to edit, purchase, and reopen items without silently overwriting a newer change made by someone else.

## API contract

`PATCH /api/households/:householdId/items/:itemId` accepts `{ name?, status?, expectedVersion }`. At least one mutable field is required. A successful update increments `version` and publishes the updated item over SSE. If `expectedVersion` does not match the stored version, the API returns `409` with `{ error: "item_version_conflict", currentItem }`.

## Data model

Shopping items gain `version INTEGER NOT NULL DEFAULT 1`. Existing local SQLite files are upgraded in place with a lightweight additive migration. Updates match by household, item ID, and expected version in one statement, then increment the version.

## Frontend behavior

Each row supports edit, save, cancel, purchase, and reopen actions. A conflict keeps the attempted draft visible, replaces the row with the authoritative current item, and explains that another household member changed it. SSE updates continue to apply the latest item and remove only purchased items from the active list.

## Verification

- API tests cover edit, purchase/reopen, version increment, and stale conflict preservation.
- Angular tests cover row actions and conflict feedback.
- Playwright opens two pages, edits from one page, then verifies a stale update from the other page is rejected and does not overwrite the first change.
