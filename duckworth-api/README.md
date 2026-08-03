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
