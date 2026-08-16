import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCommandInvocation } from './command-invocation.mjs';

export function runHostedProcess({ key, fingerprint, cwd, command, env = process.env }) {
  if (!key || !fingerprint || !cwd || !Array.isArray(command) || command.length === 0) {
    throw new Error('hosted process requires key, fingerprint, cwd, and command');
  }
  const invocation = createCommandInvocation(command);
  const child = spawn(invocation.executable, invocation.args, {
    cwd,
    env,
    stdio: 'inherit',
    windowsHide: true,
  });
  const forward = (signal) => {
    if (!child.killed) child.kill(signal);
  };
  process.once('SIGINT', () => forward('SIGINT'));
  process.once('SIGTERM', () => forward('SIGTERM'));
  child.once('error', (error) => {
    process.stderr.write(`Duckworth ${key} failed to start: ${error.message}\n`);
    process.exitCode = 1;
  });
  child.once('exit', (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    else process.exitCode = code ?? 1;
  });
  return child;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const [key, fingerprint, cwd, commandJson] = process.argv.slice(2);
  runHostedProcess({ key, fingerprint, cwd, command: JSON.parse(commandJson) });
}
