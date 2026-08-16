export type TemplateOperator =
  | { kind: 'literal'; values: readonly string[] }
  | { kind: 'number'; capture: string }
  | { kind: 'unit'; capture: string; role: 'measure' | 'container' | 'any' }
  | { kind: 'text'; capture: string; minTokens: number; maxTokens?: number }
  | { kind: 'optional'; operators: readonly TemplateOperator[] }
  | { kind: 'repeat'; operators: readonly TemplateOperator[]; max: number };

export interface CompiledTemplate {
  id: string;
  operators: readonly TemplateOperator[];
  defaults?: Readonly<Record<string, string | number>>;
}

export interface CompiledGrammar {
  templates: readonly CompiledTemplate[];
  separators: readonly string[];
  connectors: readonly string[];
  commandPrefixes: readonly string[];
  referencePrefixes?: readonly string[];
  correctionPrefixes?: readonly string[];
  referencePronouns?: readonly string[];
}

export interface UnitDefinition {
  id: string;
  capability: 'measure' | 'container' | 'both';
  dimensionId?: string;
  factorToBase?: number;
}

export interface AttributeDefinition {
  id: string;
  valueType: 'string' | 'number';
  cardinality: 'one' | 'many';
}

export interface CategoryDefinition {
  id: string;
  relevantAttributeIds: readonly string[];
  variantAttributeIds: readonly string[];
  signals: readonly string[];
  shopTypeIds?: readonly string[];
  /** Data-owned mapping from unit to semantic role for this retail domain. */
  unitRoles?: Readonly<Record<string, string>>;
  /** Data-owned mapping from a semantic measure role to its display/variant attribute. */
  measureAttributeIds?: Readonly<Record<string, string>>;
  /** Data-owned numerator/denominator combinations, such as a medicine concentration. */
  ratioRoles?: readonly {
    role: string;
    numeratorUnitIds: readonly string[];
    denominatorUnitIds: readonly string[];
  }[];
  /** Regex rules authored in the signed semantic pack for structured attributes. */
  attributePatterns?: readonly {
    attributeId: string;
    expression: string;
    valueGroup?: number;
    flags?: string;
    removeMatch?: boolean;
  }[];
  /** Grammar words that are not product identity for this category. */
  discardConnectors?: readonly string[];
}

export type DescriptorRole =
  | 'identity_attribute'
  | 'preference'
  | 'packaging_qualifier'
  | 'display_only'
  | 'unknown';

export interface DescriptorDefinition {
  alias: string;
  role: DescriptorRole;
  value?: string | number;
  attributeId?: string;
  categoryIds?: readonly string[];
  conceptIds?: readonly string[];
}

export interface ConceptDefinition {
  id: string;
  categoryId: string;
  shopTypeIds?: readonly string[];
}

export interface BrandDefinition {
  id: string;
  parentBrandId?: string;
}

export interface OrganizationDefinition {
  id: string;
}

export interface ProductFamilyDefinition {
  id: string;
  conceptId: string;
  brandId: string;
  aliases?: readonly string[];
}

export type CommercialRoleType = 'brand_owner' | 'manufacturer' | 'marketer' | 'licensee' | 'distributor';

export interface CommercialRoleDefinition {
  id: string;
  role: CommercialRoleType;
  organizationId: string;
  countryCode: string;
  brandId?: string;
  productFamilyId?: string;
  productId?: string;
  effectiveFrom?: string;
  effectiveTo?: string;
}

export interface ProductDefinition {
  id: string;
  conceptId: string;
  brandId: string;
  aliases: readonly string[];
  shopTypeIds?: readonly string[];
  defaultUnitId?: string;
  productFamilyId?: string;
}

export interface ShopTypeDefinition { id: string; }

export interface BrandShopTypeRule {
  brandId: string;
  conceptId?: string;
  categoryId?: string;
  shopTypeIds: readonly string[];
}

export interface DefaultItemPolicy { quantity: number; unitId: string; }

export interface SemanticIndex<T> {
  readonly byId: ReadonlyMap<string, T>;
  readonly byAlias: ReadonlyMap<string, T>;
}

export type ConceptIndex = SemanticIndex<ConceptDefinition>;
export type BrandIndex = SemanticIndex<BrandDefinition>;

export interface BrainPolicy {
  acceptThreshold: number;
  ambiguityMargin: number;
  maximumSegments: number;
  maximumCandidatesPerEntity: number;
  minimumLearningSupport: number;
  defaultItem?: DefaultItemPolicy;
}

interface LayerBase {
  schemaVersion: 2;
  id: string;
  version: string;
}

export interface SemanticCoreLayer extends LayerBase {
  kind: 'core';
  dimensions: readonly { id: string; baseUnitId: string }[];
  units: readonly UnitDefinition[];
  attributes: readonly AttributeDefinition[];
}

export interface SemanticLocaleLayer extends LayerBase {
  kind: 'locale';
  locale: string;
  fallbacks: readonly string[];
  grammar: CompiledGrammar;
  numerals: Readonly<Record<string, number>>;
  unitAliases: readonly { alias: string; unitId: string; precedence?: number }[];
  conceptAliases: readonly { alias: string; conceptId: string; precedence?: number }[];
  attributeValues: Readonly<Record<string, readonly string[]>>;
  attributeMarkers?: readonly { attributeId: string; prefixes: readonly string[] }[];
  displayLabels: Readonly<Record<string, string>>;
  hints?: Readonly<Record<string, string>>;
}

export interface SemanticCountryLayer extends LayerBase {
  kind: 'country';
  countryCode: string;
  locales: readonly string[];
  shopTypes?: readonly ShopTypeDefinition[];
  categories: readonly CategoryDefinition[];
  concepts: readonly ConceptDefinition[];
  brands: readonly BrandDefinition[];
  organizations?: readonly OrganizationDefinition[];
  productFamilies?: readonly ProductFamilyDefinition[];
  products: readonly ProductDefinition[];
  descriptors?: readonly DescriptorDefinition[];
  commercialRoles?: readonly CommercialRoleDefinition[];
  brandShopTypeRules?: readonly BrandShopTypeRule[];
  policy: BrainPolicy;
}

export interface SemanticHouseholdLayer extends LayerBase {
  kind: 'household';
  householdId: string;
  conceptAliases: readonly { alias: string; conceptId: string }[];
  brandAliases: readonly { alias: string; brandId: string }[];
  quantityPreferences?: readonly { identityKey: string; quantity: number; unitId: string | null }[];
  unitPreferences?: readonly { identityKey: string; unitId: string }[];
  packagePreferences?: readonly { identityKey: string; size: number; unitId: string }[];
  descriptorPreferences?: readonly { identityKey: string; attributes: Readonly<Record<string, string | number>> }[];
  commercialRolePreferences?: readonly { identityKey: string; roles: readonly { role: string; organizationId: string }[] }[];
  canonicalAliases?: readonly { alias: string; label: string }[];
  localEntities?: readonly HouseholdSemanticEntity[];
}

export interface HouseholdSemanticEntity {
  id: string;
  kind: 'brand' | 'product' | 'concept' | 'product_family';
  label: string;
  aliases: readonly string[];
  conceptId?: string;
  brandId?: string;
  categoryId?: string;
  productFamilyId?: string;
}

export type ValidatedSemanticLayer =
  | SemanticCoreLayer
  | SemanticLocaleLayer
  | SemanticCountryLayer
  | SemanticHouseholdLayer;

export interface SemanticRuntime {
  versions: Readonly<Record<string, string>>;
  grammar: CompiledGrammar;
  numerals: ReadonlyMap<string, number>;
  units: ReadonlyMap<string, UnitDefinition>;
  unitAliases: ReadonlyMap<string, UnitDefinition>;
  categories: ReadonlyMap<string, CategoryDefinition>;
  attributes: ReadonlyMap<string, AttributeDefinition>;
  attributeValues: ReadonlyMap<string, readonly string[]>;
  attributeMarkers: ReadonlyMap<string, readonly string[]>;
  concepts: ConceptIndex;
  brands: BrandIndex;
  organizations: SemanticIndex<OrganizationDefinition>;
  productFamilies: SemanticIndex<ProductFamilyDefinition>;
  products: SemanticIndex<ProductDefinition>;
  descriptors: readonly DescriptorDefinition[];
  commercialRoles: readonly CommercialRoleDefinition[];
  shopTypes: ReadonlyMap<string, ShopTypeDefinition>;
  brandShopTypeRules: readonly BrandShopTypeRule[];
  quantityPreferences: ReadonlyMap<string, { quantity: number; unitId: string | null }>;
  unitPreferences: ReadonlyMap<string, string>;
  packagePreferences: ReadonlyMap<string, { size: number; unitId: string }>;
  descriptorPreferences: ReadonlyMap<string, Readonly<Record<string, string | number>>>;
  commercialRolePreferences: ReadonlyMap<string, readonly { role: string; organizationId: string }[]>;
  canonicalAliases: ReadonlyMap<string, string>;
  householdEntities: ReadonlyMap<string, HouseholdSemanticEntity>;
  displayLabels: Readonly<Record<string, string>>;
  hints: Readonly<Record<string, string>>;
  policy: BrainPolicy;
  maximumInputLength: number;
  maximumTemplateSteps: number;
}

class ImmutableMap<K, V> implements ReadonlyMap<K, V> {
  readonly #map: Map<K, V>;
  constructor(entries: Iterable<readonly [K, V]>) { this.#map = new Map(entries); }
  get size(): number { return this.#map.size; }
  get(key: K): V | undefined { return this.#map.get(key); }
  has(key: K): boolean { return this.#map.has(key); }
  entries(): MapIterator<[K, V]> { return this.#map.entries(); }
  keys(): MapIterator<K> { return this.#map.keys(); }
  values(): MapIterator<V> { return this.#map.values(); }
  forEach(callbackfn: (value: V, key: K, map: ReadonlyMap<K, V>) => void, thisArg?: unknown): void {
    this.#map.forEach((value, key) => callbackfn.call(thisArg, value, key, this));
  }
  [Symbol.iterator](): MapIterator<[K, V]> { return this.#map[Symbol.iterator](); }
  get [Symbol.toStringTag](): string { return 'ImmutableMap'; }
}

export function compileSemanticRuntime(layers: readonly ValidatedSemanticLayer[]): SemanticRuntime {
  const core = requireLayer(layers, 'core');
  const locale = requireLayer(layers, 'locale');
  const country = requireLayer(layers, 'country');
  const householdLayers = layers.filter((layer): layer is SemanticHouseholdLayer => layer.kind === 'household');
  layers.forEach((layer) => {
    if (layer.schemaVersion !== 2 || !layer.version.trim()) throw new TypeError('Invalid semantic layer version');
  });

  const unitsById = new Map(core.units.map((unit) => [unit.id, freezeRecord(unit)]));
  const attributesById = new Map(core.attributes.map((attribute) => [attribute.id, freezeRecord(attribute)]));
  const categoriesById = new Map(country.categories.map((category) => [category.id, freezeRecord(category)]));
  const conceptsById = new Map(country.concepts.map((concept) => [concept.id, freezeRecord(concept)]));
  const brandsById = new Map(country.brands.map((brand) => [brand.id, freezeRecord(brand)]));
  const organizationsById = new Map((country.organizations ?? []).map((organization) => [organization.id, freezeRecord(organization)]));
  const productFamiliesById = new Map((country.productFamilies ?? []).map((family) => [family.id, freezeRecord(family)]));
  const productsById = new Map(country.products.map((product) => [product.id, freezeRecord(product)]));
  const householdEntities = new Map<string, HouseholdSemanticEntity>();
  const canonicalAliases = new Map<string, string>();
  const unitPreferences = new Map<string, string>();
  const packagePreferences = new Map<string, { size: number; unitId: string }>();
  const descriptorPreferences = new Map<string, Readonly<Record<string, string | number>>>();
  const commercialRolePreferences = new Map<string, readonly { role: string; organizationId: string }[]>();
  householdLayers.flatMap((layer) => layer.canonicalAliases ?? []).forEach(({ alias, label }) => {
    canonicalAliases.set(normalizeAlias(alias), label);
  });
  householdLayers.flatMap((layer) => layer.unitPreferences ?? []).forEach(({ identityKey, unitId }) => {
    unitPreferences.set(identityKey, unitId);
  });
  householdLayers.flatMap((layer) => layer.packagePreferences ?? []).forEach(({ identityKey, size, unitId }) => {
    packagePreferences.set(identityKey, { size, unitId });
  });
  householdLayers.flatMap((layer) => layer.descriptorPreferences ?? []).forEach(({ identityKey, attributes }) => {
    descriptorPreferences.set(identityKey, freezeRecord({ ...attributes }));
  });
  householdLayers.flatMap((layer) => layer.commercialRolePreferences ?? []).forEach(({ identityKey, roles }) => {
    commercialRolePreferences.set(identityKey, Object.freeze(roles.map((role) => ({ ...role }))));
  });
  householdLayers.flatMap((layer) => layer.localEntities ?? []).forEach((entity) => {
    if (householdEntities.has(entity.id)) throw new TypeError(`Duplicate household entity ${entity.id}`);
    householdEntities.set(entity.id, freezeRecord(entity));
    if (entity.kind === 'concept') {
      if (!entity.categoryId) throw new TypeError(`Household concept ${entity.id} requires categoryId`);
      conceptsById.set(entity.id, freezeRecord({ id: entity.id, categoryId: entity.categoryId }));
    } else if (entity.kind === 'brand') {
      brandsById.set(entity.id, freezeRecord({ id: entity.id }));
    } else if (entity.kind === 'product_family') {
      if (!entity.conceptId || !entity.brandId) throw new TypeError(`Household product family ${entity.id} requires conceptId and brandId`);
      productFamiliesById.set(entity.id, freezeRecord({ id: entity.id, conceptId: entity.conceptId, brandId: entity.brandId, aliases: entity.aliases }));
    } else if (entity.kind === 'product') {
      if (!entity.conceptId || !entity.brandId) throw new TypeError(`Household product ${entity.id} requires conceptId and brandId`);
      productsById.set(entity.id, freezeRecord({
        id: entity.id,
        conceptId: entity.conceptId,
        brandId: entity.brandId,
        aliases: entity.aliases,
        productFamilyId: entity.productFamilyId,
      }));
    }
  });
  const shopTypesById = new Map((country.shopTypes ?? []).map((shopType) => [shopType.id, freezeRecord(shopType)]));
  validateCatalogReferences(core, locale, country);
  const brandShopTypeRules = (country.brandShopTypeRules ?? []).map((rule) => freezeRecord(rule));
  validateShopTypeReferences(
    country,
    unitsById,
    categoriesById,
    conceptsById,
    brandsById,
    organizationsById,
    productFamiliesById,
    shopTypesById,
    brandShopTypeRules,
  );
  const conceptAliases = new Map<string, ConceptDefinition>();
  locale.conceptAliases.forEach(({ alias, conceptId }) => {
    const concept = conceptsById.get(conceptId);
    if (concept) conceptAliases.set(normalizeAlias(alias), concept);
  });
  householdLayers.flatMap((layer) => layer.conceptAliases).forEach(({ alias, conceptId }) => {
    const concept = conceptsById.get(conceptId);
    if (!concept) throw new TypeError(`Unknown household concept ${conceptId}`);
    conceptAliases.set(normalizeAlias(alias), concept);
  });
  householdEntities.forEach((entity) => {
    if (entity.kind !== 'concept') return;
    const concept = conceptsById.get(entity.id)!;
    entity.aliases.forEach((alias) => conceptAliases.set(normalizeAlias(alias), concept));
  });
  const brandAliases = new Map<string, BrandDefinition>();
  country.products.forEach((product) => {
    const brand = brandsById.get(product.brandId);
    if (brand) product.aliases.forEach((alias) => brandAliases.set(normalizeAlias(alias), brand));
  });
  householdLayers.flatMap((layer) => layer.brandAliases).forEach(({ alias, brandId }) => {
    const brand = brandsById.get(brandId);
    if (!brand) throw new TypeError(`Unknown household brand ${brandId}`);
    brandAliases.set(normalizeAlias(alias), brand);
  });
  householdEntities.forEach((entity) => {
    if (entity.kind !== 'brand') return;
    const brand = brandsById.get(entity.id)!;
    entity.aliases.forEach((alias) => brandAliases.set(normalizeAlias(alias), brand));
  });
  const productAliases = new Map<string, ProductDefinition>();
  country.products.forEach((product) => {
    const frozen = productsById.get(product.id)!;
    product.aliases.forEach((alias) => productAliases.set(normalizeAlias(alias), frozen));
  });
  householdEntities.forEach((entity) => {
    if (entity.kind !== 'product') return;
    const product = productsById.get(entity.id)!;
    product.aliases.forEach((alias) => productAliases.set(normalizeAlias(alias), product));
  });
  const productFamilyAliases = new Map<string, ProductFamilyDefinition>();
  productFamiliesById.forEach((family) => (family.aliases ?? []).forEach((alias) => productFamilyAliases.set(normalizeAlias(alias), family)));
  const unitAliases = new Map<string, UnitDefinition>();
  locale.unitAliases.forEach(({ alias, unitId }) => {
    const unit = unitsById.get(unitId);
    if (!unit) throw new TypeError(`Unknown unit ${unitId}`);
    unitAliases.set(normalizeAlias(alias), unit);
  });

  return Object.freeze({
    versions: Object.freeze(Object.fromEntries(layers.map((layer) => [layer.id, layer.version]))),
    grammar: freezeRecord(locale.grammar),
    numerals: immutable(Object.entries(locale.numerals).map(([key, value]) => [normalizeAlias(key), value] as const)),
    units: immutable(unitsById),
    unitAliases: immutable(unitAliases),
    categories: immutable(categoriesById),
    attributes: immutable(attributesById),
    attributeValues: immutable(Object.entries(locale.attributeValues).map(([key, values]) => [key, Object.freeze([...values])] as const)),
    attributeMarkers: immutable((locale.attributeMarkers ?? []).map(({ attributeId, prefixes }) => (
      [attributeId, Object.freeze([...prefixes])] as const
    ))),
    concepts: Object.freeze({ byId: immutable(conceptsById), byAlias: immutable(conceptAliases) }),
    brands: Object.freeze({ byId: immutable(brandsById), byAlias: immutable(brandAliases) }),
    organizations: Object.freeze({ byId: immutable(organizationsById), byAlias: immutable(new Map()) }),
    productFamilies: Object.freeze({ byId: immutable(productFamiliesById), byAlias: immutable(productFamilyAliases) }),
    products: Object.freeze({ byId: immutable(productsById), byAlias: immutable(productAliases) }),
    descriptors: Object.freeze([...(country.descriptors ?? [])].map((descriptor) => freezeRecord(descriptor))),
    commercialRoles: Object.freeze([...(country.commercialRoles ?? [])].map((role) => freezeRecord(role))),
    shopTypes: immutable(shopTypesById),
    brandShopTypeRules: Object.freeze(brandShopTypeRules),
    quantityPreferences: immutable(householdLayers.flatMap((layer) => layer.quantityPreferences ?? []).map((preference) => [preference.identityKey, {
      quantity: preference.quantity,
      unitId: preference.unitId,
    }] as const)),
    canonicalAliases: immutable(canonicalAliases),
    unitPreferences: immutable(unitPreferences),
    packagePreferences: immutable(packagePreferences),
    descriptorPreferences: immutable(descriptorPreferences),
    commercialRolePreferences: immutable(commercialRolePreferences),
    householdEntities: immutable(householdEntities),
    displayLabels: freezeRecord({
      ...locale.displayLabels,
      ...Object.fromEntries([...householdEntities.values()].map((entity) => [entity.id, entity.label])),
    }),
    hints: freezeRecord({ ...(locale.hints ?? {}) }),
    policy: freezeRecord(country.policy),
    maximumInputLength: 10_000,
    maximumTemplateSteps: 50_000,
  });
}

function validateCatalogReferences(
  core: SemanticCoreLayer,
  locale: SemanticLocaleLayer,
  country: SemanticCountryLayer,
): void {
  assertUniqueIds(core.dimensions, 'dimension');
  assertUniqueIds(core.units, 'unit');
  assertUniqueIds(core.attributes, 'attribute');
  assertUniqueIds(country.categories, 'category');
  assertUniqueIds(country.concepts, 'concept');
  assertUniqueIds(country.brands, 'brand');
  assertUniqueIds(country.organizations ?? [], 'organization');
  assertUniqueIds(country.productFamilies ?? [], 'product family');
  assertUniqueIds(country.products, 'product');
  assertUniqueIds(country.shopTypes ?? [], 'shop type');
  const attributeIds = new Set(core.attributes.map((attribute) => attribute.id));
  country.categories.forEach((category) => {
    [...category.relevantAttributeIds, ...category.variantAttributeIds].forEach((attributeId) => {
      if (!attributeIds.has(attributeId)) throw new TypeError(`Category ${category.id} references unknown attribute ${attributeId}`);
    });
    Object.entries(category.measureAttributeIds ?? {}).forEach(([role, attributeId]) => {
      if (!role.trim()) throw new TypeError(`Category ${category.id} has an empty measure role`);
      if (!attributeIds.has(attributeId)) throw new TypeError(`Category ${category.id} references unknown measure attribute ${attributeId}`);
    });
  });
  const categoryIds = new Set(country.categories.map((category) => category.id));
  country.concepts.forEach((concept) => {
    if (!categoryIds.has(concept.categoryId)) throw new TypeError(`Concept ${concept.id} references unknown category ${concept.categoryId}`);
  });
  const conceptIds = new Set(country.concepts.map((concept) => concept.id));
  const brandIds = new Set(country.brands.map((brand) => brand.id));
  const organizationIds = new Set((country.organizations ?? []).map((organization) => organization.id));
  const productFamilyIds = new Set((country.productFamilies ?? []).map((family) => family.id));
  country.brands.forEach((brand) => {
    if (brand.parentBrandId && !brandIds.has(brand.parentBrandId)) throw new TypeError(`Brand ${brand.id} references unknown parent brand ${brand.parentBrandId}`);
    if (brand.parentBrandId === brand.id) throw new TypeError(`Brand ${brand.id} cannot parent itself`);
  });
  country.brands.forEach((brand) => {
    const seen = new Set<string>();
    let current = brand;
    while (current.parentBrandId) {
      if (seen.has(current.id)) throw new TypeError(`Brand parent cycle includes ${current.id}`);
      seen.add(current.id);
      current = country.brands.find((candidate) => candidate.id === current.parentBrandId)!;
    }
  });
  (country.productFamilies ?? []).forEach((family) => {
    if (!conceptIds.has(family.conceptId)) throw new TypeError(`Product family ${family.id} references unknown concept ${family.conceptId}`);
    if (!brandIds.has(family.brandId)) throw new TypeError(`Product family ${family.id} references unknown brand ${family.brandId}`);
  });
  country.products.forEach((product) => {
    if (!conceptIds.has(product.conceptId)) throw new TypeError(`Product ${product.id} references unknown concept ${product.conceptId}`);
    if (!brandIds.has(product.brandId)) throw new TypeError(`Product ${product.id} references unknown brand ${product.brandId}`);
    if (product.defaultUnitId && !core.units.some((unit) => unit.id === product.defaultUnitId)) {
      throw new TypeError(`Product ${product.id} references unknown default unit ${product.defaultUnitId}`);
    }
    if (product.productFamilyId && !productFamilyIds.has(product.productFamilyId)) {
      throw new TypeError(`Product ${product.id} references unknown product family ${product.productFamilyId}`);
    }
  });
  (country.descriptors ?? []).forEach((descriptor) => {
    if (descriptor.attributeId && !attributeIds.has(descriptor.attributeId)) throw new TypeError(`Descriptor ${descriptor.alias} references unknown attribute ${descriptor.attributeId}`);
    (descriptor.categoryIds ?? []).forEach((categoryId) => {
      if (!categoryIds.has(categoryId)) throw new TypeError(`Descriptor ${descriptor.alias} references unknown category ${categoryId}`);
    });
    (descriptor.conceptIds ?? []).forEach((conceptId) => {
      if (!conceptIds.has(conceptId)) throw new TypeError(`Descriptor ${descriptor.alias} references unknown concept ${conceptId}`);
    });
    if (descriptor.role === 'identity_attribute' && (!descriptor.attributeId || descriptor.value === undefined)) {
      throw new TypeError(`Identity descriptor ${descriptor.alias} requires attributeId and value`);
    }
  });
  (country.commercialRoles ?? []).forEach((role) => {
    if (!organizationIds.has(role.organizationId)) throw new TypeError(`Commercial role ${role.id} references unknown organization ${role.organizationId}`);
    if (!role.brandId && !role.productFamilyId && !role.productId) throw new TypeError(`Commercial role ${role.id} must target a brand, product family, or product`);
    if (role.brandId && !brandIds.has(role.brandId)) throw new TypeError(`Commercial role ${role.id} references unknown brand ${role.brandId}`);
    if (role.productFamilyId && !productFamilyIds.has(role.productFamilyId)) throw new TypeError(`Commercial role ${role.id} references unknown product family ${role.productFamilyId}`);
    if (role.productId && !country.products.some((product) => product.id === role.productId)) throw new TypeError(`Commercial role ${role.id} references unknown product ${role.productId}`);
    if (role.effectiveFrom && role.effectiveTo && role.effectiveFrom > role.effectiveTo) throw new TypeError(`Commercial role ${role.id} has an invalid effective date range`);
  });
  Object.keys(locale.attributeValues).forEach((attributeId) => {
    if (!attributeIds.has(attributeId)) throw new TypeError(`Locale references unknown attribute ${attributeId}`);
  });
}

function assertUniqueIds(values: readonly { id: string }[], label: string): void {
  const seen = new Set<string>();
  values.forEach(({ id }) => {
    if (seen.has(id)) throw new TypeError(`Duplicate ${label} id ${id}`);
    seen.add(id);
  });
}

function validateShopTypeReferences(
  country: SemanticCountryLayer,
  units: ReadonlyMap<string, UnitDefinition>,
  categories: ReadonlyMap<string, CategoryDefinition>,
  concepts: ReadonlyMap<string, ConceptDefinition>,
  brands: ReadonlyMap<string, BrandDefinition>,
  organizations: ReadonlyMap<string, OrganizationDefinition>,
  productFamilies: ReadonlyMap<string, ProductFamilyDefinition>,
  shopTypes: ReadonlyMap<string, ShopTypeDefinition>,
  brandRules: readonly BrandShopTypeRule[],
): void {
  const ensureShopTypes = (ids: readonly string[] | undefined, label: string): void => {
    (ids ?? []).forEach((id) => {
      if (!shopTypes.has(id)) throw new TypeError(`${label} references unknown shop type ${id}`);
    });
  };
  country.categories.forEach((category) => ensureShopTypes(category.shopTypeIds, `Category ${category.id}`));
  country.concepts.forEach((concept) => ensureShopTypes(concept.shopTypeIds, `Concept ${concept.id}`));
  country.products.forEach((product) => ensureShopTypes(product.shopTypeIds, `Product ${product.id}`));
  brandRules.forEach((rule) => {
    if (!brands.has(rule.brandId)) throw new TypeError(`Unknown brand ${rule.brandId}`);
    if (!rule.conceptId && !rule.categoryId) throw new TypeError(`Brand shop type rule ${rule.brandId} is not scoped`);
    if (rule.conceptId && !concepts.has(rule.conceptId)) throw new TypeError(`Unknown concept ${rule.conceptId}`);
    if (rule.categoryId && !categories.has(rule.categoryId)) throw new TypeError(`Unknown category ${rule.categoryId}`);
    ensureShopTypes(rule.shopTypeIds, `Brand shop type rule ${rule.brandId}`);
  });
  if (country.policy.defaultItem) {
    const { quantity, unitId } = country.policy.defaultItem;
    if (!Number.isFinite(quantity) || quantity <= 0 || !units.has(unitId)) {
      throw new TypeError('Invalid default item policy');
    }
  }
}

function requireLayer<K extends ValidatedSemanticLayer['kind']>(
  layers: readonly ValidatedSemanticLayer[],
  kind: K,
): Extract<ValidatedSemanticLayer, { kind: K }> {
  const matching = layers.filter((layer): layer is Extract<ValidatedSemanticLayer, { kind: K }> => layer.kind === kind);
  if (matching.length !== 1) throw new TypeError(`Semantic runtime requires exactly one ${kind} layer`);
  return matching[0];
}

function immutable<K, V>(entries: Iterable<readonly [K, V]> | ReadonlyMap<K, V>): ReadonlyMap<K, V> {
  return Object.freeze(new ImmutableMap(entries));
}

function freezeRecord<T>(value: T): T {
  if (Array.isArray(value)) {
    value.forEach(freezeRecord);
    return Object.freeze(value) as T;
  }
  if (value && typeof value === 'object') {
    Object.values(value as Record<string, unknown>).forEach(freezeRecord);
    return Object.freeze(value);
  }
  return value;
}

function normalizeAlias(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase();
}
