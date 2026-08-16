import { existsSync, renameSync, statSync, unlinkSync } from 'node:fs';

export function rotateLog(path, { maximumBytes = 5 * 1024 * 1024, backups = 3 } = {}) {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1) throw new Error('maximum log size must be positive');
  if (!Number.isSafeInteger(backups) || backups < 1) throw new Error('log backup count must be positive');
  if (!existsSync(path) || statSync(path).size <= maximumBytes) return false;
  const oldest = `${path}.${backups}`;
  if (existsSync(oldest)) unlinkSync(oldest);
  for (let index = backups - 1; index >= 1; index -= 1) {
    const source = `${path}.${index}`;
    if (existsSync(source)) renameSync(source, `${path}.${index + 1}`);
  }
  renameSync(path, `${path}.1`);
  return true;
}
