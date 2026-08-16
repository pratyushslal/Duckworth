import {
  interpretCapture,
  normalizeItemName,
} from '../../item-capture/dist/index.js';
import type { SemanticRuntime } from './semantic-runtime.js';

export type CaptureSource = 'text' | 'voice' | 'api';

export interface BrandHint {
  label: string;
  aliases: readonly string[];
}

export interface CaptureCommand {
  text: string;
  locale?: string;
  countryCode?: string;
  acceptedProductId?: string;
  brandHints?: readonly BrandHint[];
  source?: CaptureSource;
  runtime: SemanticRuntime;
}

export interface ItemIntent {
  captureText: string;
  itemName: string;
  identityKey: string;
  quantity: number | null;
  unit: string | null;
  packageSize: number | null;
  packageUnit: string | null;
  /** A reviewed local brand match; the original item wording remains unchanged. */
  brandName?: string;
  /** Optional source-neutral semantic enrichment produced by conversation interpretation. */
  category?: {
    id: string;
    confidence: 'confirmed' | 'inferred' | 'unknown';
  };
  attributes?: Readonly<Record<string, string | number>>;
}

export interface CorrectionCommand {
  captureText: string;
  itemName: string;
  quantity: number | null;
  unit: string | null;
  packageSize: number | null;
  packageUnit: string | null;
  locale: string;
  countryCode: string;
  acceptedProductId?: string;
  source?: CaptureSource;
  runtime: SemanticRuntime;
}

export class ItemCorrectionConflictError extends Error {
  constructor() {
    super('Item text and structured details disagree');
  }
}

export type ItemLifecycleStatus = 'active' | 'purchased' | 'removed';
export type ItemLifecycleAction = 'purchase' | 'reopen' | 'remove' | 'restore';

export interface ItemLifecycleState {
  status: ItemLifecycleStatus;
  removedAt: string | null;
}

export class InvalidItemTransitionError extends Error {
  constructor() {
    super('Item lifecycle transition is not valid');
  }
}

export function interpretItem(command: CaptureCommand): ItemIntent {
  const captureText = command.text.trim();
  const parsed = interpretCapture(captureText, command.runtime);
  const productDefaultUnit = parsed.unitExplicit === false
    ? matchingProductDefaultUnit(parsed.name, command.runtime)
    : undefined;
  const brandName = identifyBrand(parsed.name, command.brandHints);
  return {
    captureText,
    itemName: parsed.name,
    identityKey: normalizeItemName(parsed.name),
    quantity: parsed.quantity,
    unit: productDefaultUnit ?? parsed.unit,
    packageSize: parsed.packageSize,
    packageUnit: parsed.packageUnit,
    ...(brandName ? { brandName } : {}),
  };
}

function matchingProductDefaultUnit(itemName: string, runtime: SemanticRuntime): string | undefined {
  const normalized = normalizeItemName(itemName);
  return [...runtime.products.byId.values()]
    .filter((product) => product.defaultUnitId && product.aliases.some((alias) => normalized === normalizeItemName(alias)))
    .sort((left, right) => left.id.localeCompare(right.id))[0]?.defaultUnitId;
}

export function identifyBrand(
  itemName: string,
  hints: readonly BrandHint[] = [],
): string | null {
  const normalizedItem = normalizeItemName(itemName);
  if (!normalizedItem) return null;
  const matches = hints
    .flatMap((hint) => hint.aliases.map((alias) => ({ hint, alias: normalizeItemName(alias) })))
    .filter(({ alias }) => alias.length > 0
      && (normalizedItem === alias || normalizedItem.startsWith(`${alias} `)))
    .sort((left, right) => right.alias.length - left.alias.length);
  return matches[0]?.hint.label.trim() || null;
}

export function reconcileItemCorrection(command: CorrectionCommand): ItemIntent {
  if (command.quantity !== null && (!Number.isFinite(command.quantity) || command.quantity <= 0)) {
    throw new ItemCorrectionConflictError();
  }
  if ((command.packageSize === null) !== (command.packageUnit === null)
    || (command.packageSize !== null && (!Number.isFinite(command.packageSize) || command.packageSize <= 0))) {
    throw new ItemCorrectionConflictError();
  }

  const itemName = command.itemName.trim().replace(/\s+/gu, ' ');
  const embedded = interpretCapture(itemName, command.runtime);
  const hasEmbeddedDetails = embedded.quantity !== null || embedded.packageSize !== null;
  const reconciledName = hasEmbeddedDetails
    ? detailsMatch(command, embedded)
      ? embedded.name
      : (() => { throw new ItemCorrectionConflictError(); })()
    : itemName;

  return {
    captureText: command.captureText.trim(),
    itemName: reconciledName,
    identityKey: normalizeItemName(reconciledName),
    quantity: command.quantity,
    unit: command.unit,
    packageSize: command.packageSize,
    packageUnit: command.packageUnit,
  };
}

function detailsMatch(command: CorrectionCommand, embedded: ReturnType<typeof interpretCapture>): boolean {
  return command.quantity === embedded.quantity
    && command.unit === embedded.unit
    && command.packageSize === embedded.packageSize
    && command.packageUnit === embedded.packageUnit;
}

export function transitionItem(
  item: ItemLifecycleState,
  action: ItemLifecycleAction,
  occurredAt: string,
): ItemLifecycleState {
  if (action === 'remove' && item.status === 'active') {
    return { status: 'removed', removedAt: occurredAt };
  }
  if (action === 'restore' && item.status === 'removed') {
    return { status: 'active', removedAt: null };
  }
  if (action === 'purchase' && item.status === 'active') {
    return { status: 'purchased', removedAt: null };
  }
  if (action === 'reopen' && item.status === 'purchased') {
    return { status: 'active', removedAt: null };
  }
  throw new InvalidItemTransitionError();
}

export {
  interpretConversation,
  resolveFollowUp,
  inferCategory,
  inferAttributes,
  enrichItemIntent,
  type ConversationCaptureCommand,
  type ConversationDecision,
  type ConversationInterpretation,
  type ConversationItemCandidate,
  type ConversationItemIntent,
  type ItemCategoryId,
} from './conversation.js';

export {
  conversationContextKey,
  contextualizeCapture,
  normalizeConversationContext,
  type ContextualConversationCaptureCommand,
  type ConversationContextRef,
} from './conversation-context.js';

export {
  decideConversationLifecycle,
  type CloseActionOrigin,
  type ConversationLifecycleInput,
  type ConversationLifecycleState,
  type ConversationSessionStatus,
  type LifecycleDecision,
} from './conversation-lifecycle.js';

export {
  validateBrainCaptureEnvelope,
  validateBrainResult,
  type BrainCaptureEnvelope,
  type ClassificationDecision,
  type BrainDraft,
  type BrainDraftFact,
  type BrainOperation,
  type BrainOutputFacts,
  type BrainResult,
  type BrainWarning,
  type DescriptorMention,
  type DescriptorRole,
  type SemanticEvidence,
  type SemanticCommercialRole,
  type SemanticItem,
  type SemanticItemFact,
  type SemanticMeasurement,
  type SemanticMeasure,
  type SemanticPackageLevel,
  type MeasureRole,
  type SemanticValue,
  type ItemClassification,
  type ProvenancedQuantity,
  type ProvenancedUnitId,
  type ShopTypeOverride,
  type ShopTypeRecommendation,
  type UndoFact,
  type ValueProvenance,
  validateItemClassification,
  validateSemanticCorrectionCommand,
  type CommercialRoleCorrection,
  type DescriptorCorrection,
  type SemanticCorrectionCommandV1,
  type SemanticCorrectionShopTypeDecision,
  type SemanticEntityRef,
} from './contracts.js';

export {
  compileSemanticRuntime,
  type AttributeDefinition,
  type BrainPolicy,
  type BrandDefinition,
  type BrandShopTypeRule,
  type BrandIndex,
  type CategoryDefinition,
  type CompiledGrammar,
  type CompiledTemplate,
  type ConceptDefinition,
  type ConceptIndex,
  type DefaultItemPolicy,
  type ProductDefinition,
  type HouseholdSemanticEntity,
  type SemanticRuntime,
  type ShopTypeDefinition,
  type TemplateOperator,
  type UnitDefinition,
  type ValidatedSemanticLayer,
} from './semantic-runtime.js';

export {
  segmentCapture,
  type SourceSegment,
} from './segmentation.js';

export {
  classifyShoppingItem,
  resolveSemanticItem,
  type EntityCandidate,
  type SemanticItemAlternative,
} from './entity-resolution.js';

export {
  resolveContextReference,
  type ContextDraft,
  type ContextEntity,
  type ContextReferenceDecision,
  type DiscourseContext,
} from './reference-resolution.js';

export { runShoppingBrain } from './pipeline.js';

export { SEMANTIC_SNAPSHOT_VERSION, upcastSemanticItem } from './semantic-upcast.js';

export {
  assertSemanticItemCompatible,
  normalizeSemanticItemForRuntime,
  IncompatibleSemanticItemError,
} from './semantic-validation.js';

export {
  classifyDuplicate,
  createItemIdentity,
  type DuplicateDecision,
  type IdentityCandidate,
  type ItemIdentity,
} from './identity.js';

export {
  compileLearningOverlay,
  projectLearnedSemanticEntry,
  resolveLearnedPreference,
  type LearnedSemanticEntry,
  type LearningCandidate,
  type LearningEvidenceEvent,
  compileTypedLearningOverlay,
  resolveLearnedField,
  type ApplicabilitySignature,
  type CompiledTypedLearningOverlay,
  type LearningEffectKind,
  type TypedLearningEffect,
} from './learning-overlay.js';

export { LearningOverlayCache } from './learning-overlay-cache.js';

export {
  applyReconciliationDisposition,
  createReconciliationCandidate,
  type CatalogReconciliationCandidate,
  type OfficialSemanticEntity,
  type ReconciliationDisposition,
} from './catalog-reconciliation.js';
