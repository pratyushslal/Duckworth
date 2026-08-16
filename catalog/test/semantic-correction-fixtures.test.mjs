import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const fixturePath = resolve(dirname(fileURLToPath(import.meta.url)), 'fixtures/semantic-corrections/corpus.json');
const corpus = JSON.parse(readFileSync(fixturePath, 'utf8'));

test('semantic correction fixtures are deterministic, span-safe, and data-owned', () => {
  assert.equal(corpus.schemaVersion, 1);
  assert.equal(corpus.implementationRule, 'runtime-data');
  assert.ok(Array.isArray(corpus.cases));
  const ids = corpus.cases.map(({ id }) => id);
  assert.equal(new Set(ids).size, ids.length);

  for (const fixture of corpus.cases) {
    assert.match(fixture.sourceCaptureId, /^capture-/);
    assert.equal(Number.isInteger(fixture.operationIndex), true);
    assert.equal(fixture.expected.api.requiresIdempotencyKey, true);
    assert.equal(fixture.expected.api.rejectsStaleVersion, true);
    assert.equal(fixture.expected.api.publishesAfterCommit, true);
    for (const span of fixture.sourceSpans) {
      assert.equal(Number.isInteger(span.sourceStart), true);
      assert.equal(Number.isInteger(span.sourceEnd), true);
      assert.ok(span.sourceStart >= 0);
      assert.ok(span.sourceEnd > span.sourceStart);
      assert.ok(span.sourceEnd <= fixture.input.length);
      assert.equal(fixture.input.slice(span.sourceStart, span.sourceEnd), span.text);
    }
    assert.equal(Object.hasOwn(fixture, 'productionRule'), false);
    assert.equal(Object.hasOwn(fixture, 'hardcodedProduct'), false);
  }
});
