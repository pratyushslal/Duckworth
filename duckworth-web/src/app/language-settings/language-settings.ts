import { Component, InjectionToken, OnInit, inject, output, signal } from '@angular/core';
import { LanguagePackApiService, type CountryLanguagePackManifest } from '../core/language-pack-api.service';
import { FallbackLanguagePackStorage, IndexedDbLanguagePackStorage, InMemoryLanguagePackStorage, LanguagePackRepository, type LanguagePackBundle } from '../core/language-pack-repository';
import { LanguagePreferences, type LanguagePreferenceState } from '../core/language-preferences';
import {
  FallbackRegionalProductPackStorage,
  IndexedDbRegionalProductPackStorage,
  InMemoryRegionalProductPackStorage,
  RegionalProductPackRepository,
  type RegionalProductPack,
} from '../core/regional-product-repository';

export const LANGUAGE_PACK_REPOSITORY = new InjectionToken<LanguagePackRepository>('LanguagePackRepository', {
  providedIn: 'root',
  factory: () => new LanguagePackRepository(new FallbackLanguagePackStorage(
    new IndexedDbLanguagePackStorage(), new InMemoryLanguagePackStorage(),
  )),
});
export const LANGUAGE_PREFERENCES = new InjectionToken<LanguagePreferences>('LanguagePreferences', {
  providedIn: 'root', factory: () => new LanguagePreferences(localStorage, 'local-device'),
});
export const REGIONAL_PRODUCT_PACK_REPOSITORY = new InjectionToken<RegionalProductPackRepository>('RegionalProductPackRepository', {
  providedIn: 'root',
  factory: () => new RegionalProductPackRepository(new FallbackRegionalProductPackStorage(
    new IndexedDbRegionalProductPackStorage(), new InMemoryRegionalProductPackStorage(),
  )),
});
export interface LanguageSettingsChange {
  preferences: LanguagePreferenceState;
  bundle?: LanguagePackBundle;
  regionalProducts?: RegionalProductPack;
}
type RowStatus = 'available' | 'downloading' | 'active' | 'enabled' | 'failed';

@Component({ selector: 'app-language-settings', templateUrl: './language-settings.html', styleUrl: './language-settings.scss' })
export class LanguageSettings implements OnInit {
  private readonly api = inject(LanguagePackApiService);
  private readonly repository = inject(LANGUAGE_PACK_REPOSITORY);
  private readonly regionalProducts = inject(REGIONAL_PRODUCT_PACK_REPOSITORY);
  private readonly preferencesStore = inject(LANGUAGE_PREFERENCES);
  readonly changed = output<LanguageSettingsChange>();
  protected readonly manifest = signal<CountryLanguagePackManifest | null>(null);
  protected readonly preferences = signal<LanguagePreferenceState>({ activeLocale: 'en-IN', enabledLocales: ['en-IN'] });
  protected readonly loading = signal(false);
  protected readonly rowStates = signal<Record<string, RowStatus>>({});

  async ngOnInit(): Promise<void> {
    await Promise.all([this.repository.hydrate(), this.regionalProducts.hydrate()]);
    const preferences = this.preferencesStore.read();
    this.preferences.set(preferences);
    const active = this.repository.active();
    const regionalProducts = this.regionalProducts.active() ?? undefined;
    if (active?.locale === preferences.activeLocale || regionalProducts) {
      this.changed.emit({
        preferences,
        ...(active?.locale === preferences.activeLocale ? { bundle: active } : {}),
        ...(regionalProducts ? { regionalProducts } : {}),
      });
    }
    await this.bootstrapDefaultPacks(preferences);
  }

  protected async loadOptions(): Promise<void> {
    if (this.loading()) return;
    this.loading.set(true);
    try { this.manifest.set(await this.api.getManifest('IN')); }
    finally { this.loading.set(false); }
  }

  protected async enable(locale: string): Promise<void> {
    const descriptor = this.manifest()?.locales.find((candidate) => candidate.locale === locale);
    if (!descriptor) return;
    this.setRowStatus(locale, 'downloading');
    try {
      const result = await this.repository.install(await this.api.downloadPack(descriptor), descriptor);
      if (!result.ok) { this.setRowStatus(locale, 'failed'); return; }
      this.preferencesStore.enable(locale);
      const preferences = this.preferencesStore.setActive(locale);
      this.preferences.set(preferences);
      this.setRowStatus(locale, 'active');
      this.changed.emit({ preferences, bundle: result.bundle });
    } catch { this.setRowStatus(locale, 'failed'); }
  }

  protected disable(locale: string): void {
    const preferences = this.preferencesStore.disable(locale);
    this.preferences.set(preferences);
    this.setRowStatus(locale, 'available');
    this.changed.emit({ preferences });
  }

  protected status(locale: string): RowStatus {
    const explicit = this.rowStates()[locale];
    if (explicit) return explicit;
    if (this.preferences().activeLocale === locale) return 'active';
    if (this.preferences().enabledLocales.includes(locale)) return 'enabled';
    return 'available';
  }
  protected localeLabel(locale: string): string {
    if (locale === 'en-IN') return 'English (India)';
    if (locale === 'hi-Latn-IN') return 'Hinglish (Latin, India)';
    return locale;
  }
  private setRowStatus(locale: string, status: RowStatus): void {
    this.rowStates.update((states) => ({ ...states, [locale]: status }));
  }

  private async bootstrapDefaultPacks(preferences: LanguagePreferenceState): Promise<void> {
    try {
      const manifest = await this.api.getManifest('IN');
      if (!manifest) return;
      this.manifest.set(manifest);

      let bundle = this.repository.active();
      const locale = preferences.enabledLocales.includes(preferences.activeLocale)
        ? preferences.activeLocale
        : manifest.defaultLocale;
      const languageDescriptor = manifest.locales.find((candidate) => candidate.locale === locale)
        ?? manifest.locales.find((candidate) => candidate.locale === manifest.defaultLocale);
      if (languageDescriptor && (bundle?.locale !== languageDescriptor.locale || bundle.version !== languageDescriptor.version)) {
        const installed = await this.repository.install(
          await this.api.downloadPack(languageDescriptor), languageDescriptor,
        );
        if (installed.ok) bundle = installed.bundle;
      }

      let regionalProducts = this.regionalProducts.active();
      const regionalDescriptor = manifest.regionalProducts.find((candidate) => candidate.countryCode === 'IN');
      if (regionalDescriptor && regionalProducts?.version !== regionalDescriptor.version) {
        const installed = await this.regionalProducts.install(
          await this.api.downloadRegionalProducts(regionalDescriptor), regionalDescriptor,
        );
        if (installed.ok) regionalProducts = installed.bundle;
      }

      if (bundle || regionalProducts) {
        this.changed.emit({
          preferences,
          ...(bundle ? { bundle } : {}),
          ...(regionalProducts ? { regionalProducts } : {}),
        });
      }
    } catch {
      // Cached packs remain active when startup reconciliation is unavailable.
    }
  }
}
