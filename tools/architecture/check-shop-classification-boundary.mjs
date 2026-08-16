import { readFile, readdir } from 'node:fs/promises';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const config = JSON.parse(await readFile(resolve(repositoryRoot, 'tools/architecture/shop-classification-boundary.json'), 'utf8'));
const violations = [];

for (const root of config.roots) {
  for (const file of await sourceFiles(resolve(repositoryRoot, root))) {
    const relative = file.slice(repositoryRoot.length + 1).replaceAll('\\', '/');
    if (config.ignoredSuffixes.some((suffix) => relative.endsWith(suffix))) continue;
    const source = await readFile(file, 'utf8');
    for (const literal of config.forbiddenLiterals) {
      if (source.includes(`'${literal}'`) || source.includes(`\"${literal}\"`) || source.includes(`\`${literal}\``)) {
        violations.push(`${relative} embeds runtime-owned classification value ${literal}`);
      }
    }
  }
}

if (violations.length > 0) {
  console.error(['Shop classification boundary violations:', ...violations.map((entry) => `- ${entry}`)].join('\n'));
  process.exitCode = 1;
} else {
  console.log('Shop classification data boundary passed.');
}

async function sourceFiles(root) {
  const entries = await readdir(root, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = resolve(root, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return ['.ts', '.mts', '.js', '.mjs'].includes(extname(entry.name)) ? [path] : [];
  }));
  return nested.flat();
}
