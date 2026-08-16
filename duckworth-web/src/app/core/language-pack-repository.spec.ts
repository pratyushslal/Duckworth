import { describe, expect, it } from 'vitest';
import {
  FallbackLanguagePackStorage,
  InMemoryLanguagePackStorage,
  LanguagePackRepository,
  type LanguagePackBundle,
  type LanguagePackStorage,
} from './language-pack-repository';

const englishPack: LanguagePackBundle = {
  schemaVersion: 1,
  checksum: 'sha256:98638f0b12a53c4af0cd5e23ad835060d4a6541f348a38b2d4f071a02d41557a',
  locale: 'en-IN',
  version: '2026.08.05.1',
  fallbacks: [],
  ui: { 'capture.placeholder': 'Add an item' },
  items: [{
    id: 'grocery.milk.dairy',
    primary: 'milk',
    aliases: ['dairy milk'],
    category: 'dairy-and-eggs',
    compatibleUnits: ['l'],
  }],
  units: [{ id: 'l', primary: 'l', aliases: ['litre'] }],
};

class MemoryPackStorage implements LanguagePackStorage {
  private staging = new Map<string, string>();

  constructor(private active: LanguagePackBundle | null) {}

  loadActive(): Promise<LanguagePackBundle | null> {
    return Promise.resolve(this.active);
  }

  stage(key: string, content: string): Promise<void> {
    this.staging.set(key, content);
    return Promise.resolve();
  }

  promote(key: string, bundle: LanguagePackBundle): Promise<void> {
    if (!this.staging.has(key)) return Promise.reject(new Error('Missing staged artifact'));
    this.active = bundle;
    this.staging.delete(key);
    return Promise.resolve();
  }
}

const descriptor = {
  locale: englishPack.locale,
  version: englishPack.version,
  checksum: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
};

const matchingChecksum = async () => descriptor.checksum;

describe('LanguagePackRepository', () => {
  it('hydrates the last validated pack before background reconciliation completes', async () => {
    const repository = new LanguagePackRepository(new MemoryPackStorage(englishPack));
    await repository.hydrate();

    let finishManifest!: () => void;
    const manifestPending = new Promise<void>((resolve) => { finishManifest = resolve; });
    repository.reconcileInBackground({
      reconcile: () => manifestPending,
    });

    expect(repository.active()).toEqual(englishPack);
    expect(repository.active()?.ui['capture.placeholder']).toBe('Add an item');

    finishManifest();
    await manifestPending;
  });

  it('stages, validates, and atomically promotes the complete UI and dictionary bundle', async () => {
    const previous = { ...englishPack, version: '2026.08.04.1', ui: { 'capture.placeholder': 'Old' } };
    const storage = new MemoryPackStorage(previous);
    const repository = new LanguagePackRepository(storage, matchingChecksum);
    await repository.hydrate();

    const result = await repository.install(JSON.stringify(englishPack), descriptor);

    expect(result).toEqual({ ok: true, bundle: englishPack });
    expect(repository.active()?.ui['capture.placeholder']).toBe('Add an item');
    expect(repository.active()?.items[0]?.primary).toBe('milk');

    const reloaded = new LanguagePackRepository(storage);
    await reloaded.hydrate();
    expect(reloaded.active()).toEqual(englishPack);
  });

  it.each([
    ['a checksum mismatch', JSON.stringify(englishPack), async () => 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'],
    ['corrupt JSON', '{not json', matchingChecksum],
    ['a missing dictionary artifact', JSON.stringify({ ...englishPack, items: undefined }), matchingChecksum],
  ])('keeps the previous pack active after %s', async (_case, content, checksum) => {
    const storage = new MemoryPackStorage(englishPack);
    const repository = new LanguagePackRepository(storage, checksum);
    await repository.hydrate();

    const result = await repository.install(content, descriptor);

    expect(result).toEqual({ ok: false, reason: 'invalid-bundle', retryable: true });
    expect(repository.active()).toEqual(englishPack);
  });

  it.each(['stage', 'promote'] as const)('keeps the previous pack active when storage %s fails', async (operation) => {
    class FailingStorage extends MemoryPackStorage {
      override stage(key: string, content: string): Promise<void> {
        return operation === 'stage' ? Promise.reject(new DOMException('Quota exceeded', 'QuotaExceededError')) : super.stage(key, content);
      }
      override promote(key: string, bundle: LanguagePackBundle): Promise<void> {
        return operation === 'promote' ? Promise.reject(new Error('Interrupted')) : super.promote(key, bundle);
      }
    }
    const storage = new FailingStorage(englishPack);
    const repository = new LanguagePackRepository(storage, matchingChecksum);
    await repository.hydrate();

    const result = await repository.install(JSON.stringify(englishPack), descriptor);

    expect(result).toEqual({ ok: false, reason: 'storage-unavailable', retryable: true });
    expect(repository.active()).toEqual(englishPack);
  });

  it('falls back to a reusable in-memory session when IndexedDB is unavailable', async () => {
    const unavailable: LanguagePackStorage = {
      loadActive: () => Promise.reject(new DOMException('Blocked', 'InvalidStateError')),
      stage: () => Promise.reject(new DOMException('Blocked', 'InvalidStateError')),
      promote: () => Promise.reject(new DOMException('Blocked', 'InvalidStateError')),
    };
    const storage = new FallbackLanguagePackStorage(
      unavailable,
      new InMemoryLanguagePackStorage(englishPack),
    );
    const repository = new LanguagePackRepository(storage, matchingChecksum);

    await repository.hydrate();
    const result = await repository.install(JSON.stringify(englishPack), descriptor);

    expect(result.ok).toBe(true);
    expect(repository.active()).toEqual(englishPack);
    expect(storage.persistenceAvailable()).toBe(false);

    const sameSession = new LanguagePackRepository(storage);
    await sameSession.hydrate();
    expect(sameSession.active()).toEqual(englishPack);
  });
});
