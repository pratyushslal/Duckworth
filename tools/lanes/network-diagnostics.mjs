import { execFileSync } from 'node:child_process';

export function parseNetstatListeners(output, ports) {
  const expected = new Set(ports);
  return output.split(/\r?\n/u).flatMap((line) => {
    const match = /^\s*TCP\s+(\[[^\]]+\]|[^\s:]+):(\d+)\s+\S+\s+LISTENING\s+(\d+)\s*$/iu.exec(line);
    if (!match) return [];
    const port = Number(match[2]);
    if (!expected.has(port)) return [];
    return [{ address: match[1].replace(/^\[|\]$/gu, ''), port, pid: Number(match[3]) }];
  }).sort((left, right) => left.port - right.port);
}

export function diagnosePortOwners(ports) {
  if (process.platform !== 'win32') return [];
  const listeners = parseNetstatListeners(execFileSync('netstat.exe', ['-ano', '-p', 'tcp'], { encoding: 'utf8', windowsHide: true }), ports);
  return listeners.map((listener) => ({ ...listener, ...readWindowsProcess(listener.pid) }));
}

function readWindowsProcess(pid) {
  try {
    const json = execFileSync('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-Command',
      `Get-CimInstance Win32_Process -Filter \"ProcessId=${pid}\" | Select-Object Name,ExecutablePath,CommandLine | ConvertTo-Json -Compress`,
    ], { encoding: 'utf8', windowsHide: true }).trim();
    return json ? JSON.parse(json) : {};
  } catch {
    return {};
  }
}
