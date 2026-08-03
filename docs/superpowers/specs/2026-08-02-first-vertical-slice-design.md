# Duckworth First Vertical Slice — Design

**Status:** Approved for implementation planning

**Date:** 2026-08-02

**Audience:** Product and engineering collaborators

## Context

Duckworth is intended to become a collaborative family shopping assistant with multiple input methods, intelligent completion, household memory, duplicate prevention, simultaneous updates, attention filtering, and purchasing guidance.

The immediate goal is smaller: create a usable proof of concept for one household without hardcoding the product around that single household. The first implementation should validate the complete path from capturing a shopping need to displaying its persisted state. It should establish boundaries that later capabilities can extend without requiring production-scale infrastructure now.

## Decision

Build the proof of concept as two independently deployable TypeScript applications and begin with one thin vertical slice:

```text
Enter item → validate → create → persist → retrieve → display
                           ↓
                    edit or complete
```

Use an Angular frontend, a lightweight Fastify API, and SQLite. Keep the frontend and API in separate top-level projects so either can move into its own repository without reorganizing source code. Inside the API, separate request coordination, shopping-domain rules, and persistence through explicit internal contracts. Treat the household as a first-class data boundary in every operation, even though the proof of concept initially serves one household.

## Goals

- Let a household member type an item and add it to a shared shopping list.
- Persist the item and display the current list reliably.
- Let a member edit or complete an item.
- Establish one canonical representation of a shopping item.
- Scope every read and write to an explicit household.
- Prevent concurrent updates from silently overwriting one another.
- Provide clear attachment points for later input, intelligence, collaboration, and purchasing capabilities.

## Non-goals

The first slice will not include:

- Voice capture or specialized tap-based shortcuts.
- AI-based completion or product inference.
- Duplicate detection.
- Live push updates between clients.
- Retailer selection or purchasing guidance.
- Production authentication and authorization.
- Multiple lists per household in the user experience.
- Distributed services, queues, or event-streaming infrastructure.
- A shared runtime source package between the frontend and API.

## Architecture

```text
┌────────────────────┐       Versioned HTTP/OpenAPI contract
│ Angular frontend   │ ─────────────────────────────────────┐
└────────────────────┘                                      │
                                                            ▼
                                                  ┌───────────────────┐
                                                  │ Fastify routes    │
                                                  └─────────┬─────────┘
                                                            │
                                                  ┌─────────▼─────────┐
                                                  │ Application       │
                                                  └─────────┬─────────┘
                                                            │
                                                  ┌─────────▼─────────┐
                                                  │ Shopping domain   │
                                                  └─────────┬─────────┘
                                                            │
                                                  ┌─────────▼─────────┐
                                                  │ Kysely repository │
                                                  └─────────┬─────────┘
                                                            │
                                                  ┌─────────▼─────────┐
                                                  │ SQLite            │
                                                  └───────────────────┘
```

The frontend and API share a versioned contract, not source modules. Fastify route schemas produce an OpenAPI document from which the Angular client is generated. Inside the API, dependencies point inward: the application layer depends on domain operations and repository interfaces, and Kysely persistence implements those interfaces. The shopping domain has no dependency on Angular, Fastify, Kysely, or SQLite.

This is a client/server boundary, not a collection of microservices. The API remains one deployable process. SQLite is a POC storage choice; migrations, SQL types, and repository contracts should avoid unnecessary SQLite-specific behavior so the persistence adapter can later move to PostgreSQL.

## Components

### List UI

The initial interface contains:

- A text field and add action.
- A list of active and completed items.
- An edit action.
- A complete or reopen action.
- Inline validation and conflict feedback.

The UI does not decide item lifecycle rules or access the database directly. It uses a generated Angular API client and renders returned state.

### Household context

Each application operation receives an actor context containing at least:

- `household_id`
- `member_id`

For the proof of concept, a configuration or seed process identifies the active household and member. These records exist in the database; their identifiers are not embedded as constants in domain or repository code. Later, an authentication adapter can resolve the same actor context without changing application use cases.

The client must not be trusted to select an arbitrary household. The server-side context supplies the household scope used by repositories.

### Application layer

The application layer exposes and coordinates four initial use cases:

- `AddItem`
- `ListItems`
- `EditItem`
- `SetItemCompletion`

It translates external requests into domain operations, supplies actor context, invokes a household-scoped repository, and maps expected failures into API outcomes. It contains coordination logic but does not duplicate domain invariants.

### Shopping domain

The shopping domain is the product's authoritative definition of a shopping item and its valid lifecycle. For the first slice it remains deliberately small:

- The `ShoppingItem` entity.
- The `ItemStatus` values `active` and `completed`.
- Creation, editing, completion, and reopening operations.
- Validation of required values and permitted state changes.
- Version checking as part of an update request.

It does not perform HTTP handling, database queries, authentication, AI inference, or presentation formatting.

### Repository and persistence

The repository contract provides only the operations required by the use cases. Every operation requires `household_id`; there is no unscoped `getById` or `listAll` operation available to application code.

Writes run transactionally. Updates match both `id` and `household_id` and require the expected `version`. A successful update increments `version`.

## Initial Data Model

### Household

| Field | Purpose |
| --- | --- |
| `id` | Stable household identifier. |
| `name` | Human-readable name. |
| `created_at` | Creation timestamp. |

### Household member

| Field | Purpose |
| --- | --- |
| `id` | Stable member identifier. |
| `household_id` | Owning household. |
| `display_name` | Human-readable identity. |
| `created_at` | Creation timestamp. |

### Shopping list

| Field | Purpose |
| --- | --- |
| `id` | Stable list identifier. |
| `household_id` | Owning household. |
| `name` | Human-readable list name. |
| `created_at` | Creation timestamp. |

The proof of concept uses one seeded default list but still models and queries its ownership explicitly.

### Shopping item

| Field | Purpose |
| --- | --- |
| `id` | Stable item identifier. |
| `household_id` | Owning household and mandatory query scope. |
| `list_id` | Parent shopping list. |
| `raw_input` | The member's original entry. |
| `display_name` | The current user-facing name. Initially derived by trimming `raw_input`. |
| `quantity` | Optional numeric quantity. |
| `unit` | Optional unit associated with the quantity. |
| `status` | `active` or `completed`. |
| `created_by` | Member who created the item. |
| `created_at` | Creation timestamp. |
| `updated_at` | Last modification timestamp. |
| `version` | Monotonically increasing value used for optimistic concurrency. |

Database constraints should ensure that referenced members, lists, and items belong to the same household wherever the selected database supports practical enforcement. Repository scoping remains mandatory even when constraints are present.

## API Contract

The Fastify API exposes versioned JSON endpoints and generates an OpenAPI document from the same request and response schemas used for runtime validation:

| Method and path | Input | Result |
| --- | --- | --- |
| `POST /api/v1/items` | `rawInput`, optional quantity and unit | Created item |
| `GET /api/v1/items` | Optional status filter | Household's items |
| `PATCH /api/v1/items/:itemId` | Expected version and editable fields | Updated item |
| `PUT /api/v1/items/:itemId/completion` | Expected version and completion state | Updated item |

Household and member identity come from server-resolved actor context, not arbitrary request-body fields.

## Data Flow

### Add an item

1. The member enters text and submits it.
2. The server resolves the actor context.
3. The application layer passes the raw input and actor context to the shopping domain.
4. The domain trims and validates the input, then creates an item in the `active` state.
5. The repository persists the item under the actor's household and default list in a transaction.
6. The API returns the created item.
7. The UI renders the authoritative returned state.

### Edit or complete an item

1. The UI submits the item ID, intended change, and last-seen version.
2. The repository loads the item using both item ID and household ID.
3. The domain validates and applies the requested change.
4. Persistence updates the record only if its stored version still matches the expected version.
5. On success, the version increments and the updated item is returned.
6. On mismatch, the latest state is returned with a conflict outcome so the UI can refresh and preserve the user's attempted change.

## Error Handling

Errors are expressed as actionable outcomes rather than raw infrastructure failures:

| Condition | Expected behavior |
| --- | --- |
| Empty or invalid item input | Reject with a field-level validation error; keep the user's text in the UI. |
| Item absent or outside household scope | Return a not-found outcome without revealing cross-household existence. |
| Version mismatch | Return a conflict outcome and current item state; do not overwrite silently. |
| Transient persistence failure | Return a retryable failure and preserve unsaved input in the UI. |
| Unexpected internal failure | Log diagnostic context without sensitive data and show a stable generic message. |

## Testing Strategy

### Domain tests

- Create an item from valid input.
- Reject empty or whitespace-only input.
- Edit an active or completed item's user-editable fields.
- Complete and reopen an item.
- Preserve domain invariants through every operation.

### Repository integration tests

- Persist and retrieve items for a household.
- Never list an item from a different household.
- Never retrieve or update another household's item by ID.
- Increment versions after successful updates.
- Reject stale-version updates without data loss.

The isolation tests must create at least two households even though the POC user experience exposes only one.

### API tests

- Cover each successful operation.
- Cover validation, not-found, and conflict outcomes.
- Confirm household identity is resolved by the server context.
- Confirm request data cannot override the resolved household.

### End-to-end test

One browser-level path proves the vertical slice: enter an item, submit it, reload or retrieve the list, observe the item, and mark it complete.

## Extension Points

Later capabilities attach without changing item ownership or bypassing the domain:

| Future capability | Attachment point |
| --- | --- |
| Voice capture | Input adapter producing the same add-item request as typed capture. |
| Tap shortcuts | UI adapter producing the same application command. |
| Intelligent completion | Enrichment step that proposes structured details before domain acceptance. |
| Household memory | Household-scoped preference service consulted by enrichment. |
| Duplicate prevention | Domain policy evaluated during item creation or confirmation. |
| Live collaboration | Change notification emitted only after a successful transaction. |
| Attention filtering | Decision service consuming ambiguity, conflict, and confidence signals. |
| Purchase guidance | Downstream consumer of settled shopping-item intent. |
| Production authentication | Actor-context resolver replacing POC configuration without changing use cases. |

These are boundaries, not commitments to separate services. A future capability should become a separate process only when deployment, scale, reliability, or ownership requirements justify it.

## Acceptance Criteria

The first slice is complete when:

- A configured household member can add a typed item and see it in the persisted list.
- The member can edit, complete, and reopen the item.
- Reloading the application preserves the list state.
- All repository reads and writes require household scope.
- Automated tests prove isolation using two households.
- A stale update cannot silently overwrite a newer update.
- Domain logic can be tested without starting the UI or database.
- The implementation contains no hardcoded domain assumption that only one household can exist.

## Alternatives Considered

### Build one complete layer at a time

Completing all input mechanisms before processing and display would delay a usable result and make contracts harder to validate. Rejected in favor of an end-to-end slice.

### Build production multi-tenancy first

Implementing production identity, distributed infrastructure, and operational scaling before validating the item workflow would add cost without improving the proof of concept. Rejected; tenant-aware data and server-resolved context provide the required migration path.

### Put rules directly in API handlers

This would reduce initial file count but cause rules to diverge as voice, automation, and other entry paths are added. Rejected in favor of a small, framework-independent shopping domain.

## Consequences

- The proof of concept becomes usable early and exercises all primary architectural boundaries.
- Household isolation is designed and tested before the product exposes multiple households.
- The Angular frontend and Fastify API can be moved to separate repositories and deployed independently.
- The OpenAPI document becomes the source of truth for frontend/backend compatibility.
- SQLite keeps local setup light while the repository boundary preserves a migration path to PostgreSQL.
- The system avoids premature distributed-service complexity.
- The team must maintain discipline around household-scoped repository methods and inward dependencies.
- Some production concerns remain intentionally deferred until the central shopping workflow is validated.
