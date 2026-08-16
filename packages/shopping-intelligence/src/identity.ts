import type { SemanticItem } from './contracts.js';
import type { SemanticRuntime } from './semantic-runtime.js';

export interface ItemIdentity {
  conceptKey: string;
  variantKey: string;
  requestKey: string;
}

export type DuplicateDecision =
  | { kind: 'exact_merge'; targetItemId: string }
  | { kind: 'similar'; candidateItemIds: readonly string[] }
  | { kind: 'distinct' };

export interface IdentityCandidate {
  id: string;
  item: SemanticItem;
}

export function createItemIdentity(item: SemanticItem, runtime: SemanticRuntime): ItemIdentity {
  const conceptKey = item.conceptId.value ?? normalize(item.itemName.value);
  const category = item.categoryId.value ? runtime.categories.get(item.categoryId.value) : undefined;
  const variantAttributes = (category?.variantAttributeIds ?? [])
    .map((id) => [id, item.attributes[id]?.value ?? null] as const)
    .sort(([left], [right]) => left.localeCompare(right));
  const packageIdentity = item.packageMeasure.value
    ? {
      value: item.packageMeasure.value.comparisonValue ?? item.packageMeasure.value.value,
      unitId: item.packageMeasure.value.comparisonUnitId ?? item.packageMeasure.value.unitId,
    }
    : null;
  const packageContainer = item.packageContainerUnitId?.value ?? null;
  const variantKey = stableKey({
    concept: conceptKey,
    brand: item.brandId.value,
    productFamily: item.productFamilyId?.value ?? null,
    product: item.productId?.value ?? null,
    package: packageIdentity,
    packageContainer,
    attributes: Object.fromEntries(variantAttributes),
    descriptors: (item.descriptorMentions ?? [])
      .filter((descriptor) => descriptor.role === 'identity_attribute')
      .map((descriptor) => [descriptor.normalized, descriptor.role]),
  });
  const requestKey = stableKey({
    variant: variantKey,
    count: item.requestedCount.value,
    unit: item.requestedUnitId.value,
  });
  return { conceptKey, variantKey, requestKey };
}

export function classifyDuplicate(
  item: SemanticItem,
  candidates: readonly IdentityCandidate[],
  runtime: SemanticRuntime,
): DuplicateDecision {
  const identity = createItemIdentity(item, runtime);
  const normalizedCandidates = candidates.map((candidate) => ({
    ...candidate,
    identity: createItemIdentity(candidate.item, runtime),
  }));
  const exact = normalizedCandidates.filter((candidate) => candidate.identity.variantKey === identity.variantKey);
  if (exact.length === 1 && identityReady(item) && identityReady(exact[0].item)) {
    return { kind: 'exact_merge', targetItemId: exact[0].id };
  }
  const similar = normalizedCandidates
    .filter((candidate) => candidate.identity.conceptKey === identity.conceptKey)
    .map(({ id }) => id)
    .sort();
  return similar.length > 0 ? { kind: 'similar', candidateItemIds: similar } : { kind: 'distinct' };
}

function identityReady(item: SemanticItem): boolean {
  return item.conceptId.confidence !== 'unknown'
    && item.brandId.confidence !== 'unknown'
    && item.packageMeasure.confidence !== 'unknown'
    && Object.values(item.attributes).every((attribute) => attribute.confidence !== 'unknown');
}

function stableKey(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, candidate]) => [key, sortValue(candidate)]));
}

function normalize(value: string): string {
  return value.normalize('NFKC').toLowerCase().trim().replace(/\s+/gu, ' ');
}
