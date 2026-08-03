# Duckworth Web

Angular frontend for the Duckworth household shopping assistant.

## Run locally

Start the API first from `duckworth-api`, then run:

```bash
pnpm install
pnpm start
```

Open `http://localhost:4200`. The development proxy forwards `/health` and `/api` to the API on port 3000.

## Verify and build

```bash
pnpm test -- --watch=false
pnpm build
pnpm api:generate
```

The OpenAPI snapshot is `openapi/duckworth-v1.json`; generated types are under `src/app/api/generated/`.
