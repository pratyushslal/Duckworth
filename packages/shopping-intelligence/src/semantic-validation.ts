import type { SemanticItem, SemanticMeasure } from './contracts.js';
import type { CategoryDefinition, SemanticRuntime } from './semantic-runtime.js';

export class IncompatibleSemanticItemError extends TypeError {
  constructor(readonly reason: string) {
    super(`Incompatible semantic item: ${reason}`);
  }
}

/**
 * Enforces the postcondition shared by all semantic write paths. This is
 * intentionally runtime-driven: categories own the role/unit compatibility
 * data and application code only checks the contract shape.
 */
export function assertSemanticItemCompatible(item: SemanticItem, runtime: SemanticRuntime): void {
  const categoryId = item.categoryId.value;
  const category = categoryId ? runtime.categories.get(categoryId) : undefined;
  if (!category) {
    if (item.measures?.length) throw new IncompatibleSemanticItemError('measures require a known category');
    return;
  }

  const conceptId = item.conceptId.value;
  const concept = conceptId ? runtime.concepts.byId.get(conceptId) : undefined;
  if (concept && concept.categoryId !== category.id) {
    throw new IncompatibleSemanticItemError(`concept ${concept.id} does not belong to category ${category.id}`);
  }
  const productId = item.productId?.value;
  const product = productId ? runtime.products.byId.get(productId) : undefined;
  if (product && (!concept || product.conceptId !== concept.id)) {
    throw new IncompatibleSemanticItemError(`product ${product.id} does not match the resolved concept`);
  }

  for (const measure of item.measures ?? []) {
    assertMeasureCompatible(measure, category, runtime);
  }

  if (item.packageMeasure.value !== null) {
    const unitId = item.packageMeasure.value.unitId;
    const packageRole = category.unitRoles?.[unitId];
    if (packageRole !== 'net_content' && packageRole !== 'contained_count') {
      throw new IncompatibleSemanticItemError(`package unit ${unitId} is not a category net-content unit`);
    }
  }

  if (item.packageContainerUnitId?.value !== null && item.packageContainerUnitId?.value !== undefined) {
    const unit = runtime.units.get(item.packageContainerUnitId.value);
    if (!unit || (unit.capability !== 'container' && unit.capability !== 'both')) {
      throw new IncompatibleSemanticItemError(`package container ${item.packageContainerUnitId.value} is not a container unit`);
    }
  }

  const allowedAttributes = new Set([
    ...category.relevantAttributeIds,
    ...Object.values(category.measureAttributeIds ?? {}),
  ]);
  const measureRoles = new Set((item.measures ?? []).map((measure) => measure.role));
  for (const attributeId of Object.keys(item.attributes)) {
    if (attributeId.startsWith('measure:')) {
      const role = attributeId.slice('measure:'.length);
      if (!measureRoles.has(role as SemanticMeasure['role'])) throw new IncompatibleSemanticItemError(`attribute ${attributeId} has no measure`);
      continue;
    }
    if (!allowedAttributes.has(attributeId)) {
      throw new IncompatibleSemanticItemError(`attribute ${attributeId} is not allowed for category ${category.id}`);
    }
  }
}

/**
 * Drops inherited facts that no longer apply after a category/concept change.
 * This is used only at correction/merge boundaries; newly produced resolver
 * output is still required to pass the strict assertion above.
 */
export function normalizeSemanticItemForRuntime(item: SemanticItem, runtime: SemanticRuntime): SemanticItem {
  const categoryId = item.categoryId.value;
  const category = categoryId ? runtime.categories.get(categoryId) : undefined;
  if (!category) {
    return {
      ...item,
      measures: [],
      packaging: [],
      packageMeasure: item.packageMeasure.value === null
        ? item.packageMeasure
        : { ...item.packageMeasure, value: null, confidence: 'unknown', evidence: [] },
      attributes: {},
      semanticVersion: 4,
    };
  }
  const measures = (item.measures ?? []).filter((measure) => measureAllowedByCategory(measure, category));
  const measureRoles = new Set(measures.map((measure) => measure.role));
  const allowedAttributes = new Set([
    ...category.relevantAttributeIds,
    ...Object.values(category.measureAttributeIds ?? {}),
  ]);
  const attributes = Object.fromEntries(Object.entries(item.attributes).filter(([attributeId]) => {
    if (attributeId.startsWith('measure:')) return measureRoles.has(attributeId.slice('measure:'.length) as SemanticMeasure['role']);
    return allowedAttributes.has(attributeId);
  }));
  const packageMeasure = item.packageMeasure.value === null
    || category.unitRoles?.[item.packageMeasure.value.unitId] === 'net_content'
    || category.unitRoles?.[item.packageMeasure.value.unitId] === 'contained_count'
    ? item.packageMeasure
    : { ...item.packageMeasure, value: null, confidence: 'unknown' as const, evidence: [] };
  return { ...item, measures, attributes, packageMeasure, semanticVersion: 4 };
}

function assertMeasureCompatible(
  measure: SemanticMeasure,
  category: CategoryDefinition,
  runtime: SemanticRuntime,
): void {
  const value = measure.value;
  if (value.kind === 'scalar') {
    const unit = runtime.units.get(value.amount.unitId);
    if (!unit || (unit.capability !== 'measure' && unit.capability !== 'both')) {
      throw new IncompatibleSemanticItemError(`measure unit ${value.amount.unitId} is not measurable`);
    }
    if (category.unitRoles?.[unit.id] !== measure.role) {
      throw new IncompatibleSemanticItemError(`role ${measure.role} is not allowed for unit ${unit.id} in category ${category.id}`);
    }
    return;
  }

  const ratioAllowed = category.ratioRoles?.some((rule) => (
    rule.role === measure.role
    && rule.numeratorUnitIds.includes(value.numerator.unitId)
    && rule.denominatorUnitIds.includes(value.denominator.unitId)
  ));
  if (!ratioAllowed) {
    throw new IncompatibleSemanticItemError(`ratio role ${measure.role} is not allowed in category ${category.id}`);
  }
}

function measureAllowedByCategory(measure: SemanticMeasure, category: CategoryDefinition): boolean {
  const value = measure.value;
  if (value.kind === 'scalar') return category.unitRoles?.[value.amount.unitId] === measure.role;
  return category.ratioRoles?.some((rule) => (
    rule.role === measure.role
    && rule.numeratorUnitIds.includes(value.numerator.unitId)
    && rule.denominatorUnitIds.includes(value.denominator.unitId)
  )) === true;
}
