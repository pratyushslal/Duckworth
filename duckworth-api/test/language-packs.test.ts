import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp } from '../src/app.js';

describe('language-pack reads', () => {
  it('returns the India manifest with bundle metadata and revalidation caching', async () => {
    const app = await buildApp({ databasePath: ':memory:' });
    const expectedManifest = JSON.parse(readFileSync('./language-packs/countries/IN/manifest.json', 'utf8'));

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/language-packs/countries/IN/manifest',
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('public, max-age=300, stale-while-revalidate=86400');
    expect(response.headers.etag).toMatch(/^"sha256:[a-f0-9]{64}"$/);
    expect(response.json()).toEqual(expectedManifest);
    await app.close();
  });

  it('returns the reviewed India regional product artifact immutably', async () => {
    const app = await buildApp({ databasePath: ':memory:' });
    const content = readFileSync('./language-packs/regional-products/IN/2026.08.05.1.json', 'utf8');
    const checksum = `sha256:${createHash('sha256').update(content).digest('hex')}`;

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/regional-product-packs/IN/2026.08.05.1',
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect(response.headers.etag).toBe(`"${checksum}"`);
    expect(response.json()).toMatchObject({
      schemaVersion: 1,
      countryCode: 'IN',
      version: '2026.08.05.1',
      products: expect.arrayContaining([
        expect.objectContaining({ id: 'product.amul.butter', primary: 'Amul Butter' }),
        expect.objectContaining({
          id: 'product.britannia.50-50',
          primary: 'Britannia 50-50',
          aliases: expect.arrayContaining([
            'britannia 50-50 biscuit',
            'britannia 50-50 biscuits',
          ]),
        }),
      ]),
    });
    await app.close();
  });

  it('returns not modified when the manifest ETag matches', async () => {
    const app = await buildApp({ databasePath: ':memory:' });
    const first = await app.inject({
      method: 'GET',
      url: '/api/v1/language-packs/countries/IN/manifest',
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/language-packs/countries/IN/manifest',
      headers: { 'if-none-match': first.headers.etag },
    });

    expect(response.statusCode).toBe(304);
    expect(response.headers.etag).toBe(first.headers.etag);
    expect(response.body).toBe('');
    await app.close();
  });

  it('returns an exact immutable locale artifact with a byte-level ETag', async () => {
    const app = await buildApp({ databasePath: ':memory:' });
    const content = readFileSync('./language-packs/packs/en-IN/2026.08.06.1.json', 'utf8');
    const checksum = `sha256:${createHash('sha256').update(content).digest('hex')}`;

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/language-packs/en-IN/2026.08.06.1',
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('application/json');
    expect(response.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect(response.headers.etag).toBe(`"${checksum}"`);
    expect(response.body).toBe(content);
    expect(JSON.parse(response.body).units).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'tray', aliases: ['trays'] }),
      expect.objectContaining({ id: 'pack', aliases: expect.arrayContaining(['pk', 'pks']) }),
    ]));
    await app.close();
  });

  it('returns not modified when an immutable artifact ETag matches', async () => {
    const app = await buildApp({ databasePath: ':memory:' });
    const content = readFileSync('./language-packs/packs/en-IN/2026.08.06.1.json', 'utf8');
    const etag = `"sha256:${createHash('sha256').update(content).digest('hex')}"`;

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/language-packs/en-IN/2026.08.06.1',
      headers: { 'if-none-match': etag },
    });

    expect(response.statusCode).toBe(304);
    expect(response.headers.etag).toBe(etag);
    expect(response.body).toBe('');
    await app.close();
  });

  it('returns a stable not-found problem for missing or unsafe artifact paths', async () => {
    const app = await buildApp({ databasePath: ':memory:' });

    for (const url of [
      '/api/v1/language-packs/fr-FR/2026.08.05.1',
      '/api/v1/language-packs/%252e%252e/2026.08.05.1',
      '/api/v1/language-packs/en-IN/%252e%252e',
    ]) {
      const response = await app.inject({ method: 'GET', url });
      expect(response.statusCode).toBe(404);
      expect(response.json()).toEqual({ error: 'language_pack_not_found' });
    }
    await app.close();
  });

  it('rejects a corrupt locale artifact before serving its content', async () => {
    const root = await mkdtemp(join(tmpdir(), 'duckworth-language-packs-'));
    const packDirectory = join(root, 'packs', 'en-IN');
    await mkdir(packDirectory, { recursive: true });
    await writeFile(join(packDirectory, '2026.08.05.1.json'), JSON.stringify({
      schemaVersion: 1,
      locale: 'en-IN',
      version: '2026.08.05.1',
      checksum: 'sha256:invalid',
      fallbacks: [],
      items: [],
      units: [],
    }));
    const app = await buildApp({ databasePath: ':memory:', languagePacksPath: root });

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/language-packs/en-IN/2026.08.05.1',
    });

    expect(response.statusCode).toBe(500);
    expect(response.body).not.toContain('sha256:invalid');
    await app.close();
    await rm(root, { recursive: true, force: true });
  });

  it('exposes no mutation route for observations, corrections, or pack publication', async () => {
    const app = await buildApp({ databasePath: ':memory:' });

    for (const request of [
      { method: 'POST' as const, url: '/api/v1/language-packs/observations' },
      { method: 'POST' as const, url: '/api/v1/language-packs/countries/IN/manifest' },
      { method: 'PUT' as const, url: '/api/v1/language-packs/en-IN/2026.08.05.1' },
    ]) {
      const response = await app.inject(request);
      expect(response.statusCode).toBe(404);
    }
    await app.close();
  });
});
