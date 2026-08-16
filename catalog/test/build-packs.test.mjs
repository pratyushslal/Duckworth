import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { buildPackArtifacts } from '../scripts/build-packs.mjs';

function representativeInput() {
  return {
    canonicalCatalog: {
      schemaVersion: 1,
      concepts: [{
        id: 'grocery.flour.wheat',
        category: 'staples',
        compatibleUnits: ['kg', 'g', 'pack'],
      }],
    },
    localePacks: [{
      schemaVersion: 1,
      locale: 'en-IN',
      version: '2026.08.05.1',
      fallbacks: [],
      ui: { languageName: 'English (India)' },
      items: [{ id: 'grocery.flour.wheat', primary: 'wheat flour', aliases: ['atta'] }],
      units: [{ id: 'kg', primary: 'kg', aliases: ['kgs'] }],
    }],
    countryManifest: {
      schemaVersion: 1,
      countryCode: 'IN',
      defaultLocale: 'en-IN',
      bridgeLocales: ['en-IN'],
      locales: [{ locale: 'en-IN', version: '2026.08.05.1' }],
    },
  };
}

test('a representative canonical concept produces deterministic locale artifacts', () => {
  const input = representativeInput();

  const first = buildPackArtifacts(input);
  const second = buildPackArtifacts(input);

  assert.deepEqual(second, first);
  assert.deepEqual(JSON.parse(first['packs/en-IN/2026.08.05.1.json']).items, [{
    id: 'grocery.flour.wheat',
    category: 'staples',
    compatibleUnits: ['g', 'kg', 'pack'],
    primary: 'wheat flour',
    aliases: ['atta'],
  }]);
});

test('a reviewed regional product produces a deterministic country artifact', () => {
  const input = representativeInput();
  input.canonicalCatalog.concepts.push({
    id: 'grocery.butter.dairy', category: 'dairy-and-eggs', compatibleUnits: ['g', 'kg', 'pack'],
  });
  input.regionalProductPacks = [{
    schemaVersion: 1,
    countryCode: 'IN',
    version: '2026.08.05.1',
    products: [{
      id: 'product.amul.butter', brandId: 'brand.amul', brandName: 'Amul', conceptId: 'grocery.butter.dairy',
      primary: 'Amul Butter', aliases: ['amul butter'],
      compatibleContainerUnits: ['pack'], compatiblePackageUnits: ['g', 'kg'],
    }],
  }];
  input.countryManifest.regionalProducts = [{ countryCode: 'IN', version: '2026.08.05.1' }];

  const artifacts = buildPackArtifacts(input);

  expectArtifact(artifacts, 'regional-products/IN/2026.08.05.1.json', {
    id: 'product.amul.butter', brandId: 'brand.amul', brandName: 'Amul', conceptId: 'grocery.butter.dairy',
    primary: 'Amul Butter', aliases: ['amul butter'],
    compatibleContainerUnits: ['pack'], compatiblePackageUnits: ['g', 'kg'],
  });
});

function expectArtifact(artifacts, path, expectedProduct) {
  assert.deepEqual(JSON.parse(artifacts[path]).products, [expectedProduct]);
}

test('duplicate canonical IDs fail with an actionable path', () => {
  const input = representativeInput();
  input.canonicalCatalog.concepts.push({ ...input.canonicalCatalog.concepts[0] });

  assert.throws(
    () => buildPackArtifacts(input),
    /canonicalCatalog\.concepts\[1\]\.id duplicates grocery\.flour\.wheat/,
  );
});

test('a missing locale label fails with an actionable path', () => {
  const input = representativeInput();
  delete input.localePacks[0].items[0].primary;

  assert.throws(
    () => buildPackArtifacts(input),
    /localePacks\[0\]\.items\[0\]\.primary must be a non-empty string/,
  );
});

test('an unknown canonical reference fails with an actionable path', () => {
  const input = representativeInput();
  input.localePacks[0].items[0].id = 'grocery.unknown';

  assert.throws(
    () => buildPackArtifacts(input),
    /localePack\.items references unknown canonical id grocery\.unknown/,
  );
});

test('duplicate locale aliases fail with an actionable path', () => {
  const input = representativeInput();
  input.localePacks[0].items[0].aliases.push('atta');

  assert.throws(
    () => buildPackArtifacts(input),
    /localePacks\[0\]\.items\[0\]\.aliases duplicates atta/,
  );
});

test('locale fallback cycles fail with an actionable path', () => {
  const input = representativeInput();
  input.localePacks[0].fallbacks = ['hi-Latn-IN'];
  const hinglish = structuredClone(input.localePacks[0]);
  hinglish.locale = 'hi-Latn-IN';
  hinglish.fallbacks = ['en-IN'];
  input.localePacks.push(hinglish);
  input.countryManifest.locales.push({ locale: 'hi-Latn-IN', version: '2026.08.05.1' });

  assert.throws(
    () => buildPackArtifacts(input),
    /localePacks fallback cycle: en-IN -> hi-Latn-IN -> en-IN/,
  );
});

test('HTML-like locale content fails with an actionable path', () => {
  const input = representativeInput();
  input.localePacks[0].items[0].primary = '<b>wheat flour</b>';

  assert.throws(
    () => buildPackArtifacts(input),
    /localePacks\[0\]\.items\[0\]\.primary must be plain text/,
  );
});

test('English India and Latin Hinglish cover the same reviewed canonical seed', async () => {
  const readSource = async (name) => JSON.parse(await readFile(new URL(`../source/${name}`, import.meta.url), 'utf8'));
  const [canonical, english, hinglish] = await Promise.all([
    readSource('canonical-items.json'),
    readSource('en-IN.json'),
    readSource('hi-Latn-IN.json'),
  ]);
  const canonicalIds = canonical.concepts.map(({ id }) => id).sort();

  assert.deepEqual(english.items.map(({ id }) => id).sort(), canonicalIds);
  assert.deepEqual(hinglish.items.map(({ id }) => id).sort(), canonicalIds);
  assert.ok(english.items.find(({ id }) => id === 'grocery.biscuits.plain').aliases.includes('biscuits'));
  assert.ok(hinglish.items.find(({ id }) => id === 'grocery.flour.wheat').aliases.includes('aata'));
});

test('pack and manifest artifacts carry deterministic content integrity metadata', () => {
  const artifacts = buildPackArtifacts(representativeInput());
  const packPath = 'packs/en-IN/2026.08.05.1.json';
  const pack = JSON.parse(artifacts[packPath]);
  const manifest = JSON.parse(artifacts['countries/IN/manifest.json']);
  const packBytesChecksum = `sha256:${createHash('sha256').update(artifacts[packPath]).digest('hex')}`;

  assert.match(pack.checksum, /^sha256:[a-f0-9]{64}$/);
  assert.equal(pack.schemaVersion, 1);
  assert.equal(pack.locale, 'en-IN');
  assert.equal(pack.version, '2026.08.05.1');
  assert.deepEqual(pack.fallbacks, []);
  assert.match(manifest.checksum, /^sha256:[a-f0-9]{64}$/);
  assert.deepEqual(manifest.locales[0], {
    locale: 'en-IN',
    version: '2026.08.05.1',
    fallbacks: [],
    artifactPath: packPath,
    checksum: packBytesChecksum,
  });
});

test('reviewed unit aliases do not require a shared parser code change', () => {
  const input = representativeInput();
  input.localePacks[0].units.find(({ id }) => id === 'kg').aliases.push('blorp');

  const artifact = JSON.parse(buildPackArtifacts(input)['packs/en-IN/2026.08.05.1.json']);
  assert.ok(artifact.units.find(({ id }) => id === 'kg').aliases.includes('blorp'));
});
