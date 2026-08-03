# Duckworth First Vertical Slice — Implementation Plan

**Status:** Ready for execution

**Date:** 2026-08-02

**Design source:** `docs/superpowers/specs/2026-08-02-first-vertical-slice-design.md`

## Objective

Deliver a usable proof of concept in which a configured household member can add, view, edit, complete, and reopen shopping items. The Angular frontend and Fastify API must be independently buildable and deployable. The data model and every repository operation must support more than one household even though the initial interface exposes one configured household.

## Selected Stack

### API

- Node.js 24 LTS
- TypeScript in strict mode
- Fastify
- TypeBox with Fastify's TypeBox type provider
- Kysely
- SQLite through `better-sqlite3`
- Vitest
- Fastify request injection for API tests

### Frontend

- Angular standalone application in strict mode
- Angular `HttpClient`
- Angular signals for local feature state
- Angular CLI's default Vitest setup
- Playwright for one end-to-end browser path

### Contract

- Versioned JSON API under `/api/v1`
- Fastify route schemas as the runtime-validation and OpenAPI source
- Generated TypeScript types in the frontend from a committed OpenAPI snapshot
- No shared runtime package between the two projects

Kysely is selected because it is lightweight and provides official SQLite and PostgreSQL dialects. This does not make a later migration automatic: database migrations and integration tests will still need a PostgreSQL pass when that decision is made.

## Repository-ready Layout

```text
Duckworth/
├── PROJECT_OVERVIEW.md
├── docs/
│   └── superpowers/
├── duckworth-api/          # Can become its own repository
│   ├── openapi/
│   ├── src/
│   ├── test/
│   ├── package.json
│   └── README.md
└── duckworth-web/          # Can become its own repository
    ├── openapi/
    ├── src/
    ├── e2e/
    ├── package.json
    └── README.md
```

Each application owns its dependencies, scripts, configuration, tests, and README. Neither application imports source files from the other. The only cross-project artifact is a copied, versioned OpenAPI document used during frontend code generation.

## API Contract

| Method | Path | Success | Purpose |
| --- | --- | --- | --- |
| `GET` | `/health` | `200` | Process readiness. |
| `POST` | `/api/v1/items` | `201` | Add a typed item. |
| `GET` | `/api/v1/items` | `200` | List items for the resolved household. |
| `PATCH` | `/api/v1/items/:itemId` | `200` | Edit item fields using an expected version. |
| `PUT` | `/api/v1/items/:itemId/completion` | `200` | Complete or reopen using an expected version. |

Expected failures use a stable error envelope:

```json
{
  "error": {
    "code": "ITEM_VERSION_CONFLICT",
    "message": "The item changed since it was loaded.",
    "details": {}
  }
}
```

Initial error codes are `VALIDATION_FAILED`, `ITEM_NOT_FOUND`, `ITEM_VERSION_CONFLICT`, and `INTERNAL_ERROR`. A conflict response includes the latest item representation in `details.currentItem`.

## Delivery Rules

- Implement in the task order below; each task has its own verification gate.
- Write the specified test first for domain and repository behavior, observe it fail for the expected reason, then implement the smallest passing behavior.
- Do not add voice, AI enrichment, duplicate detection, live push updates, authentication, or retailer routing during this plan.
- Do not add a generic framework abstraction unless a task immediately uses it.
- Never add an unscoped repository method such as `getById(id)`; require `householdId` in every repository operation.
- Keep generated API files isolated and never hand-edit them.

## Task 1 — Establish Two Independent Application Shells

**Outcome:** Both applications install, build, test, and run independently; the Angular development server can reach the API health endpoint.

### API files

- `duckworth-api/package.json`
- `duckworth-api/tsconfig.json`
- `duckworth-api/.nvmrc`
- `duckworth-api/.env.example`
- `duckworth-api/.gitignore`
- `duckworth-api/src/app.ts`
- `duckworth-api/src/server.ts`
- `duckworth-api/src/config.ts`
- `duckworth-api/src/routes/health.ts`
- `duckworth-api/test/health.test.ts`

### Frontend files

- Angular CLI-generated files under `duckworth-web/`
- `duckworth-web/.nvmrc`
- `duckworth-web/proxy.conf.json`
- `duckworth-web/src/app/core/api-health.service.ts`
- `duckworth-web/src/app/core/api-health.service.spec.ts`

### Steps

1. Create `duckworth-api` as its own pnpm package with TypeScript strict mode and ESM.
2. Add Fastify, TypeBox, Kysely, `better-sqlite3`, Vitest, `tsx`, and required Fastify plugins. Keep runtime and development dependencies separate.
3. Define API scripts: `dev`, `build`, `start`, `typecheck`, `test`, `test:watch`, `db:migrate`, `db:seed`, and `openapi:write`.
4. Make `buildApp()` construct and return Fastify without listening. Keep `server.ts` responsible only for configuration, start, and graceful shutdown. This enables request-injection tests.
5. Add `/health` returning a stable payload such as `{ "status": "ok" }`.
6. Generate `duckworth-web` with Angular CLI as a standalone, strict, routed application using SCSS and pnpm. Disable SSR for this POC.
7. Configure the Angular development proxy to forward `/api` and `/health` to the Fastify development port.
8. Add a small Angular service test proving the health response can be represented without coupling the root component to transport details.
9. Pin both applications to Node.js 24 in `.nvmrc` and declare a compatible `engines.node` range.

### Verify

```text
cd duckworth-api
pnpm typecheck
pnpm test --run
pnpm build

cd ../duckworth-web
pnpm test --watch=false
pnpm build
```

Manual check: run both development servers and confirm the frontend can call `/health` through its proxy.

## Task 2 — Implement the Shopping Domain

**Outcome:** Framework-independent domain code creates and changes valid shopping items deterministically.

### Files

- `duckworth-api/src/modules/shopping/domain/item-status.ts`
- `duckworth-api/src/modules/shopping/domain/shopping-item.ts`
- `duckworth-api/src/modules/shopping/domain/shopping-item.errors.ts`
- `duckworth-api/src/modules/shopping/domain/shopping-item.test.ts`

### Steps

1. Define `ItemStatus` as `active | completed`.
2. Define `ShoppingItem` with the fields approved in the design: IDs, original input, display name, optional quantity and unit, status, timestamps, creator, and version.
3. Write failing tests for valid creation, whitespace rejection, trimmed display name, editing, completing, reopening, and version preservation inside domain transformations.
4. Implement pure functions or entity methods for `createItem`, `editItem`, and `setCompletion`.
5. Inject ID and clock values into creation rather than calling global generators from the domain. This keeps tests deterministic and moves side effects to the application layer.
6. Keep household identity mandatory in the creation input. Do not provide a default household.

### Verify

```text
cd duckworth-api
pnpm test --run src/modules/shopping/domain/shopping-item.test.ts
pnpm typecheck
```

## Task 3 — Add Household-aware SQLite Persistence

**Outcome:** Migrations create the four core tables, and repository tests prove tenant isolation and optimistic concurrency.

### Files

- `duckworth-api/src/infrastructure/database/database.ts`
- `duckworth-api/src/infrastructure/database/database.types.ts`
- `duckworth-api/src/infrastructure/database/migrations/001_initial.ts`
- `duckworth-api/src/infrastructure/database/migrate.ts`
- `duckworth-api/src/infrastructure/database/seed.ts`
- `duckworth-api/src/modules/shopping/application/shopping-item.repository.ts`
- `duckworth-api/src/modules/shopping/infrastructure/kysely-shopping-item.repository.ts`
- `duckworth-api/test/support/test-database.ts`
- `duckworth-api/test/shopping-item.repository.test.ts`

### Steps

1. Configure Kysely's SQLite dialect with `better-sqlite3` and enable SQLite foreign-key enforcement for every connection.
2. Create migrations for `households`, `household_members`, `shopping_lists`, and `shopping_items`.
3. Use application-generated string IDs, UTC timestamps, explicit foreign keys, and indexes beginning with `household_id` for list and item access paths. Add composite uniqueness and foreign-key constraints where needed so a member, list, and item referenced together must belong to the same household.
4. Add `version INTEGER NOT NULL DEFAULT 1` and restrict status values to `active` or `completed`.
5. Make the repository interface require `householdId` on create, list, find, and update operations.
6. Implement compare-and-swap updates: update only where `id`, `household_id`, and `version` all match; increment the version on success.
7. Make the seed command read household and member identity from explicit configuration. It may create friendly development names, but domain and repository code must contain no single-household constants.
8. Use a new in-memory SQLite database per integration-test context and run real migrations against it.
9. Write tests using two households to prove list, lookup, and update isolation. Add a stale-version test that proves the newer record is preserved.

### Verify

```text
cd duckworth-api
pnpm db:migrate
pnpm db:seed
pnpm test --run test/shopping-item.repository.test.ts
pnpm typecheck
```

Inspect the development database and confirm the seed creates household, member, and default-list rows before any shopping item is added.

## Task 4 — Implement Application Use Cases and HTTP Routes

**Outcome:** The complete item lifecycle is available through a validated, household-scoped API.

### Files

- `duckworth-api/src/context/actor-context.ts`
- `duckworth-api/src/modules/shopping/application/add-item.ts`
- `duckworth-api/src/modules/shopping/application/list-items.ts`
- `duckworth-api/src/modules/shopping/application/edit-item.ts`
- `duckworth-api/src/modules/shopping/application/set-item-completion.ts`
- `duckworth-api/src/modules/shopping/http/item.schemas.ts`
- `duckworth-api/src/modules/shopping/http/item.routes.ts`
- `duckworth-api/src/http/error-handler.ts`
- `duckworth-api/test/items.api.test.ts`

### Steps

1. Resolve `householdId` and `memberId` in a server-side Fastify hook or plugin from validated POC configuration. Do not accept either value from request bodies or query parameters.
2. Fail application startup with a clear configuration error when the configured household or member is missing or inconsistent.
3. Implement the four application use cases. They coordinate ID generation, current time, domain functions, and repository calls.
4. Define TypeBox request, response, and error schemas once and register them on the Fastify routes.
5. Implement the versioned endpoints specified above.
6. Map validation errors to `400`, missing or cross-household items to `404`, stale versions to `409`, and unexpected errors to `500`.
7. Include the latest authoritative item in a `409` response.
8. Register CORS with a configured frontend origin for independently hosted development or deployment. Keep the local proxy as the default development route.
9. Test routes with `fastify.inject()` against migrated in-memory databases. Include attempts to override household identity and access another household's item.

### Verify

```text
cd duckworth-api
pnpm test --run test/items.api.test.ts
pnpm test --run
pnpm typecheck
pnpm build
```

Manual check with an HTTP client: create, list, edit, complete, and reopen one item; then repeat an update with an old version and observe `409` without data loss.

## Task 5 — Publish and Consume the OpenAPI Contract

**Outcome:** The backend publishes a reproducible OpenAPI document, and the frontend obtains its API types from that document rather than maintaining copied DTOs.

### API files

- `duckworth-api/src/plugins/openapi.ts`
- `duckworth-api/src/openapi/write-openapi.ts`
- `duckworth-api/openapi/duckworth-v1.json`
- `duckworth-api/test/openapi.test.ts`

### Frontend files

- `duckworth-web/openapi/duckworth-v1.json`
- `duckworth-web/src/app/api/generated/schema.d.ts`
- `duckworth-web/src/app/api/shopping-api.service.ts`
- `duckworth-web/src/app/api/shopping-api.service.spec.ts`

### Steps

1. Register Fastify OpenAPI support and tag the item routes consistently.
2. Make `pnpm openapi:write` build the app without listening and write a deterministically formatted `openapi/duckworth-v1.json`.
3. Test that the document includes all four item operations and their success and error schemas.
4. Copy the generated document into the frontend's `openapi/` directory as a versioned contract snapshot.
5. Add `openapi-typescript` to the frontend development dependencies and an `api:generate` script that regenerates `schema.d.ts` from the local snapshot.
6. Implement a narrow Angular `ShoppingApiService` using `HttpClient` and types projected from the generated schema. Components must not call raw URLs directly.
7. Add a CI-ready check that regenerates the types and fails when committed generated output is stale.
8. Document that, after repository separation, the frontend contract-update workflow downloads a released API specification before running the same generator. Do not introduce a shared npm package for this POC.

### Verify

```text
cd duckworth-api
pnpm openapi:write
pnpm test --run test/openapi.test.ts

cd ../duckworth-web
pnpm api:generate
pnpm test --watch=false
pnpm build
```

Confirm that no manually declared `ShoppingItemDto` duplicates the generated contract type.

## Task 6 — Deliver Add and List as the First User-visible Tracer Bullet

**Outcome:** A member can add a typed item in Angular, reload, and still see it.

### Files

- `duckworth-web/src/app/features/shopping/shopping-page.component.ts`
- `duckworth-web/src/app/features/shopping/shopping-page.component.html`
- `duckworth-web/src/app/features/shopping/shopping-page.component.scss`
- `duckworth-web/src/app/features/shopping/shopping-page.component.spec.ts`
- `duckworth-web/src/app/features/shopping/shopping-list.state.ts`
- `duckworth-web/src/app/features/shopping/shopping-list.state.spec.ts`
- `duckworth-web/src/app/app.routes.ts`

### Steps

1. Route the application root to a standalone shopping page.
2. Model feature state with signals for items, draft text, loading, submitting, and actionable error state.
3. Load the household list on page entry through `ShoppingApiService`.
4. Add an item-entry form with required validation. Preserve draft text when a request fails and clear it only after success.
5. Render active and completed items from authoritative API responses. Use stable item IDs for list tracking.
6. Disable duplicate submissions while an add request is in flight, but do not lock unrelated list interactions.
7. Test initial load, successful add, whitespace validation, preserved input after failure, loading state, and retry.

### Verify

```text
cd duckworth-web
pnpm test --watch=false
pnpm build
```

Manual demonstration: enter `milk`, submit, reload the browser, and observe `milk` in the list.

## Task 7 — Deliver Edit, Complete, Reopen, and Conflict Recovery

**Outcome:** The full first-slice lifecycle works in the UI without silent lost updates.

### Files

- `duckworth-web/src/app/features/shopping/item-row.component.ts`
- `duckworth-web/src/app/features/shopping/item-row.component.html`
- `duckworth-web/src/app/features/shopping/item-row.component.scss`
- `duckworth-web/src/app/features/shopping/item-row.component.spec.ts`
- Updates to `duckworth-web/src/app/features/shopping/shopping-list.state.ts`
- Updates to `duckworth-web/src/app/features/shopping/shopping-page.component.*`

### Steps

1. Render each item through a focused row component with edit, complete, and reopen actions.
2. Send the last-seen `version` with every mutation.
3. Replace local item state only with the authoritative item returned by the API.
4. Show inline progress for the item being changed without blocking the entire list.
5. On `409`, replace the stale item with `details.currentItem`, preserve the attempted edit, and explain that the item changed elsewhere.
6. On other failures, keep the last confirmed item state and provide a retry action.
7. Add unit tests for successful edit, completion, reopening, conflict refresh, and retryable failure.

### Verify

```text
cd duckworth-web
pnpm test --watch=false
pnpm build
```

Manual conflict demonstration: load the same item in two browser tabs, update it in one, then update the stale version in the other and confirm the first change is not overwritten.

## Task 8 — Add End-to-end Coverage and Final Quality Gates

**Outcome:** One automated browser test proves the deployed frontend/API boundary and persisted lifecycle.

### Files

- `duckworth-web/playwright.config.ts`
- `duckworth-web/e2e/shopping-list.spec.ts`
- `duckworth-web/package.json`
- `duckworth-api/package.json`

### Steps

1. Add Playwright to the frontend repository and configure it to start both applications for the test run.
2. Give the E2E run its own temporary SQLite database and seeded household/member context.
3. Test: open the list, add an item, reload, edit it, complete it, and reopen it.
4. Capture traces and screenshots only on failure.
5. Add final check scripts in each project. Do not add a root build system that the separated repositories would require.

### Verify

```text
cd duckworth-api
pnpm typecheck
pnpm test --run
pnpm build

cd ../duckworth-web
pnpm api:generate
pnpm test --watch=false
pnpm build
pnpm exec playwright test
```

## Task 9 — Document Independent Operation and Repository Separation

**Outcome:** A new engineer can run either project from its own directory, and separating the directories into repositories requires no source changes.

### Files

- `duckworth-api/README.md`
- `duckworth-api/.env.example`
- `duckworth-web/README.md`
- `duckworth-web/proxy.conf.json`
- `docs/superpowers/specs/2026-08-02-first-vertical-slice-design.md`

### Steps

1. Document prerequisites, install, configuration, migrations, seed, development, tests, build, and OpenAPI export for the API.
2. Document install, API contract sync, development proxy, tests, build, and E2E execution for the frontend.
3. List every environment variable and make startup errors name missing variables precisely.
4. Document the contract-release workflow for separate repositories: API publishes `duckworth-v1.json`; frontend updates its snapshot and regenerated types in one change.
5. Verify that deleting the parent workspace metadata would not break either application.
6. Initialize or push the two directories as separate repositories only when the user requests repository creation or remote publication.

### Verify

Follow each README from a clean checkout or clean copy. Both sets of commands must work without relying on tools, packages, or source files from the sibling directory, except the explicitly documented contract-update operation.

## Completion Checklist

- [ ] Typed item capture works through Angular and Fastify.
- [ ] Items persist in SQLite across API restarts.
- [ ] Edit, complete, and reopen work.
- [ ] Household identity is server-resolved and cannot be overridden by request data.
- [ ] Repository and API isolation tests use two households.
- [ ] Optimistic concurrency prevents silent overwrites.
- [ ] OpenAPI is generated from API route schemas.
- [ ] Frontend types are generated from the committed OpenAPI snapshot.
- [ ] Backend and frontend build and test independently.
- [ ] Playwright proves the end-to-end lifecycle.
- [ ] Both project READMEs support independent setup.
- [ ] No deferred Duckworth intelligence features have leaked into the POC.

## Recommended Execution Checkpoints

1. **Foundation checkpoint:** Task 1 passes; two applications communicate.
2. **Data checkpoint:** Tasks 2–4 pass; the API lifecycle and isolation are complete.
3. **Contract checkpoint:** Task 5 passes; frontend/backend drift is detectable.
4. **Usability checkpoint:** Tasks 6–7 pass; the POC is usable by one household.
5. **Handoff checkpoint:** Tasks 8–9 pass; behavior is verified and both projects are repository-ready.

## Online Repository Handoff Gate

Do not configure or push to an online Git remote during early POC development. When the usability and handoff checkpoints pass, explicitly remind the project owner to provide the online repository locations before publishing the code.

The application is considered stable and presentable enough for this reminder when:

- The complete first-slice lifecycle works through the Angular frontend and Fastify API.
- Backend unit, integration, and contract tests pass.
- Frontend unit and end-to-end tests pass.
- Both applications build independently from their own directories.
- Setup and operation are documented in both application READMEs.
- No known defect blocks the primary add, view, edit, complete, or reopen workflow.
- The interface is coherent enough to demonstrate without developer intervention.

At that point, stop before remote setup and ask the project owner for the frontend and backend online Git repository details.

## Primary Technical References

- Node.js release policy and supported LTS lines: https://nodejs.org/en/about/previous-releases
- Angular workspace setup: https://angular.dev/tools/cli/setup-local
- Angular project structure and multi-repository guidance: https://angular.dev/reference/configs/file-structure
- Angular unit testing: https://angular.dev/guide/testing
- Angular signals: https://angular.dev/guide/signals
- Fastify TypeScript and schema validation: https://fastify.dev/docs/latest/Reference/TypeScript/
- Fastify request-injection testing: https://fastify.dev/docs/v5.7.x/Guides/Testing/
- Kysely dialect and migration capabilities: https://www.kysely.dev/
- Vitest: https://vitest.dev/guide/
