import type { HouseholdSemanticEntity } from './semantic-runtime.js';

export interface OfficialSemanticEntity {
  id: string;
  kind: HouseholdSemanticEntity['kind'];
  label: string;
  aliases: readonly string[];
  conceptId?: string;
  brandId?: string;
  productFamilyId?: string;
}

export type ReconciliationDisposition = 'link' | 'merge' | 'keep_separate';

export interface CatalogReconciliationCandidate {
  id: string;
  householdId: string;
  localEntityId: string;
  officialEntityId: string;
  fingerprint: string;
  status: 'proposed' | 'linked' | 'merged' | 'kept_separate';
  replacedByCatalogId: string | null;
}

export function createReconciliationCandidate(
  householdId: string,
  local: HouseholdSemanticEntity,
  official: OfficialSemanticEntity,
): CatalogReconciliationCandidate | null {
  if (local.kind !== official.kind) return null;
  const localFingerprint = semanticFingerprint(local);
  const officialFingerprint = semanticFingerprint(official);
  if (localFingerprint !== officialFingerprint) return null;
  return {
    id: `reconcile:${householdId}:${local.id}:${official.id}`,
    householdId,
    localEntityId: local.id,
    officialEntityId: official.id,
    fingerprint: localFingerprint,
    status: 'proposed',
    replacedByCatalogId: null,
  };
}

export function applyReconciliationDisposition(
  candidate: CatalogReconciliationCandidate,
  disposition: ReconciliationDisposition,
): CatalogReconciliationCandidate {
  if (candidate.status !== 'proposed') throw new Error('reconciliation_candidate_already_resolved');
  if (disposition === 'link') {
    return { ...candidate, status: 'linked', replacedByCatalogId: candidate.officialEntityId };
  }
  if (disposition === 'merge') {
    return { ...candidate, status: 'merged', replacedByCatalogId: candidate.officialEntityId };
  }
  return { ...candidate, status: 'kept_separate', replacedByCatalogId: null };
}

function semanticFingerprint(entity: Pick<HouseholdSemanticEntity, 'kind' | 'label' | 'aliases' | 'conceptId' | 'brandId' | 'productFamilyId'>): string {
  return JSON.stringify({
    kind: entity.kind,
    label: normalize(entity.label),
    aliases: [...new Set(entity.aliases.map(normalize))].sort(),
    conceptId: entity.conceptId ?? null,
    brandId: entity.brandId ?? null,
    productFamilyId: entity.productFamilyId ?? null,
  });
}

function normalize(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase().trim().replace(/\s+/gu, ' ');
}
