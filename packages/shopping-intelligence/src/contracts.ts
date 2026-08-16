import type { CommercialRoleType } from './semantic-runtime.js';

export interface BrainCaptureEnvelope {
  schemaVersion: 2;
  inputId: string;
  householdId: string;
  contextId: string;
  shoppingListId: string;
  source: { kind: string; deviceId?: string; speakerId?: string };
  text: string;
  rawText?: string;
  alternatives?: readonly { text: string; confidence?: number }[];
  locale: string;
  countryCode: string;
  occurredAt: string;
  idempotencyKey: string;
  acceptedSuggestion?: {
    reference: string;
    originalText: string;
    replacement: { start: number; end: number; replacementText: string };
    productId?: string;
    conceptId?: string;
    brandId?: string;
  };
}

export interface SemanticEvidence {
  kind: 'source_span' | 'catalog_match' | 'household_confirmation' | 'grammar_rule';
  sourceStart?: number;
  sourceEnd?: number;
  ref?: string;
}

export interface SemanticValue<T> {
  value: T;
  confidence: 'confirmed' | 'inferred' | 'unknown';
  evidence: readonly SemanticEvidence[];
}

export interface SemanticMeasurement {
  value: number;
  unitId: string;
  comparisonValue?: number;
  comparisonUnitId?: string;
}

export type MeasureRole =
  | 'net_content'
  | 'contained_count'
  | 'medicine_strength'
  | 'concentration'
  | 'serving_size'
  | 'alcohol_by_volume'
  | 'storage_capacity'
  | 'battery_capacity'
  | 'power_rating'
  | 'voltage_rating'
  | 'current_rating'
  | 'frequency_rating'
  | 'screen_diagonal'
  | 'product_dimension'
  | 'cable_length'
  | 'appliance_capacity'
  | 'fabric_weight'
  | 'promotional_quantity';

export interface SemanticMeasure {
  role: MeasureRole;
  scope: 'product' | 'package' | 'contained_item';
  value: { kind: 'scalar'; amount: SemanticMeasurement }
    | { kind: 'ratio'; numerator: SemanticMeasurement; denominator: SemanticMeasurement };
  confidence: SemanticValue<unknown>['confidence'];
  evidence: readonly SemanticEvidence[];
}

export interface SemanticPackageLevel {
  containerUnitId: string;
  containedCount?: SemanticValue<number | null>;
  containedUnitId?: SemanticValue<string | null>;
  evidence: readonly SemanticEvidence[];
}

export type DescriptorRole =
  | 'identity_attribute'
  | 'preference'
  | 'packaging_qualifier'
  | 'display_only'
  | 'unknown';

export interface DescriptorMention {
  surface: string;
  normalized: string;
  sourceStart: number;
  sourceEnd: number;
  role: DescriptorRole;
  evidence: readonly SemanticEvidence[];
}

export interface SemanticCommercialRole {
  role: CommercialRoleType;
  organizationId: string;
  confidence: 'confirmed' | 'inferred' | 'unknown';
  evidence: readonly SemanticEvidence[];
}

export interface SemanticItem {
  semanticVersion?: 3 | 4;
  itemName: SemanticValue<string>;
  conceptId: SemanticValue<string | null>;
  brandId: SemanticValue<string | null>;
  productFamilyId?: SemanticValue<string | null>;
  productId?: SemanticValue<string | null>;
  categoryId: SemanticValue<string | null>;
  requestedCount: SemanticValue<number | null>;
  requestedUnitId: SemanticValue<string | null>;
  packageMeasure: SemanticValue<SemanticMeasurement | null>;
  packageContainerUnitId?: SemanticValue<string | null>;
  measures?: readonly SemanticMeasure[];
  packaging?: readonly SemanticPackageLevel[];
  attributes: Readonly<Record<string, SemanticValue<string | number>>>;
  descriptorMentions?: readonly DescriptorMention[];
  commercialRoles?: readonly SemanticCommercialRole[];
  identity: { conceptKey: string; variantKey: string; requestKey: string };
}

export interface BrainDraft {
  reasonCode: string;
  text: string;
  sourceStart: number;
  sourceEnd: number;
  candidateIds: readonly string[];
}

export interface BrainWarning {
  code: string;
  sourceStart?: number;
  sourceEnd?: number;
}

export type BrainOperation =
  | { kind: 'create'; item: SemanticItem; sourceStart?: number; sourceEnd?: number }
  | { kind: 'merge'; targetItemId: string; item: SemanticItem; sourceStart?: number; sourceEnd?: number }
  | { kind: 'correct'; targetItemId: string; item: SemanticItem }
  | { kind: 'draft'; draft: BrainDraft };

export interface BrainResult {
  schemaVersion: 2;
  engineVersion: string;
  runtimeVersions: Readonly<Record<string, string>>;
  capture: { inputId: string; text: string };
  operations: readonly BrainOperation[];
  warnings: readonly BrainWarning[];
}

export interface SemanticItemFact {
  itemId: string;
  item: SemanticItem;
}

export interface BrainDraftFact extends BrainDraft {
  draftId: string;
}

export interface UndoFact {
  eventId: string;
  itemId: string;
}

export interface BrainOutputFacts {
  saved: readonly SemanticItemFact[];
  merged: readonly SemanticItemFact[];
  drafts: readonly BrainDraftFact[];
  undo: readonly UndoFact[];
  warnings: readonly BrainWarning[];
}

export type ClassificationDecision = 'include' | 'exclude';
export type ValueProvenance = 'explicit' | 'history' | 'catalog_default' | 'policy_default';

export interface ShopTypeRecommendation {
  tagId: string;
  confidence: SemanticValue<unknown>['confidence'];
  evidence: readonly SemanticEvidence[];
  semanticIdentityKey: string;
  runtimeVersions: Readonly<Record<string, string>>;
}

export interface ShopTypeOverride {
  tagId: string;
  decision: ClassificationDecision;
  semanticIdentityKey: string;
}

export interface ProvenancedQuantity {
  value: number | null;
  source: ValueProvenance;
}

export interface ProvenancedUnitId {
  value: string | null;
  source: ValueProvenance;
}

export interface ItemClassification {
  automaticCategory: SemanticValue<string | null>;
  categoryOverride: string | null;
  effectiveCategoryId: string | null;
  automaticShopTypes: readonly ShopTypeRecommendation[];
  shopTypeOverrides: readonly ShopTypeOverride[];
  defaultedQuantity: ProvenancedQuantity;
  defaultedUnitId: ProvenancedUnitId;
}

export interface SemanticEntityRef {
  kind: 'catalog' | 'household';
  id: string;
}

export interface CommercialRoleCorrection {
  role: string;
  organizationRef: SemanticEntityRef;
  confidence?: 'confirmed' | 'inferred';
}

export interface DescriptorCorrection {
  attributeId: string;
  valueId?: string;
  value?: string | number;
  role?: DescriptorRole;
}

export interface SemanticCorrectionShopTypeDecision {
  tagId: string;
  decision: ClassificationDecision;
}

export interface SemanticCorrectionCommandV1 {
  schemaVersion: 1;
  idempotencyKey: string;
  itemId: string;
  expectedItemVersion: number;
  source: {
    captureInputId: string;
    operationIndex: number;
    sourceStart: number;
    sourceEnd: number;
    rawClause: string;
  };
  corrected: {
    canonicalLabel?: string;
    conceptRef?: SemanticEntityRef | null;
    productFamilyRef?: SemanticEntityRef | null;
    brandRef?: SemanticEntityRef | null;
    productRef?: SemanticEntityRef | null;
    brandRoles?: readonly CommercialRoleCorrection[];
    descriptors?: readonly DescriptorCorrection[];
    quantity?: number | null;
    unitId?: string | null;
    packageSize?: number | null;
    packageUnitId?: string | null;
    packageContainerUnitId?: string | null;
    shopTypeDecisions?: readonly SemanticCorrectionShopTypeDecision[];
  };
  learn: {
    mode: 'none' | 'this_item_only' | 'future_matching_items';
    scope: 'household';
  };
}

export function validateSemanticCorrectionCommand(value: unknown): SemanticCorrectionCommandV1 {
  const command = record(value, 'semantic correction command');
  if (command.schemaVersion !== 1) fail('semantic correction schemaVersion must be 1');
  requireNonEmptyString(command.idempotencyKey, 'idempotencyKey');
  requireNonEmptyString(command.itemId, 'itemId');
  if (!Number.isInteger(command.expectedItemVersion) || (command.expectedItemVersion as number) < 1) {
    fail('expectedItemVersion must be a positive integer');
  }

  const source = record(command.source, 'source');
  requireNonEmptyString(source.captureInputId, 'source.captureInputId');
  if (!Number.isInteger(source.operationIndex) || (source.operationIndex as number) < 0) {
    fail('source.operationIndex must be a non-negative integer');
  }
  requireNonEmptyString(source.rawClause, 'source.rawClause');
  if (!Number.isInteger(source.sourceStart) || !Number.isInteger(source.sourceEnd)
    || (source.sourceStart as number) < 0 || (source.sourceEnd as number) < (source.sourceStart as number)) {
    fail('source span is invalid');
  }

  const corrected = record(command.corrected, 'corrected');
  if (Object.keys(corrected).length === 0) fail('corrected must contain at least one field');
  optionalNonEmptyString(corrected.canonicalLabel, 'corrected.canonicalLabel');
  validateEntityRefOrNull(corrected.conceptRef, 'corrected.conceptRef');
  validateEntityRefOrNull(corrected.productFamilyRef, 'corrected.productFamilyRef');
  validateEntityRefOrNull(corrected.brandRef, 'corrected.brandRef');
  validateEntityRefOrNull(corrected.productRef, 'corrected.productRef');
  if (corrected.brandRoles !== undefined) {
    requireArray(corrected.brandRoles, 'corrected.brandRoles').forEach((role, index) => {
      const entry = record(role, `corrected.brandRoles[${index}]`);
      requireNonEmptyString(entry.role, `corrected.brandRoles[${index}].role`);
      if (!['brand_owner', 'manufacturer', 'marketer', 'licensee', 'distributor'].includes(entry.role as string)) {
        fail(`corrected.brandRoles[${index}].role is invalid`);
      }
      validateEntityRef(entry.organizationRef, `corrected.brandRoles[${index}].organizationRef`);
      if (entry.confidence !== undefined && entry.confidence !== 'confirmed' && entry.confidence !== 'inferred') {
        fail(`corrected.brandRoles[${index}].confidence is invalid`);
      }
    });
  }
  if (corrected.descriptors !== undefined) {
    requireArray(corrected.descriptors, 'corrected.descriptors').forEach((descriptor, index) => {
      const entry = record(descriptor, `corrected.descriptors[${index}]`);
      requireNonEmptyString(entry.attributeId, `corrected.descriptors[${index}].attributeId`);
      if (entry.valueId === undefined && entry.value === undefined) {
        fail(`corrected.descriptors[${index}] requires valueId or value`);
      }
      optionalNonEmptyString(entry.valueId, `corrected.descriptors[${index}].valueId`);
      if (entry.value !== undefined && typeof entry.value !== 'string' && !isFiniteNumber(entry.value)) {
        fail(`corrected.descriptors[${index}].value is invalid`);
      }
    });
  }
  validateNullablePositiveNumber(corrected.quantity, 'corrected.quantity');
  validateNullableString(corrected.unitId, 'corrected.unitId');
  validateNullablePositiveNumber(corrected.packageSize, 'corrected.packageSize');
  validateNullableString(corrected.packageUnitId, 'corrected.packageUnitId');
  validateNullableString(corrected.packageContainerUnitId, 'corrected.packageContainerUnitId');
  if (corrected.shopTypeDecisions !== undefined) {
    const tags = new Set<string>();
    requireArray(corrected.shopTypeDecisions, 'corrected.shopTypeDecisions').forEach((decision, index) => {
      const entry = record(decision, `corrected.shopTypeDecisions[${index}]`);
      const tagId = requireNonEmptyString(entry.tagId, `corrected.shopTypeDecisions[${index}].tagId`);
      if (tags.has(tagId)) fail('corrected.shopTypeDecisions must not repeat tag IDs');
      tags.add(tagId);
      if (entry.decision !== 'include' && entry.decision !== 'exclude') {
        fail(`corrected.shopTypeDecisions[${index}].decision is invalid`);
      }
    });
  }

  const learn = record(command.learn, 'learn');
  if (learn.mode !== 'none' && learn.mode !== 'this_item_only' && learn.mode !== 'future_matching_items') {
    fail('learn.mode is invalid');
  }
  if (learn.scope !== 'household') fail('learn.scope must be household');
  return value as SemanticCorrectionCommandV1;
}

export function validateBrainCaptureEnvelope(value: unknown): BrainCaptureEnvelope {
  const envelope = record(value, 'capture envelope');
  requireSchemaVersion(envelope.schemaVersion);
  requireString(envelope.inputId, 'inputId');
  requireString(envelope.householdId, 'householdId');
  requireString(envelope.contextId, 'contextId');
  requireString(envelope.shoppingListId, 'shoppingListId');
  requireString(envelope.text, 'text');
  optionalString(envelope.rawText, 'rawText');
  requireString(envelope.locale, 'locale');
  requireString(envelope.countryCode, 'countryCode');
  requireString(envelope.occurredAt, 'occurredAt');
  requireString(envelope.idempotencyKey, 'idempotencyKey');
  if (envelope.acceptedSuggestion !== undefined) {
    const suggestion = record(envelope.acceptedSuggestion, 'acceptedSuggestion');
    requireString(suggestion.reference, 'acceptedSuggestion.reference');
    requireString(suggestion.originalText, 'acceptedSuggestion.originalText');
    if (suggestion.originalText !== envelope.text) fail('acceptedSuggestion.originalText must equal capture text');
    const replacement = record(suggestion.replacement, 'acceptedSuggestion.replacement');
    const start = replacement.start;
    const end = replacement.end;
    const text = envelope.text;
    if (typeof start !== 'number' || typeof end !== 'number' || !Number.isInteger(start) || !Number.isInteger(end)
      || start < 0 || end < start || typeof text !== 'string' || end > text.length) {
      fail('acceptedSuggestion.replacement range is invalid');
    }
    requireString(replacement.replacementText, 'acceptedSuggestion.replacement.replacementText');
  }

  const source = record(envelope.source, 'source');
  requireNonEmptyString(source.kind, 'source.kind');
  optionalString(source.deviceId, 'source.deviceId');
  optionalString(source.speakerId, 'source.speakerId');

  if (envelope.alternatives !== undefined) {
    requireArray(envelope.alternatives, 'alternatives').forEach((candidate, index) => {
      const alternative = record(candidate, `alternatives[${index}]`);
      requireString(alternative.text, `alternatives[${index}].text`);
      optionalFiniteNumber(alternative.confidence, `alternatives[${index}].confidence`);
    });
  }

  return value as BrainCaptureEnvelope;
}

export function validateBrainResult(value: unknown): BrainResult {
  const result = record(value, 'brain result');
  requireSchemaVersion(result.schemaVersion);
  requireNonEmptyString(result.engineVersion, 'engineVersion');

  const runtimeVersions = record(result.runtimeVersions, 'runtimeVersions');
  const runtimeEntries = Object.entries(runtimeVersions);
  if (runtimeEntries.length === 0) fail('runtimeVersions must not be empty');
  runtimeEntries.forEach(([key, version]) => {
    requireNonEmptyString(key, 'runtimeVersions key');
    requireNonEmptyString(version, `runtimeVersions.${key}`);
  });

  const capture = record(result.capture, 'capture');
  requireString(capture.inputId, 'capture.inputId');
  const sourceText = requireString(capture.text, 'capture.text');

  requireArray(result.operations, 'operations').forEach((entry, index) => {
    validateOperation(record(entry, `operations[${index}]`), sourceText);
  });
  requireArray(result.warnings, 'warnings').forEach((entry, index) => {
    const warning = record(entry, `warnings[${index}]`);
    requireString(warning.code, `warnings[${index}].code`);
    validateOptionalSpan(warning, sourceText, `warnings[${index}]`);
  });

  return value as BrainResult;
}

export function validateItemClassification(value: unknown): ItemClassification {
  const classification = record(value, 'item classification');
  validateSemanticValue(
    classification.automaticCategory,
    '',
    isNullableString,
    'automaticCategory',
  );
  if (classification.categoryOverride !== null) {
    requireNonEmptyString(classification.categoryOverride, 'categoryOverride');
  }
  if (classification.effectiveCategoryId !== null) {
    requireNonEmptyString(classification.effectiveCategoryId, 'effectiveCategoryId');
  }
  validateAutomaticShopTypes(classification.automaticShopTypes);
  validateShopTypeOverrides(classification.shopTypeOverrides);
  validateProvenancedQuantity(classification.defaultedQuantity);
  validateProvenancedUnitId(classification.defaultedUnitId);
  return value as ItemClassification;
}

function validateOperation(operation: Record<string, unknown>, sourceText: string): void {
  const kind = operation.kind;
  if (kind === 'draft') {
    const draft = record(operation.draft, 'draft');
    requireString(draft.reasonCode, 'draft.reasonCode');
    requireString(draft.text, 'draft.text');
    validateSpan(draft.sourceStart, draft.sourceEnd, sourceText, 'draft');
    requireArray(draft.candidateIds, 'draft.candidateIds')
      .forEach((candidateId) => requireString(candidateId, 'draft.candidateIds[]'));
    return;
  }
  if (kind !== 'create' && kind !== 'merge' && kind !== 'correct') {
    fail('operation kind is invalid');
  }
  if (kind === 'merge' || kind === 'correct') {
    requireString(operation.targetItemId, 'targetItemId');
  }
  validateSemanticItem(record(operation.item, 'operation.item'), sourceText);
}

function validateSemanticItem(item: Record<string, unknown>, sourceText: string): void {
  validateSemanticValue(item.itemName, sourceText, isString, 'itemName');
  validateSemanticValue(item.conceptId, sourceText, isNullableString, 'conceptId');
  validateSemanticValue(item.brandId, sourceText, isNullableString, 'brandId');
  if (item.productId !== undefined) {
    validateSemanticValue(item.productId, sourceText, isNullableString, 'productId');
  }
  if (item.productFamilyId !== undefined) {
    validateSemanticValue(item.productFamilyId, sourceText, isNullableString, 'productFamilyId');
  }
  validateSemanticValue(item.categoryId, sourceText, isNullableString, 'categoryId');
  validateSemanticValue(item.requestedCount, sourceText, isNullableFiniteNumber, 'requestedCount');
  validateSemanticValue(item.requestedUnitId, sourceText, isNullableString, 'requestedUnitId');
  validateSemanticValue(
    item.packageMeasure,
    sourceText,
    (candidate) => candidate === null || isSemanticMeasurement(candidate),
    'packageMeasure',
  );
  if (item.packageContainerUnitId !== undefined) {
    validateSemanticValue(item.packageContainerUnitId, sourceText, isNullableString, 'packageContainerUnitId');
  }

  const attributes = record(item.attributes, 'attributes');
  Object.entries(attributes).forEach(([key, attribute]) => {
    validateSemanticValue(
      attribute,
      sourceText,
      (candidate) => typeof candidate === 'string' || isFiniteNumber(candidate),
      `attributes.${key}`,
    );
  });

  if (item.semanticVersion !== undefined && item.semanticVersion !== 3 && item.semanticVersion !== 4) {
    fail('item.semanticVersion must be 3 or 4 when present');
  }
  if (item.measures !== undefined) {
    requireArray(item.measures, 'measures').forEach((entry, index) => validateSemanticMeasure(
      record(entry, `measures[${index}]`), sourceText, index,
    ));
  }
  if (item.packaging !== undefined) {
    requireArray(item.packaging, 'packaging').forEach((entry, index) => {
      const level = record(entry, `packaging[${index}]`);
      requireNonEmptyString(level.containerUnitId, `packaging[${index}].containerUnitId`);
      requireArray(level.evidence, `packaging[${index}].evidence`);
      if (level.containedCount !== undefined) {
        validateSemanticValue(level.containedCount, sourceText, isNullableFiniteNumber, `packaging[${index}].containedCount`);
      }
      if (level.containedUnitId !== undefined) {
        validateSemanticValue(level.containedUnitId, sourceText, isNullableString, `packaging[${index}].containedUnitId`);
      }
    });
  }
  if (item.descriptorMentions !== undefined) {
    requireArray(item.descriptorMentions, 'descriptorMentions').forEach((mention, index) => {
      const descriptor = record(mention, `descriptorMentions[${index}]`);
      requireString(descriptor.surface, `descriptorMentions[${index}].surface`);
      requireString(descriptor.normalized, `descriptorMentions[${index}].normalized`);
      validateSpan(descriptor.sourceStart, descriptor.sourceEnd, sourceText, `descriptorMentions[${index}]`);
      requireString(descriptor.role, `descriptorMentions[${index}].role`);
      requireArray(descriptor.evidence, `descriptorMentions[${index}].evidence`);
    });
  }
  if (item.commercialRoles !== undefined) {
    requireArray(item.commercialRoles, 'commercialRoles').forEach((role, index) => {
      const value = record(role, `commercialRoles[${index}]`);
      requireString(value.role, `commercialRoles[${index}].role`);
      requireString(value.organizationId, `commercialRoles[${index}].organizationId`);
      requireString(value.confidence, `commercialRoles[${index}].confidence`);
      requireArray(value.evidence, `commercialRoles[${index}].evidence`);
    });
  }

  const identity = record(item.identity, 'identity');
  requireString(identity.conceptKey, 'identity.conceptKey');
  requireString(identity.variantKey, 'identity.variantKey');
  requireString(identity.requestKey, 'identity.requestKey');
}

function validateSemanticMeasure(measure: Record<string, unknown>, sourceText: string, index: number): void {
  const roles = new Set([
    'net_content', 'contained_count', 'medicine_strength', 'concentration', 'serving_size',
    'alcohol_by_volume', 'storage_capacity', 'battery_capacity', 'power_rating', 'voltage_rating',
    'current_rating', 'frequency_rating', 'screen_diagonal', 'product_dimension', 'cable_length',
    'appliance_capacity', 'fabric_weight', 'promotional_quantity',
  ]);
  if (!roles.has(requireString(measure.role, `measures[${index}].role`))) fail(`measures[${index}].role is invalid`);
  if (measure.scope !== 'product' && measure.scope !== 'package' && measure.scope !== 'contained_item') {
    fail(`measures[${index}].scope is invalid`);
  }
  requireString(measure.confidence, `measures[${index}].confidence`);
  requireArray(measure.evidence, `measures[${index}].evidence`);
  const value = record(measure.value, `measures[${index}].value`);
  if (value.kind === 'scalar') {
    if (!isSemanticMeasurement(value.amount)) fail(`measures[${index}].value.amount is invalid`);
    return;
  }
  if (value.kind === 'ratio') {
    if (!isSemanticMeasurement(value.numerator) || !isSemanticMeasurement(value.denominator)) {
      fail(`measures[${index}].value ratio is invalid`);
    }
    return;
  }
  fail(`measures[${index}].value.kind is invalid`);
}

function validateAutomaticShopTypes(value: unknown): void {
  const tagIds = new Set<string>();
  requireArray(value, 'automaticShopTypes').forEach((entry, index) => {
    const recommendation = record(entry, `automaticShopTypes[${index}]`);
    const tagId = requireNonEmptyString(recommendation.tagId, `automaticShopTypes[${index}].tagId`);
    if (tagIds.has(tagId)) fail('automaticShopTypes must not repeat tag IDs');
    tagIds.add(tagId);
    if (recommendation.confidence === 'unknown') {
      fail(`automaticShopTypes[${index}].confidence must not be unknown`);
    }
    validateSemanticValue(
      { value: tagId, confidence: recommendation.confidence, evidence: recommendation.evidence },
      '',
      isString,
      `automaticShopTypes[${index}]`,
    );
    requireNonEmptyString(recommendation.semanticIdentityKey, `automaticShopTypes[${index}].semanticIdentityKey`);
    const runtimeVersions = record(recommendation.runtimeVersions, `automaticShopTypes[${index}].runtimeVersions`);
    const entries = Object.entries(runtimeVersions);
    if (entries.length === 0) fail(`automaticShopTypes[${index}].runtimeVersions must not be empty`);
    entries.forEach(([key, version]) => {
      requireNonEmptyString(key, `automaticShopTypes[${index}].runtimeVersions key`);
      requireNonEmptyString(version, `automaticShopTypes[${index}].runtimeVersions.${key}`);
    });
  });
}

function validateShopTypeOverrides(value: unknown): void {
  const tagIds = new Set<string>();
  requireArray(value, 'shopTypeOverrides').forEach((entry, index) => {
    const override = record(entry, `shopTypeOverrides[${index}]`);
    const tagId = requireNonEmptyString(override.tagId, `shopTypeOverrides[${index}].tagId`);
    if (tagIds.has(tagId)) fail('shopTypeOverrides must not repeat tag IDs');
    tagIds.add(tagId);
    if (override.decision !== 'include' && override.decision !== 'exclude') {
      fail(`shopTypeOverrides[${index}].decision is invalid`);
    }
    requireNonEmptyString(override.semanticIdentityKey, `shopTypeOverrides[${index}].semanticIdentityKey`);
  });
}

function validateProvenancedQuantity(value: unknown): void {
  const quantity = record(value, 'defaultedQuantity');
  if (quantity.value !== null && (!isFiniteNumber(quantity.value) || quantity.value <= 0)) {
    fail('defaultedQuantity.value must be a positive finite number or null');
  }
  validateValueProvenance(quantity.source, 'defaultedQuantity.source');
}

function validateProvenancedUnitId(value: unknown): void {
  const unit = record(value, 'defaultedUnitId');
  if (unit.value !== null) requireNonEmptyString(unit.value, 'defaultedUnitId.value');
  validateValueProvenance(unit.source, 'defaultedUnitId.source');
}

function validateValueProvenance(value: unknown, label: string): void {
  if (value !== 'explicit' && value !== 'history' && value !== 'catalog_default' && value !== 'policy_default') {
    fail(`${label} is invalid`);
  }
}

function validateSemanticValue(
  candidate: unknown,
  sourceText: string,
  valueIsValid: (value: unknown) => boolean,
  label: string,
): void {
  const semanticValue = record(candidate, label);
  if (!valueIsValid(semanticValue.value)) fail(`${label}.value is invalid`);
  if (semanticValue.confidence !== 'confirmed'
    && semanticValue.confidence !== 'inferred'
    && semanticValue.confidence !== 'unknown') {
    fail(`${label}.confidence is invalid`);
  }
  const evidence = requireArray(semanticValue.evidence, `${label}.evidence`);
  if (semanticValue.confidence !== 'unknown' && evidence.length === 0) {
    fail(`${label} must include evidence or use unknown confidence`);
  }
  evidence.forEach((entry, index) => {
    validateEvidence(record(entry, `${label}.evidence[${index}]`), sourceText);
  });
}

function validateEvidence(evidence: Record<string, unknown>, sourceText: string): void {
  if (evidence.kind !== 'source_span'
    && evidence.kind !== 'catalog_match'
    && evidence.kind !== 'household_confirmation'
    && evidence.kind !== 'grammar_rule') {
    fail('evidence kind is invalid');
  }
  optionalString(evidence.ref, 'evidence.ref');
  validateOptionalSpan(evidence, sourceText, 'evidence');
  if (evidence.kind === 'source_span' && evidence.sourceStart === undefined) {
    fail('source_span evidence requires a bounded span');
  }
}

function isSemanticMeasurement(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (!isFiniteNumber(value.value) || typeof value.unitId !== 'string') return false;
  if (value.comparisonValue !== undefined && !isFiniteNumber(value.comparisonValue)) return false;
  return value.comparisonUnitId === undefined || typeof value.comparisonUnitId === 'string';
}

function validateOptionalSpan(
  value: Record<string, unknown>,
  sourceText: string,
  label: string,
): void {
  if (value.sourceStart === undefined && value.sourceEnd === undefined) return;
  validateSpan(value.sourceStart, value.sourceEnd, sourceText, label);
}

function validateSpan(start: unknown, end: unknown, sourceText: string, label: string): void {
  if (!Number.isInteger(start) || !Number.isInteger(end)
    || (start as number) < 0
    || (end as number) < (start as number)
    || (end as number) > sourceText.length) {
    fail(`${label} source span is out of bounds`);
  }
}

function requireSchemaVersion(value: unknown): asserts value is 2 {
  if (value !== 2) fail('schemaVersion must be 2');
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) fail(`${label} must be an object`);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) fail(`${label} must be an array`);
  return value;
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== 'string') fail(`${label} must be a string`);
  return value;
}

function requireNonEmptyString(value: unknown, label: string): string {
  const text = requireString(value, label);
  if (text.trim().length === 0) fail(`${label} must not be empty`);
  return text;
}

function optionalString(value: unknown, label: string): void {
  if (value !== undefined) requireString(value, label);
}

function optionalNonEmptyString(value: unknown, label: string): void {
  if (value !== undefined) requireNonEmptyString(value, label);
}

function validateNullableString(value: unknown, label: string): void {
  if (value !== undefined && value !== null) requireNonEmptyString(value, label);
}

function validateNullablePositiveNumber(value: unknown, label: string): void {
  if (value !== undefined && value !== null
    && (!isFiniteNumber(value) || value <= 0)) {
    fail(`${label} must be a positive finite number or null`);
  }
}

function validateEntityRef(value: unknown, label: string): void {
  const ref = record(value, label);
  if (ref.kind !== 'catalog' && ref.kind !== 'household') fail(`${label}.kind is invalid`);
  requireNonEmptyString(ref.id, `${label}.id`);
}

function validateEntityRefOrNull(value: unknown, label: string): void {
  if (value !== undefined && value !== null) validateEntityRef(value, label);
}

function optionalFiniteNumber(value: unknown, label: string): void {
  if (value !== undefined && !isFiniteNumber(value)) fail(`${label} must be a finite number`);
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isNullableFiniteNumber(value: unknown): value is number | null {
  return value === null || isFiniteNumber(value);
}

function fail(message: string): never {
  throw new TypeError(`Invalid shopping brain contract: ${message}`);
}
