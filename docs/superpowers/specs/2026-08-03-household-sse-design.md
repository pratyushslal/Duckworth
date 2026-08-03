# Household SSE Coordination Design

## Goal

Keep open household shopping-list screens synchronized when another client adds an item or marks one purchased.

## Contract

- `GET /api/households/:householdId/events` opens an SSE stream.
- Events use `event: shopping-item.changed` and JSON `data` containing `{ action, item }`.
- `action` is `created` or `updated`.
- Events are emitted only after the SQLite mutation succeeds and only to subscribers for the same household.
- The stream sends a keep-alive comment every 20 seconds and closes cleanly when the client disconnects.

## Architecture

The API owns an in-process event hub keyed by household ID. The repository remains responsible for SQLite writes; the route layer publishes the resulting item after a successful mutation. This is intentionally process-local for the POC, while the hub boundary allows a later Redis or broker adapter without changing the HTTP contract.

## Frontend behavior

Angular opens one `EventSource` for the configured household. Created events append unseen active items; updated purchased events remove the item from the active list. The existing add and purchase actions remain optimistic only after their HTTP responses; SSE prevents a second open screen from becoming stale.

## Verification

- API tests cover SSE headers, event payloads, household isolation, and mutation publication.
- Angular tests cover applying created/updated events and closing the stream.
- Playwright opens two pages for the same household and verifies one page reflects a change made on the other.
