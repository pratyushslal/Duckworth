import { execFileSync } from 'node:child_process';

export function buildFirewallRules() {
  return [
    { name: 'Duckworth Family Live Web', port: 4200 },
    { name: 'Duckworth Sandbox Web', port: 4300 },
  ];
}

export function installFirewallRules() {
  requireWindows();
  for (const rule of buildFirewallRules()) {
    removeRule(rule.name);
    execFileSync('netsh.exe', [
      'advfirewall', 'firewall', 'add', 'rule',
      `name=${rule.name}`, 'dir=in', 'action=allow', 'protocol=TCP', `localport=${rule.port}`,
      'profile=private', 'remoteip=localsubnet', 'enable=yes',
    ], { stdio: 'inherit', windowsHide: true });
  }
}

export function removeFirewallRules() {
  requireWindows();
  for (const rule of buildFirewallRules()) removeRule(rule.name);
}

export function firewallRuleStatus() {
  if (process.platform !== 'win32') return [];
  return buildFirewallRules().map((rule) => {
    try {
      const output = execFileSync('netsh.exe', ['advfirewall', 'firewall', 'show', 'rule', `name=${rule.name}`, 'verbose'], {
        encoding: 'utf8', windowsHide: true,
      });
      return { ...rule, installed: !/No rules match/iu.test(output), output };
    } catch {
      return { ...rule, installed: false };
    }
  });
}

function removeRule(name) {
  try {
    execFileSync('netsh.exe', ['advfirewall', 'firewall', 'delete', 'rule', `name=${name}`], { stdio: 'ignore', windowsHide: true });
  } catch {
    // Missing rules are already removed.
  }
}

function requireWindows() {
  if (process.platform !== 'win32') throw new Error('Windows firewall management is supported on Windows only');
}
