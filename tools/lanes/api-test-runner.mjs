import { randomBytes, randomUUID } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { createCommandInvocation } from './command-invocation.mjs';
import { createStaticWebServer } from './static-web-server.mjs';

export function createApiTestInstanceSpec(manifest, {
  instanceId = `api-test-${randomUUID()}`,
  secret = randomBytes(32).toString('base64url'),
  ttlMs = manifest.apiTest.defaultTtlMs,
  now = new Date(),
} = {}) {
  if (!/^api-test-[a-zA-Z0-9-]+$/u.test(instanceId)) throw new Error('invalid api-test instance ID');
  if (!Number.isSafeInteger(ttlMs) || ttlMs < 1) throw new Error('api-test TTL must be positive');
  const instanceRoot = join(manifest.apiTest.databaseRoot, instanceId);
  const databasePath = join(instanceRoot, 'api-test.sqlite');
  const readyFile = join(instanceRoot, 'ready.json');
  return {
    instanceId,
    instanceRoot,
    databasePath,
    readyFile,
    expiresAt: new Date(now.getTime() + ttlMs).toISOString(),
    cwd: join(manifest.apiTest.sourceRoot, 'duckworth-api'),
    command: ['pnpm', 'exec', 'tsx', 'src/server.ts'],
    env: {
      HOST: manifest.apiTest.host,
      PORT: '0',
      DUCKWORTH_LANE: 'api-test',
      DUCKWORTH_INSTANCE_ID: instanceId,
      SQLITE_PATH: databasePath,
      DUCKWORTH_PUBLIC_ORIGIN: 'http://127.0.0.1',
      DUCKWORTH_TEST_CONTROL_SECRET: secret,
      DUCKWORTH_READY_FILE: readyFile,
    },
    secret,
  };
}

export async function startApiTestInstance(manifest, options = {}) {
  reapExpiredApiTests(manifest);
  enforceConcurrencyLimit(manifest, options.maxConcurrent ?? 4);
  const spec = createApiTestInstanceSpec(manifest, options);
  mkdirSync(spec.instanceRoot, { recursive: false });
  const log = openSync(join(spec.instanceRoot, 'api.log'), 'a', 0o600);
  const errorLog = openSync(join(spec.instanceRoot, 'api.error.log'), 'a', 0o600);
  const invocation = createCommandInvocation(spec.command);
  const child = spawn(invocation.executable, invocation.args, {
    cwd: spec.cwd,
    env: { ...process.env, ...spec.env },
    windowsHide: true,
    stdio: ['ignore', log, errorLog],
  });
  closeSync(log);
  closeSync(errorLog);
  let web;
  try {
    const ready = await waitForReadyFile(spec.readyFile, spec.instanceId);
    const leaseResponse = await fetch(`${ready.origin}/api/v1/test/session`, {
      method: 'POST',
      headers: { 'x-duckworth-test-secret': spec.secret },
      signal: AbortSignal.timeout(5_000),
    });
    if (leaseResponse.status !== 201) throw new Error('api-test process refused its launch secret');
    const lease = await leaseResponse.json();
    if (lease.lane !== 'api-test' || lease.instanceId !== spec.instanceId || typeof lease.lease !== 'string') {
      throw new Error('api-test lease identity did not match the launched instance');
    }
    web = options.withWeb ? createStaticWebServer({
      staticRoot: options.staticRoot ?? join(manifest.apiTest.sourceRoot, 'duckworth-web', 'dist', 'duckworth-web', 'browser'),
      apiOrigin: ready.origin,
      upstreamHeaders: { 'x-duckworth-test-lease': lease.lease },
    }) : undefined;
    if (web) await listen(web, manifest.apiTest.host);
    const webOrigin = web ? `http://${manifest.apiTest.host}:${web.address().port}` : undefined;
    const metadata = {
      version: 1,
      instanceId: spec.instanceId,
      pid: child.pid,
      origin: ready.origin,
      databasePath: spec.databasePath,
      expiresAt: spec.expiresAt,
    };
    writeFileSync(join(spec.instanceRoot, 'instance.json'), `${JSON.stringify(metadata, null, 2)}\n`, { mode: 0o600 });
    let stopped = false;
    return {
      ...metadata,
      lease: lease.lease,
      ...(webOrigin ? { webOrigin } : {}),
      async stop() {
        if (stopped) return;
        stopped = true;
        if (web) await closeServer(web);
        stopProcessTree(child.pid);
        await delay(250);
        removeInstanceRoot(manifest.apiTest.databaseRoot, spec.instanceRoot);
      },
    };
  } catch (error) {
    if (web?.listening) await closeServer(web);
    stopProcessTree(child.pid);
    const errorLogPath = join(spec.instanceRoot, 'api.error.log');
    const diagnostics = existsSync(errorLogPath) ? readFileSync(errorLogPath, 'utf8').trim() : '';
    removeInstanceRoot(manifest.apiTest.databaseRoot, spec.instanceRoot);
    throw new Error(`${error instanceof Error ? error.message : String(error)}${diagnostics ? `\n${diagnostics}` : ''}`);
  }
}

export async function runWithApiTest(manifest, command, options = {}) {
  if (!Array.isArray(command) || command.length === 0) throw new Error('api-test run requires a command after --');
  const instance = await startApiTestInstance(manifest, options);
  try {
    return await new Promise((resolvePromise, reject) => {
      const invocation = createCommandInvocation(command);
      const child = spawn(invocation.executable, invocation.args, {
        cwd: options.cwd ?? manifest.apiTest.sourceRoot,
        env: {
          ...process.env,
          DUCKWORTH_API_TEST_ORIGIN: instance.origin,
          DUCKWORTH_API_TEST_INSTANCE_ID: instance.instanceId,
          DUCKWORTH_API_TEST_LEASE: instance.lease,
          ...(instance.webOrigin ? {
            DUCKWORTH_API_TEST_WEB_ORIGIN: instance.webOrigin,
            DUCKWORTH_E2E_SANDBOX_ORIGIN: instance.webOrigin,
            DUCKWORTH_E2E_SANDBOX_HOUSEHOLD: instance.instanceId,
          } : {}),
        },
        stdio: 'inherit',
      });
      child.once('error', reject);
      child.once('exit', (code, signal) => resolvePromise(signal ? 1 : code ?? 1));
    });
  } finally {
    await instance.stop();
  }
}

export function reapExpiredApiTests(manifest, now = new Date()) {
  const root = manifest.apiTest.databaseRoot;
  if (!existsSync(root)) return [];
  const removed = [];
  for (const name of readdirSync(root)) {
    const instanceRoot = join(root, name);
    const metadataPath = join(instanceRoot, 'instance.json');
    if (!existsSync(metadataPath)) continue;
    try {
      const metadata = JSON.parse(readFileSync(metadataPath, 'utf8'));
      if (Date.parse(metadata.expiresAt) > now.getTime()) continue;
      stopProcessTree(metadata.pid);
      removeInstanceRoot(root, instanceRoot);
      removed.push(metadata.instanceId);
    } catch {
      // Preserve malformed state for diagnosis; never guess which process to stop.
    }
  }
  return removed;
}

function enforceConcurrencyLimit(manifest, maximum) {
  if (!Number.isSafeInteger(maximum) || maximum < 1) throw new Error('api-test concurrency limit must be positive');
  const root = manifest.apiTest.databaseRoot;
  if (!existsSync(root)) { mkdirSync(root, { recursive: true }); return; }
  const active = readdirSync(root).filter((name) => existsSync(join(root, name, 'instance.json'))).length;
  if (active >= maximum) throw new Error(`api-test concurrency limit of ${maximum} reached`);
}

async function waitForReadyFile(path, expectedInstanceId, attempts = 120) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (existsSync(path)) {
      const descriptor = JSON.parse(readFileSync(path, 'utf8'));
      if (descriptor.lane !== 'api-test' || descriptor.instanceId !== expectedInstanceId) {
        throw new Error('api-test readiness identity mismatch');
      }
      return descriptor;
    }
    await delay(250);
  }
  throw new Error('api-test process did not become ready');
}

function stopProcessTree(pid) {
  if (!Number.isInteger(pid) || pid < 1) return;
  try {
    if (process.platform === 'win32') execFileSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
    else process.kill(-pid, 'SIGKILL');
  } catch {
    // A process that already exited is successfully stopped.
  }
}

function removeInstanceRoot(root, instanceRoot) {
  const parent = resolve(root);
  const target = resolve(instanceRoot);
  const path = relative(parent, target);
  if (!path || path.startsWith('..') || isAbsolute(path)) throw new Error('refusing to remove an unsafe api-test path');
  rmSync(target, { recursive: true, force: true });
}

function delay(milliseconds) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

function listen(server, host) {
  return new Promise((resolvePromise, reject) => {
    server.once('error', reject);
    server.listen(0, host, resolvePromise);
  });
}

function closeServer(server) {
  return new Promise((resolvePromise, reject) => {
    server.close((error) => error ? reject(error) : resolvePromise());
  });
}
