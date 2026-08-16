import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildStartupFallbackScript, buildStartupTaskArguments, startupFallbackPath } from '../windows-startup.mjs';

describe('Windows startup registration', () => {
  it('registers a limited logon task that runs the resident supervisor', () => {
    const args = buildStartupTaskArguments({ nodePath: 'C:\\Node\\node.exe', cliPath: 'C:\\Duckworth\\duckworth-profiles.mjs' });
    assert.deepEqual(args.slice(0, 8), ['/Create', '/F', '/SC', 'ONLOGON', '/RL', 'LIMITED', '/TN', 'Duckworth Profile Supervisor']);
    assert.ok(args.includes('/TR'));
    assert.ok(args.at(-1).includes('watch'));
  });

  it('builds a hidden per-user Startup fallback when Task Scheduler is unavailable', () => {
    const path = startupFallbackPath({ APPDATA: 'C:\\Users\\A\\AppData\\Roaming' });
    assert.equal(path, 'C:\\Users\\A\\AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs\\Startup\\Duckworth Profile Supervisor.vbs');
    const script = buildStartupFallbackScript({
      nodePath: 'C:\\Node\\node.exe', cliPath: 'C:\\Duckworth\\duckworth-profiles.mjs',
    });
    assert.match(script, /WScript\.Shell/u);
    assert.match(script, /duckworth-profiles\.mjs/u);
    assert.match(script, /watch/u);
    assert.match(script, /, 0, False/u);
  });
});
