import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const root = join(repositoryRoot, 'duckworth-web', 'src', 'app');
const violations = [];
const allowedDataFile = 'unit-display-data.ts';

function walk(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) walk(path);
    if (!entry.isFile() || !/\.ts$/u.test(entry.name) || entry.name.endsWith('.spec.ts') || entry.name === allowedDataFile) continue;
    const source = readFileSync(path, 'utf8');
    if (/\bUNIT_LABELS\b/u.test(source)) violations.push(`${path}: formatter-local unit data`);
    if (/["'`](?:brand|product|shop)\.[a-z0-9._-]+["'`]/u.test(source)) violations.push(`${path}: embedded catalog identity`);
  }
}

walk(root);
if (violations.length > 0) {
  console.error(['Dynamic-knowledge boundary violations:', ...violations].join('\n'));
  process.exitCode = 1;
} else {
  console.log('Dynamic-knowledge boundary passed: no catalog identities or formatter-local unit table found.');
}
