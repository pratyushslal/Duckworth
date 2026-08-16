import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';

export function bootstrapLiveCredentials({
  envFile,
  householdId,
  now = new Date(),
  randomToken = () => randomBytes(32).toString('base64url'),
  randomPairingCode = () => randomBytes(9).toString('base64url'),
  protectFile = protectCredentialFile,
} = {}) {
  if (!envFile || !isAbsolute(envFile)) throw new Error('live credential file path must be absolute');
  const household = householdId?.trim();
  if (!household || !/^[a-zA-Z0-9._-]+$/u.test(household)) throw new Error('household ID is required and must be path-safe');
  const path = resolve(envFile);
  if (existsSync(path)) throw new Error(`live credential file already exists: ${path}`);
  const accessToken = randomToken();
  const pairingCode = randomPairingCode();
  const pairingExpiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, [
    `DUCKWORTH_HOUSEHOLD_ID=${household}`,
    `DUCKWORTH_ACCESS_TOKEN=${accessToken}`,
    `DUCKWORTH_PAIRING_CODE=${pairingCode}`,
    `DUCKWORTH_PAIRING_EXPIRES_AT=${pairingExpiresAt}`,
    '',
  ].join('\n'), { encoding: 'utf8', flag: 'wx', mode: 0o600 });
  protectFile(path);
  return { envFile: path, householdId: household, pairingCode, pairingExpiresAt };
}

function protectCredentialFile(path) {
  if (process.platform !== 'win32') return;
  const user = process.env.USERNAME;
  if (!user) throw new Error('USERNAME is required to protect the live credential file');
  execFileSync('icacls.exe', [path, '/inheritance:r', '/grant:r', `${user}:(R,W)`], { stdio: 'ignore', windowsHide: true });
}
