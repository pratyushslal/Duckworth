import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

export function createCommandInvocation(command, {
  platform = process.platform,
  comspec = process.env.ComSpec || 'cmd.exe',
  processPath = process.execPath,
  pnpmCliPath = defaultPnpmCliPath(),
  pythonPath,
} = {}) {
  if (!Array.isArray(command) || command.length === 0) throw new Error('command must not be empty');
  for (const token of command) {
    if (typeof token !== 'string' || /[\u0000\r\n]/u.test(token)) {
      throw new Error('command tokens must be strings without control characters');
    }
  }
  if (platform !== 'win32') return { executable: command[0], args: command.slice(1) };
  if (command[0].toLocaleLowerCase('en-US') === 'node') {
    return { executable: processPath, args: command.slice(1) };
  }
  if (/^(?:python|python3|py)(?:\.exe)?$/u.test(command[0].toLocaleLowerCase('en-US'))) {
    return { executable: pythonPath ?? findWindowsExecutable(command[0]), args: command.slice(1) };
  }
  if (command[0].toLocaleLowerCase('en-US') === 'pnpm' && pnpmCliPath) {
    return {
      executable: processPath,
      args: [
        pnpmCliPath,
        '--config.manage-package-manager-versions=false',
        '--config.confirmModulesPurge=false',
        ...command.slice(1),
      ],
    };
  }
  // cmd.exe needs each token quoted independently. Quoting the complete
  // command makes it interpret the whole string as an executable filename.
  const commandLine = command.map(quoteCmdToken).join(' ');
  // Do not combine /s with a fully tokenized command. cmd.exe's /s quote
  // normalization strips the first/last quote pair and breaks commands such
  // as `"pnpm" "build"` when they are passed through spawnSync.
  return { executable: comspec, args: ['/d', '/c', commandLine] };
}

function defaultPnpmCliPath() {
  const candidates = [
    process.env.APPDATA ? join(process.env.APPDATA, 'npm', 'node_modules', 'pnpm', 'bin', 'pnpm.mjs') : null,
    process.env.PNPM_HOME ? join(process.env.PNPM_HOME, 'node_modules', 'pnpm', 'bin', 'pnpm.mjs') : null,
  ].filter(Boolean);
  try {
    const shim = execFileSync('where.exe', ['pnpm'], { encoding: 'utf8', windowsHide: true })
      .split(/\r?\n/u).map((entry) => entry.trim()).find(Boolean);
    if (shim) {
      candidates.push(join(dirname(shim), '..', '..', 'node', 'node_modules', 'pnpm', 'bin', 'pnpm.mjs'));
    }
  } catch {
    // The direct spawn will report the missing executable to the caller.
  }
  return candidates.find((path) => existsSync(path));
}

function quoteCmdToken(token) {
  return `"${token.replaceAll('%', '%%').replaceAll('"', '""')}"`;
}

function findWindowsExecutable(name) {
  try {
    const output = execFileSync('where.exe', [name], {
      encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'],
    });
    const [first] = output.split(/\r?\n/u).map((entry) => entry.trim()).filter(Boolean);
    if (first) return first;
  } catch {
    // The direct spawn will report the missing executable to the caller.
  }
  return name.toLocaleLowerCase('en-US').endsWith('.exe') ? name : `${name}.exe`;
}
