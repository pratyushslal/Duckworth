import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { writeRuntimeReadyFile } from '../src/runtime-readiness.js';

describe('runtime readiness descriptor', () => {
  it('atomically records the assigned origin and exact runtime identity', () => {
    const directory = mkdtempSync(join(tmpdir(), 'duckworth-ready-'));
    const path = join(directory, 'ready.json');
    try {
      writeRuntimeReadyFile(path, {
        origin: 'http://127.0.0.1:32123',
        lane: 'api-test',
        instanceId: 'api-test-run-1',
        pid: 123,
      });
      expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({
        origin: 'http://127.0.0.1:32123',
        lane: 'api-test',
        instanceId: 'api-test-run-1',
        pid: 123,
      });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
