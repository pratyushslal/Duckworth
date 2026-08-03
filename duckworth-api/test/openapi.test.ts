import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';

describe('OpenAPI contract', () => {
  it('describes the versioned shopping and event endpoints', async () => {
    const app = await buildApp({ databasePath: ':memory:' });
    await app.ready();
    const document = app.swagger() as { paths: Record<string, unknown> };
    expect(document.paths['/api/v1/households/{householdId}/items']).toBeDefined();
    expect(document.paths['/api/v1/households/{householdId}/items/{itemId}']).toBeDefined();
    expect(document.paths['/api/v1/households/{householdId}/events']).toBeDefined();
    await app.close();
  });
});
