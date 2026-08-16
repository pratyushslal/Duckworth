import { isAbsolute, normalize, resolve } from 'node:path';

export type ApiLane = 'live' | 'sandbox' | 'api-test';

export interface RuntimeIdentity {
  lane: ApiLane;
  instanceId: string;
  buildId?: string;
}

export interface ApiConfig {
  host: string;
  port: number;
  lane: ApiLane;
  instanceId: string;
  buildId?: string;
  databasePath: string;
  publicOrigin: string;
  householdId?: string;
  accessToken?: string;
  pairingCode?: string;
  pairingExpiresAt?: string;
  testControlSecret?: string;
  captureRetentionDays: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  const port = Number(env.PORT ?? 3000);
  const allowsDynamicPort = env.NODE_ENV === 'test' || env.DUCKWORTH_LANE === 'api-test';

  if (!Number.isInteger(port) || port < (allowsDynamicPort ? 0 : 1) || port > 65_535) {
    throw new Error('PORT must be an integer between 1 and 65535');
  }

  if (env.NODE_ENV === 'test') {
    return {
      host: env.HOST ?? '127.0.0.1',
      port,
      lane: 'api-test',
      instanceId: env.DUCKWORTH_INSTANCE_ID ?? 'test',
      ...(env.DUCKWORTH_BUILD_ID?.trim() ? { buildId: env.DUCKWORTH_BUILD_ID.trim() } : {}),
      databasePath: env.SQLITE_PATH ?? ':memory:',
      publicOrigin: env.DUCKWORTH_PUBLIC_ORIGIN ?? 'http://127.0.0.1:4300',
      captureRetentionDays: parseRetentionDays(env.DUCKWORTH_CAPTURE_RETENTION_DAYS),
    };
  }

  const lane = requireLane(env.DUCKWORTH_LANE);
  const instanceId = requireValue(env.DUCKWORTH_INSTANCE_ID, 'DUCKWORTH_INSTANCE_ID');
  const buildId = env.DUCKWORTH_BUILD_ID?.trim() || undefined;
  const databasePath = requireValue(env.SQLITE_PATH, 'SQLITE_PATH');
  const publicOrigin = requireOrigin(env.DUCKWORTH_PUBLIC_ORIGIN);
  const householdId = env.DUCKWORTH_HOUSEHOLD_ID?.trim() || undefined;
  const accessToken = env.DUCKWORTH_ACCESS_TOKEN?.trim() || undefined;
  const pairingCode = env.DUCKWORTH_PAIRING_CODE?.trim() || undefined;
  const pairingExpiresAt = env.DUCKWORTH_PAIRING_EXPIRES_AT?.trim() || undefined;
  const testControlSecret = env.DUCKWORTH_TEST_CONTROL_SECRET?.trim() || undefined;
  const captureRetentionDays = parseRetentionDays(env.DUCKWORTH_CAPTURE_RETENTION_DAYS);
  if (lane === 'live' && (!householdId || !accessToken)) {
    throw new Error('live lane requires household and access credentials');
  }
  if (lane === 'live' && Boolean(pairingCode) !== Boolean(pairingExpiresAt)) {
    throw new Error('pairing code and expiry must be configured together');
  }
  if (pairingExpiresAt !== undefined && !isFutureTimestamp(pairingExpiresAt)) {
    throw new Error('DUCKWORTH_PAIRING_EXPIRES_AT must be a future ISO timestamp');
  }
  if (lane === 'api-test' && !testControlSecret) {
    throw new Error('api-test lane requires DUCKWORTH_TEST_CONTROL_SECRET');
  }
  validateDatabasePath(lane, databasePath);
  validateConfiguredLanePaths(env);

  return {
    host: env.HOST ?? '127.0.0.1',
    port,
    lane,
    instanceId,
    ...(buildId ? { buildId } : {}),
    databasePath,
    publicOrigin,
    householdId,
    accessToken,
    pairingCode,
    pairingExpiresAt,
    ...(testControlSecret ? { testControlSecret } : {}),
    captureRetentionDays,
  };
}

function parseRetentionDays(value: string | undefined): number {
  if (value === undefined || value.trim() === '') return 90;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 3_650) {
    throw new Error('DUCKWORTH_CAPTURE_RETENTION_DAYS must be an integer between 1 and 3650');
  }
  return parsed;
}

function isFutureTimestamp(value: string): boolean {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && timestamp > Date.now();
}

function requireLane(value: string | undefined): ApiLane {
  if (value !== 'live' && value !== 'sandbox' && value !== 'api-test') {
    throw new Error('DUCKWORTH_LANE is required and must be live, sandbox, or api-test');
  }
  return value;
}

function requireValue(value: string | undefined, name: string): string {
  const trimmed = value?.trim() ?? '';
  if (!trimmed) throw new Error(`${name} is required`);
  return trimmed;
}

function requireOrigin(value: string | undefined): string {
  const origin = requireValue(value, 'DUCKWORTH_PUBLIC_ORIGIN');
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    throw new Error('DUCKWORTH_PUBLIC_ORIGIN must be an absolute HTTP(S) origin');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('DUCKWORTH_PUBLIC_ORIGIN must be an absolute HTTP(S) origin');
  }
  if (parsed.pathname !== '/' || parsed.search || parsed.hash) {
    throw new Error('DUCKWORTH_PUBLIC_ORIGIN must not include a path or query');
  }
  return parsed.origin;
}

function validateDatabasePath(lane: ApiLane, databasePath: string): void {
  if (databasePath === ':memory:') {
    throw new Error('SQLITE_PATH must be an absolute persistent path outside test mode');
  }
  if (!isAbsolute(databasePath)) throw new Error('SQLITE_PATH must be an absolute path');
  const segments = normalize(databasePath).split(/[\\/]+/u).map((segment) => segment.toLocaleLowerCase('en-US'));
  if (lane === 'live' && segments.some((segment) => (
    ['sandbox', 'test', 'tmp', 'temp'].includes(segment)
      || ['sandbox.', 'test.', 'tmp.', 'temp.'].some((prefix) => segment.startsWith(prefix))
  ))) {
    throw new Error('live lane cannot use a sandbox or test database path');
  }
  if (lane === 'sandbox' && segments.some((segment) => segment === 'live' || segment.startsWith('live.'))) {
    throw new Error('sandbox lane cannot use a live database path');
  }
  if (lane === 'api-test' && !segments.some((segment) => (
    ['api-test', 'test', 'tmp', 'temp'].includes(segment)
      || ['api-test.', 'test.', 'tmp.', 'temp.'].some((prefix) => segment.startsWith(prefix))
  ))) {
    throw new Error('api-test lane requires a test-labelled database path');
  }
}

function validateConfiguredLanePaths(env: NodeJS.ProcessEnv): void {
  const livePath = env.DUCKWORTH_LIVE_SQLITE_PATH?.trim();
  const sandboxPath = env.DUCKWORTH_SANDBOX_SQLITE_PATH?.trim();
  const apiTestPath = env.DUCKWORTH_API_TEST_SQLITE_PATH?.trim();
  const configured = [livePath, sandboxPath, apiTestPath]
    .filter((path): path is string => Boolean(path))
    .map((path) => resolve(path).toLocaleLowerCase('en-US'));
  if (new Set(configured).size !== configured.length) {
    if (!apiTestPath) throw new Error('live and sandbox database paths must differ');
    throw new Error('configured lane database paths must all differ');
  }
}
