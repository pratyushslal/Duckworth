import {
  interpretItem,
  type CaptureCommand,
  type ItemIntent,
} from './index.js';
import type { SemanticRuntime } from './semantic-runtime.js';
import { resolveSemanticItem } from './entity-resolution.js';

export type ItemCategoryId = string;

export interface ConversationCaptureCommand extends Omit<CaptureCommand, 'source'> {
  householdId: string;
  sessionId?: string;
  occurredAt: string;
  source?: 'text' | 'voice' | 'api' | 'assistant';
}

export interface ConversationItemIntent extends ItemIntent {
  category: {
    id: ItemCategoryId;
    confidence: 'confirmed' | 'inferred' | 'unknown';
  };
  attributes: Readonly<Record<string, string | number>>;
}

export interface ConversationInterpretation {
  captureText: string;
  items: ConversationItemIntent[];
  unresolved: Array<{
    text: string;
    reason: 'ambiguous_clause' | 'ambiguous_reference';
  }>;
}

export type ConversationItemCandidate = ConversationItemIntent & { id: string };

/** Adds semantic category and explicit attributes without depending on an input channel. */
export function enrichItemIntent(item: ItemIntent, runtime: SemanticRuntime): ConversationItemIntent {
  const semantic = resolveSemanticItem({
    captureText: item.captureText,
    name: item.itemName,
    quantity: item.quantity,
    unit: item.unit,
    packageSize: item.packageSize,
    packageUnit: item.packageUnit,
  }, runtime).item;
  return {
    ...item,
    category: {
      id: semantic.categoryId.value ?? 'unknown',
      confidence: semantic.categoryId.confidence,
    },
    attributes: Object.fromEntries(Object.entries(semantic.attributes).map(([id, value]) => [id, value.value])),
  };
}

export type ConversationDecision =
  | { kind: 'create'; item: ConversationItemIntent }
  | { kind: 'merge'; itemId: string; delta: ConversationItemIntent }
  | { kind: 'draft'; text: string; reason: 'ambiguous_reference' };

export function resolveFollowUp(
  text: string,
  candidates: readonly ConversationItemCandidate[],
  runtime: SemanticRuntime,
): ConversationDecision {
  const normalizedText = text.trim().normalize('NFKC').toLocaleLowerCase();
  const isFollowUp = (runtime.grammar.referencePrefixes ?? []).some((prefix) => {
    const normalizedPrefix = prefix.trim().normalize('NFKC').toLocaleLowerCase();
    return normalizedText === normalizedPrefix || normalizedText.startsWith(`${normalizedPrefix} `);
  });
  const targetText = text.trim();
  const parsed = interpretItem({
    text: targetText,
    runtime,
  });
  const delta: ConversationItemIntent = enrichItemIntent({ ...parsed, captureText: text.trim() }, runtime);
  if (!isFollowUp) return { kind: 'create', item: delta };
  const matches = candidates.filter((candidate) => (
    candidate.identityKey === delta.identityKey
    || candidate.identityKey.endsWith(` ${delta.identityKey}`)
  ));

  if (matches.length === 1) {
    return { kind: 'merge', itemId: matches[0].id, delta };
  }
  if (matches.length > 1) {
    return { kind: 'draft', text: text.trim(), reason: 'ambiguous_reference' };
  }
  return { kind: 'create', item: delta };
}

export function interpretConversation(
  command: ConversationCaptureCommand,
): ConversationInterpretation {
  const captureText = command.text.trim();
  const clauses = captureText
    .replace(/^(?:please\s+add|add|i\s+need|we\s+need|i\s+want|we\s+want)\s+/iu, '')
    .split(/\s+and\s+|[,;]+/iu)
    .map((clause) => clause.trim())
    .filter(Boolean);

  const unresolved = clauses
    .filter((text) => !/[\p{L}\p{N}]/u.test(text))
    .map((text) => ({ text, reason: 'ambiguous_clause' as const }));
  const items = clauses
    .filter((text) => /[\p{L}\p{N}]/u.test(text))
    .map((text): ConversationItemIntent => {
      const item = interpretItem({
        text,
        locale: command.locale,
        countryCode: command.countryCode,
        runtime: command.runtime,
        brandHints: command.brandHints,
        acceptedProductId: command.acceptedProductId,
      });

      return enrichItemIntent({ ...item, captureText: text }, command.runtime);
    });

  return { captureText, items, unresolved };
}

export function inferCategory(
  item: Pick<ItemIntent, 'itemName' | 'packageSize'>,
  runtime: SemanticRuntime,
): ConversationItemIntent['category'] {
  const semantic = resolveSemanticItem({
    captureText: item.itemName,
    name: item.itemName,
    quantity: null,
    unit: null,
    packageSize: item.packageSize,
    packageUnit: null,
  }, runtime).item.categoryId;
  return { id: semantic.value ?? 'unknown', confidence: semantic.confidence };
}

export function inferAttributes(
  itemName: string,
  runtime: SemanticRuntime,
): Readonly<Record<string, string | number>> {
  const attributes = resolveSemanticItem({
    captureText: itemName,
    name: itemName,
    quantity: null,
    unit: null,
    packageSize: null,
    packageUnit: null,
  }, runtime).item.attributes;
  return Object.fromEntries(Object.entries(attributes).map(([id, value]) => [id, value.value]));
}
