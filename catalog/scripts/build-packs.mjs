import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

function assertObject(value, path) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${path} must be an object`);
  }
}

function assertString(value, path) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${path} must be a non-empty string`);
}

function assertPlainText(value, path) {
  assertString(value, path);
  if (/[<>]/u.test(value)) throw new Error(`${path} must be plain text`);
}

function canonicalJson(value) {
  const normalize = (candidate) => {
    if (Array.isArray(candidate)) return candidate.map(normalize);
    if (!candidate || typeof candidate !== 'object') return candidate;
    return Object.fromEntries(Object.keys(candidate).sort().map((key) => [key, normalize(candidate[key])]));
  };
  return `${JSON.stringify(normalize(value), null, 2)}\n`;
}

function checksum(content) {
  return `sha256:${createHash('sha256').update(content).digest('hex')}`;
}

function semanticPayload(layer) {
  const { checksum: ignored, ...payload } = layer;
  return payload;
}

function validateSemanticLayer(layer, expectedKind) {
  assertObject(layer, expectedKind);
  if (layer.schemaVersion !== 2) throw new Error(`${expectedKind}.schemaVersion must be 2`);
  if (layer.kind !== expectedKind) throw new Error(`${expectedKind}.kind must be ${expectedKind}`);
  assertString(layer.id, `${expectedKind}.id`);
  assertString(layer.version, `${expectedKind}.version`);
}

export function verifySemanticArtifact(artifact) {
  assertObject(artifact, 'semanticArtifact');
  assertString(artifact.checksum, 'semanticArtifact.checksum');
  const expected = checksum(canonicalJson(semanticPayload(artifact)));
  if (artifact.checksum !== expected) throw new Error('semantic artifact checksum mismatch');
  return artifact;
}

export function buildSemanticArtifacts({ core, locales, countries }) {
  validateSemanticLayer(core, 'core');
  if (!Array.isArray(core.dimensions) || !Array.isArray(core.units) || !Array.isArray(core.attributes)) {
    throw new Error('core dimensions, units, and attributes must be arrays');
  }
  const dimensions = new Map();
  core.dimensions.forEach((dimension, index) => {
    assertObject(dimension, `core.dimensions[${index}]`);
    assertString(dimension.id, `core.dimensions[${index}].id`);
    assertString(dimension.baseUnitId, `core.dimensions[${index}].baseUnitId`);
    if (dimensions.has(dimension.id)) throw new Error(`dimension ${dimension.id} duplicates`);
    dimensions.set(dimension.id, dimension);
  });
  const units = new Map();
  core.units.forEach((unit, index) => {
    assertObject(unit, `core.units[${index}]`);
    assertString(unit.id, `core.units[${index}].id`);
    if (!['measure', 'container', 'both'].includes(unit.capability)) {
      throw new Error(`core.units[${index}].capability is invalid`);
    }
    const previous = units.get(unit.id);
    if (previous && (previous.dimensionId !== unit.dimensionId || previous.capability !== unit.capability)) {
      throw new Error(`unit ${unit.id} has conflicting unit dimensions`);
    }
    if (previous) throw new Error(`unit ${unit.id} duplicates`);
    if (unit.dimensionId && !dimensions.has(unit.dimensionId)) {
      throw new Error(`unit ${unit.id} references unknown dimension ${unit.dimensionId}`);
    }
    units.set(unit.id, unit);
  });
  for (const dimension of dimensions.values()) {
    if (!units.has(dimension.baseUnitId)) {
      throw new Error(`dimension ${dimension.id} references unknown base unit ${dimension.baseUnitId}`);
    }
  }
  const attributes = new Set();
  core.attributes.forEach((attribute, index) => {
    assertObject(attribute, `core.attributes[${index}]`);
    assertString(attribute.id, `core.attributes[${index}].id`);
    if (attributes.has(attribute.id)) throw new Error(`attribute ${attribute.id} duplicates`);
    attributes.add(attribute.id);
  });

  if (!Array.isArray(locales)) throw new Error('locales must be an array');
  const localeByName = new Map();
  for (const locale of locales) {
    validateSemanticLayer(locale, 'locale');
    assertString(locale.locale, 'locale.locale');
    if (localeByName.has(locale.locale)) throw new Error(`locale ${locale.locale} duplicates`);
    localeByName.set(locale.locale, locale);
    assertObject(locale.grammar, 'locale.grammar');
    for (const field of ['templates', 'separators', 'connectors', 'commandPrefixes']) {
      if (!Array.isArray(locale.grammar[field])) throw new Error(`locale.grammar.${field} must be an array`);
    }
    if (locale.grammar.referencePrefixes !== undefined && !Array.isArray(locale.grammar.referencePrefixes)) {
      throw new Error('locale.grammar.referencePrefixes must be an array');
    }
    assertObject(locale.numerals, 'locale.numerals');
    assertObject(locale.attributeValues, 'locale.attributeValues');
    if (locale.attributeMarkers !== undefined && !Array.isArray(locale.attributeMarkers)) {
      throw new Error('locale.attributeMarkers must be an array');
    }
    assertObject(locale.displayLabels, 'locale.displayLabels');
    if (locale.hints !== undefined) {
      assertObject(locale.hints, 'locale.hints');
      Object.entries(locale.hints).forEach(([key, value]) => {
        assertString(key, 'locale.hints key');
        assertPlainText(value, `locale.hints.${key}`);
      });
    }
    for (const [collectionName, referenceName, known] of [
      ['unitAliases', 'unitId', units],
      ['conceptAliases', 'conceptId', null],
    ]) {
      const aliases = new Map();
      if (!Array.isArray(locale[collectionName])) throw new Error(`locale.${collectionName} must be an array`);
      locale[collectionName].forEach((entry, index) => {
        assertObject(entry, `locale.${collectionName}[${index}]`);
        assertString(entry.alias, `locale.${collectionName}[${index}].alias`);
        assertString(entry[referenceName], `locale.${collectionName}[${index}].${referenceName}`);
        if (known && !known.has(entry[referenceName])) {
          throw new Error(`locale.${collectionName}[${index}] references unknown ${referenceName} ${entry[referenceName]}`);
        }
        const key = entry.alias.normalize('NFKC').toLowerCase();
        const previous = aliases.get(key);
        if (previous && previous.target !== entry[referenceName]
          && (previous.precedence === undefined || entry.precedence === undefined || previous.precedence === entry.precedence)) {
          throw new Error(`duplicate alias ${entry.alias} requires explicit precedence`);
        }
        if (!previous || (entry.precedence ?? 0) > (previous.precedence ?? 0)) {
          aliases.set(key, { target: entry[referenceName], precedence: entry.precedence });
        }
      });
    }
  }
  const visiting = new Set();
  const visited = new Set();
  const visitLocale = (name, path = []) => {
    if (visiting.has(name)) throw new Error(`locale fallback cycle: ${[...path, name].join(' -> ')}`);
    if (visited.has(name)) return;
    const locale = localeByName.get(name);
    if (!locale) throw new Error(`unknown locale fallback ${name}`);
    visiting.add(name);
    for (const fallback of locale.fallbacks ?? []) visitLocale(fallback, [...path, name]);
    visiting.delete(name);
    visited.add(name);
  };
  for (const name of localeByName.keys()) visitLocale(name);

  if (!Array.isArray(countries)) throw new Error('countries must be an array');
  for (const country of countries) {
    validateSemanticLayer(country, 'country');
    assertString(country.countryCode, 'country.countryCode');
    for (const locale of country.locales ?? []) {
      if (!localeByName.has(locale)) throw new Error(`country references unknown locale ${locale}`);
    }
    for (const category of country.categories ?? []) {
      for (const attributeId of [...(category.relevantAttributeIds ?? []), ...(category.variantAttributeIds ?? [])]) {
        if (!attributes.has(attributeId)) throw new Error(`category ${category.id} references unknown attribute ${attributeId}`);
      }
      if (category.unitRoles !== undefined) {
        assertObject(category.unitRoles, `category ${category.id}.unitRoles`);
        Object.entries(category.unitRoles).forEach(([unitId, role]) => {
          if (!units.has(unitId)) throw new Error(`category ${category.id} references unknown unit ${unitId}`);
          assertString(role, `category ${category.id}.unitRoles.${unitId}`);
        });
      }
      if (category.measureAttributeIds !== undefined) {
        assertObject(category.measureAttributeIds, `category ${category.id}.measureAttributeIds`);
        Object.entries(category.measureAttributeIds).forEach(([role, attributeId]) => {
          assertPlainText(role, `category ${category.id}.measureAttributeIds role`);
          if (!attributes.has(attributeId)) {
            throw new Error(`category ${category.id}.measureAttributeIds references unknown attribute ${attributeId}`);
          }
        });
      }
      if (category.ratioRoles !== undefined) {
        if (!Array.isArray(category.ratioRoles)) throw new Error(`category ${category.id}.ratioRoles must be an array`);
        category.ratioRoles.forEach((rule, index) => {
          assertObject(rule, `category ${category.id}.ratioRoles[${index}]`);
          assertString(rule.role, `category ${category.id}.ratioRoles[${index}].role`);
          for (const field of ['numeratorUnitIds', 'denominatorUnitIds']) {
            if (!Array.isArray(rule[field]) || rule[field].length === 0) throw new Error(`category ${category.id}.ratioRoles[${index}].${field} must be a non-empty array`);
            rule[field].forEach((unitId) => {
              if (!units.has(unitId)) throw new Error(`category ${category.id} references unknown unit ${unitId}`);
            });
          }
        });
      }
      if (category.attributePatterns !== undefined) {
        if (!Array.isArray(category.attributePatterns)) throw new Error(`category ${category.id}.attributePatterns must be an array`);
        category.attributePatterns.forEach((pattern, index) => {
          assertObject(pattern, `category ${category.id}.attributePatterns[${index}]`);
          if (!attributes.has(pattern.attributeId)) throw new Error(`category ${category.id} references unknown attribute ${pattern.attributeId}`);
          assertString(pattern.expression, `category ${category.id}.attributePatterns[${index}].expression`);
          try { new RegExp(pattern.expression, pattern.flags ?? 'iu'); } catch { throw new Error(`category ${category.id}.attributePatterns[${index}] has an invalid expression`); }
        });
      }
      if (category.discardConnectors !== undefined) {
        if (!Array.isArray(category.discardConnectors)) throw new Error(`category ${category.id}.discardConnectors must be an array`);
        category.discardConnectors.forEach((connector, index) => assertPlainText(connector, `category ${category.id}.discardConnectors[${index}]`));
      }
    }
    const shopTypeIds = new Set();
    if (country.shopTypes !== undefined && !Array.isArray(country.shopTypes)) {
      throw new Error('country.shopTypes must be an array');
    }
    for (const shopType of country.shopTypes ?? []) {
      assertObject(shopType, 'country.shopTypes entry');
      assertString(shopType.id, 'country.shopTypes[].id');
      if (shopTypeIds.has(shopType.id)) throw new Error(`shop type ${shopType.id} duplicates`);
      shopTypeIds.add(shopType.id);
    }
    const ensureShopTypeReferences = (ids, label) => {
      if (ids === undefined) return;
      if (!Array.isArray(ids)) throw new Error(`${label}.shopTypeIds must be an array`);
      const uniqueIds = new Set();
      ids.forEach((id) => {
        assertString(id, `${label}.shopTypeIds[]`);
        if (!shopTypeIds.has(id)) throw new Error(`${label} references unknown shop type ${id}`);
        if (uniqueIds.has(id)) throw new Error(`${label} repeats shop type ${id}`);
        uniqueIds.add(id);
      });
    };
    const categoryIds = new Set((country.categories ?? []).map((category) => category.id));
    const conceptIds = new Set((country.concepts ?? []).map((concept) => concept.id));
    const brandIds = new Set((country.brands ?? []).map((brand) => brand.id));
    country.categories?.forEach((category) => ensureShopTypeReferences(category.shopTypeIds, `category ${category.id}`));
    country.concepts?.forEach((concept) => ensureShopTypeReferences(concept.shopTypeIds, `concept ${concept.id}`));
    country.products?.forEach((product) => ensureShopTypeReferences(product.shopTypeIds, `product ${product.id}`));
    if (country.brandShopTypeRules !== undefined && !Array.isArray(country.brandShopTypeRules)) {
      throw new Error('country.brandShopTypeRules must be an array');
    }
    country.brandShopTypeRules?.forEach((rule, index) => {
      assertObject(rule, `country.brandShopTypeRules[${index}]`);
      assertString(rule.brandId, `country.brandShopTypeRules[${index}].brandId`);
      if (!brandIds.has(rule.brandId)) throw new Error(`brand shop type rule references unknown brand ${rule.brandId}`);
      if (!rule.conceptId && !rule.categoryId) throw new Error(`brand shop type rule ${rule.brandId} is not scoped`);
      if (rule.conceptId && !conceptIds.has(rule.conceptId)) throw new Error(`brand shop type rule references unknown concept ${rule.conceptId}`);
      if (rule.categoryId && !categoryIds.has(rule.categoryId)) throw new Error(`brand shop type rule references unknown category ${rule.categoryId}`);
      ensureShopTypeReferences(rule.shopTypeIds, `brand shop type rule ${rule.brandId}`);
    });
    if (country.policy?.defaultItem !== undefined) {
      const { quantity, unitId } = country.policy.defaultItem;
      if (!Number.isFinite(quantity) || quantity <= 0 || !units.has(unitId)) {
        throw new Error('country.policy.defaultItem is invalid');
      }
    }
  }

  const layers = [core, ...locales, ...countries];
  return Object.fromEntries(layers
    .map((layer) => {
      const payload = semanticPayload(layer);
      const artifact = { ...payload, checksum: checksum(canonicalJson(payload)) };
      const scope = layer.kind === 'core' ? 'core' : layer.kind === 'locale' ? `locales/${layer.locale}` : `countries/${layer.countryCode}`;
      return [`semantic/${scope}/${layer.version}.json`, canonicalJson(artifact)];
    })
    .sort(([left], [right]) => left.localeCompare(right)));
}

export function buildPackArtifacts({ canonicalCatalog, localePacks, regionalProductPacks = [], countryManifest }) {
  assertObject(canonicalCatalog, 'canonicalCatalog');
  if (canonicalCatalog.schemaVersion !== 1 || !Array.isArray(canonicalCatalog.concepts)) {
    throw new Error('canonicalCatalog must use schemaVersion 1 and contain concepts');
  }
  const concepts = new Map();
  canonicalCatalog.concepts.forEach((concept, index) => {
    assertObject(concept, `canonicalCatalog.concepts[${index}]`);
    assertString(concept.id, `canonicalCatalog.concepts[${index}].id`);
    assertString(concept.category, `canonicalCatalog.concepts[${index}].category`);
    if (!Array.isArray(concept.compatibleUnits)) {
      throw new Error(`canonicalCatalog.concepts[${index}].compatibleUnits must be an array`);
    }
    if (concepts.has(concept.id)) {
      throw new Error(`canonicalCatalog.concepts[${index}].id duplicates ${concept.id}`);
    }
    concepts.set(concept.id, concept);
  });
  if (!Array.isArray(localePacks)) throw new Error('localePacks must be an array');
  const packsByLocale = new Map(localePacks.map((pack) => [pack.locale, pack]));
  const visitedLocales = new Set();
  const visitFallbacks = (locale, path) => {
    const cycleStart = path.indexOf(locale);
    if (cycleStart >= 0) {
      throw new Error(`localePacks fallback cycle: ${[...path.slice(cycleStart), locale].join(' -> ')}`);
    }
    if (visitedLocales.has(locale)) return;
    const pack = packsByLocale.get(locale);
    if (!pack) return;
    for (const fallback of pack.fallbacks ?? []) visitFallbacks(fallback, [...path, locale]);
    visitedLocales.add(locale);
  };
  for (const locale of packsByLocale.keys()) visitFallbacks(locale, []);
  assertObject(countryManifest, 'countryManifest');
  const artifacts = {};
  const localeMetadata = new Map();
  for (const pack of [...localePacks].sort((left, right) => left.locale.localeCompare(right.locale))) {
    const packIndex = localePacks.indexOf(pack);
    const packPath = `localePacks[${packIndex}]`;
    assertObject(pack, packPath);
    assertString(pack.locale, `${packPath}.locale`);
    assertString(pack.version, `${packPath}.version`);
    assertObject(pack.ui, `${packPath}.ui`);
    Object.entries(pack.ui).forEach(([key, value]) => assertPlainText(value, `${packPath}.ui.${key}`));
    if (!Array.isArray(pack.items)) throw new Error(`${packPath}.items must be an array`);
    pack.items.forEach((item, itemIndex) => {
      const itemPath = `${packPath}.items[${itemIndex}]`;
      assertObject(item, itemPath);
      assertPlainText(item.primary, `${itemPath}.primary`);
      if (!Array.isArray(item.aliases)) throw new Error(`${itemPath}.aliases must be an array`);
      const aliases = new Set();
      item.aliases.forEach((alias, aliasIndex) => {
        assertPlainText(alias, `${itemPath}.aliases[${aliasIndex}]`);
        const key = alias.normalize('NFKC').toLocaleLowerCase(pack.locale);
        if (aliases.has(key)) throw new Error(`${itemPath}.aliases duplicates ${alias}`);
        aliases.add(key);
      });
    });
    if (!Array.isArray(pack.units)) throw new Error(`${packPath}.units must be an array`);
    pack.units.forEach((unit, unitIndex) => {
      const unitPath = `${packPath}.units[${unitIndex}]`;
      assertObject(unit, unitPath);
      assertString(unit.id, `${unitPath}.id`);
      if (!Array.isArray(unit.aliases)) throw new Error(`${unitPath}.aliases must be an array`);
      [unit.primary, ...unit.aliases].forEach((token, tokenIndex) => {
        const tokenPath = tokenIndex === 0 ? `${unitPath}.primary` : `${unitPath}.aliases[${tokenIndex - 1}]`;
        assertPlainText(token, tokenPath);
      });
    });
    const items = [...pack.items]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((item) => {
        const concept = concepts.get(item.id);
        if (!concept) throw new Error(`localePack.items references unknown canonical id ${item.id}`);
        return {
          id: item.id,
          category: concept.category,
          compatibleUnits: [...concept.compatibleUnits].sort(),
          primary: item.primary,
          aliases: [...(item.aliases ?? [])].sort(),
        };
      });
    const payload = {
      schemaVersion: 1,
      locale: pack.locale,
      version: pack.version,
      fallbacks: [...(pack.fallbacks ?? [])],
      ui: pack.ui,
      items,
      units: [...(pack.units ?? [])]
        .sort((left, right) => left.id.localeCompare(right.id))
        .map((unit) => ({ ...unit, aliases: [...(unit.aliases ?? [])].sort() })),
    };
    const artifact = { ...payload, checksum: checksum(canonicalJson(payload)) };
    const artifactPath = `packs/${pack.locale}/${pack.version}.json`;
    const artifactContent = canonicalJson(artifact);
    artifacts[artifactPath] = artifactContent;
    localeMetadata.set(pack.locale, {
      locale: pack.locale,
      version: pack.version,
      fallbacks: [...(pack.fallbacks ?? [])],
      artifactPath,
      checksum: checksum(artifactContent),
    });
  }
  const regionalProductMetadata = new Map();
  if (!Array.isArray(regionalProductPacks)) throw new Error('regionalProductPacks must be an array');
  for (const productPack of [...regionalProductPacks]
    .sort((left, right) => `${left.countryCode}@${left.version}`.localeCompare(`${right.countryCode}@${right.version}`))) {
    assertObject(productPack, 'regionalProductPack');
    assertString(productPack.countryCode, 'regionalProductPack.countryCode');
    assertString(productPack.version, 'regionalProductPack.version');
    if (productPack.schemaVersion !== 1 || !Array.isArray(productPack.products)) {
      throw new Error('regionalProductPack must use schemaVersion 1 and contain products');
    }
    const seenIds = new Set();
    const products = productPack.products.map((product, index) => {
      const path = `regionalProductPack.products[${index}]`;
      assertObject(product, path);
      ['id', 'brandId', 'brandName', 'conceptId', 'primary'].forEach((field) => assertPlainText(product[field], `${path}.${field}`));
      if (!concepts.has(product.conceptId)) throw new Error(`${path}.conceptId references unknown canonical id ${product.conceptId}`);
      if (seenIds.has(product.id)) throw new Error(`${path}.id duplicates ${product.id}`);
      seenIds.add(product.id);
      for (const field of ['aliases', 'compatibleContainerUnits', 'compatiblePackageUnits']) {
        if (!Array.isArray(product[field])) throw new Error(`${path}.${field} must be an array`);
      }
      const aliases = new Set();
      product.aliases.forEach((alias, aliasIndex) => {
        assertPlainText(alias, `${path}.aliases[${aliasIndex}]`);
        const key = alias.normalize('NFKC').toLocaleLowerCase('en-IN');
        if (aliases.has(key)) throw new Error(`${path}.aliases duplicates ${alias}`);
        aliases.add(key);
      });
      product.compatibleContainerUnits.forEach((unit, unitIndex) => assertString(unit, `${path}.compatibleContainerUnits[${unitIndex}]`));
      product.compatiblePackageUnits.forEach((unit, unitIndex) => assertString(unit, `${path}.compatiblePackageUnits[${unitIndex}]`));
      return {
        id: product.id, brandId: product.brandId, brandName: product.brandName, conceptId: product.conceptId, primary: product.primary,
        aliases: [...product.aliases].sort(),
        compatibleContainerUnits: [...product.compatibleContainerUnits].sort(),
        compatiblePackageUnits: [...product.compatiblePackageUnits].sort(),
      };
    }).sort((left, right) => left.id.localeCompare(right.id));
    const payload = { schemaVersion: 1, countryCode: productPack.countryCode, version: productPack.version, products };
    const artifact = { ...payload, checksum: checksum(canonicalJson(payload)) };
    const artifactPath = `regional-products/${productPack.countryCode}/${productPack.version}.json`;
    const artifactContent = canonicalJson(artifact);
    artifacts[artifactPath] = artifactContent;
    regionalProductMetadata.set(`${productPack.countryCode}@${productPack.version}`, {
      countryCode: productPack.countryCode, version: productPack.version, artifactPath, checksum: checksum(artifactContent),
    });
  }
  const manifestPayload = {
    ...countryManifest,
    locales: countryManifest.locales.map(({ locale, version }) => {
      const metadata = localeMetadata.get(locale);
      if (!metadata || metadata.version !== version) {
        throw new Error(`countryManifest.locales references unavailable ${locale}@${version}`);
      }
      return metadata;
    }),
    ...(countryManifest.regionalProducts ? {
      regionalProducts: countryManifest.regionalProducts.map(({ countryCode, version }) => {
        const metadata = regionalProductMetadata.get(`${countryCode}@${version}`);
        if (!metadata) throw new Error(`countryManifest.regionalProducts references unavailable ${countryCode}@${version}`);
        return metadata;
      }),
    } : {}),
  };
  const manifest = { ...manifestPayload, checksum: checksum(canonicalJson(manifestPayload)) };
  artifacts[`countries/${countryManifest.countryCode}/manifest.json`] = canonicalJson(manifest);
  return Object.fromEntries(Object.entries(artifacts).sort(([left], [right]) => left.localeCompare(right)));
}

export async function buildSourcePacks({
  sourceRoot = new URL('../source/', import.meta.url),
  outputRoot = new URL('../../duckworth-api/language-packs/', import.meta.url),
} = {}) {
  const readJson = async (name) => JSON.parse(await readFile(new URL(name, sourceRoot), 'utf8'));
  const artifacts = buildPackArtifacts({
    canonicalCatalog: await readJson('canonical-items.json'),
    localePacks: await Promise.all([readJson('en-IN.json'), readJson('hi-Latn-IN.json')]),
    regionalProductPacks: [await readJson('IN-products.json')],
    countryManifest: await readJson('IN.json'),
  });
  const semanticArtifacts = buildSemanticArtifacts({
    core: await readJson('semantic/core.json'),
    locales: [await readJson('semantic/en-IN.json')],
    countries: [await readJson('semantic/IN.json')],
  });
  Object.assign(artifacts, semanticArtifacts);
  for (const [relativePath, content] of Object.entries(artifacts)) {
    const target = fileURLToPath(new URL(relativePath, outputRoot));
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content, 'utf8');
  }
  return Object.keys(artifacts);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const paths = await buildSourcePacks();
  process.stdout.write(`Built ${paths.length} language-pack artifacts.\n`);
}
