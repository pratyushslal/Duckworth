import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const TASK_NAME = 'Duckworth Profile Supervisor';
const FALLBACK_NAME = `${TASK_NAME}.vbs`;

export function buildStartupTaskArguments({ nodePath, cliPath }) {
  if (!nodePath || !cliPath) throw new Error('nodePath and cliPath are required');
  return [
    '/Create', '/F', '/SC', 'ONLOGON', '/RL', 'LIMITED', '/TN', TASK_NAME,
    '/TR', `"${nodePath}" "${cliPath}" watch`,
  ];
}

export function installStartupTask({ nodePath, cliPath }) {
  if (process.platform !== 'win32') throw new Error('startup registration is supported on Windows only');
  try {
    execFileSync('schtasks.exe', buildStartupTaskArguments({ nodePath, cliPath }), { stdio: 'ignore', windowsHide: true });
    rmSync(startupFallbackPath(), { force: true });
    return { method: 'task-scheduler' };
  } catch {
    const path = startupFallbackPath();
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, buildStartupFallbackScript({ nodePath, cliPath }), { encoding: 'utf8', mode: 0o600 });
    return { method: 'startup-folder', path };
  }
}

export function removeStartupTask() {
  if (process.platform !== 'win32') throw new Error('startup registration is supported on Windows only');
  try {
    execFileSync('schtasks.exe', ['/Delete', '/F', '/TN', TASK_NAME], { stdio: 'ignore', windowsHide: true });
  } catch {
    // The per-user fallback is valid when Task Scheduler is unavailable.
  }
  rmSync(startupFallbackPath(), { force: true });
}

export function queryStartupTask() {
  if (process.platform !== 'win32') return { installed: false };
  try {
    const output = execFileSync('schtasks.exe', ['/Query', '/TN', TASK_NAME, '/FO', 'LIST'], {
      encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'],
    });
    return { installed: true, method: 'task-scheduler', output };
  } catch {
    const path = startupFallbackPath();
    return existsSync(path) ? { installed: true, method: 'startup-folder', path } : { installed: false };
  }
}

export function startupFallbackPath(env = process.env) {
  const appData = env.APPDATA?.trim();
  if (!appData) throw new Error('APPDATA is required for per-user startup registration');
  return join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup', FALLBACK_NAME);
}

export function buildStartupFallbackScript({ nodePath, cliPath }) {
  if (!nodePath || !cliPath) throw new Error('nodePath and cliPath are required');
  if ([nodePath, cliPath].some((value) => /["\r\n]/u.test(value))) throw new Error('startup paths contain unsupported characters');
  const command = `Chr(34) & "${nodePath}" & Chr(34) & " " & Chr(34) & "${cliPath}" & Chr(34) & " watch"`;
  return `Set shell = CreateObject("WScript.Shell")\r\nshell.Run ${command}, 0, False\r\n`;
}
