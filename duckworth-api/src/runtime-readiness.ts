import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { ApiLane } from './config.js';

export interface RuntimeReadyDescriptor {
  origin: string;
  lane: ApiLane;
  instanceId: string;
  pid: number;
}

export function writeRuntimeReadyFile(path: string, descriptor: RuntimeReadyDescriptor): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(descriptor, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  renameSync(temporary, path);
}
