import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';

const sandboxDatabase = 'C:\\Duckworth\\data\\sandbox.sqlite';
const liveDatabase = 'C:\\Duckworth\\data\\live.sqlite';
const apiTestDatabase = 'C:\\Duckworth\\data\\api-test\\run-1.sqlite';

describe('API runtime configuration', () => {
  it('loads an explicit sandbox manifest', () => {
    expect(loadConfig({
      HOST: '0.0.0.0',
      PORT: '3001',
      DUCKWORTH_LANE: 'sandbox',
      DUCKWORTH_INSTANCE_ID: 'sandbox-laptop',
      SQLITE_PATH: sandboxDatabase,
      DUCKWORTH_PUBLIC_ORIGIN: 'http://127.0.0.1:4300',
    })).toEqual({
      host: '0.0.0.0',
      port: 3001,
      lane: 'sandbox',
      instanceId: 'sandbox-laptop',
      databasePath: sandboxDatabase,
      publicOrigin: 'http://127.0.0.1:4300',
      householdId: undefined,
      accessToken: undefined,
      pairingCode: undefined,
      pairingExpiresAt: undefined,
      captureRetentionDays: 90,
    });
  });

  it('identifies test mode as an isolated api-test runtime', () => {
    expect(loadConfig({
      NODE_ENV: 'test',
      DUCKWORTH_INSTANCE_ID: 'api-test-run-1',
      SQLITE_PATH: ':memory:',
    })).toMatchObject({
      host: '127.0.0.1',
      lane: 'api-test',
      instanceId: 'api-test-run-1',
      databasePath: ':memory:',
    });
  });

  it('loads an explicit disposable api-test manifest outside in-process test mode', () => {
    expect(loadConfig({
      HOST: '127.0.0.1',
      PORT: '3101',
      DUCKWORTH_LANE: 'api-test',
      DUCKWORTH_INSTANCE_ID: 'api-test-run-1',
      SQLITE_PATH: apiTestDatabase,
      DUCKWORTH_PUBLIC_ORIGIN: 'http://127.0.0.1:3101',
      DUCKWORTH_TEST_CONTROL_SECRET: 'launch-secret',
    })).toMatchObject({
      lane: 'api-test',
      instanceId: 'api-test-run-1',
      databasePath: apiTestDatabase,
      testControlSecret: 'launch-secret',
    });
  });

  it('rejects an explicit api-test runtime without a launch secret', () => {
    expect(() => loadConfig({
      DUCKWORTH_LANE: 'api-test',
      DUCKWORTH_INSTANCE_ID: 'api-test-run-1',
      SQLITE_PATH: apiTestDatabase,
      DUCKWORTH_PUBLIC_ORIGIN: 'http://127.0.0.1:3101',
    })).toThrow('api-test lane requires DUCKWORTH_TEST_CONTROL_SECRET');
  });

  it('allows the operating system to assign an api-test port but not a permanent-profile port', () => {
    expect(loadConfig({
      PORT: '0',
      DUCKWORTH_LANE: 'api-test',
      DUCKWORTH_INSTANCE_ID: 'api-test-run-1',
      SQLITE_PATH: apiTestDatabase,
      DUCKWORTH_PUBLIC_ORIGIN: 'http://127.0.0.1',
      DUCKWORTH_TEST_CONTROL_SECRET: 'launch-secret',
    }).port).toBe(0);
    expect(() => loadConfig({
      PORT: '0',
      DUCKWORTH_LANE: 'sandbox',
      DUCKWORTH_INSTANCE_ID: 'sandbox-laptop',
      SQLITE_PATH: sandboxDatabase,
      DUCKWORTH_PUBLIC_ORIGIN: 'http://127.0.0.1:4300',
    })).toThrow('PORT must be an integer between 1 and 65535');
  });

  it.each([
    ['DUCKWORTH_LANE', { DUCKWORTH_INSTANCE_ID: 'id', SQLITE_PATH: sandboxDatabase, DUCKWORTH_PUBLIC_ORIGIN: 'http://127.0.0.1:4300' }],
    ['DUCKWORTH_INSTANCE_ID', { DUCKWORTH_LANE: 'sandbox', SQLITE_PATH: sandboxDatabase, DUCKWORTH_PUBLIC_ORIGIN: 'http://127.0.0.1:4300' }],
    ['SQLITE_PATH', { DUCKWORTH_LANE: 'sandbox', DUCKWORTH_INSTANCE_ID: 'id', DUCKWORTH_PUBLIC_ORIGIN: 'http://127.0.0.1:4300' }],
    ['DUCKWORTH_PUBLIC_ORIGIN', { DUCKWORTH_LANE: 'sandbox', DUCKWORTH_INSTANCE_ID: 'id', SQLITE_PATH: sandboxDatabase }],
  ] as const)('rejects a missing %s', (missing, values) => {
    expect(() => loadConfig(values)).toThrow(`${missing} is required`);
  });

  it('rejects a relative persistent database path', () => {
    expect(() => loadConfig({
      DUCKWORTH_LANE: 'sandbox',
      DUCKWORTH_INSTANCE_ID: 'id',
      SQLITE_PATH: './data/sandbox.sqlite',
      DUCKWORTH_PUBLIC_ORIGIN: 'http://127.0.0.1:4300',
    })).toThrow('SQLITE_PATH must be an absolute path');
  });

  it('rejects a live database path that is labelled sandbox', () => {
    expect(() => loadConfig({
      DUCKWORTH_LANE: 'live',
      DUCKWORTH_INSTANCE_ID: 'id',
      SQLITE_PATH: sandboxDatabase,
      DUCKWORTH_PUBLIC_ORIGIN: 'http://192.168.0.102:3000',
      DUCKWORTH_HOUSEHOLD_ID: 'family-a',
      DUCKWORTH_ACCESS_TOKEN: 'secret-token',
      DUCKWORTH_PAIRING_CODE: 'pair-family-a',
      DUCKWORTH_PAIRING_EXPIRES_AT: '2099-01-01T00:00:00.000Z',
    })).toThrow('live lane cannot use a sandbox or test database path');
  });

  it('starts live with stable access credentials when no device pairing window is open', () => {
    expect(loadConfig({
      DUCKWORTH_LANE: 'live',
      DUCKWORTH_INSTANCE_ID: 'family-live',
      SQLITE_PATH: liveDatabase,
      DUCKWORTH_PUBLIC_ORIGIN: 'http://192.168.0.102:4200',
      DUCKWORTH_HOUSEHOLD_ID: 'family-a',
      DUCKWORTH_ACCESS_TOKEN: 'secret-token',
    })).toMatchObject({
      lane: 'live', householdId: 'family-a', accessToken: 'secret-token',
      pairingCode: undefined, pairingExpiresAt: undefined,
    });
  });

  it('rejects an incomplete live device-pairing window', () => {
    expect(() => loadConfig({
      DUCKWORTH_LANE: 'live',
      DUCKWORTH_INSTANCE_ID: 'family-live',
      SQLITE_PATH: liveDatabase,
      DUCKWORTH_PUBLIC_ORIGIN: 'http://192.168.0.102:4200',
      DUCKWORTH_HOUSEHOLD_ID: 'family-a',
      DUCKWORTH_ACCESS_TOKEN: 'secret-token',
      DUCKWORTH_PAIRING_CODE: 'pair-family-a',
    })).toThrow('pairing code and expiry must be configured together');
  });

  it('rejects equal configured live and sandbox paths', () => {
    expect(() => loadConfig({
      DUCKWORTH_LANE: 'sandbox',
      DUCKWORTH_INSTANCE_ID: 'id',
      SQLITE_PATH: sandboxDatabase,
      DUCKWORTH_PUBLIC_ORIGIN: 'http://127.0.0.1:4300',
      DUCKWORTH_LIVE_SQLITE_PATH: liveDatabase,
      DUCKWORTH_SANDBOX_SQLITE_PATH: liveDatabase,
    })).toThrow('live and sandbox database paths must differ');
  });

  it.each([
    ['live', liveDatabase],
    ['sandbox', sandboxDatabase],
  ] as const)('rejects an api-test runtime using a %s database path', (_label, databasePath) => {
    expect(() => loadConfig({
      DUCKWORTH_LANE: 'api-test',
      DUCKWORTH_INSTANCE_ID: 'api-test-run-1',
      SQLITE_PATH: databasePath,
      DUCKWORTH_PUBLIC_ORIGIN: 'http://127.0.0.1:3101',
      DUCKWORTH_TEST_CONTROL_SECRET: 'launch-secret',
    })).toThrow('api-test lane requires a test-labelled database path');
  });

  it('rejects a configured api-test path shared with another lane', () => {
    expect(() => loadConfig({
      DUCKWORTH_LANE: 'sandbox',
      DUCKWORTH_INSTANCE_ID: 'sandbox-laptop',
      SQLITE_PATH: sandboxDatabase,
      DUCKWORTH_PUBLIC_ORIGIN: 'http://127.0.0.1:4300',
      DUCKWORTH_LIVE_SQLITE_PATH: liveDatabase,
      DUCKWORTH_SANDBOX_SQLITE_PATH: sandboxDatabase,
      DUCKWORTH_API_TEST_SQLITE_PATH: sandboxDatabase,
    })).toThrow('configured lane database paths must all differ');
  });
});
