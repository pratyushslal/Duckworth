import type { CaptureInterpretation } from '../../item-capture/dist/index.js';
import type {
  BrainWarning,
  DescriptorMention,
  ItemClassification,
  SemanticCommercialRole,
  SemanticEvidence,
  SemanticItem,
  SemanticMeasure,
  SemanticMeasurement,
  SemanticValue,
} from './contracts.js';
import { extractDomainSemantics, reconcileDomainSemantics, type DomainSemanticExtraction } from './domain-semantics.js';
import { assertSemanticItemCompatible } from './semantic-validation.js';
import type {
  CategoryDefinition,
  ConceptDefinition,
  DescriptorDefinition,
  ProductDefinition,
  SemanticRuntime,
} from './semantic-runtime.js';

export interface EntityCandidate<T> {
  value: T;
  score: number;
  evidence: readonly SemanticEvidence[];
}

export interface SemanticItemAlternative {
  item: SemanticItem;
  reasonCode: string;
}

export function resolveSemanticItem(
  capture: CaptureInterpretation,
  runtime: SemanticRuntime,
): { item: SemanticItem; alternatives: readonly SemanticItemAlternative[]; warnings: readonly BrainWarning[] } {
  const extractedDomain = extractDomainSemantics(capture.captureText, runtime);
  const netContentWithoutRequestedQuantity = extractedDomain.requested === undefined
    && extractedDomain.measures.some((measure) => measure.role === 'net_content'
      && measure.value.kind === 'scalar'
      && capture.quantity === measure.value.amount.value
      && capture.unit === measure.value.amount.unitId);
  // The grammar interpreter remains authoritative when it already found a
  // concrete container. Domain enrichment only replaces its surface parse for
  // an otherwise raw capture or a domain-specific container/attribute form.
  const useDomainSurface = extractedDomain.itemName !== undefined && (
    (extractedDomain.requested !== undefined && (
      capture.name === capture.captureText
      || (extractedDomain.requested.unitId !== 'piece' && (capture.unit === null || capture.unit === 'piece'))
    ))
    || netContentWithoutRequestedQuantity
    || extractedDomain.measures.some((measure) => measure.value.kind === 'ratio')
    || (Object.keys(extractedDomain.attributes).length > 0 && capture.quantity !== null)
  );
  const domainPackage = extractedDomain.legacyPackage
    ? { packageSize: extractedDomain.legacyPackage.size, packageUnit: extractedDomain.legacyPackage.unitId }
    : { packageSize: capture.packageSize, packageUnit: capture.packageUnit };
  const resolvedCapture = useDomainSurface && extractedDomain.itemName ? {
    ...capture,
    name: extractedDomain.itemName,
    quantity: extractedDomain.requested?.quantity ?? (netContentWithoutRequestedQuantity ? null : capture.quantity),
    unit: extractedDomain.requested?.unitId ?? (netContentWithoutRequestedQuantity ? null : capture.unit),
    ...domainPackage,
  } : { ...capture, ...domainPackage };
  const itemSpan = sourceSpan(resolvedCapture.captureText, resolvedCapture.name);
  const productMatches = matchingProducts(resolvedCapture.name, runtime);
  if (productMatches.length > 1) {
    const alternatives = productMatches.map((product) => ({
      item: buildItem(resolvedCapture, runtime, product, runtime.concepts.byId.get(product.conceptId), itemSpan, extractedDomain),
      reasonCode: 'ambiguous_product_alias',
    }));
    return {
      item: buildItem(resolvedCapture, runtime, undefined, resolveConcept(resolvedCapture.name, runtime), itemSpan, extractedDomain),
      alternatives,
      warnings: [],
    };
  }
  const product = productMatches[0];
  const concept = product
    ? runtime.concepts.byId.get(product.conceptId)
    : resolveConcept(resolvedCapture.name, runtime);
  return { item: buildItem(resolvedCapture, runtime, product, concept, itemSpan, extractedDomain), alternatives: [], warnings: [] };
}

function buildItem(
  capture: CaptureInterpretation,
  runtime: SemanticRuntime,
  product: ProductDefinition | undefined,
  concept: ConceptDefinition | undefined,
  itemSpan: SemanticEvidence,
  domain: DomainSemanticExtraction,
): SemanticItem {
  const catalogEvidence = product
    ? [{ kind: 'catalog_match', ref: product.id } as const]
    : concept
      ? [{ kind: 'catalog_match', ref: concept.id } as const]
      : [];
  const category = concept
    ? runtime.categories.get(concept.categoryId)
    : inferCategory(domain.itemName ?? capture.name, runtime);
  const resolvedDomain = reconcileDomainSemantics(
    domain,
    category,
    capture.packageSize,
    capture.packageUnit,
    runtime,
  );
  const categoryEvidence = concept
    ? catalogEvidence
    : category
      ? signalEvidence(capture.captureText, capture.name, category.signals)
      : [];
  const requestedEvidence = capture.quantity === null ? [] : [grammarEvidence('requested_count')];
  const defaultUnitId = capture.unitExplicit === false ? product?.defaultUnitId : undefined;
  let requestedUnitId = defaultUnitId ?? capture.unit;
  let unitEvidence = requestedUnitId === null || requestedUnitId === undefined ? [] : [grammarEvidence(defaultUnitId ? 'catalog_default_unit' : 'requested_unit')];
  const packageContainerUnitId = capture.packageContainerUnit ?? null;
  const packageRole = capture.packageUnit === null ? undefined : category?.unitRoles?.[capture.packageUnit];
  const explicitPackageMeasure = capture.packageSize === null || capture.packageUnit === null
    || (category && packageRole !== 'net_content' && packageRole !== 'contained_count')
    ? null
    : measurement(capture.packageSize, capture.packageUnit, runtime);
  const attributes = category ? resolveAttributes(capture, category, runtime) : {};
  const descriptorMentions: DescriptorMention[] = capture.packQualifier && capture.packQualifierSpan
    ? [{
        surface: capture.packQualifier,
        normalized: normalize(capture.packQualifier),
        sourceStart: capture.packQualifierSpan.start,
        sourceEnd: capture.packQualifierSpan.end,
        role: 'packaging_qualifier',
        evidence: [grammarEvidence('pack_qualifier')],
      }]
    : [];
  const resolvedDescriptors = resolveDescriptors(capture, category, concept, runtime);
  descriptorMentions.push(...resolvedDescriptors);
  descriptorMentions.push(...resolveUnknownDescriptors(capture, category, product, resolvedDescriptors));
  const descriptorAttributes = Object.fromEntries(resolvedDescriptors
    .filter((descriptor): descriptor is DescriptorMention & { attributeId: string; value: string | number } => (
      descriptor.role === 'identity_attribute'
      && 'attributeId' in descriptor && typeof descriptor.attributeId === 'string'
      && 'value' in descriptor && (typeof descriptor.value === 'string' || typeof descriptor.value === 'number')
    ))
    .map((descriptor) => [descriptor.attributeId, semantic(descriptor.value, 'confirmed', descriptor.evidence)]));
  const domainAttributes = Object.fromEntries(Object.entries(resolvedDomain.attributes)
    .filter(([attributeId]) => category ? categoryAttributeIds(category).has(attributeId) : false)
    .map(([attributeId, value]) => [attributeId, semantic(value, 'confirmed', [grammarEvidence(`domain_attribute:${attributeId}`)])]));
  const measureAttributes = Object.fromEntries(resolvedDomain.measures.map((measure) => [
    `measure:${measure.role}`,
    semantic(measureLabel(measure), 'confirmed', measure.evidence),
  ]));
  const mappedMeasureAttributes = Object.fromEntries(resolvedDomain.measures.flatMap((measure) => {
    const attributeId = category?.measureAttributeIds?.[measure.role];
    return attributeId ? [[attributeId, semantic(measureLabel(measure), 'confirmed', measure.evidence)]] : [];
  }));
  const resolvedAttributes = {
    ...attributes,
    ...descriptorAttributes,
    ...domainAttributes,
    ...measureAttributes,
    ...mappedMeasureAttributes,
  };
  const conceptKey = concept?.id ?? normalize(capture.name);
  // Keep an unrecognized or partially recognized phrase distinct from a
  // reviewed concept (for example, "oat milk" must not collapse into
  // "milk"). Household preferences may still fall back to the reviewed
  // concept key below.
  const variantConceptKey = product ? conceptKey : normalize(capture.name);
  const baseIdentityKey = [variantConceptKey, product?.brandId]
    .filter((value): value is string => Boolean(value))
    .join('|');
  const preferenceKeys = [
    baseIdentityKey,
    ...(concept && conceptKey !== baseIdentityKey ? [conceptKey] : []),
  ];
  const learnedAttributes = Object.fromEntries(
    Object.entries(preferenceKeys
      .map((key) => runtime.descriptorPreferences.get(key))
      .find((value): value is Readonly<Record<string, string | number>> => value !== undefined) ?? {})
      .filter(([attributeId]) => category ? categoryAttributeIds(category).has(attributeId) : false)
      .map(([attributeId, value]) => [attributeId, semantic(value, 'confirmed', [{ kind: 'household_confirmation', ref: 'household-learning' }])]),
  );
  const resolvedWithLearning: Record<string, SemanticValue<string | number>> = { ...learnedAttributes, ...resolvedAttributes };
  const catalogRoles = resolveCommercialRoles(product, runtime);
  const learnedRoles = preferenceKeys
    .map((key) => runtime.commercialRolePreferences.get(key))
    .find((value): value is readonly { role: string; organizationId: string }[] => value !== undefined)
    ?.map((role) => ({
    role: role.role as SemanticCommercialRole['role'],
    organizationId: role.organizationId,
    confidence: 'confirmed' as const,
    evidence: [{ kind: 'household_confirmation' as const, ref: 'household-learning' }],
  })) ?? [];
  const commercialRoles = catalogRoles.length > 0 ? catalogRoles : learnedRoles;
  const variantParts = category?.variantAttributeIds
    .flatMap((attributeId) => resolvedWithLearning[attributeId]?.value === undefined
      ? []
      : [`${attributeId}:${String(resolvedWithLearning[attributeId].value)}`]) ?? [];
  const learnedUnitId = preferenceKeys
    .map((key) => runtime.unitPreferences.get(key))
    .find((value): value is string => value !== undefined)
    ?? runtime.unitPreferences.get([baseIdentityKey, ...variantParts].filter(Boolean).join('|'));
  if ((requestedUnitId === null || requestedUnitId === undefined) && learnedUnitId) {
    requestedUnitId = learnedUnitId;
    unitEvidence = [grammarEvidence('household_unit_default')];
  }
  const baseVariantKey = [
    variantConceptKey,
    product?.brandId,
    ...variantParts,
  ]
    .filter((value): value is string => Boolean(value))
    .join('|');
  const learnedPackage = preferenceKeys
    .map((key) => runtime.packagePreferences.get(key))
    .find((value): value is { size: number; unitId: string } => value !== undefined)
    ?? runtime.packagePreferences.get(baseVariantKey);
  const packageMeasure = explicitPackageMeasure ?? (learnedPackage
    ? measurement(learnedPackage.size, learnedPackage.unitId, runtime)
    : null);
  const packageEvidence = explicitPackageMeasure === null && packageMeasure !== null
    ? [grammarEvidence('household_package_default')]
    : explicitPackageMeasure === null ? [] : [grammarEvidence('package_measure')];
  const variantKey = [
    baseVariantKey,
    packageMeasure && `${packageMeasure.value}:${packageMeasure.unitId}`,
    packageContainerUnitId && `container:${packageContainerUnitId}`,
  ]
    .filter((value): value is string => Boolean(value))
    .join('|');
  const requestKey = [variantKey, capture.quantity, requestedUnitId].filter((value) => value !== null && value !== undefined).join('|');
  const item: SemanticItem = {
    itemName: semantic(product ? (runtime.displayLabels[product.id] ?? capture.name) : (runtime.canonicalAliases.get(normalize(capture.name)) ?? capture.name), 'confirmed', [itemSpan]),
    conceptId: semantic(concept?.id ?? null, concept ? 'confirmed' : 'unknown', catalogEvidence),
    brandId: semantic(product?.brandId ?? null, product ? 'confirmed' : 'unknown', product ? catalogEvidence : []),
    ...(product?.productFamilyId
      ? { productFamilyId: semantic(product.productFamilyId, 'confirmed', catalogEvidence) }
      : {}),
    productId: semantic(product?.id ?? null, product ? 'confirmed' : 'unknown', product ? catalogEvidence : []),
    categoryId: semantic(category?.id ?? null, category ? (concept ? 'confirmed' : 'inferred') : 'unknown', categoryEvidence),
    requestedCount: semantic(capture.quantity, capture.quantity === null ? 'unknown' : 'confirmed', requestedEvidence),
    requestedUnitId: semantic(requestedUnitId ?? null, requestedUnitId === null || requestedUnitId === undefined ? 'unknown' : defaultUnitId ? 'inferred' : 'confirmed', unitEvidence),
    packageMeasure: semantic(packageMeasure, packageMeasure === null ? 'unknown' : 'confirmed', packageEvidence),
    packageContainerUnitId: semantic(
      packageContainerUnitId,
      packageContainerUnitId === null ? 'unknown' : 'confirmed',
      packageContainerUnitId === null ? [] : [grammarEvidence('package_container')],
    ),
    attributes: resolvedWithLearning,
    semanticVersion: 4,
    measures: resolvedDomain.measures,
    packaging: resolvedDomain.packaging,
    ...(descriptorMentions.length > 0 ? { descriptorMentions } : {}),
    ...(commercialRoles.length > 0 ? { commercialRoles } : {}),
    identity: { conceptKey, variantKey, requestKey },
  };
  assertSemanticItemCompatible(item, runtime);
  return item;
}

function measureLabel(measure: SemanticMeasure): string {
  if (measure.value.kind === 'scalar') return `${measure.value.amount.value} ${measure.value.amount.unitId}`;
  return `${measure.value.numerator.value} ${measure.value.numerator.unitId}/${measure.value.denominator.value} ${measure.value.denominator.unitId}`;
}

export function classifyShoppingItem(item: SemanticItem, runtime: SemanticRuntime): ItemClassification {
  const categoryId = item.categoryId.value;
  const product = item.productId?.value ? runtime.products.byId.get(item.productId.value) : undefined;
  const concept = item.conceptId.value ? runtime.concepts.byId.get(item.conceptId.value) : undefined;
  const tagIds = product?.shopTypeIds?.length
    ? product.shopTypeIds
    : concept?.shopTypeIds?.length
      ? concept.shopTypeIds
      : matchingScopedBrandRule(item, categoryId, runtime)?.shopTypeIds
        ?? runtime.categories.get(categoryId ?? '')?.shopTypeIds
        ?? [];
  const evidence = product?.id
    ? [{ kind: 'catalog_match', ref: product.id } as const]
    : concept?.id
      ? [{ kind: 'catalog_match', ref: concept.id } as const]
      : categoryId
        ? item.categoryId.evidence
        : [];
  const defaultItem = runtime.policy.defaultItem;
  const learnedPreference = runtime.quantityPreferences.get(item.identity.variantKey);
  const learnedUnit = runtime.unitPreferences.get(item.identity.variantKey);
  return {
    automaticCategory: item.categoryId,
    categoryOverride: null,
    effectiveCategoryId: categoryId,
    automaticShopTypes: tagIds.map((tagId) => ({
      tagId,
      confidence: 'inferred' as const,
      evidence,
      semanticIdentityKey: item.identity.variantKey,
      runtimeVersions: runtime.versions,
    })),
    shopTypeOverrides: [],
    defaultedQuantity: item.requestedCount.value === null
      ? learnedPreference
        ? { value: learnedPreference.quantity, source: 'policy_default' }
        : { value: defaultItem?.quantity ?? null, source: defaultItem ? 'policy_default' : 'explicit' }
      : { value: item.requestedCount.value, source: 'explicit' },
    defaultedUnitId: item.requestedUnitId.value === null
      ? (learnedPreference?.unitId ?? learnedUnit)
        ? { value: learnedPreference?.unitId ?? learnedUnit ?? null, source: 'policy_default' }
        : { value: defaultItem?.unitId ?? null, source: defaultItem ? 'policy_default' : 'explicit' }
      : { value: item.requestedUnitId.value, source: 'explicit' },
  };
}

function matchingScopedBrandRule(
  item: SemanticItem,
  categoryId: string | null,
  runtime: SemanticRuntime,
): import('./semantic-runtime.js').BrandShopTypeRule | undefined {
  if (!item.brandId.value) return undefined;
  return runtime.brandShopTypeRules.find((rule) => (
    rule.brandId === item.brandId.value
    && (!rule.conceptId || rule.conceptId === item.conceptId.value)
    && (!rule.categoryId || rule.categoryId === categoryId)
  ));
}

function resolveConcept(name: string, runtime: SemanticRuntime): ConceptDefinition | undefined {
  const normalized = normalize(name);
  const exact = runtime.concepts.byAlias.get(normalized);
  if (exact) return exact;
  const matches = [...runtime.concepts.byAlias.entries()]
    .filter(([alias]) => containsPhrase(normalized, alias))
    .sort(([left], [right]) => right.length - left.length);
  return matches[0]?.[1];
}

function matchingProducts(name: string, runtime: SemanticRuntime): ProductDefinition[] {
  const normalized = normalize(name);
  return [...runtime.products.byId.values()]
    .filter((product) => product.aliases.some((alias) => containsPhrase(normalized, normalize(alias))))
    .sort((left, right) => left.id.localeCompare(right.id));
}

function inferCategory(name: string, runtime: SemanticRuntime): CategoryDefinition | undefined {
  const normalized = normalize(name);
  return [...runtime.categories.values()]
    .map((category) => ({
      category,
      length: Math.max(0, ...category.signals.filter((signal) => containsPhrase(normalized, normalize(signal))).map((signal) => signal.length)),
    }))
    .filter(({ length }) => length > 0)
    .sort((left, right) => right.length - left.length || left.category.id.localeCompare(right.category.id))[0]?.category;
}

function resolveAttributes(
  capture: CaptureInterpretation,
  category: CategoryDefinition,
  runtime: SemanticRuntime,
): Readonly<Record<string, SemanticValue<string | number>>> {
  const attributes: Record<string, SemanticValue<string | number>> = {};
  const normalized = normalize(capture.name);
  for (const attributeId of category.relevantAttributeIds) {
    const values = runtime.attributeValues.get(attributeId) ?? [];
    const value = [...values].sort((left, right) => right.length - left.length)
      .find((candidate) => containsPhrase(normalized, normalize(candidate)));
    if (value) {
      attributes[attributeId] = semantic(value, 'confirmed', [sourceSpan(capture.captureText, value)]);
      continue;
    }
    const markers = runtime.attributeMarkers.get(attributeId) ?? [];
    for (const marker of markers) {
      const extracted = valueAfterMarker(capture.name, marker);
      if (extracted) {
        attributes[attributeId] = semantic(extracted, 'confirmed', [sourceSpan(capture.captureText, extracted)]);
        break;
      }
    }
  }
  return Object.freeze(attributes);
}

function categoryAttributeIds(category: CategoryDefinition): Set<string> {
  return new Set([
    ...category.relevantAttributeIds,
    ...Object.values(category.measureAttributeIds ?? {}),
  ]);
}

function resolveDescriptors(
  capture: CaptureInterpretation,
  category: CategoryDefinition | undefined,
  concept: ConceptDefinition | undefined,
  runtime: SemanticRuntime,
): Array<DescriptorMention & Partial<Pick<DescriptorDefinition, 'attributeId' | 'value'>>> {
  const normalized = normalize(capture.name);
  return runtime.descriptors
    .filter((descriptor) => (descriptor.categoryIds ?? []).length === 0 || descriptor.categoryIds?.includes(category?.id ?? ''))
    .filter((descriptor) => (descriptor.conceptIds ?? []).length === 0 || descriptor.conceptIds?.includes(concept?.id ?? ''))
    .filter((descriptor) => containsPhrase(normalized, normalize(descriptor.alias)))
    .map((descriptor) => {
      const span = sourceSpan(capture.captureText, descriptor.alias);
      return {
        surface: descriptor.alias,
        normalized: normalize(descriptor.alias),
        sourceStart: span.sourceStart ?? 0,
        sourceEnd: span.sourceEnd ?? descriptor.alias.length,
        role: descriptor.role,
        evidence: [{ kind: 'catalog_match', ref: `descriptor:${descriptor.alias}` } as const],
        ...(descriptor.attributeId ? { attributeId: descriptor.attributeId } : {}),
        ...(descriptor.value !== undefined ? { value: descriptor.value } : {}),
      };
    });
}

function resolveUnknownDescriptors(
  capture: CaptureInterpretation,
  category: CategoryDefinition | undefined,
  product: ProductDefinition | undefined,
  resolved: readonly DescriptorMention[],
): DescriptorMention[] {
  const known = [
    ...(product?.aliases ?? []),
    ...(category?.signals ?? []),
    ...resolved.map((descriptor) => descriptor.surface),
  ].map(normalize).filter(Boolean).sort((left, right) => right.length - left.length);
  const name = capture.name;
  const normalized = normalize(name);
  let remainder = normalized;
  known.forEach((phrase) => { remainder = remainder.replaceAll(phrase, ' '); });
  const unknown = remainder.match(/[\p{L}\p{N}][\p{L}\p{N}-]*/gu) ?? [];
  return unknown.flatMap((token) => {
    const sourceStart = name.toLocaleLowerCase().indexOf(token.toLocaleLowerCase());
    if (sourceStart < 0) return [];
    return [{
      surface: name.slice(sourceStart, sourceStart + token.length),
      normalized: token,
      sourceStart,
      sourceEnd: sourceStart + token.length,
      role: 'unknown' as const,
      evidence: [{ kind: 'source_span' as const, sourceStart, sourceEnd: sourceStart + token.length }],
    }];
  });
}

function resolveCommercialRoles(product: ProductDefinition | undefined, runtime: SemanticRuntime): SemanticCommercialRole[] {
  if (!product) return [];
  const familyId = product.productFamilyId;
  return runtime.commercialRoles
    .filter((role) => (
      role.productId === product.id
      || (familyId !== undefined && role.productFamilyId === familyId)
      || role.brandId === product.brandId
    ))
    .map((role) => ({
      role: role.role,
      organizationId: role.organizationId,
      confidence: 'confirmed' as const,
      evidence: [{ kind: 'catalog_match', ref: role.id } as const],
    }));
}

function measurement(value: number, unitId: string, runtime: SemanticRuntime): SemanticMeasurement {
  const unit = runtime.units.get(unitId);
  if (!unit?.dimensionId || unit.factorToBase === undefined) return { value, unitId };
  const base = [...runtime.units.values()].find((candidate) => (
    candidate.dimensionId === unit.dimensionId && candidate.factorToBase === 1
  ));
  return {
    value,
    unitId,
    comparisonValue: value * unit.factorToBase,
    comparisonUnitId: base?.id ?? unitId,
  };
}

function semantic<T>(
  value: T,
  confidence: SemanticValue<T>['confidence'],
  evidence: readonly SemanticEvidence[],
): SemanticValue<T> {
  return { value, confidence, evidence: Object.freeze([...evidence]) };
}

function sourceSpan(source: string, value: string): SemanticEvidence {
  const normalizedSource = normalize(source);
  const normalizedValue = normalize(value);
  const normalizedStart = normalizedSource.indexOf(normalizedValue);
  const sourceStart = normalizedStart < 0 ? 0 : source.toLowerCase().indexOf(value.toLowerCase());
  const safeStart = sourceStart < 0 ? 0 : sourceStart;
  return { kind: 'source_span', sourceStart: safeStart, sourceEnd: safeStart + value.length };
}

function signalEvidence(source: string, name: string, signals: readonly string[]): SemanticEvidence[] {
  const normalized = normalize(name);
  const signal = signals.find((candidate) => containsPhrase(normalized, normalize(candidate)));
  return signal ? [sourceSpan(source, signal)] : [];
}

function grammarEvidence(ref: string): SemanticEvidence {
  return { kind: 'grammar_rule', ref };
}

function valueAfterMarker(text: string, marker: string): string | null {
  const normalizedText = normalize(text);
  const normalizedMarker = normalize(marker);
  const index = normalizedText.indexOf(`${normalizedMarker} `);
  if (index < 0) return null;
  const originalIndex = text.toLowerCase().indexOf(marker.toLowerCase());
  if (originalIndex < 0) return null;
  const value = text.slice(originalIndex + marker.length).trim();
  return value || null;
}

function containsPhrase(text: string, phrase: string): boolean {
  return text === phrase || text.startsWith(`${phrase} `) || text.endsWith(` ${phrase}`) || text.includes(` ${phrase} `);
}

function normalize(value: string): string {
  return value.normalize('NFKC').toLowerCase().trim().replace(/\s+/gu, ' ');
}
