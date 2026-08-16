# Regional Brand and Pack-Aware Capture Design

**Status:** Approved for written-spec review

**Date:** 2026-08-05

## Goal

Make Duckworth correctly assist, interpret, and retain a capture such as `amul butter 1 pack 500 gm` without turning shopping-list capture into a product form. The corrected experience should suggest reviewed regional products locally, interpret both the purchase count and package size, and display the result as **1 pack · Amul Butter · 500 g**.

The exact text entered by the user remains authoritative and traceable. Structured interpretation is advisory before submission and authoritative only after the API validates and persists it.

## Scope

This correction includes:

- Automatically installing the selected country's default reviewed vocabulary on a fresh profile.
- Preserving cached vocabulary and free-text capture during offline or failed startup reconciliation.
- Recognizing `gm` and `gms` as India-English aliases of canonical `g`.
- Parsing two conservative orderings of the same two-measure intent: item name followed by purchase quantity/container and package size/measure, or package size/measure followed by purchase quantity/container.
- Persisting and returning package size separately from the existing shopping quantity.
- Adding a separate, versioned India regional product vocabulary with stable brand and product identifiers.
- Seeding the first reviewed regional entries needed to prove the architecture, including Amul Butter, Britannia 50-50, and Dukes Bourbon.
- Local, advisory product suggestions with the existing accessible combobox behavior.
- Parser, catalog, API, migration, Angular, offline, and browser coverage.

This correction excludes:

- Retailer catalogs, availability, routing, ordering, carts, and payments.
- Prices, currencies, price entry, and price anomaly logic.
- A universal global brand or SKU catalog.
- Barcodes, GTIN resolution, manufacturer feeds, or automatic web lookup.
- Silent replacement of user text or mandatory catalog selection.
- Uploading household vocabulary or raw capture text for global learning.

## Observed Failures and Root Causes

### Default vocabulary is not bootstrapped

The browser starts with `en-IN` in language preferences but only hydrates an existing cached bundle. A fresh profile has no cached bundle, and the background reconciliation service is not wired into application startup. As a result, reviewed generic items and units produce no suggestions until a user manually installs a language pack. Household-history suggestions still work, which makes the failure appear inconsistent.

### The parser supports only one measurement

The shared parser supports leading quantity syntax or one trailing `quantity + recognized unit` pair. It cannot represent both `1 pack` and `500 gm`, and `gm` is not currently a recognized alias. The full phrase therefore falls back to a bare item name with missing quantity.

### The reviewed vocabulary intentionally contains no brands

The initial locale packs contain a small generic concept set. Amul and other regional brands are absent by design, so `amul` cannot produce an official suggestion or structured product identity.

## Approaches Considered

### Patch aliases and seed flat strings

Adding `gm` plus a few complete branded strings would make the demonstration appear to work, but it would still collapse purchase count and package size into one field. Brand strings would be mixed into language content without stable identity or a scalable update boundary.

### Build one comprehensive product catalog

A single country-wide catalog could offer broad coverage, but it would be too large and volatile for the existing language-pack lifecycle. It would also encourage SKU, retailer, and availability concerns that are explicitly outside shopping-list capture.

### Layer generic, regional-product, and household sources

This is the selected approach. Generic concepts remain in reviewed locale packs. Regional product records use a separate schema and artifact lifecycle. Household captures remain a distinct authoritative source. The assistance facade merges these already-loaded local sources while retaining their provenance and current ranking rules.

## Product Decisions

### Capture remains a single field

The user can type `amul butter 1 pack 500 gm` naturally. Duckworth previews:

> **1 pack · Amul Butter · 500 g**

No separate brand, package, or quantity form is required during ordinary capture. Existing inline details remain available for correction after addition.

### Two measurements have distinct meanings

- `quantity` and `unit` retain their current meaning: how many purchasable containers or units the household wants.
- `packageSize` and `packageUnit` describe the amount inside one requested container.
- For the approved example, `quantity = 1`, `unit = pack`, `packageSize = 500`, and `packageUnit = g`.
- Package size does not satisfy completeness by itself. A capture with `500 g` and no container count continues to use the existing single-measure meaning: `quantity = 500`, `unit = g`, with no separate package size.
- The two-measure grammar applies only when exactly one unit is a recognized container and the other is a recognized mass or volume unit. It accepts either ordering, including reviewed `pac` → `pack` and `pkt`/`pkts` → `packet` aliases. Ambiguous phrases remain free text rather than being guessed.

Initial container units are `pack`, `packet`, `bottle`, `carton`, `can`, `box`, and `bag`. Initial package-measure units are `g`, `kg`, `ml`, and `l`.

### Brand recognition is optional and advisory

An exact or prefix regional-product match attaches `brandId`, `productId`, and `conceptId` to the local suggestion and structured preview. The client submits only the accepted `productId`; the API resolves the corresponding brand and generic concept from its reviewed catalog. Unknown brands and products remain valid free text with null identifiers.

Selecting a suggestion is explicit. Duckworth never rewrites `amul` to `Amul`, replaces a product, or adds a package size without acceptance. Submitting typed text without selecting a suggestion still parses quantities and preserves the user's casing.

### Sources remain separate

Suggestion ranking remains:

1. Personal accepted vocabulary and redirects.
2. Confirmed household captures.
3. Reviewed regional products for the selected country.
4. Generic items in the active locale pack.
5. Enabled fallback-locale sources.
6. Conservative fuzzy candidates.

Source labels distinguish **History**, **Regional product**, and **Reviewed vocabulary**. A household string that happens to contain a brand does not become an official regional-product record.

## Architecture

### Shared capture parser

`@duckworth/item-capture` extends `CaptureInterpretation` with nullable `packageSize` and `packageUnit`. The dependency-free parser adds:

- `gm` and `gms` aliases for `g`; the same reviewed aliases are added to the India locale sources used by assistance.
- A conservative trailing pattern for `name + purchase quantity + container unit + package size + measure unit`.
- Existing single-measure and bare-name behavior unchanged.

The parser does not depend on brand catalogs. Brand recognition and grammatical interpretation remain separate so unknown brands parse identically.

### Regional product artifacts

A focused catalog source defines:

- Stable brand identifiers, such as `brand.amul`.
- Stable product identifiers, such as `product.amul.butter`.
- A generic concept link, such as `grocery.butter.dairy`; that concept is added to the canonical and India locale sources.
- Country applicability, reviewed display text, locale aliases, and transliterations.
- Compatible container and package-measure units.

Regional products are built into immutable, checksummed artifacts separate from locale packs. The country manifest references the default locale pack and regional-product segments. The initial implementation uses one small India segment; the schema supports later category shards without changing assistance interfaces.

### Default local vocabulary bootstrap

Application startup follows this order:

1. Hydrate the last validated locale and regional-product artifacts from IndexedDB.
2. Configure assistance immediately from cached artifacts and household/personal sources.
3. Reconcile the India manifest in the background.
4. On a fresh profile, install the manifest's default `en-IN` bundle and default regional-product segment automatically.
5. Validate checksums and schemas in staging, then atomically promote each artifact.
6. Reconfigure assistance after promotion without changing the current draft.

The language settings control remains available for optional languages. It must not falsely label a locale active when its bundle is absent; it shows **Not downloaded** or an equivalent truthful status until validation succeeds.

### Persistence and API contract

`shopping_items` adds nullable columns:

- `package_size REAL NULL`
- `package_unit TEXT NULL`
- `brand_id TEXT NULL`
- `product_id TEXT NULL`
- `concept_id TEXT NULL`

Constraints require positive finite package size, a package unit whenever package size is present, and null package unit when package size is absent. The three product identity columns are either all null or all non-null. Existing rows migrate with null values.

Create requests may include one accepted `productId`. Update requests may replace or clear that `productId` together with normal optimistic concurrency. The API validates the product, derives `brandId` and `conceptId`, and exposes all structured fields in create, list, and update responses. The shared parser remains authoritative for quantity fields. OpenAPI snapshots and generated Angular types change together.

### Assistance projection

The local-assistance package receives regional products as another already-loaded source. A match for `amul` or `amul b` returns `Amul Butter` with regional-product provenance and stable identifiers. When conservative trailing measurements are present, product matching considers the item-name prefix and acceptance produces the full capture, for example `Amul Butter 1 pack 500 g`, without changing either numeric value. The package remains independent of Angular, HTTP, IndexedDB, and catalog file formats.

The existing five-result limit, deterministic ordering, quantity-preservation rule, and no-keystroke-HTTP guarantee remain intact.

## Data Flow

### Fresh-profile startup

1. The app renders free-text capture immediately.
2. Cached sources are loaded if present.
3. The country manifest and default artifacts reconcile in the background.
4. Successfully validated artifacts are promoted locally.
5. Typing `tom` can suggest `tomatoes`; typing `amul` can suggest `Amul Butter`.

### Approved capture

1. The user types `amul butter 1 pack 500 gm`.
2. Local assistance offers `Amul Butter 1 pack 500 g`, preserving both typed numeric values while canonicalizing accepted units.
3. The shared parser returns the item name, purchase quantity, and package size.
4. The preview renders **1 pack · Amul Butter · 500 g**.
5. Submission sends the original capture plus the accepted `productId`, if any.
6. The API reparses the original text, validates the product, derives its brand and concept, persists the structured result, and returns it.
7. The active item is complete and does not show **Needs details**.

## Error Handling and Safety

- Manifest or artifact failure: retain cached sources, keep free-text capture available, and expose Retry.
- No cache on a failed first launch: use household history only and show that reviewed vocabulary is unavailable.
- Invalid regional-product artifact: reject the whole staged segment; never partially activate it.
- Unknown brand or product: persist the text with null catalog identifiers.
- Ambiguous two-measure phrase: preserve it as free text or the existing single-measure interpretation; never guess two measurements.
- Invalid or stale `productId`: return `400 invalid_product_reference`; preserve the draft and offer an explicit retry as unrecognized free text with no product ID.
- Draft during background activation: rebuild the index but never replace the draft or auto-select a suggestion.
- No prices, currency, retailer identity, or ordering fields are introduced.

## Testing Strategy

Implementation follows red-green-refactor through public boundaries:

1. A fresh-profile Angular test fails until startup installs the default `en-IN` bundle and reports truthful activation state.
2. Pure parser tests cover `gm`, `gms`, the approved two-measure phrase, single-measure compatibility, and ambiguous fallbacks.
3. API integration tests cover SQLite migration, structured persistence, null defaults, catalog-ID validation, attention reasons, and OpenAPI output.
4. Catalog build tests cover stable IDs, concept references, country/locale applicability, duplicate aliases, checksums, and invalid regional records.
5. Local-assistance tests prove `amul` and `amul b` suggestions, provenance, deterministic ranking, quantity preservation, and no silent rewrite.
6. Angular component tests prove the structured preview, suggestion acceptance, no per-keystroke HTTP, unknown-brand capture, and preserved drafts during artifact activation.
7. A live browser test starts with clean browser storage, waits for background installation, verifies `tom`, `milk 2 k`, and `amul` assistance, submits the approved phrase, reloads, and confirms **1 pack · Amul Butter · 500 g** without **Needs details**.

## Acceptance Criteria

- A fresh India profile receives reviewed `en-IN` and regional-product assistance without manually opening language settings.
- Cached assistance remains usable offline; free-text capture remains usable without any pack.
- `tom` suggests `tomatoes`, and `milk 2 k` can complete to `milk 2 kg`, after the default pack is active.
- `amul` and `amul b` can suggest the reviewed regional product `Amul Butter` locally.
- `amul butter 1 pack 500 gm` previews and persists as name `Amul Butter` when explicitly selected, quantity `1`, unit `pack`, package size `500`, and package unit `g`.
- The same unselected typed phrase preserves its original name casing while still parsing both measurements.
- The saved item is complete and does not request manual quantity details.
- Unknown brands remain valid and are never silently mapped.
- Existing single-measure capture, household history, spelling clarification, Unicode input, sorting, SSE, concurrency, and offline behavior remain green.
- No retailer, ordering, price, currency, remote lookup, or online Git behavior is added.
