import { InvalidCaptureError, interpretCapture } from '../../item-capture/dist/index.js';
import type {
  BrainCaptureEnvelope,
  BrainDraft,
  BrainOperation,
  BrainResult,
  SemanticEvidence,
  SemanticItem,
  SemanticValue,
} from './contracts.js';
import { resolveSemanticItem } from './entity-resolution.js';
import {
  resolveContextReference,
  resolveUnqualifiedContextReference,
  type DiscourseContext,
} from './reference-resolution.js';
import { segmentCapture, type SourceSegment } from './segmentation.js';
import type { SemanticRuntime } from './semantic-runtime.js';

const ENGINE_VERSION = 'shopping-brain-v2';

export function runShoppingBrain(
  envelope: BrainCaptureEnvelope,
  runtime: SemanticRuntime,
  context: DiscourseContext,
): BrainResult {
  if (envelope.contextId !== context.contextId || envelope.shoppingListId !== context.shoppingListId) {
    throw new TypeError('Discourse context does not match the capture envelope');
  }
  const operations: BrainOperation[] = [];
  const warnings: BrainResult['warnings'][number][] = [];
  const segments = segmentCapture(envelope.text, runtime).slice(0, runtime.policy.maximumSegments);
  for (const segment of segments) {
    try {
      const capture = interpretCapture(segment.text, runtime);
      const resolved = resolveSemanticItem(capture, runtime);
      warnings.push(...resolved.warnings.map((warning) => shiftWarning(warning, segment.start)));
      if (resolved.alternatives.length > 0) {
        operations.push({ kind: 'draft', draft: draftFor(
          segment,
          'ambiguous_entity',
          resolved.alternatives.map(({ item }) => item.identity.variantKey),
        ) });
        continue;
      }
      let item = shiftItem(resolved.item, segment.start);
      const correctionCapture = startsWithAny(segment.text, runtime.grammar.correctionPrefixes ?? []);
      const pronounCapture = (runtime.grammar.referencePronouns ?? [])
        .some((pronoun) => normalize(pronoun) === normalize(item.itemName.value));
      const referenceCapture = correctionCapture
        || pronounCapture
        || startsWithAny(segment.text, runtime.grammar.referencePrefixes ?? []);
      if (!referenceCapture) {
        operations.push({ kind: 'create', item, sourceStart: segment.start, sourceEnd: segment.end });
        continue;
      }
      const reference = pronounCapture
        ? resolveUnqualifiedContextReference(context.recentEntities, runtime.policy)
        : resolveContextReference(item, context.recentEntities, runtime.policy);
      if (reference.kind === 'merge') {
        const target = context.recentEntities.find(({ itemId }) => itemId === reference.targetItemId);
        if (pronounCapture && target?.item) item = applyReferenceTarget(target.item, item);
        operations.push({
          kind: correctionCapture ? 'correct' : 'merge',
          targetItemId: reference.targetItemId,
          item,
          ...(correctionCapture ? {} : { sourceStart: segment.start, sourceEnd: segment.end }),
        });
      } else if (reference.kind === 'draft') {
        operations.push({ kind: 'draft', draft: draftFor(segment, 'ambiguous_reference', reference.candidateItemIds) });
      } else {
        operations.push({ kind: 'create', item, sourceStart: segment.start, sourceEnd: segment.end });
      }
    } catch (error) {
      if (!(error instanceof InvalidCaptureError)) throw error;
      operations.push({ kind: 'draft', draft: draftFor(segment, 'unsupported_text', []) });
    }
  }
  if (segments.length === 0 && envelope.text.trim()) {
    const start = envelope.text.search(/\S/u);
    const end = envelope.text.trimEnd().length;
    operations.push({ kind: 'draft', draft: {
      reasonCode: 'unsupported_text',
      text: envelope.text.slice(start, end),
      sourceStart: start,
      sourceEnd: end,
      candidateIds: [],
    } });
  }
  return {
    schemaVersion: 2,
    engineVersion: ENGINE_VERSION,
    runtimeVersions: runtime.versions,
    capture: { inputId: envelope.inputId, text: envelope.text },
    operations: Object.freeze(operations),
    warnings: Object.freeze(warnings),
  };
}

function applyReferenceTarget(target: SemanticItem, requested: SemanticItem): SemanticItem {
  return {
    itemName: inheritedValue(target.itemName),
    conceptId: inheritedValue(target.conceptId),
    brandId: inheritedValue(target.brandId),
    categoryId: inheritedValue(target.categoryId),
    requestedCount: requested.requestedCount,
    requestedUnitId: requested.requestedUnitId,
    packageMeasure: requested.packageMeasure.value === null ? inheritedValue(target.packageMeasure) : requested.packageMeasure,
    packageContainerUnitId: requested.packageContainerUnitId ?? (target.packageContainerUnitId
      ? inheritedValue(target.packageContainerUnitId)
      : undefined),
    attributes: {
      ...Object.fromEntries(Object.entries(target.attributes).map(([id, value]) => [id, inheritedValue(value)])),
      ...requested.attributes,
    },
    identity: target.identity,
  };
}

function inheritedValue<T>(value: SemanticValue<T>): SemanticValue<T> {
  return {
    ...value,
    evidence: value.evidence.map((evidence) => evidence.kind === 'source_span'
      ? { kind: 'household_confirmation', ref: 'reference_target' }
      : evidence),
  };
}

function draftFor(segment: SourceSegment, reasonCode: string, candidateIds: readonly string[]): BrainDraft {
  return {
    reasonCode,
    text: segment.text,
    sourceStart: segment.start,
    sourceEnd: segment.end,
    candidateIds: Object.freeze([...candidateIds].sort()),
  };
}

function shiftItem(item: SemanticItem, offset: number): SemanticItem {
  return {
    ...item,
    itemName: shiftValue(item.itemName, offset),
    conceptId: shiftValue(item.conceptId, offset),
    brandId: shiftValue(item.brandId, offset),
    categoryId: shiftValue(item.categoryId, offset),
    requestedCount: shiftValue(item.requestedCount, offset),
    requestedUnitId: shiftValue(item.requestedUnitId, offset),
    packageMeasure: shiftValue(item.packageMeasure, offset),
    ...(item.packageContainerUnitId
      ? { packageContainerUnitId: shiftValue(item.packageContainerUnitId, offset) }
      : {}),
    attributes: Object.fromEntries(Object.entries(item.attributes).map(([id, value]) => [id, shiftValue(value, offset)])),
  };
}

function shiftValue<T>(value: SemanticValue<T>, offset: number): SemanticValue<T> {
  return { ...value, evidence: value.evidence.map((evidence) => shiftEvidence(evidence, offset)) };
}

function shiftEvidence(evidence: SemanticEvidence, offset: number): SemanticEvidence {
  if (evidence.sourceStart === undefined || evidence.sourceEnd === undefined) return evidence;
  return { ...evidence, sourceStart: evidence.sourceStart + offset, sourceEnd: evidence.sourceEnd + offset };
}

function shiftWarning(
  warning: BrainResult['warnings'][number],
  offset: number,
): BrainResult['warnings'][number] {
  if (warning.sourceStart === undefined || warning.sourceEnd === undefined) return warning;
  return { ...warning, sourceStart: warning.sourceStart + offset, sourceEnd: warning.sourceEnd + offset };
}

function startsWithAny(text: string, prefixes: readonly string[]): boolean {
  const normalized = normalize(text);
  return prefixes.some((prefix) => normalized === normalize(prefix) || normalized.startsWith(`${normalize(prefix)} `));
}

function normalize(text: string): string {
  return text.normalize('NFKC').toLowerCase().trim();
}
