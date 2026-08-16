import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CaptureAssistanceService, type CaptureAssistanceSources } from './capture-assistance.service';
import { HouseholdVocabulary } from './household-vocabulary';
import type { LanguagePackBundle } from './language-pack-repository';
import type { ShoppingItem } from './shopping-items.service';
import type { RegionalProductPack } from './regional-product-repository';
import { PersonalVocabularyStore } from './personal-vocabulary-store';

class MemoryStorage {
  private readonly values = new Map<string, string>();
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, value); }
}

const pack = (locale: string, version: string, primary: string): LanguagePackBundle => ({
  schemaVersion: 1,
  checksum: 'sha256:1111111111111111111111111111111111111111111111111111111111111111',
  locale,
  version,
  fallbacks: locale === 'hi-Latn-IN' ? ['en-IN'] : [],
  ui: {},
  items: [{ id: `item.${primary}`, primary, aliases: [], category: 'test', compatibleUnits: ['kg'] }],
  units: [{ id: 'kg', primary: 'kg', aliases: ['kilo'] }],
});
const regionalProducts: RegionalProductPack = {
  schemaVersion: 1,
  checksum: 'sha256:2222222222222222222222222222222222222222222222222222222222222222',
  countryCode: 'IN', version: '1',
  products: [{
    id: 'product.amul.butter', primary: 'Amul Butter', aliases: ['amul butter'],
    brandId: 'brand.amul', brandName: 'Amul', conceptId: 'grocery.butter.dairy',
    compatibleContainerUnits: ['pack'], compatiblePackageUnits: ['g'],
  }],
};

const shoppingItem = (overrides: Partial<ShoppingItem> = {}): ShoppingItem => ({
  id: 'shopping-bread', householdId: 'family-a', captureText: 'bread 2 packs', name: 'bread', quantity: 2,
  unit: 'pack', packageSize: null, packageUnit: null,
  brandId: null, productId: 'product.bread', conceptId: 'grocery.bread',
  unitSource: 'explicit', unitConfirmedAt: '2026-08-04T00:00:00.000Z',
  attentionReasons: [], status: 'active', removedAt: null, createdAt: '2026-08-04T00:00:00.000Z',
  updatedAt: '2026-08-04T00:00:00.000Z', version: 1, ...overrides,
});

const sources = (): CaptureAssistanceSources => {
  const household = new HouseholdVocabulary('en-IN');
  household.replace([shoppingItem()]);
  return {
    activeLocale: 'en-IN',
    enabledLocales: ['en-IN', 'hi-Latn-IN'],
    packs: [pack('en-IN', '1', 'milk'), pack('hi-Latn-IN', '1', 'atta')],
    regionalProducts,
    household: household.snapshot(),
    personal: {
      version: 1,
      entries: [{ text: 'biscuit', locale: 'en-IN', redirects: ['biscut'], kind: 'item' }],
      observations: [],
      suppressions: [],
      diagnostics: { skippedRecords: 0 },
    },
  };
};

describe('CaptureAssistanceService', () => {
  let service: CaptureAssistanceService;
  let httpTesting: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [CaptureAssistanceService, provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(CaptureAssistanceService);
    httpTesting = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpTesting.verify());

  it('keeps personal, household, active-pack, and fallback-pack projections distinguishable', () => {
    service.configure(sources());

    expect(service.suggest('biscut')[0]).toEqual(expect.objectContaining({ text: 'biscuit', source: 'personal', kind: 'correction' }));
    expect(service.suggest('bread')[0]).toEqual(expect.objectContaining({ text: 'bread', source: 'household' }));
    expect(service.suggest('mil')[0]).toEqual(expect.objectContaining({ text: 'milk', source: 'active-locale' }));
    expect(service.suggest('att')[0]).toEqual(expect.objectContaining({ text: 'atta', source: 'fallback-locale' }));
    expect(service.suggest('amul')[0]).toEqual(expect.objectContaining({
      text: 'Amul Butter', source: 'regional-product', canonicalId: 'product.amul.butter',
    }));
  });

  it('returns item and unit suggestions synchronously without an HTTP request', () => {
    service.configure(sources());

    expect(service.suggest('mil')[0]?.text).toBe('milk');
    expect(service.suggest('milk 2 k')[0]?.text).toBe('milk 2 kg');
    httpTesting.expectNone(() => true);
  });

  it('uses only a confirmed local identity to suppress remote fallback', () => {
    service.configure(sources());
    expect(service.resolveLocalCapture('Amul Butter 500 g')).toMatchObject({ status: 'resolved' });
    expect(service.resolveLocalCapture('unfamiliar chemical')).toMatchObject({ status: 'unknown' });
    expect(service.resolveLocalCapture('')).toMatchObject({ status: 'invalid' });
  });

  it('rebuilds only when a source version changes, not for keystrokes or same-version objects', () => {
    const initial = sources();
    expect(service.configure(initial)).toBe(true);
    expect(service.suggest('mil')[0]?.text).toBe('milk');
    expect(service.suggest('mil')[0]?.text).toBe('milk');

    const sameVersions = { ...initial, packs: [pack('en-IN', '1', 'millet'), initial.packs[1]] };
    expect(service.configure(sameVersions)).toBe(false);
    expect(service.suggest('mil')[0]?.text).toBe('milk');

    const changedVersion = { ...sameVersions, packs: [pack('en-IN', '2', 'millet'), initial.packs[1]] };
    expect(service.configure(changedVersion)).toBe(true);
    expect(service.suggest('mil')[0]?.text).toBe('millet');
  });

  it('keeps valid official and household suggestions when personal diagnostics report skipped records', () => {
    const withDiagnostics = sources();
    withDiagnostics.personal = {
      ...withDiagnostics.personal,
      diagnostics: { skippedRecords: 3 },
    };
    service.configure(withDiagnostics);

    expect(service.suggest('mil')[0]?.text).toBe('milk');
    expect(service.suggest('bre')[0]?.text).toBe('bread');
    expect(service.diagnostics()).toEqual({ skippedPersonalRecords: 3 });
  });

  it('observes successful captures without displaying raw evidence and surfaces one conservative clarification', () => {
    const store = new PersonalVocabularyStore(new MemoryStorage(), 'profile-a', 'en-IN');
    const initial = sources();
    initial.personal = store.assistanceSnapshot();
    service.configure(initial);

    expect(service.observeSuccessfulCapture('biscut', store)).toBeNull();
    expect(store.read().entries).toEqual([]);
    expect(service.observeSuccessfulCapture('biscuit', store)).toEqual(expect.objectContaining({
      earlier: 'biscut', later: 'biscuit', locale: 'en-IN',
    }));
    expect(store.read().entries).toEqual([]);
  });

  it.each([
    ['prefer-later', 'biscuit', 'biscut'],
    ['prefer-earlier', 'biscut', 'biscuit'],
  ] as const)('keeps a %s decision private and displays only the preferred spelling', (decision, preferred, rejected) => {
    const store = new PersonalVocabularyStore(new MemoryStorage(), 'profile-a', 'en-IN');
    const initial = sources();
    initial.household = {
      version: 2,
      entries: [
        { text: 'biscut', locale: 'en-IN', kind: 'item' },
        { text: 'biscuit', locale: 'en-IN', kind: 'item' },
      ],
    };
    initial.personal = store.assistanceSnapshot();
    const officialBefore = JSON.stringify(initial.packs);
    service.configure(initial);
    service.observeSuccessfulCapture('biscut', store);
    const candidate = service.observeSuccessfulCapture('biscuit', store)!;

    service.resolveClarification(candidate, decision, store);

    expect(service.suggest(rejected).map((suggestion) => suggestion.text)).toEqual([preferred]);
    expect(store.read().entries.map((entry) => entry.text)).toEqual([preferred]);
    expect(store.read().entries[0]?.redirects).toBeUndefined();
    expect(JSON.stringify(initial.packs)).toBe(officialBefore);
  });

  it('suppresses a keep-separate pair and does not ask again', () => {
    const store = new PersonalVocabularyStore(new MemoryStorage(), 'profile-a', 'en-IN');
    const initial = sources();
    initial.personal = store.assistanceSnapshot();
    service.configure(initial);
    service.observeSuccessfulCapture('biscut', store);
    const candidate = service.observeSuccessfulCapture('biscuit', store)!;

    service.resolveClarification(candidate, 'keep-separate', store);

    expect(service.observeSuccessfulCapture('biscuit', store)).toBeNull();
  });
});
