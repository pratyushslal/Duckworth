import type { ConversationCaptureCommand } from './conversation.js';

export interface ConversationContextRef {
  contextId: string;
  deviceId: string;
  speakerId: string | null;
}

export interface ContextualConversationCaptureCommand extends ConversationCaptureCommand {
  context: ConversationContextRef;
  idempotencyKey: string;
}

export function normalizeConversationContext(ref: ConversationContextRef): ConversationContextRef {
  const contextId = normalizeRequired(ref.contextId, 'contextId');
  const deviceId = normalizeRequired(ref.deviceId, 'deviceId');
  const speakerId = ref.speakerId?.trim() || null;
  return { contextId, deviceId, speakerId };
}

export function conversationContextKey(ref: ConversationContextRef): string {
  return normalizeRequired(ref.contextId, 'contextId');
}

export function contextualizeCapture(
  command: ContextualConversationCaptureCommand,
): ContextualConversationCaptureCommand {
  const text = command.text.trim();
  if (!text) throw new Error('text is required');
  const idempotencyKey = normalizeRequired(command.idempotencyKey, 'idempotencyKey');
  return {
    ...command,
    text,
    context: normalizeConversationContext(command.context),
    idempotencyKey,
  };
}

function normalizeRequired(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${field} is required`);
  return normalized;
}
