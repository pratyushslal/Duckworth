# Duckworth API

Fastify + TypeScript API with SQLite persistence.

## Run locally

```bash
pnpm install
pnpm dev
```

The API listens on `http://127.0.0.1:3000`.

Useful commands:

```bash
pnpm test -- --run
pnpm typecheck
pnpm build
pnpm openapi:write
```

SQLite is stored at `data/duckworth.sqlite` by default. Set `SQLITE_PATH` to use another file. The versioned API is under `/api/v1`; `/health` reports process readiness.

Item creation accepts the richer `{ "input": "1.5 kg potatoes" }` shape and retains legacy `{ "name": "potatoes" }` callers. Responses include structured quantity, unit provenance, confirmation time, and derived attention reasons. Unit history is household-scoped and is learned only from explicitly entered or accepted units; inferred values never reinforce themselves.

The dependency-free shared TypeScript parser under `../packages/item-capture` builds automatically before API development, test, typecheck, build, and start commands. Operation is entirely local; remote Git publication and hosted services are intentionally deferred.
