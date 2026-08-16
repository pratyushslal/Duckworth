import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { normalizeItemName } from '@duckworth/item-capture';
import type { BrandHint } from '@duckworth/shopping-intelligence';

export interface ResolvedRegionalProduct {
  productId: string;
  brandId: string;
  conceptId: string;
  displayName: string;
}

interface RegionalProduct {
  id: string;
  brandId: string;
  brandName: string;
  conceptId: string;
  primary: string;
  aliases: string[];
}

export class RegionalProductCatalog {
  constructor(private readonly rootPath: string) {}

  listBrandHints(countryCode: string): BrandHint[] {
    let products: RegionalProduct[];
    try {
      products = this.readProducts(countryCode);
    } catch {
      return [];
    }
    const hints = new Map<string, BrandHint>();
    for (const product of products) {
      const label = product.brandName.trim();
      const key = normalizeItemName(label);
      if (!key || hints.has(key)) continue;
      hints.set(key, { label, aliases: [label] });
    }
    return [...hints.values()];
  }

  resolve(countryCode: string, productId: string, parsedName: string): ResolvedRegionalProduct | null {
    try {
      const product = this.readProducts(countryCode).find((entry) => entry.id === productId);
      if (!product) return null;
      const key = normalizeItemName(parsedName);
      if (![product.primary, ...product.aliases].some((label) => normalizeItemName(label) === key)) return null;
      return {
        productId: product.id,
        brandId: product.brandId,
        conceptId: product.conceptId,
        displayName: product.primary,
      };
    } catch {
      return null;
    }
  }

  private readProducts(countryCode: string): RegionalProduct[] {
    if (!/^[A-Z]{2}$/u.test(countryCode)) return [];
    const manifest = JSON.parse(readFileSync(
      join(this.rootPath, 'countries', countryCode, 'manifest.json'), 'utf8',
    )) as { regionalProducts?: Array<{ countryCode: string; artifactPath: string }> };
    const descriptor = manifest.regionalProducts?.find((entry) => entry.countryCode === countryCode);
    if (!descriptor || !descriptor.artifactPath.startsWith(`regional-products/${countryCode}/`)) return [];
    const pack = JSON.parse(readFileSync(join(this.rootPath, ...descriptor.artifactPath.split('/')), 'utf8')) as {
      products?: RegionalProduct[];
    };
    return pack.products ?? [];
  }
}
