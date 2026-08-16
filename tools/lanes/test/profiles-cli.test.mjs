import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseCommand, resolveLanHost, resultExitCode } from '../duckworth-profiles.mjs';

describe('profile supervisor CLI', () => {
  it('targets one permanent profile without implying a global switch', () => {
    assert.deepEqual(parseCommand(['ensure', 'sandbox']), { action: 'ensure', profiles: ['sandbox'] });
    assert.deepEqual(parseCommand(['restart', 'live']), { action: 'restart', profiles: ['live'] });
    assert.deepEqual(parseCommand(['ensure']), { action: 'ensure', profiles: ['live', 'sandbox'] });
  });

  it('redetects the current LAN address instead of reusing an installed DHCP address', () => {
    assert.equal(resolveLanHost({}, { lanHost: '192.168.0.20' }, () => '192.168.0.102'), '192.168.0.102');
    assert.equal(resolveLanHost({ DUCKWORTH_LAN_HOST: '10.0.0.8' }, { lanHost: '192.168.0.20' }, () => '192.168.0.102'), '10.0.0.8');
  });

  it('rejects unknown actions and profiles', () => {
    assert.throws(() => parseCommand(['switch', 'live']), /unknown profile command/);
    assert.throws(() => parseCommand(['ensure', 'api-test']), /api-test instances are disposable/);
  });

  it('parses disposable api-test run and open commands separately', () => {
    assert.deepEqual(parseCommand(['api-test', 'run', '--', 'pnpm', 'test']), {
      action: 'api-test-run', command: ['pnpm', 'test'],
    });
    assert.deepEqual(parseCommand(['api-test', 'open', '--ttl', '30m']), {
      action: 'api-test-open', ttlMs: 30 * 60 * 1000,
    });
    assert.deepEqual(parseCommand(['api-test', 'run', '--with-web', '--', 'python', 'e2e/foundation_check.py']), {
      action: 'api-test-run', command: ['python', 'e2e/foundation_check.py'], withWeb: true,
    });
    assert.deepEqual(parseCommand(['api-test', 'open', '--with-web', '--ttl', '30m']), {
      action: 'api-test-open', ttlMs: 30 * 60 * 1000, withWeb: true,
    });
    assert.deepEqual(parseCommand(['api-test', 'reap']), { action: 'api-test-reap' });
  });

  it('propagates a child API-test command failure to the supervisor CLI', () => {
    assert.equal(resultExitCode({ exitCode: 7 }), 7);
    assert.equal(resultExitCode({ status: [] }), 0);
  });

  it('parses resident supervision and Windows startup commands', () => {
    assert.deepEqual(parseCommand(['watch']), { action: 'watch' });
    assert.deepEqual(parseCommand(['startup', 'install']), { action: 'startup-install' });
    assert.deepEqual(parseCommand(['startup', 'status']), { action: 'startup-status' });
    assert.deepEqual(parseCommand(['startup', 'remove']), { action: 'startup-remove' });
  });

  it('parses explicit live release promotion', () => {
    assert.deepEqual(parseCommand(['release', 'promote']), { action: 'release-promote' });
  });

  it('parses one-time live credential bootstrap', () => {
    assert.deepEqual(parseCommand(['bootstrap', 'live', '--household', 'family-a']), {
      action: 'bootstrap-live', householdId: 'family-a',
    });
  });

  it('parses explicit LAN firewall administration', () => {
    assert.deepEqual(parseCommand(['firewall', 'install']), { action: 'firewall-install' });
    assert.deepEqual(parseCommand(['firewall', 'status']), { action: 'firewall-status' });
    assert.deepEqual(parseCommand(['firewall', 'remove']), { action: 'firewall-remove' });
  });
});
