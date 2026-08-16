import type { paths } from '../api/generated/schema';

export type LanguagePackBundle = paths['/api/v1/language-packs/{locale}/{version}']['get']['responses'][200]['content']['application/json'];

export interface LanguagePackStorage {
  loadActive(): Promise<LanguagePackBundle | null>;
  stage(key: string, content: string): Promise<void>;
  promote(key: string, bundle: LanguagePackBundle): Promise<void>;
}

export interface LanguagePackReconciler {
  reconcile(): Promise<void>;
}

export interface LanguagePackDescriptor {
  locale: string;
  version: string;
  checksum: string;
}

export type LanguagePackInstallResult =
  | { ok: true; bundle: LanguagePackBundle }
  | { ok: false; reason: 'invalid-bundle' | 'storage-unavailable'; retryable: true };

export type ContentChecksum = (content: string) => Promise<string>;

export class LanguagePackRepository {
  private activeBundle: LanguagePackBundle | null = null;
  private reconciliationStarted = false;

  constructor(
    private readonly storage: LanguagePackStorage,
    private readonly checksum: ContentChecksum = sha256,
  ) {}

  active(): LanguagePackBundle | null {
    return this.activeBundle;
  }

  async hydrate(): Promise<void> {
    try {
      const stored = await this.storage.loadActive();
      this.activeBundle = isCompleteLanguagePack(stored) ? stored : null;
    } catch {
      this.activeBundle = null;
    }
  }

  async install(content: string, descriptor: LanguagePackDescriptor): Promise<LanguagePackInstallResult> {
    const key = `${descriptor.locale}@${descriptor.version}`;
    try {
      await this.storage.stage(key, content);
    } catch {
      return { ok: false, reason: 'storage-unavailable', retryable: true };
    }

    let bundle: unknown;
    try {
      const actualChecksum = await this.checksum(content);
      bundle = JSON.parse(content) as unknown;
      if (actualChecksum !== descriptor.checksum
        || !isCompleteLanguagePack(bundle)
        || bundle.locale !== descriptor.locale
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

  reconcileInBackground(reconciler: LanguagePackReconciler): void {
    if (this.reconciliationStarted) return;
    this.reconciliationStarted = true;
    void reconciler.reconcile().catch(() => undefined);
  }
}

export class IndexedDbLanguagePackStorage implements LanguagePackStorage {
  constructor(
    private readonly indexedDb: IDBFactory = globalThis.indexedDB,
    private readonly databaseName = 'duckworth-language-packs',
  ) {}

  async loadActive(): Promise<LanguagePackBundle | null> {
    const database = await this.open();
    try {
      const transaction = database.transaction(['metadata', 'bundles'], 'readonly');
      const activeKey = await requestResult<string | undefined>(
        transaction.objectStore('metadata').get('active'),
      );
      if (!activeKey) return null;
      return await requestResult<LanguagePackBundle | undefined>(
        transaction.objectStore('bundles').get(activeKey),
      ) ?? null;
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

  async promote(key: string, bundle: LanguagePackBundle): Promise<void> {
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
      request.onerror = () => reject(request.error ?? new Error('Unable to open language-pack storage'));
    });
  }
}

export class InMemoryLanguagePackStorage implements LanguagePackStorage {
  private readonly staging = new Map<string, string>();

  constructor(private activeBundle: LanguagePackBundle | null = null) {}

  loadActive(): Promise<LanguagePackBundle | null> {
    return Promise.resolve(this.activeBundle);
  }

  stage(key: string, content: string): Promise<void> {
    this.staging.set(key, content);
    return Promise.resolve();
  }

  promote(key: string, bundle: LanguagePackBundle): Promise<void> {
    if (!this.staging.has(key)) return Promise.reject(new Error('Staged language pack is missing'));
    this.activeBundle = bundle;
    this.staging.delete(key);
    return Promise.resolve();
  }
}

export class FallbackLanguagePackStorage implements LanguagePackStorage {
  private usePersistentStorage = true;
  private readonly stagedContent = new Map<string, string>();

  constructor(
    private readonly persistent: LanguagePackStorage,
    private readonly session: LanguagePackStorage = new InMemoryLanguagePackStorage(),
  ) {}

  persistenceAvailable(): boolean {
    return this.usePersistentStorage;
  }

  async loadActive(): Promise<LanguagePackBundle | null> {
    if (!this.usePersistentStorage) return this.session.loadActive();
    try {
      const bundle = await this.persistent.loadActive();
      if (bundle) await this.seedSession(bundle);
      return bundle;
    } catch {
      this.usePersistentStorage = false;
      return this.session.loadActive();
    }
  }

  async stage(key: string, content: string): Promise<void> {
    this.stagedContent.set(key, content);
    if (!this.usePersistentStorage) return this.session.stage(key, content);
    try {
      await this.persistent.stage(key, content);
    } catch {
      this.usePersistentStorage = false;
      await this.session.stage(key, content);
    }
  }

  async promote(key: string, bundle: LanguagePackBundle): Promise<void> {
    if (!this.usePersistentStorage) {
      await this.ensureSessionStage(key);
      await this.session.promote(key, bundle);
      this.stagedContent.delete(key);
      return;
    }
    try {
      await this.persistent.promote(key, bundle);
      await this.seedSession(bundle);
    } catch {
      this.usePersistentStorage = false;
      await this.ensureSessionStage(key);
      await this.session.promote(key, bundle);
    } finally {
      this.stagedContent.delete(key);
    }
  }

  private async ensureSessionStage(key: string): Promise<void> {
    const content = this.stagedContent.get(key);
    if (content === undefined) throw new Error('Staged language pack is missing');
    await this.session.stage(key, content);
  }

  private async seedSession(bundle: LanguagePackBundle): Promise<void> {
    const key = `${bundle.locale}@${bundle.version}`;
    await this.session.stage(key, JSON.stringify(bundle));
    await this.session.promote(key, bundle);
  }
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Language-pack storage request failed'));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('Language-pack transaction failed'));
    transaction.onabort = () => reject(transaction.error ?? new Error('Language-pack transaction aborted'));
  });
}

function isCompleteLanguagePack(value: unknown): value is LanguagePackBundle {
  if (!value || typeof value !== 'object') return false;
  const pack = value as Partial<LanguagePackBundle>;
  return pack.schemaVersion === 1
    && typeof pack.checksum === 'string'
    && /^sha256:[a-f0-9]{64}$/u.test(pack.checksum)
    && typeof pack.locale === 'string'
    && pack.locale.length > 0
    && typeof pack.version === 'string'
    && pack.version.length > 0
    && isStringArray(pack.fallbacks)
    && isStringRecord(pack.ui)
    && Array.isArray(pack.items)
    && pack.items.length > 0
    && pack.items.every(isCompleteItem)
    && Array.isArray(pack.units)
    && pack.units.length > 0
    && pack.units.every(isCompleteUnit);
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return !!value && typeof value === 'object'
    && Object.values(value).every((entry) => typeof entry === 'string');
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

function isCompleteItem(value: unknown): value is LanguagePackBundle['items'][number] {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<LanguagePackBundle['items'][number]>;
  return typeof item.id === 'string' && item.id.length > 0
    && typeof item.primary === 'string' && item.primary.length > 0
    && isStringArray(item.aliases)
    && typeof item.category === 'string' && item.category.length > 0
    && isStringArray(item.compatibleUnits);
}

function isCompleteUnit(value: unknown): value is LanguagePackBundle['units'][number] {
  if (!value || typeof value !== 'object') return false;
  const unit = value as Partial<LanguagePackBundle['units'][number]>;
  return typeof unit.id === 'string' && unit.id.length > 0
    && typeof unit.primary === 'string' && unit.primary.length > 0
    && isStringArray(unit.aliases);
}

async function sha256(content: string): Promise<string> {
  const bytes = new TextEncoder().encode(content);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `sha256:${hex}`;
}
