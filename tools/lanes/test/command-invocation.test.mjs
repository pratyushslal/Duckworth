import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createCommandInvocation } from '../command-invocation.mjs';

describe('child command invocation', () => {
  it('runs pnpm through its JavaScript entry point without a command shell', () => {
    assert.deepEqual(createCommandInvocation(['pnpm', 'test', 'name with spaces'], {
      platform: 'win32', processPath: 'C:\\node.exe', pnpmCliPath: 'C:\\pnpm\\pnpm.mjs',
    }), {
      executable: 'C:\\node.exe',
      args: [
        'C:\\pnpm\\pnpm.mjs',
        '--config.manage-package-manager-versions=false',
        '--config.confirmModulesPurge=false',
        'test',
        'name with spaces',
      ],
    });
  });

  it('runs node directly on Windows without routing a local script path through cmd', () => {
    assert.deepEqual(createCommandInvocation(['node', 'dist/src/server.js'], {
      platform: 'win32', processPath: 'C:\\node.exe', pnpmCliPath: 'C:\\pnpm\\pnpm.mjs',
    }), { executable: 'C:\\node.exe', args: ['dist/src/server.js'] });
  });

  it('runs Python directly so browser checks cannot become false-green shell commands', () => {
    assert.deepEqual(createCommandInvocation(['python', 'duckworth-web/e2e/foundation_check.py'], {
      platform: 'win32', processPath: 'C:\\node.exe', pnpmCliPath: 'C:\\pnpm\\pnpm.mjs',
      pythonPath: 'C:\\Python\\python.exe',
    }), {
      executable: 'C:\\Python\\python.exe', args: ['duckworth-web/e2e/foundation_check.py'],
    });
  });

  it('quotes Windows shell tokens individually instead of quoting the whole command', () => {
    assert.deepEqual(createCommandInvocation(['git', 'status'], {
      platform: 'win32', comspec: 'cmd.exe',
    }), {
      executable: 'cmd.exe', args: ['/d', '/c', '"git" "status"'],
    });
  });

  it('rejects command-line control characters', () => {
    assert.throws(() => createCommandInvocation(['pnpm', 'test\r\nwhoami'], {
      platform: 'win32', comspec: 'cmd.exe',
    }), /control characters/);
  });
});
