import { mkdir, writeFile } from 'node:fs/promises';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { RegionalProductCatalog } from '../src/regional-product-packs.js';

describe('RegionalProductCatalog', () => {
  it('uses the catalog-owned brand display label instead of guessing from the product title', async () => {
    const root = await mkdtemp(join(tmpdir(), 'duckworth-regional-products-'));
    await mkdir(join(root, 'countries', 'IN'), { recursive: true });
    await mkdir(join(root, 'regional-products', 'IN'), { recursive: true });
    await writeFile(join(root, 'countries', 'IN', 'manifest.json'), JSON.stringify({
      regionalProducts: [{ countryCode: 'IN', artifactPath: 'regional-products/IN/1.json' }],
    }));
    await writeFile(join(root, 'regional-products', 'IN', '1.json'), JSON.stringify({
      products: [{
        id: 'product.example',
        brandId: 'brand.example',
        brandName: 'Example Consumer Brand',
        conceptId: 'grocery.example',
        primary: 'Example Consumer Brand Premium Noodles',
        aliases: ['example noodles'],
      }],
    }));

    const hints = new RegionalProductCatalog(root).listBrandHints('IN');

    expect(hints).toEqual([{ label: 'Example Consumer Brand', aliases: ['Example Consumer Brand'] }]);
  });
});
