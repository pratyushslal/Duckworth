import { homedir } from 'node:os';
import { createHash } from 'node:crypto';
import { isAbsolute, join, relative, resolve } from 'node:path';

export function defaultOperationalRoot(env = process.env) {
  const localAppData = env.LOCALAPPDATA?.trim();
  return resolve(localAppData || join(homedir(), 'AppData', 'Local'), 'Duckworth');
}

export function createProfileManifest({
  repositoryRoot,
  operationalRoot = defaultOperationalRoot(),
  lanHost = '127.0.0.1',
  liveReleaseRoot,
  liveBuildId,
} = {}) {
  if (!repositoryRoot) throw new Error('repositoryRoot is required');
  const sourceRoot = resolve(repositoryRoot);
  const runtimeRoot = resolve(operationalRoot);
  const activeLiveReleaseRoot = resolve(liveReleaseRoot ?? join(runtimeRoot, 'releases', 'current'));
  return {
    version: 1,
    operationalRoot: runtimeRoot,
    live: {
      profile: 'live',
      instanceId: 'family-live',
      sourceRoot: activeLiveReleaseRoot,
      ...(liveBuildId ? { buildId: liveBuildId } : {}),
      databasePath: join(runtimeRoot, 'data', 'live', 'duckworth.sqlite'),
      envFile: join(runtimeRoot, 'config', 'live.env'),
      api: { host: '127.0.0.1', port: 3000, healthOrigin: 'http://127.0.0.1:3000' },
      web: { host: '0.0.0.0', port: 4200, publicOrigin: `http://${lanHost}:4200` },
    },
    sandbox: {
      profile: 'sandbox',
      instanceId: 'sandbox-laptop',
      sourceRoot,
      databasePath: join(runtimeRoot, 'data', 'sandbox', 'duckworth.sqlite'),
      envFile: join(runtimeRoot, 'config', 'sandbox.env'),
      api: { host: '127.0.0.1', port: 3001, healthOrigin: 'http://127.0.0.1:3001' },
      web: { host: '0.0.0.0', port: 4300, publicOrigin: `http://${lanHost}:4300` },
    },
    apiTest: {
      profile: 'api-test',
      sourceRoot,
      host: '127.0.0.1',
      databaseRoot: join(runtimeRoot, 'data', 'api-test'),
      stateRoot: join(runtimeRoot, 'supervisor', 'api-test'),
      defaultTtlMs: 60 * 60 * 1000,
    },
  };
}

export function validateProfileManifest(manifest, { repositoryRoot } = {}) {
  if (!manifest || manifest.version !== 1) throw new Error('unsupported profile manifest version');
  const permanent = [manifest.live, manifest.sandbox];
  const ports = permanent.flatMap((profile) => [profile.api.port, profile.web.port]);
  if (ports.some((port) => !Number.isInteger(port) || port < 1 || port > 65_535)) {
    throw new Error('profile ports must be valid');
  }
  if (new Set(ports).size !== ports.length) throw new Error('profile ports must be unique');
  const databasePaths = permanent.map((profile) => resolve(profile.databasePath).toLocaleLowerCase('en-US'));
  if (new Set(databasePaths).size !== databasePaths.length) throw new Error('profile database paths must be unique');
  if (!permanent.every((profile) => isAbsolute(profile.databasePath))) {
    throw new Error('profile database paths must be absolute');
  }
  if (repositoryRoot) {
    const sourceRoot = resolve(repositoryRoot);
    for (const profile of permanent) {
      if (isWithin(sourceRoot, resolve(profile.databasePath))) {
        throw new Error('permanent profile data must be outside the source tree');
      }
    }
  }
  if (manifest.apiTest.host !== '127.0.0.1' && manifest.apiTest.host !== '::1') {
    throw new Error('api-test must bind to loopback');
  }
  return manifest;
}

export function buildDesiredProcesses(manifest) {
  const processes = [
    apiProcess(manifest.live, ['node', 'dist/src/server.js']),
    webProcess(manifest.live, [
      'node', join(manifest.live.sourceRoot, 'tools', 'lanes', 'static-web-server.mjs'),
    ], join(manifest.live.sourceRoot, 'duckworth-web', 'dist', 'duckworth-web', 'browser')),
    apiProcess(manifest.sandbox, ['node', 'node_modules/tsx/dist/cli.mjs', 'watch', 'src/server.ts']),
    webProcess(manifest.sandbox, [
      'node', 'node_modules/@angular/cli/bin/ng.js', 'serve', '--host', '0.0.0.0',
      '--port', '4300', '--proxy-config', 'proxy.sandbox.conf.json',
    ]),
  ];
  return processes.map((process) => ({
    ...process,
    fingerprint: createHash('sha256').update(JSON.stringify({
      key: process.key,
      command: process.command,
      cwd: process.cwd,
      env: process.env,
      envFile: process.envFile,
    })).digest('hex'),
  }));
}

function apiProcess(profile, command) {
  return {
    key: `${profile.profile}-api`,
    profile: profile.profile,
    kind: 'api',
    command,
    cwd: join(profile.sourceRoot, 'duckworth-api'),
    envFile: profile.envFile,
    healthOrigin: profile.api.healthOrigin,
    env: {
      HOST: profile.api.host,
      PORT: String(profile.api.port),
      DUCKWORTH_LANE: profile.profile,
      DUCKWORTH_INSTANCE_ID: profile.instanceId,
      SQLITE_PATH: profile.databasePath,
      DUCKWORTH_PUBLIC_ORIGIN: profile.web.publicOrigin,
      ...(profile.buildId ? { DUCKWORTH_BUILD_ID: profile.buildId } : {}),
    },
  };
}

function webProcess(profile, command, staticRoot) {
  return {
    key: `${profile.profile}-web`,
    profile: profile.profile,
    kind: 'web',
    command,
    cwd: join(profile.sourceRoot, 'duckworth-web'),
    healthOrigin: profile.web.publicOrigin,
    env: {
      HOST: profile.web.host,
      PORT: String(profile.web.port),
      DUCKWORTH_EXPECTED_LANE: profile.profile,
      DUCKWORTH_EXPECTED_INSTANCE_ID: profile.instanceId,
      DUCKWORTH_API_ORIGIN: profile.api.healthOrigin,
      ...(staticRoot ? { DUCKWORTH_STATIC_ROOT: staticRoot } : {}),
    },
  };
}

function isWithin(parent, child) {
  const path = relative(parent, child);
  return path === '' || (!path.startsWith('..') && !isAbsolute(path));
}
