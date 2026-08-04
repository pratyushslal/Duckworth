# Duckworth Web

Angular frontend for the Duckworth household shopping assistant.

## Run locally

Start the API first from `duckworth-api`, then run:

```bash
pnpm install
pnpm start
```

Open `http://localhost:4200`. The development proxy forwards `/health` and `/api` to the API on port 3000.

## Fast item capture

The add box understands a conservative leading quantity and optional unit:

- `milk` saves immediately and appears as **Needs details** until a quantity is added inline.
- `2 milk` saves a count of two.
- `1.5 kg potatoes` saves quantity `1.5`, unit `kg`, and item `potatoes`.
- `2 cartons milk` saves canonical unit `carton`.
- `biscuits 2 pcs` also works when quantity and a recognized unit come after the item name.

Recognized units cover common mass, volume, count, and package words. Trailing syntax requires a recognized unit, so a product name such as `Formula 1` is not misread as a quantity. Unrecognized wording stays in the item name so Duckworth does not guess. The preview is computed locally and does not wait for the network.

When the household has previously confirmed a unit for the same item, Duckworth highlights it as **From last time · Check before ordering**. Use the value-specific **Accept** action or **Change unit** inline; leaving it unconfirmed never blocks other list actions. Confirmed history is cached locally per household for immediate advisory previews, while the API remains authoritative.

## Verify and build

```bash
pnpm test -- --watch=false
pnpm build
pnpm api:generate
python e2e/full_lifecycle_check.py
python e2e/sse_check.py
```

The OpenAPI snapshot is `openapi/duckworth-v1.json`; generated types are under `src/app/api/generated/`.
The shared TypeScript capture package is built automatically before start, test, and production build commands. No online Git remote or hosted service is required.
