import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bootstrapLiveCredentials } from '../live-bootstrap.mjs';

describe('live credential bootstrap', () => {
  const directories = [];
  afterEach(() => directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true })));

  it('creates secrets outside source control without returning the access token', () => {
    const root = mkdtempSync(join(tmpdir(), 'duckworth-live-bootstrap-'));
    directories.push(root);
    const envFile = join(root, 'config', 'live.env');
    const result = bootstrapLiveCredentials({
      envFile,
      householdId: 'family-a',
      now: new Date('2026-08-14T00:00:00.000Z'),
      randomToken: () => 'secret-access-token',
      randomPairingCode: () => 'pair-once',
      protectFile: () => {},
    });
    const contents = readFileSync(envFile, 'utf8');
    assert.equal(existsSync(envFile), true);
    assert.match(contents, /DUCKWORTH_ACCESS_TOKEN=secret-access-token/u);
    assert.match(contents, /DUCKWORTH_PAIRING_EXPIRES_AT=2026-08-21T00:00:00.000Z/u);
    assert.deepEqual(result, {
      envFile,
      householdId: 'family-a',
      pairingCode: 'pair-once',
      pairingExpiresAt: '2026-08-21T00:00:00.000Z',
    });
    assert.throws(() => bootstrapLiveCredentials({ envFile, householdId: 'family-a' }), /already exists/);
  });
});
