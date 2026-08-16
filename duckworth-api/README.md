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
pnpm language-packs:build
pnpm language-packs:test
```

SQLite is stored at `data/duckworth.sqlite` by default. Set `SQLITE_PATH` to use another file. The versioned API is under `/api/v1`; `/health` reports process readiness.

Item creation accepts the richer `{ "input": "1.5 kg potatoes" }` shape and retains legacy `{ "name": "potatoes" }` callers. Responses include structured quantity, unit provenance, confirmation time, and derived attention reasons. Unit history is household-scoped and is learned only from explicitly entered or accepted units; inferred values never reinforce themselves.

The dependency-free shared TypeScript parser under `../packages/item-capture` builds automatically before API development, test, typecheck, build, and start commands. Operation is entirely local; remote Git publication and hosted services are intentionally deferred.

## Reviewed language packs

Catalog source and JSON schemas live under `../catalog`. `pnpm language-packs:build` validates canonical IDs, locale completeness, parser-compatible units, and deterministic checksums before publishing immutable artifacts under `language-packs/`. `pnpm language-packs:test` verifies that pipeline. Machine translation or transliteration may prepare a draft, but editorial/native-speaker review is required before locale source can be published.

The API serves cacheable country manifests and exact versioned artifacts from `/api/v1/language-packs`, with ETags and immutable caching. The initial India manifest contains reviewed `en-IN` and Latin-script `hi-Latn-IN` packs. There is no pack write endpoint or telemetry upload, and no hosted service or online Git remote is required.
