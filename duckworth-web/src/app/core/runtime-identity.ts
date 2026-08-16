export type RuntimeLane = 'live' | 'sandbox' | 'api-test';

export interface RuntimeIdentity {
  lane: RuntimeLane;
  instanceId?: string;
}

export interface RuntimeHealth {
  status: 'ok';
  lane?: RuntimeLane;
  instanceId?: string;
}

export function expectedLaneForOrigin(origin: string): RuntimeLane | null {
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return null;
  }
  if (parsed.port === '4200') return 'live';
  if (parsed.port === '4300') return 'sandbox';
  return null;
}

export function verifyRuntimeIdentity(expected: RuntimeIdentity, health: RuntimeHealth): void {
  if (health.lane !== expected.lane || (expected.instanceId !== undefined && health.instanceId !== expected.instanceId)) {
    throw new Error('API runtime lane does not match this origin');
  }
}
