import { describe, expect, it } from 'vitest';
import {
  InMemoryRegionalProductPackStorage,
  RegionalProductPackRepository,
  type RegionalProductPack,
} from './regional-product-repository';

const checksum = 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const pack: RegionalProductPack = {
  schemaVersion: 1,
  checksum,
  countryCode: 'IN',
  version: '2026.08.05.1',
  products: [{
    id: 'product.amul.butter',
    primary: 'Amul Butter',
    aliases: ['amul butter'],
    brandId: 'brand.amul',
    brandName: 'Amul',
    conceptId: 'grocery.butter.dairy',
    compatibleContainerUnits: ['pack'],
    compatiblePackageUnits: ['g'],
  }],
};

describe('RegionalProductPackRepository', () => {
  it('atomically installs and hydrates a complete reviewed pack', async () => {
    const storage = new InMemoryRegionalProductPackStorage();
    const repository = new RegionalProductPackRepository(storage, async () => checksum);

    await expect(repository.install(JSON.stringify(pack), {
      countryCode: 'IN', version: pack.version, checksum,
    })).resolves.toEqual({ ok: true, bundle: pack });

    const restored = new RegionalProductPackRepository(storage, async () => checksum);
    await restored.hydrate();
    expect(restored.active()).toEqual(pack);
  });

  it('keeps the prior pack active when a replacement is invalid', async () => {
    const storage = new InMemoryRegionalProductPackStorage(pack);
    const repository = new RegionalProductPackRepository(storage, async () => checksum);
    await repository.hydrate();

    await expect(repository.install('{broken', {
      countryCode: 'IN', version: '2026.08.05.2', checksum,
    })).resolves.toMatchObject({ ok: false, reason: 'invalid-bundle' });
    expect(repository.active()).toEqual(pack);
  });
});
