import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildFirewallRules } from '../windows-firewall.mjs';

describe('Windows LAN firewall policy', () => {
  it('opens only live and sandbox web ports on the private profile', () => {
    assert.deepEqual(buildFirewallRules(), [
      { name: 'Duckworth Family Live Web', port: 4200 },
      { name: 'Duckworth Sandbox Web', port: 4300 },
    ]);
  });
});
