import { HttpClient, HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import type { paths } from '../api/generated/schema';
import {
  LanguagePackRepository,
  type LanguagePackDescriptor,
} from './language-pack-repository';
import type { RegionalProductPackDescriptor } from './regional-product-repository';

type GeneratedCountryManifest = paths['/api/v1/language-packs/countries/{countryCode}/manifest']['get']['responses'][200]['content']['application/json'];
export type CountryLanguagePackManifest = GeneratedCountryManifest & {
  regionalProducts: Array<RegionalProductPackDescriptor & { artifactPath: string }>;
};

@Injectable({ providedIn: 'root' })
export class LanguagePackApiService {
  private readonly http = inject(HttpClient);

  reconcileInBackground(
    repository: LanguagePackRepository,
    countryCode: string,
    manifestEtag?: string,
  ): void {
    repository.reconcileInBackground({
      reconcile: () => this.reconcile(repository, countryCode, manifestEtag),
    });
  }

  private async reconcile(
    repository: LanguagePackRepository,
    countryCode: string,
    manifestEtag?: string,
  ): Promise<void> {
    const manifest = await this.getManifest(countryCode, manifestEtag);
    if (!manifest) return;

    const active = repository.active();
    const locale = active?.locale ?? manifest.defaultLocale;
    const descriptor = manifest.locales.find((candidate) => candidate.locale === locale);
    if (!descriptor || active?.version === descriptor.version) return;

    const content = await this.downloadPack(descriptor);
    await repository.install(content, descriptor);
  }

  async getManifest(
    countryCode: string,
    etag?: string,
  ): Promise<CountryLanguagePackManifest | null> {
    const headers = new HttpHeaders({
      'Cache-Control': 'no-cache',
      ...(etag ? { 'If-None-Match': etag } : {}),
    });
    try {
      const response = await firstValueFrom(this.http.get<CountryLanguagePackManifest>(
        `/api/v1/language-packs/countries/${encodeURIComponent(countryCode)}/manifest`,
        { observe: 'response', headers },
      ));
      return response.body;
    } catch (error) {
      if (error instanceof HttpErrorResponse && error.status === 304) return null;
      throw error;
    }
  }

  downloadPack(descriptor: LanguagePackDescriptor): Promise<string> {
    return firstValueFrom(this.http.get(
      `/api/v1/language-packs/${encodeURIComponent(descriptor.locale)}/${encodeURIComponent(descriptor.version)}`,
      { responseType: 'text' },
    ));
  }

  downloadRegionalProducts(descriptor: RegionalProductPackDescriptor): Promise<string> {
    return firstValueFrom(this.http.get(
      `/api/v1/regional-product-packs/${encodeURIComponent(descriptor.countryCode)}/${encodeURIComponent(descriptor.version)}`,
      { responseType: 'text' },
    ));
  }
}
