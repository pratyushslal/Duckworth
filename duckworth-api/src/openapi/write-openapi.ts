import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { buildApp } from '../app.js';

const app = await buildApp({ databasePath: ':memory:' });
await app.ready();
const output = resolve(process.cwd(), 'openapi/duckworth-v1.json');
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, `${JSON.stringify(app.swagger(), null, 2)}\n`, 'utf8');
await app.close();
console.log(`Wrote ${output}`);
