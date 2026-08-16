import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { createStaticWebServer } from '../static-web-server.mjs';

describe('production static web server', () => {
  const close = [];
  const directories = [];
  afterEach(async () => {
    await Promise.all(close.splice(0).map((server) => new Promise((resolve) => server.close(resolve))));
    directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true }));
  });

  it('serves the built SPA and proxies health without exposing arbitrary files', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'duckworth-static-test-'));
    directories.push(directory);
    writeFileSync(join(directory, 'index.html'), '<h1>Duckworth live</h1>');
    const api = createServer((_request, response) => {
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ status: 'ok', lane: 'live', instanceId: 'family-live' }));
    });
    await listen(api);
    close.push(api);

    const web = createStaticWebServer({
      staticRoot: directory,
      apiOrigin: `http://127.0.0.1:${api.address().port}`,
    });
    await listen(web);
    close.push(web);
    const origin = `http://127.0.0.1:${web.address().port}`;

    assert.equal(await (await fetch(`${origin}/shopping/list`)).text(), '<h1>Duckworth live</h1>');
    assert.deepEqual(await (await fetch(`${origin}/health`)).json(), {
      status: 'ok', lane: 'live', instanceId: 'family-live',
    });
    assert.equal((await fetch(`${origin}/..%2F..%2Fpackage.json`)).status, 400);
  });

  it('adds configured test-only headers to proxied API requests', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'duckworth-static-test-'));
    directories.push(directory);
    writeFileSync(join(directory, 'index.html'), '<h1>Duckworth test</h1>');
    const api = createServer((request, response) => {
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ lease: request.headers['x-duckworth-test-lease'] }));
    });
    await listen(api);
    close.push(api);

    const web = createStaticWebServer({
      staticRoot: directory,
      apiOrigin: `http://127.0.0.1:${api.address().port}`,
      upstreamHeaders: { 'x-duckworth-test-lease': 'lease-from-runner' },
    });
    await listen(web);
    close.push(web);

    const response = await fetch(`http://127.0.0.1:${web.address().port}/api/v1/example`);
    assert.deepEqual(await response.json(), { lease: 'lease-from-runner' });
  });
});

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
}
