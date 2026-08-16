import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LanguagePackApiService } from './language-pack-api.service';
import {
  InMemoryLanguagePackStorage,
  LanguagePackRepository,
  type LanguagePackBundle,
} from './language-pack-repository';

const oldPack: LanguagePackBundle = {
  schemaVersion: 1,
  checksum: 'sha256:1111111111111111111111111111111111111111111111111111111111111111',
  locale: 'en-IN',
  version: '2026.08.04.1',
  fallbacks: [],
  ui: { greeting: 'Old greeting' },
  items: [{ id: 'milk', primary: 'milk', aliases: [], category: 'dairy', compatibleUnits: ['l'] }],
  units: [{ id: 'l', primary: 'l', aliases: ['litre'] }],
};
const newPack: LanguagePackBundle = {
  ...oldPack,
  checksum: 'sha256:2222222222222222222222222222222222222222222222222222222222222222',
  version: '2026.08.05.1',
  ui: { greeting: 'New greeting' },
  items: [{ id: 'milk', primary: 'dairy milk', aliases: ['milk'], category: 'dairy', compatibleUnits: ['l'] }],
};
const artifactChecksum = 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

describe('LanguagePackApiService', () => {
  let service: LanguagePackApiService;
  let httpTesting: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [LanguagePackApiService, provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(LanguagePackApiService);
    httpTesting = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpTesting.verify());

  it('reconciles once in the background with conditional HTTP without delaying the cached pack', async () => {
    const repository = new LanguagePackRepository(
      new InMemoryLanguagePackStorage(oldPack),
      async () => artifactChecksum,
    );
    await repository.hydrate();

    service.reconcileInBackground(repository, 'IN', '"cached-manifest"');
    service.reconcileInBackground(repository, 'IN', '"cached-manifest"');

    expect(repository.active()?.ui['greeting']).toBe('Old greeting');
    const manifestRequest = httpTesting.expectOne('/api/v1/language-packs/countries/IN/manifest');
    expect(manifestRequest.request.method).toBe('GET');
    expect(manifestRequest.request.headers.get('Cache-Control')).toBe('no-cache');
    expect(manifestRequest.request.headers.get('If-None-Match')).toBe('"cached-manifest"');
    manifestRequest.flush({
      schemaVersion: 1,
      checksum: 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      countryCode: 'IN',
      defaultLocale: 'en-IN',
      bridgeLocales: ['en-IN'],
      locales: [{
        locale: 'en-IN',
        version: newPack.version,
        fallbacks: [],
        artifactPath: 'packs/en-IN/2026.08.05.1.json',
        checksum: artifactChecksum,
      }],
    }, { headers: { ETag: '"new-manifest"' } });

    await Promise.resolve();
    await Promise.resolve();
    const packRequest = httpTesting.expectOne('/api/v1/language-packs/en-IN/2026.08.05.1');
    expect(packRequest.request.responseType).toBe('text');
    packRequest.flush(JSON.stringify(newPack));

    await vi.waitFor(() => expect(repository.active()).toEqual(newPack));
  });

  it('does not fetch an artifact when the conditional manifest is not modified', async () => {
    const repository = new LanguagePackRepository(new InMemoryLanguagePackStorage(oldPack));
    await repository.hydrate();

    service.reconcileInBackground(repository, 'IN', '"cached-manifest"');
    httpTesting.expectOne('/api/v1/language-packs/countries/IN/manifest')
      .flush(null, { status: 304, statusText: 'Not Modified' });

    await vi.waitFor(() => expect(repository.active()).toEqual(oldPack));
    expect(httpTesting.match((request) => request.url.includes('/language-packs/en-IN/'))).toHaveLength(0);
  });
});
