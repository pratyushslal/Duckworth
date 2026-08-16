import type { SemanticItem } from './contracts.js';
import type { BrainPolicy } from './semantic-runtime.js';

export interface DiscourseContext {
  contextId: string;
  shoppingListId: string;
  recentEntities: readonly ContextEntity[];
  openDrafts: readonly ContextDraft[];
}

export interface ContextEntity {
  itemId: string;
  conceptKey: string;
  variantKey: string;
  mentionedAt: string;
  item?: SemanticItem;
}

export interface ContextDraft {
  draftId: string;
  candidateItemIds: readonly string[];
}

export function resolveUnqualifiedContextReference(
  candidates: readonly ContextEntity[],
  policy: BrainPolicy,
): ContextReferenceDecision {
  const bounded = candidates.slice(0, policy.maximumCandidatesPerEntity);
  if (bounded.length === 1) return { kind: 'merge', targetItemId: bounded[0].itemId };
  if (bounded.length > 1) return { kind: 'draft', candidateItemIds: stableIds(bounded) };
  return { kind: 'create' };
}

export type ContextReferenceDecision =
  | { kind: 'merge'; targetItemId: string }
  | { kind: 'draft'; candidateItemIds: readonly string[] }
  | { kind: 'create' };

export function resolveContextReference(
  item: SemanticItem,
  candidates: readonly ContextEntity[],
  policy: BrainPolicy,
): ContextReferenceDecision {
  const bounded = candidates.slice(0, policy.maximumCandidatesPerEntity);
  const exact = bounded.filter((candidate) => candidate.variantKey === item.identity.variantKey);
  if (exact.length === 1) return { kind: 'merge', targetItemId: exact[0].itemId };
  if (exact.length > 1) return { kind: 'draft', candidateItemIds: stableIds(exact) };
  const sameConcept = bounded.filter((candidate) => candidate.conceptKey === item.identity.conceptKey);
  if (sameConcept.length === 1) return { kind: 'merge', targetItemId: sameConcept[0].itemId };
  if (sameConcept.length > 1) return { kind: 'draft', candidateItemIds: stableIds(sameConcept) };
  return { kind: 'create' };
}

function stableIds(candidates: readonly ContextEntity[]): string[] {
  return [...new Set(candidates.map(({ itemId }) => itemId))].sort();
}
