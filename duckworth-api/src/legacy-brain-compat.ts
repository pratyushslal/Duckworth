import {
  runShoppingBrain,
  type BrainCaptureEnvelope,
  type CaptureCommand,
  type ConversationCaptureCommand,
  type ConversationInterpretation,
  type ConversationItemIntent,
  type DiscourseContext,
  type ItemIntent,
  type SemanticItem,
  type SemanticRuntime,
} from '@duckworth/shopping-intelligence';

/**
 * Compatibility-only translations for v1 callers. All interpretation is delegated to the
 * versioned shopping-brain facade; this module only reshapes its source-neutral result.
 */
export function interpretLegacyConversation(
  command: ConversationCaptureCommand,
): ConversationInterpretation {
  const envelope = legacyEnvelope(command);
  const result = runShoppingBrain(envelope, command.runtime, emptyContext(envelope));
  return {
    captureText: envelope.text.trim(),
    items: result.operations.flatMap((operation) => (
      operation.kind === 'create'
        ? [toConversationIntent(
            operation.item,
            envelope.text.slice(operation.sourceStart ?? 0, operation.sourceEnd ?? envelope.text.length),
            command.brandHints,
          )]
        : []
    )),
    unresolved: result.operations.flatMap((operation) => (
      operation.kind === 'draft'
        ? [{ text: operation.draft.text, reason: operation.draft.reasonCode === 'ambiguous_reference'
          ? 'ambiguous_reference' as const
          : 'ambiguous_clause' as const }]
        : []
    )),
  };
}

export function interpretLegacyItem(command: CaptureCommand): ItemIntent {
  const envelope = legacyEnvelope({
    ...command,
    householdId: 'legacy-item-adapter',
    occurredAt: '1970-01-01T00:00:00.000Z',
  });
  const result = runShoppingBrain(envelope, command.runtime, emptyContext(envelope));
  const operation = result.operations.find((candidate) => candidate.kind === 'create');
  if (!operation || operation.kind !== 'create') {
    throw new TypeError('Legacy item input did not produce a savable item');
  }
  return toItemIntent(operation.item, envelope.text, command.brandHints, true);
}

function legacyEnvelope(command: ConversationCaptureCommand): BrainCaptureEnvelope {
  const householdId = command.householdId;
  const contextId = command.sessionId ?? `legacy:${householdId}`;
  return {
    schemaVersion: 2,
    inputId: `legacy:${contextId}:${command.occurredAt}`,
    householdId,
    contextId,
    shoppingListId: `default:${householdId}`,
    source: {
      kind: command.source === 'voice' ? 'voice-transcript' : command.source ?? 'text',
      deviceId: 'legacy-adapter',
    },
    text: command.text,
    locale: command.locale ?? 'und',
    countryCode: command.countryCode ?? 'ZZ',
    occurredAt: command.occurredAt,
    idempotencyKey: `legacy:${contextId}:${command.occurredAt}`,
  };
}

function emptyContext(envelope: BrainCaptureEnvelope): DiscourseContext {
  return {
    contextId: envelope.contextId,
    shoppingListId: envelope.shoppingListId,
    recentEntities: [],
    openDrafts: [],
  };
}

function toConversationIntent(
  item: SemanticItem,
  source: string,
  brandHints?: readonly { label: string; aliases: readonly string[] }[],
): ConversationItemIntent {
  const intent = toItemIntent(item, source, brandHints, true);
  return {
    ...intent,
    category: {
      id: item.categoryId.value ?? 'unknown',
      confidence: item.categoryId.confidence,
    },
    attributes: Object.fromEntries(
      Object.entries(item.attributes).map(([id, value]) => [id, value.value]),
    ),
  };
}

function toItemIntent(
  item: SemanticItem,
  source: string,
  brandHints?: readonly { label: string; aliases: readonly string[] }[],
  preserveSource = false,
): ItemIntent {
  const evidence = [
    ...item.itemName.evidence,
    ...item.requestedCount.evidence,
    ...item.requestedUnitId.evidence,
    ...item.packageMeasure.evidence,
  ].filter((entry) => entry.sourceStart !== undefined && entry.sourceEnd !== undefined);
  const start = evidence.length > 0 ? Math.min(...evidence.map((entry) => entry.sourceStart!)) : 0;
  const end = evidence.length > 0 ? Math.max(...evidence.map((entry) => entry.sourceEnd!)) : source.length;
  const measure = item.packageMeasure.value;
  const normalizedName = item.itemName.value.normalize('NFKC').toLocaleLowerCase('und');
  const brandName = item.brandId.value === null ? undefined : brandHints
    ?.flatMap((hint) => hint.aliases.map((alias) => ({ hint, alias: alias.normalize('NFKC').toLocaleLowerCase('und') })))
    .filter(({ alias }) => normalizedName === alias || normalizedName.startsWith(`${alias} `))
    .sort((left, right) => right.alias.length - left.alias.length)[0]?.hint.label;
  return {
    captureText: preserveSource ? source.trim() : source.slice(start, end).trim() || item.itemName.value,
    itemName: item.itemName.value,
    identityKey: normalizedName.replace(/\s+/gu, ' ').trim(),
    quantity: item.requestedCount.value,
    unit: item.requestedUnitId.value,
    packageSize: measure?.value ?? null,
    packageUnit: measure?.unitId ?? null,
    ...(brandName ? { brandName } : {}),
  };
}
