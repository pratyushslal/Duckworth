import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { InMemoryLanguagePackStorage, LanguagePackRepository, type LanguagePackBundle } from '../core/language-pack-repository';
import { LanguagePreferences } from '../core/language-preferences';
import {
  InMemoryRegionalProductPackStorage,
  RegionalProductPackRepository,
  type RegionalProductPack,
} from '../core/regional-product-repository';
import {
  LANGUAGE_PACK_REPOSITORY, LANGUAGE_PREFERENCES, REGIONAL_PRODUCT_PACK_REPOSITORY, LanguageSettings,
} from './language-settings';

class MemoryStorage {
  private readonly values = new Map<string, string>();
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, value); }
}
const checksum = 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const english: LanguagePackBundle = {
  schemaVersion: 1, checksum, locale: 'en-IN', version: '1', fallbacks: [], ui: {},
  items: [{ id: 'butter', primary: 'butter', aliases: [], category: 'dairy', compatibleUnits: ['pack'] }],
  units: [{ id: 'kg', primary: 'kg', aliases: ['kilo'] }],
};
const hinglish: LanguagePackBundle = {
  schemaVersion: 1, checksum: 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  locale: 'hi-Latn-IN', version: '1', fallbacks: ['en-IN'], ui: { greeting: 'Namaste' },
  items: [{ id: 'atta', primary: 'atta', aliases: ['aata'], category: 'staples', compatibleUnits: ['kg'] }],
  units: [{ id: 'kg', primary: 'kg', aliases: ['kilo'] }],
};
const regional: RegionalProductPack = {
  schemaVersion: 1, checksum, countryCode: 'IN', version: '1',
  products: [{
    id: 'product.amul.butter', primary: 'Amul Butter', aliases: ['amul butter'],
    brandId: 'brand.amul', brandName: 'Amul', conceptId: 'grocery.butter.dairy',
    compatibleContainerUnits: ['pack'], compatiblePackageUnits: ['g'],
  }],
};
const manifest = {
  schemaVersion: 1 as const, checksum, countryCode: 'IN', defaultLocale: 'en-IN', bridgeLocales: ['en-IN'],
  locales: [
    { locale: 'en-IN', version: '1', fallbacks: [], artifactPath: 'en.json', checksum },
    { locale: 'hi-Latn-IN', version: '1', fallbacks: ['en-IN'], artifactPath: 'hi.json', checksum },
  ],
  regionalProducts: [{ countryCode: 'IN', version: '1', artifactPath: 'regional.json', checksum }],
};

describe('LanguageSettings', () => {
  let http: HttpTestingController;
  let preferences: LanguagePreferences;
  let repository: LanguagePackRepository;
  let regionalRepository: RegionalProductPackRepository;

  beforeEach(async () => {
    preferences = new LanguagePreferences(new MemoryStorage(), 'device-a');
    repository = new LanguagePackRepository(new InMemoryLanguagePackStorage(), async () => checksum);
    regionalRepository = new RegionalProductPackRepository(
      new InMemoryRegionalProductPackStorage(), async () => checksum,
    );
    await TestBed.configureTestingModule({
      imports: [LanguageSettings],
      providers: [
        provideHttpClient(), provideHttpClientTesting(),
        { provide: LANGUAGE_PACK_REPOSITORY, useValue: repository },
        { provide: REGIONAL_PRODUCT_PACK_REPOSITORY, useValue: regionalRepository },
        { provide: LANGUAGE_PREFERENCES, useValue: preferences },
      ],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
  });

  it('bootstraps the default locale vocabulary on first use without opening settings', async () => {
    const fixture = TestBed.createComponent(LanguageSettings);
    const changed = vi.fn();
    fixture.componentInstance.changed.subscribe(changed);
    fixture.detectChanges();

    await new Promise((resolve) => setTimeout(resolve, 0));
    http.expectOne('/api/v1/language-packs/countries/IN/manifest').flush(manifest);
    await new Promise((resolve) => setTimeout(resolve, 0));
    http.expectOne('/api/v1/language-packs/en-IN/1').flush(JSON.stringify(english));
    await new Promise((resolve) => setTimeout(resolve, 0));
    http.expectOne('/api/v1/regional-product-packs/IN/1').flush(JSON.stringify(regional));
    await new Promise((resolve) => setTimeout(resolve, 0));
    await fixture.whenStable();

    expect(repository.active()).toEqual(english);
    expect(regionalRepository.active()).toEqual(regional);
    expect(changed).toHaveBeenCalledWith(expect.objectContaining({ bundle: english, regionalProducts: regional }));
  });

  it('lists manifest languages and atomically enables a complete UI/dictionary bundle', async () => {
    const fixture = TestBed.createComponent(LanguageSettings);
    const changed = vi.fn();
    fixture.componentInstance.changed.subscribe(changed);
    fixture.detectChanges();
    await new Promise((resolve) => setTimeout(resolve, 0));
    http.expectOne('/api/v1/language-packs/countries/IN/manifest').flush(manifest);
    await new Promise((resolve) => setTimeout(resolve, 0));
    http.expectOne('/api/v1/language-packs/en-IN/1').flush(JSON.stringify(english));
    await new Promise((resolve) => setTimeout(resolve, 0));
    http.expectOne('/api/v1/regional-product-packs/IN/1').flush(JSON.stringify(regional));
    await fixture.whenStable(); fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('English (India)');
    expect(fixture.nativeElement.textContent).toContain('Hinglish (Latin, India)');

    const enable = Array.from(fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>)
      .find((button) => button.textContent?.trim() === 'Enable')!;
    enable.click(); fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Downloading and validating');
    http.expectOne('/api/v1/language-packs/hi-Latn-IN/1').flush(JSON.stringify(hinglish));
    await vi.waitFor(() => expect(preferences.read().activeLocale).toBe('hi-Latn-IN'));
    fixture.detectChanges();

    expect(preferences.read()).toEqual({ activeLocale: 'hi-Latn-IN', enabledLocales: ['en-IN', 'hi-Latn-IN'] });
    expect(repository.active()).toEqual(hinglish);
    expect(changed).toHaveBeenCalledWith(expect.objectContaining({ bundle: hinglish }));
    expect(fixture.nativeElement.textContent).toContain('Active');
  });

  it('retains the prior language and offers Retry after an invalid artifact', async () => {
    const fixture = TestBed.createComponent(LanguageSettings);
    fixture.detectChanges(); await new Promise((resolve) => setTimeout(resolve, 0));
    http.expectOne('/api/v1/language-packs/countries/IN/manifest').flush(manifest);
    await new Promise((resolve) => setTimeout(resolve, 0));
    http.expectOne('/api/v1/language-packs/en-IN/1').flush(JSON.stringify(english));
    await new Promise((resolve) => setTimeout(resolve, 0));
    http.expectOne('/api/v1/regional-product-packs/IN/1').flush(JSON.stringify(regional));
    await fixture.whenStable(); fixture.detectChanges();
    const enable = Array.from(fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>)
      .find((button) => button.textContent?.trim() === 'Enable')!;
    enable.click();
    http.expectOne('/api/v1/language-packs/hi-Latn-IN/1').flush('{broken');
    await fixture.whenStable(); fixture.detectChanges();

    expect(preferences.read().activeLocale).toBe('en-IN');
    expect(fixture.nativeElement.textContent).toContain('Retry');
  });
});
