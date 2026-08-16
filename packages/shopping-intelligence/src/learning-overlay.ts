import type { BrainPolicy, SemanticHouseholdLayer } from './semantic-runtime.js';

export interface LearnedSemanticEntry {
  id: string;
  householdId: string;
  kind: 'alias' | 'brand_preference' | 'variant_preference' | 'quantity_preference';
  value: Readonly<Record<string, string | number>>;
  supportingEventIds: readonly string[];
  status: 'active' | 'suppressed' | 'cleared';
}

export interface LearningCandidate {
  id: string;
  householdId: string;
  kind: LearnedSemanticEntry['kind'];
  value: Readonly<Record<string, string | number>>;
}

export interface LearningEvidenceEvent {
  id: string;
  kind: 'accepted_correction' | 'confirmed_event' | 'draft' | 'removed_mistake' | 'undone_merge' | 'rejected_spelling';
  supportsCandidate?: boolean;
}

export type LearningEffectKind =
  | 'canonical_label'
  | 'entity_alias'
  | 'commercial_role'
  | 'descriptor_value'
  | 'quantity_default'
  | 'unit_default'
  | 'package_default'
  | 'shop_eligibility';

export interface ApplicabilitySignature {
  locale: string;
  countryCode: string;
  identityRefs: readonly string[];
  identityDescriptorValueIds: readonly string[];
  sourceAliasKey?: string;
  packageSignature?: string;
  applyOnlyWhenFieldAbsent: boolean;
}

export interface TypedLearningEffect {
  id: string;
  householdId: string;
  kind: LearningEffectKind;
  value: Readonly<Record<string, string | number | boolean | null | readonly string[]>>;
  applicability: ApplicabilitySignature;
  status: 'candidate' | 'reviewed' | 'active' | 'suppressed' | 'cleared' | 'expired';
  supportingEventIds: readonly string[];
  contradictingEventIds?: readonly string[];
}

export interface CompiledTypedLearningOverlay {
  householdId: string;
  revision: number;
  canonicalLabels: ReadonlyMap<string, string>;
  quantityDefaults: ReadonlyMap<string, { quantity: number; unitId: string | null }>;
  unitDefaults: ReadonlyMap<string, string>;
  packageDefaults: ReadonlyMap<string, { size: number; unitId: string }>;
  descriptorDefaults: ReadonlyMap<string, Readonly<Record<string, string | number>>>;
  commercialRoleDefaults: ReadonlyMap<string, readonly { role: string; organizationId: string }[]>;
  shopEligibility: ReadonlyMap<string, readonly string[]>;
  conflicts: readonly string[];
}

export function compileTypedLearningOverlay(
  householdId: string,
  revision: number,
  effects: readonly TypedLearningEffect[],
): CompiledTypedLearningOverlay {
  const active = effects.filter((effect) => effect.householdId === householdId && effect.status === 'active');
  const canonicalLabels = new Map<string, string>();
  const quantityDefaults = new Map<string, { quantity: number; unitId: string | null }>();
  const unitDefaults = new Map<string, string>();
  const packageDefaults = new Map<string, { size: number; unitId: string }>();
  const descriptorDefaults = new Map<string, Record<string, string | number>>();
  const commercialRoleDefaults = new Map<string, Array<{ role: string; organizationId: string }>>();
  const shopEligibility = new Map<string, readonly string[]>();
  const conflicts: string[] = [];
  const byKey = new Map<string, TypedLearningEffect[]>();
  active.forEach((effect) => {
    const key = `${effect.kind}:${effect.applicability.identityRefs.join('|')}:${effect.applicability.identityDescriptorValueIds.join('|')}:${effect.applicability.sourceAliasKey ?? ''}`;
    const group = byKey.get(key) ?? [];
    group.push(effect);
    byKey.set(key, group);
  });
  byKey.forEach((group) => {
    const values = new Set(group.map((effect) => JSON.stringify(effect.value)));
    if (values.size > 1) {
      conflicts.push(...group.map(({ id }) => id).sort());
      return;
    }
    const effect = [...group].sort((left, right) => left.id.localeCompare(right.id))[0];
    const identityKey = effect.applicability.identityDescriptorValueIds.length > 0
      ? `${effect.applicability.identityRefs.join('|')}:${effect.applicability.identityDescriptorValueIds.join('|')}`
      : effect.applicability.identityRefs.join('|');
    const key = effect.applicability.sourceAliasKey ?? identityKey;
    const value = effect.value;
    if (effect.kind === 'canonical_label' && typeof value.label === 'string') canonicalLabels.set(key, value.label);
    if (effect.kind === 'quantity_default' && typeof value.quantity === 'number' && value.quantity > 0) {
      quantityDefaults.set(key, { quantity: value.quantity, unitId: typeof value.unitId === 'string' ? value.unitId : null });
    }
    if (effect.kind === 'unit_default' && typeof value.unitId === 'string') unitDefaults.set(key, value.unitId);
    if (effect.kind === 'package_default' && typeof value.size === 'number' && typeof value.unitId === 'string') {
      packageDefaults.set(key, { size: value.size, unitId: value.unitId });
    }
    if (effect.kind === 'descriptor_value' && typeof value.attributeId === 'string'
      && (typeof value.value === 'string' || typeof value.value === 'number')) {
      const current = descriptorDefaults.get(key) ?? {};
      current[value.attributeId] = value.value;
      descriptorDefaults.set(key, current);
    }
    if (effect.kind === 'commercial_role' && typeof value.role === 'string' && typeof value.organizationId === 'string') {
      const current = commercialRoleDefaults.get(key) ?? [];
      current.push({ role: value.role, organizationId: value.organizationId });
      commercialRoleDefaults.set(key, current);
    }
    if (effect.kind === 'shop_eligibility' && Array.isArray(value.tagIds)
      && value.tagIds.every((tag) => typeof tag === 'string')) {
      shopEligibility.set(key, [...value.tagIds].sort());
    }
  });
  return {
    householdId,
    revision,
    canonicalLabels,
    quantityDefaults,
    unitDefaults,
    packageDefaults,
    descriptorDefaults,
    commercialRoleDefaults,
    shopEligibility,
    conflicts,
  };
}

export function resolveLearnedField<T>(explicitValue: T | null | undefined, learnedValue: T | undefined): T | undefined {
  return explicitValue !== null && explicitValue !== undefined ? explicitValue : learnedValue;
}

export function projectLearnedSemanticEntry(
  candidate: LearningCandidate,
  evidence: readonly LearningEvidenceEvent[],
  policy: BrainPolicy,
): LearnedSemanticEntry | null {
  const acceptedCorrection = evidence.filter(({ kind, supportsCandidate }) => (
    kind === 'accepted_correction' && supportsCandidate !== false
  ));
  const confirmed = evidence.filter(({ kind, supportsCandidate }) => (
    kind === 'confirmed_event' && supportsCandidate !== false
  ));
  const supporting = acceptedCorrection.length > 0
    ? acceptedCorrection
    : confirmed.length >= policy.minimumLearningSupport
      ? confirmed
      : [];
  if (supporting.length === 0) return null;
  return {
    ...candidate,
    supportingEventIds: [...new Set(supporting.map(({ id }) => id))].sort(),
    status: 'active',
  };
}

export function compileLearningOverlay(
  householdId: string,
  entries: readonly LearnedSemanticEntry[],
): SemanticHouseholdLayer {
  const active = entries.filter((entry) => entry.householdId === householdId && entry.status === 'active');
  const conceptAliases = active.flatMap((entry) => {
    if (entry.kind !== 'alias') return [];
    const alias = entry.value.alias;
    const conceptId = entry.value.conceptId;
    return typeof alias === 'string' && typeof conceptId === 'string' ? [{ alias, conceptId }] : [];
  });
  const brandAliases = active.flatMap((entry) => {
    if (entry.kind !== 'brand_preference') return [];
    const alias = entry.value.alias;
    const brandId = entry.value.brandId;
    return typeof alias === 'string' && typeof brandId === 'string' ? [{ alias, brandId }] : [];
  });
  const quantityPreferences = active.flatMap((entry) => {
    if (entry.kind !== 'quantity_preference') return [];
    const identityKey = entry.value.identityKey;
    const quantity = entry.value.requestedQuantity;
    const unitId = entry.value.unit;
    return typeof identityKey === 'string' && typeof quantity === 'number' && Number.isFinite(quantity) && quantity > 0
      ? [{ identityKey, quantity, unitId: typeof unitId === 'string' ? unitId : null }]
      : [];
  });
  return {
    schemaVersion: 2,
    kind: 'household',
    id: `household:${householdId}:learning`,
    version: stableOverlayVersion(active),
    householdId,
    conceptAliases,
    brandAliases,
    quantityPreferences,
  };
}

export function resolveLearnedPreference<T>(
  explicitValue: T | null | undefined,
  entry: LearnedSemanticEntry | null | undefined,
): T | string | number | null {
  if (explicitValue !== null && explicitValue !== undefined) return explicitValue;
  if (!entry || entry.status !== 'active') return null;
  return entry.value.preferredValue ?? null;
}

function stableOverlayVersion(entries: readonly LearnedSemanticEntry[]): string {
  return entries
    .map((entry) => `${entry.id}:${entry.status}:${entry.supportingEventIds.join(',')}`)
    .sort()
    .join('|') || 'empty';
}
