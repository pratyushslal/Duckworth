import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

export function installSupervisorApp({ sourceDirectory, operationalRoot, repositoryRoot, lanHost }) {
  const appRoot = resolve(operationalRoot, 'supervisor', 'app');
  mkdirSync(appRoot, { recursive: true });
  for (const entry of readdirSync(sourceDirectory, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith('.mjs')) copyFileSync(join(sourceDirectory, entry.name), join(appRoot, entry.name));
  }
  const installation = {
    version: 1,
    repositoryRoot: resolve(repositoryRoot),
    operationalRoot: resolve(operationalRoot),
    lanHost,
  };
  const path = join(appRoot, 'installation.json');
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(installation, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  renameSync(temporary, path);
  const cliPath = join(appRoot, 'duckworth-profiles.mjs');
  if (!existsSync(cliPath)) throw new Error('installed supervisor is missing duckworth-profiles.mjs');
  return { appRoot, cliPath, installation };
}

export function readSupervisorInstallation(appRoot) {
  const path = join(appRoot, 'installation.json');
  if (!existsSync(path)) return null;
  const value = JSON.parse(readFileSync(path, 'utf8'));
  if (!value || value.version !== 1 || typeof value.repositoryRoot !== 'string'
    || typeof value.operationalRoot !== 'string' || typeof value.lanHost !== 'string') {
    throw new Error('supervisor installation manifest is invalid');
  }
  return value;
}
