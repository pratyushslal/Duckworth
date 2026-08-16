import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseNetstatListeners } from '../network-diagnostics.mjs';

describe('unmanaged port diagnostics', () => {
  it('maps listening ports to owning PIDs', () => {
    const output = `
  TCP    0.0.0.0:4200       0.0.0.0:0       LISTENING       1234
  TCP    127.0.0.1:3000     0.0.0.0:0       LISTENING       5678
`;
    assert.deepEqual(parseNetstatListeners(output, [3000, 4200, 4300]), [
      { address: '127.0.0.1', port: 3000, pid: 5678 },
      { address: '0.0.0.0', port: 4200, pid: 1234 },
    ]);
  });
});
