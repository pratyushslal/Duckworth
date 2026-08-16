import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rotateLog } from '../log-rotation.mjs';

describe('bounded supervisor logs', () => {
  const directories = [];
  afterEach(() => directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true })));
  it('rotates oversized logs and keeps a bounded number of backups', () => {
    const directory = mkdtempSync(join(tmpdir(), 'duckworth-log-'));
    directories.push(directory);
    const path = join(directory, 'live-api.log');
    writeFileSync(path, '123456');
    rotateLog(path, { maximumBytes: 5, backups: 2 });
    assert.equal(existsSync(path), false);
    assert.equal(readFileSync(`${path}.1`, 'utf8'), '123456');
  });
});
