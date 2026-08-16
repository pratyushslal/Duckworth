import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { applyReconciliation, parseEnvFile, planReconciliation } from '../process-supervisor.mjs';

describe('profile reconciliation', () => {
  it('never stops a healthy live process while restarting sandbox', () => {
    const current = [
      { key: 'live-api', profile: 'live', pid: 100, healthy: true, fingerprint: 'live-a' },
      { key: 'live-web', profile: 'live', pid: 101, healthy: true, fingerprint: 'live-w' },
      { key: 'sandbox-api', profile: 'sandbox', pid: 200, healthy: true, fingerprint: 'sandbox-a-old' },
      { key: 'sandbox-web', profile: 'sandbox', pid: 201, healthy: true, fingerprint: 'sandbox-w-old' },
    ];
    const desired = [
      { key: 'live-api', profile: 'live', fingerprint: 'live-a' },
      { key: 'live-web', profile: 'live', fingerprint: 'live-w' },
      { key: 'sandbox-api', profile: 'sandbox', fingerprint: 'sandbox-a-new' },
      { key: 'sandbox-web', profile: 'sandbox', fingerprint: 'sandbox-w-new' },
    ];

    const plan = planReconciliation(current, desired, { profiles: ['sandbox'] });

    assert.deepEqual(plan.stop.map((entry) => entry.key).sort(), ['sandbox-api', 'sandbox-web']);
    assert.deepEqual(plan.start.map((entry) => entry.key).sort(), ['sandbox-api', 'sandbox-web']);
    assert.deepEqual(plan.keep.map((entry) => entry.key).sort(), []);
    assert.ok(plan.stop.every((entry) => entry.profile !== 'live'));
  });

  it('keeps matching healthy processes and replaces unhealthy ones only in scope', () => {
    const current = [{ key: 'live-api', profile: 'live', pid: 100, healthy: false, fingerprint: 'live-a' }];
    const desired = [{ key: 'live-api', profile: 'live', fingerprint: 'live-a' }];
    const plan = planReconciliation(current, desired, { profiles: ['live'] });
    assert.deepEqual(plan.stop.map((entry) => entry.key), ['live-api']);
    assert.deepEqual(plan.start.map((entry) => entry.key), ['live-api']);
  });

  it('applies stops before starts and does not act on kept processes', async () => {
    const calls = [];
    const plan = {
      keep: [{ key: 'live-api' }],
      stop: [{ key: 'sandbox-api' }],
      start: [{ key: 'sandbox-api' }],
    };
    await applyReconciliation(plan, {
      stop: async (entry) => calls.push(`stop:${entry.key}`),
      start: async (entry) => { calls.push(`start:${entry.key}`); return { ...entry, pid: 42 }; },
    });
    assert.deepEqual(calls, ['stop:sandbox-api', 'start:sandbox-api']);
  });

  it('parses an external secrets file without interpreting commands', () => {
    assert.deepEqual(parseEnvFile(`
# Duckworth live credentials
DUCKWORTH_HOUSEHOLD_ID=family-a
DUCKWORTH_ACCESS_TOKEN="secret value"
MALFORMED
`), {
      DUCKWORTH_HOUSEHOLD_ID: 'family-a',
      DUCKWORTH_ACCESS_TOKEN: 'secret value',
    });
  });
});
