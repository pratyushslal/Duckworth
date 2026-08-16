import { describe, expect, it } from 'vitest';
import { expectedLaneForOrigin, verifyRuntimeIdentity, type RuntimeIdentity } from './runtime-identity';

describe('runtime identity binding', () => {
  it('maps the family and sandbox origins to their expected lanes', () => {
    expect(expectedLaneForOrigin('http://192.168.0.102:4200')).toBe('live');
    expect(expectedLaneForOrigin('http://192.168.0.102:4300')).toBe('sandbox');
  });

  it('does not guess a lane for an unbound origin', () => {
    expect(expectedLaneForOrigin('http://127.0.0.1:5173')).toBeNull();
  });

  it('accepts a matching server identity and rejects a mismatch', () => {
    const expected: RuntimeIdentity = { lane: 'sandbox', instanceId: 'sandbox-laptop' };
    expect(() => verifyRuntimeIdentity(expected, {
      status: 'ok', lane: 'sandbox', instanceId: 'sandbox-laptop',
    })).not.toThrow();
    expect(() => verifyRuntimeIdentity(expected, {
      status: 'ok', lane: 'live', instanceId: 'family-live',
    })).toThrow('API runtime lane does not match this origin');
  });

  it('accepts an explicitly bound disposable api-test identity', () => {
    const expected: RuntimeIdentity = { lane: 'api-test', instanceId: 'api-test-run-1' };
    expect(() => verifyRuntimeIdentity(expected, {
      status: 'ok', lane: 'api-test', instanceId: 'api-test-run-1',
    })).not.toThrow();
  });
});
