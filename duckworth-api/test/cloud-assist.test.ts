import { describe, expect, it, vi } from 'vitest';
import { CloudAssistClient, CloudAssistProviderError } from '../src/cloud-assist.js';

describe('CloudAssistClient', () => {
  it('requests a strict, no-collection, zero-retention structured suggestion', async () => {
    const fetchMock = vi.fn(async (..._args: Parameters<typeof globalThis.fetch>) => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({
      itemName: 'Telma', quantity: 1, unit: 'strip', measures: [{ value: 40, unit: 'mg', role: 'medicine_strength' }],
      attributes: { strength: '40 mg' }, rationale: 'structured extraction',
    }) } }] })));
    const client = new CloudAssistClient({ apiKey: 'test-key', fetch: fetchMock as unknown as typeof globalThis.fetch });

    await expect(client.suggest('1 strip of Telma 40 mg')).resolves.toMatchObject({ itemName: 'Telma' });

    const request = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(request).toMatchObject({
      response_format: { type: 'json_schema', json_schema: { strict: true } },
      provider: { data_collection: 'deny', zdr: true, require_parameters: true },
    });
  });

  it('rejects malformed or out-of-contract provider content as a provider error', async () => {
    const fetchMock = vi.fn(async (..._args: Parameters<typeof globalThis.fetch>) => (
      new Response(JSON.stringify({ choices: [{ message: { content: '{not json' } }] }))
    ));
    const client = new CloudAssistClient({ apiKey: 'test-key', fetch: fetchMock as unknown as typeof globalThis.fetch });

    await expect(client.suggest('one item')).rejects.toBeInstanceOf(CloudAssistProviderError);
  });
});
