import { describe, expect, it } from 'vitest';
import {
  conversationContextKey,
  contextualizeCapture,
  normalizeConversationContext,
  type ContextualConversationCaptureCommand,
} from './conversation-context.js';

const command: ContextualConversationCaptureCommand = {
  householdId: 'household-a',
  context: { contextId: 'ctx-a', deviceId: 'tablet-a', speakerId: null },
  text: 'Add milk',
  locale: 'en-IN',
  countryCode: 'IN',
  source: 'text',
  occurredAt: '2026-08-11T00:00:00.000Z',
  idempotencyKey: 'capture-a',
};

describe('conversation context contract', () => {
  it('normalizes dynamic device and speaker identifiers without inventing identity', () => {
    expect(normalizeConversationContext({
      contextId: ' ctx-a ',
      deviceId: ' tablet-a ',
      speakerId: '',
    })).toEqual({ contextId: 'ctx-a', deviceId: 'tablet-a', speakerId: null });
  });

  it('uses the server context id as the stable partition key', () => {
    expect(conversationContextKey(command.context)).toBe('ctx-a');
  });

  it('preserves the capture text and interpretation metadata across sources', () => {
    expect(contextualizeCapture({ ...command, source: 'voice' })).toEqual({
      ...command,
      source: 'voice',
    });
  });

  it.each([
    [{ ...command.context, contextId: ' ' }, 'contextId'],
    [{ ...command.context, deviceId: ' ' }, 'deviceId'],
  ])('rejects missing %s', (context, field) => {
    expect(() => normalizeConversationContext(context)).toThrow(field);
  });

  it('rejects a missing idempotency key', () => {
    expect(() => contextualizeCapture({ ...command, idempotencyKey: ' ' })).toThrow('idempotencyKey');
  });
});
