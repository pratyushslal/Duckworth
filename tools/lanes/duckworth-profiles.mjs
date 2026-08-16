import { networkInterfaces } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createProfileManifest,
  defaultOperationalRoot,
  validateProfileManifest,
} from './profile-manifest.mjs';
import { createSupervisor } from './supervisor-runtime.mjs';
import { reapExpiredApiTests, runWithApiTest, startApiTestInstance } from './api-test-runner.mjs';
import { watchProfiles } from './supervisor-watch.mjs';
import { installStartupTask, queryStartupTask, removeStartupTask } from './windows-startup.mjs';
import { promoteRelease, readActiveRelease } from './release-manager.mjs';
import { bootstrapLiveCredentials } from './live-bootstrap.mjs';
import { firewallRuleStatus, installFirewallRules, removeFirewallRules } from './windows-firewall.mjs';
import { diagnosePortOwners } from './network-diagnostics.mjs';
import { installSupervisorApp, readSupervisorInstallation } from './supervisor-install.mjs';

const PERMANENT_PROFILES = ['live', 'sandbox'];

export function parseCommand(argv) {
  const [action = 'status', profile] = argv;
  if (action === 'firewall') {
    if (!['install', 'status', 'remove'].includes(profile)) throw new Error('firewall command must be install, status, or remove');
    return { action: `firewall-${profile}` };
  }
  if (action === 'bootstrap') {
    if (profile !== 'live') throw new Error('bootstrap command must target live');
    const householdIndex = argv.indexOf('--household');
    const householdId = householdIndex >= 0 ? argv[householdIndex + 1]?.trim() : undefined;
    if (!householdId) throw new Error('bootstrap live requires --household');
    return { action: 'bootstrap-live', householdId };
  }
  if (action === 'release') {
    if (profile !== 'promote') throw new Error('release command must be promote');
    return { action: 'release-promote' };
  }
  if (action === 'watch') return { action: 'watch' };
  if (action === 'startup') {
    if (!['install', 'status', 'remove'].includes(profile)) throw new Error('startup command must be install, status, or remove');
    return { action: `startup-${profile}` };
  }
  if (action === 'api-test') {
    if (profile === 'reap') return { action: 'api-test-reap' };
    if (profile === 'run') {
      const separator = argv.indexOf('--');
      const command = separator >= 0 ? argv.slice(separator + 1) : [];
      if (!command.length) throw new Error('api-test run requires a command after --');
      return { action: 'api-test-run', command, ...(argv.slice(2, separator).includes('--with-web') ? { withWeb: true } : {}) };
    }
    if (profile === 'open') {
      const ttlIndex = argv.indexOf('--ttl');
      const ttlMs = ttlIndex >= 0 ? parseDuration(argv[ttlIndex + 1]) : 60 * 60 * 1000;
      return { action: 'api-test-open', ttlMs, ...(argv.includes('--with-web') ? { withWeb: true } : {}) };
    }
    throw new Error('api-test command must be run, open, or reap');
  }
  if (!['ensure', 'restart', 'status', 'stop', 'diagnose'].includes(action)) {
    throw new Error(`unknown profile command: ${action}`);
  }
  if (profile === 'api-test') throw new Error('api-test instances are disposable; use the api-test command');
  if (profile && !PERMANENT_PROFILES.includes(profile)) throw new Error(`unknown profile: ${profile}`);
  return { action, profiles: profile ? [profile] : [...PERMANENT_PROFILES] };
}

export async function runCli(argv, env = process.env) {
  const command = parseCommand(argv);
  const scriptDirectory = dirname(fileURLToPath(import.meta.url));
  const installation = readSupervisorInstallation(scriptDirectory);
  const repositoryRoot = resolve(env.DUCKWORTH_REPOSITORY_ROOT || installation?.repositoryRoot || resolve(scriptDirectory, '..', '..'));
  const operationalRoot = resolve(env.DUCKWORTH_OPERATIONAL_ROOT || installation?.operationalRoot || defaultOperationalRoot(env));
  const lanHost = resolveLanHost(env, installation);
  const activeRelease = readActiveRelease(operationalRoot);
  const manifest = validateProfileManifest(createProfileManifest({
    repositoryRoot,
    operationalRoot,
    lanHost,
    ...(activeRelease ? { liveReleaseRoot: activeRelease.releaseRoot } : {}),
    ...(activeRelease ? { liveBuildId: activeRelease.buildId } : {}),
  }), { repositoryRoot });
  if (command.action === 'firewall-install') { installFirewallRules(); return { manifest, firewall: firewallRuleStatus() }; }
  if (command.action === 'firewall-status') return { manifest, firewall: firewallRuleStatus() };
  if (command.action === 'firewall-remove') { removeFirewallRules(); return { manifest, firewall: firewallRuleStatus() }; }
  if (command.action === 'bootstrap-live') {
    const result = bootstrapLiveCredentials({ envFile: manifest.live.envFile, householdId: command.householdId });
    process.stdout.write(`Live credentials created at ${result.envFile}\nPairing code: ${result.pairingCode}\nPairing expires: ${result.pairingExpiresAt}\n`);
    return { manifest, bootstrap: result };
  }
  if (command.action === 'release-promote') {
    return { manifest, release: await promoteRelease({ repositoryRoot, operationalRoot, lanHost }) };
  }
  if (command.action === 'startup-install') {
    const installed = installSupervisorApp({ sourceDirectory: scriptDirectory, operationalRoot, repositoryRoot, lanHost });
    installStartupTask({ nodePath: process.execPath, cliPath: installed.cliPath });
    return { manifest, startup: queryStartupTask() };
  }
  if (command.action === 'startup-status') return { manifest, startup: queryStartupTask() };
  if (command.action === 'startup-remove') { removeStartupTask(); return { manifest, startup: queryStartupTask() }; }
  if (command.action === 'api-test-reap') {
    const removed = reapExpiredApiTests(manifest);
    process.stdout.write(`Removed ${removed.length} expired API-test instance(s).\n`);
    return { manifest, removed };
  }
  if (command.action === 'api-test-run') {
    const exitCode = await runWithApiTest(manifest, command.command, { withWeb: command.withWeb });
    return { manifest, exitCode };
  }
  if (command.action === 'api-test-open') {
    const instance = await startApiTestInstance(manifest, { ttlMs: command.ttlMs, withWeb: command.withWeb });
    process.stdout.write(`API-test URL: ${instance.origin}\nInstance:     ${instance.instanceId}\nExpires:      ${instance.expiresAt}\n`);
    if (instance.webOrigin) process.stdout.write(`Browser URL:  ${instance.webOrigin}\n`);
    await waitForExpiryOrSignal(command.ttlMs);
    await instance.stop();
    return { manifest, instanceId: instance.instanceId };
  }
  const supervisor = createSupervisor({
    manifest,
    processHostPath: resolve(scriptDirectory, 'process-host.mjs'),
  });

  if (command.action === 'watch') {
    const controller = new AbortController();
    const stop = () => controller.abort();
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
    await watchProfiles(supervisor, { signal: controller.signal });
    return { manifest, status: await supervisor.status() };
  }

  if (command.action === 'ensure') await supervisor.ensure(command.profiles);
  if (command.action === 'restart') await supervisor.ensure(command.profiles, { restart: true });
  if (command.action === 'stop') await supervisor.stop(command.profiles);
  const status = await supervisor.status();
  if (command.action === 'diagnose') printDiagnostics(manifest, status);
  else printStatus(manifest, status);
  return { manifest, status };
}

export function resultExitCode(result) {
  return Number.isInteger(result?.exitCode) ? result.exitCode : 0;
}

export function resolveLanHost(env = process.env, _installation, detect = detectLanAddress) {
  return env.DUCKWORTH_LAN_HOST?.trim() || detect();
}

function parseDuration(value) {
  const match = /^(\d+)(ms|s|m|h)$/u.exec(value ?? '');
  if (!match) throw new Error('TTL must use ms, s, m, or h, for example 30m');
  const multiplier = { ms: 1, s: 1_000, m: 60_000, h: 3_600_000 }[match[2]];
  const duration = Number(match[1]) * multiplier;
  if (!Number.isSafeInteger(duration) || duration < 1) throw new Error('TTL must be positive');
  return duration;
}

function waitForExpiryOrSignal(ttlMs) {
  return new Promise((resolvePromise) => {
    const timer = setTimeout(resolvePromise, ttlMs);
    const finish = () => { clearTimeout(timer); resolvePromise(); };
    process.once('SIGINT', finish);
    process.once('SIGTERM', finish);
  });
}

function printStatus(manifest, status) {
  for (const entry of status) {
    const state = entry.healthy ? 'healthy' : entry.reason ?? 'unhealthy';
    process.stdout.write(`${entry.key.padEnd(15)} ${state.padEnd(18)} PID ${entry.pid}\n`);
  }
  process.stdout.write(`Family live: ${manifest.live.web.publicOrigin}/\n`);
  process.stdout.write(`Sandbox:    ${manifest.sandbox.web.publicOrigin}/\n`);
}

function printDiagnostics(manifest, status) {
  printStatus(manifest, status);
  process.stdout.write(`Operational data: ${manifest.operationalRoot}\n`);
  process.stdout.write(`Live release:     ${manifest.live.sourceRoot}\n`);
  process.stdout.write(`Sandbox source:   ${manifest.sandbox.sourceRoot}\n`);
  process.stdout.write('APIs remain loopback-only; only web ports 4200 and 4300 should be allowed through the LAN firewall.\n');
  const owners = diagnosePortOwners([3000, 3001, 4200, 4300]);
  for (const owner of owners) {
    process.stdout.write(`Port ${owner.port}: PID ${owner.pid} ${owner.Name ?? ''} ${owner.CommandLine ?? ''}\n`);
  }
}

function detectLanAddress() {
  const candidates = Object.entries(networkInterfaces()).flatMap(([name, addresses]) => (
    (addresses ?? []).flatMap((address) => (
      address.family === 'IPv4' && !address.internal && !isVirtualInterface(name) ? [address.address] : []
    ))
  ));
  return candidates[0] ?? '127.0.0.1';
}

function isVirtualInterface(name) {
  return /virtual|vpn|wsl|docker|hyper-v|vethernet|loopback/iu.test(name);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  runCli(process.argv.slice(2))
    .then((result) => { process.exitCode = resultExitCode(result); })
    .catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    });
}
