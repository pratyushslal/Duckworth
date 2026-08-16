import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const repositoryRoot = resolve(process.env.DUCKWORTH_REPOSITORY_ROOT || process.cwd());
const featureRegistry = JSON.parse(readFileSync(resolve(repositoryRoot, 'tools/coordination/feature-registry.json'), 'utf8'));
const testManifest = JSON.parse(readFileSync(resolve(repositoryRoot, 'tools/coordination/test-manifest.json'), 'utf8'));

const featureIds = featureRegistry.features.map((feature) => feature.id);
const testIds = testManifest.tests.map((test) => test.id);
assertUnique(featureIds, 'feature');
assertUnique(testIds, 'test');
const knownTests = new Set(testIds);
for (const feature of featureRegistry.features) {
  if (!feature.id || !feature.status || !Array.isArray(feature.acceptance) || feature.acceptance.length === 0) {
    throw new Error(`feature record is incomplete: ${feature.id || '<missing>'}`);
  }
  if (!Array.isArray(feature.tests) || feature.tests.length === 0) throw new Error(`feature has no tests: ${feature.id}`);
  for (const testId of feature.tests) if (!knownTests.has(testId)) throw new Error(`feature ${feature.id} references unknown test ${testId}`);
}
for (const test of testManifest.tests) {
  if (!Array.isArray(test.command) || test.command.length === 0) throw new Error(`test command is incomplete: ${test.id}`);
}
process.stdout.write(`Governance manifests valid: ${featureRegistry.features.length} features, ${testManifest.tests.length} tests.\n`);

function assertUnique(values, label) {
  if (new Set(values).size !== values.length) throw new Error(`duplicate ${label} ID`);
}
