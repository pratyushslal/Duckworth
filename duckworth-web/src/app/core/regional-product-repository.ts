export interface RegionalProduct {
  id: string;
  primary: string;
  aliases: string[];
  brandId: string;
  brandName: string;
  conceptId: string;
  compatibleContainerUnits: string[];
  compatiblePackageUnits: string[];
}

export interface RegionalProductPack {
  schemaVersion: 1;
  checksum: string;
  countryCode: string;
  version: string;
  products: RegionalProduct[];
}

export interface RegionalProductPackDescriptor {
  countryCode: string;
  version: string;
  checksum: string;
}

export interface RegionalProductPackStorage {
  loadActive(): Promise<RegionalProductPack | null>;
  stage(key: string, content: string): Promise<void>;
  promote(key: string, bundle: RegionalProductPack): Promise<void>;
}

export type RegionalProductPackInstallResult =
  | { ok: true; bundle: RegionalProductPack }
  | { ok: false; reason: 'invalid-bundle' | 'storage-unavailable'; retryable: true };

type ContentChecksum = (content: string) => Promise<string>;

export class RegionalProductPackRepository {
  private activeBundle: RegionalProductPack | null = null;

  constructor(
    private readonly storage: RegionalProductPackStorage,
    private readonly checksum: ContentChecksum = sha256,
  ) {}

  active(): RegionalProductPack | null {
    return this.activeBundle;
  }

  async hydrate(): Promise<void> {
    try {
      const stored = await this.storage.loadActive();
      this.activeBundle = isCompleteRegionalProductPack(stored) ? stored : null;
    } catch {
      this.activeBundle = null;
    }
  }

  async install(
    content: string,
    descriptor: RegionalProductPackDescriptor,
  ): Promise<RegionalProductPackInstallResult> {
    const key = `${descriptor.countryCode}@${descriptor.version}`;
    try {
      await this.storage.stage(key, content);
    } catch {
      return { ok: false, reason: 'storage-unavailable', retryable: true };
    }

    let bundle: unknown;
    try {
      bundle = JSON.parse(content) as unknown;
      if (await this.checksum(content) !== descriptor.checksum
        || !isCompleteRegionalProductPack(bundle)
        || bundle.countryCode !== descriptor.countryCode
        || bundle.version !== descriptor.version) {
        return { ok: false, reason: 'invalid-bundle', retryable: true };
      }
    } catch {
      return { ok: false, reason: 'invalid-bundle', retryable: true };
    }

    try {
      await this.storage.promote(key, bundle);
    } catch {
      return { ok: false, reason: 'storage-unavailable', retryable: true };
    }
    this.activeBundle = bundle;
    return { ok: true, bundle };
  }
}

export class IndexedDbRegionalProductPackStorage implements RegionalProductPackStorage {
  constructor(
    private readonly indexedDb: IDBFactory = globalThis.indexedDB,
    private readonly databaseName = 'duckworth-regional-product-packs',
  ) {}

  async loadActive(): Promise<RegionalProductPack | null> {
    const database = await this.open();
    try {
      const transaction = database.transaction(['metadata', 'bundles'], 'readonly');
      const key = await requestResult<string | undefined>(transaction.objectStore('metadata').get('active'));
      if (!key) return null;
      return await requestResult<RegionalProductPack | undefined>(transaction.objectStore('bundles').get(key)) ?? null;
    } finally {
      database.close();
    }
  }

  async stage(key: string, content: string): Promise<void> {
    const database = await this.open();
    try {
      const transaction = database.transaction('staging', 'readwrite');
      transaction.objectStore('staging').put(content, key);
      await transactionDone(transaction);
    } finally {
      database.close();
    }
  }

  async promote(key: string, bundle: RegionalProductPack): Promise<void> {
    const database = await this.open();
    try {
      const transaction = database.transaction(['bundles', 'metadata', 'staging'], 'readwrite');
      transaction.objectStore('bundles').put(bundle, key);
      transaction.objectStore('metadata').put(key, 'active');
      transaction.objectStore('staging').delete(key);
      await transactionDone(transaction);
    } finally {
      database.close();
    }
  }

  private open(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = this.indexedDb.open(this.databaseName, 1);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains('bundles')) database.createObjectStore('bundles');
        if (!database.objectStoreNames.contains('metadata')) database.createObjectStore('metadata');
        if (!database.objectStoreNames.contains('staging')) database.createObjectStore('staging');
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('Unable to open regional-product storage'));
    });
  }
}

export class InMemoryRegionalProductPackStorage implements RegionalProductPackStorage {
  private readonly staging = new Map<string, string>();
  constructor(private activeBundle: RegionalProductPack | null = null) {}
  loadActive(): Promise<RegionalProductPack | null> { return Promise.resolve(this.activeBundle); }
  stage(key: string, content: string): Promise<void> { this.staging.set(key, content); return Promise.resolve(); }
  promote(key: string, bundle: RegionalProductPack): Promise<void> {
    if (!this.staging.has(key)) return Promise.reject(new Error('Staged regional-product pack is missing'));
    this.activeBundle = bundle;
    this.staging.delete(key);
    return Promise.resolve();
  }
}

export class FallbackRegionalProductPackStorage implements RegionalProductPackStorage {
  private usePersistentStorage = true;
  private readonly staged = new Map<string, string>();
  constructor(
    private readonly persistent: RegionalProductPackStorage,
    private readonly session: RegionalProductPackStorage = new InMemoryRegionalProductPackStorage(),
  ) {}
  async loadActive(): Promise<RegionalProductPack | null> {
    if (!this.usePersistentStorage) return this.session.loadActive();
    try { return await this.persistent.loadActive(); }
    catch { this.usePersistentStorage = false; return this.session.loadActive(); }
  }
  async stage(key: string, content: string): Promise<void> {
    this.staged.set(key, content);
    if (!this.usePersistentStorage) return this.session.stage(key, content);
    try { await this.persistent.stage(key, content); }
    catch { this.usePersistentStorage = false; await this.session.stage(key, content); }
  }
  async promote(key: string, bundle: RegionalProductPack): Promise<void> {
    if (!this.usePersistentStorage) return this.promoteSession(key, bundle);
    try { await this.persistent.promote(key, bundle); }
    catch { this.usePersistentStorage = false; await this.promoteSession(key, bundle); }
    finally { this.staged.delete(key); }
  }
  private async promoteSession(key: string, bundle: RegionalProductPack): Promise<void> {
    const content = this.staged.get(key);
    if (content === undefined) throw new Error('Staged regional-product pack is missing');
    await this.session.stage(key, content);
    await this.session.promote(key, bundle);
  }
}

function isCompleteRegionalProductPack(value: unknown): value is RegionalProductPack {
  if (!value || typeof value !== 'object') return false;
  const pack = value as Partial<RegionalProductPack>;
  return pack.schemaVersion === 1
    && typeof pack.checksum === 'string' && /^sha256:[a-f0-9]{64}$/u.test(pack.checksum)
    && typeof pack.countryCode === 'string' && pack.countryCode.length === 2
    && typeof pack.version === 'string' && pack.version.length > 0
    && Array.isArray(pack.products) && pack.products.every(isCompleteRegionalProduct);
}

function isCompleteRegionalProduct(value: unknown): value is RegionalProduct {
  if (!value || typeof value !== 'object') return false;
  const product = value as Partial<RegionalProduct>;
  return typeof product.id === 'string' && product.id.length > 0
    && typeof product.primary === 'string' && product.primary.length > 0
    && typeof product.brandId === 'string' && product.brandId.length > 0
    && typeof product.brandName === 'string' && product.brandName.length > 0
    && typeof product.conceptId === 'string' && product.conceptId.length > 0
    && isStringArray(product.aliases)
    && isStringArray(product.compatibleContainerUnits)
    && isStringArray(product.compatiblePackageUnits);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Regional-product storage request failed'));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('Regional-product transaction failed'));
    transaction.onabort = () => reject(transaction.error ?? new Error('Regional-product transaction aborted'));
  });
}

async function sha256(content: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(content));
  const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `sha256:${hex}`;
}
