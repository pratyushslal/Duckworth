import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readExpectedHealth } from '../supervisor-runtime.mjs';
import { restartDelayMs } from '../supervisor-watch.mjs';

describe('supervisor crash recovery backoff', () => {
  it('backs off repeated failures but returns to the normal health interval after success', () => {
    assert.equal(restartDelayMs(0), 10_000);
    assert.equal(restartDelayMs(1), 5_000);
    assert.equal(restartDelayMs(2), 10_000);
    assert.equal(restartDelayMs(20), 60_000);
  });

  it('does not declare a running profile unhealthy after one transient probe failure', async () => {
    let attempts = 0;
    const health = await readExpectedHealth({
      healthOrigin: 'http://127.0.0.1:3000', profile: 'live', instanceId: 'family-live',
    }, async () => {
      attempts += 1;
      if (attempts === 1) throw new Error('transient connection reset');
      return { ok: true, json: async () => ({ status: 'ok', lane: 'live', instanceId: 'family-live' }) };
    }, { attempts: 3, delayMs: 1 });
    assert.equal(attempts, 2);
    assert.equal(health.instanceId, 'family-live');
  });
});
