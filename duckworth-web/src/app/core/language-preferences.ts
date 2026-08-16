interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface LanguagePreferenceState {
  activeLocale: string;
  enabledLocales: string[];
}

interface StoredLanguagePreferences extends LanguagePreferenceState {
  version: 1;
  deviceProfileId: string;
}

const DEFAULT_STATE: Readonly<LanguagePreferenceState> = {
  activeLocale: 'en-IN',
  enabledLocales: ['en-IN'],
};
const LOCALE_ID = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/u;

export class LanguagePreferences {
  private sessionState: LanguagePreferenceState = cloneState(DEFAULT_STATE);

  constructor(
    private readonly storage: StorageLike,
    private readonly deviceProfileId: string,
  ) {}

  storageKey(): string {
    return `duckworth:language-preferences:v1:${encodeURIComponent(this.deviceProfileId)}`;
  }

  read(): LanguagePreferenceState {
    let raw: string | null;
    try {
      raw = this.storage.getItem(this.storageKey());
    } catch {
      return cloneState(this.sessionState);
    }
    if (!raw) return cloneState(this.sessionState);

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      this.sessionState = cloneState(DEFAULT_STATE);
      return cloneState(this.sessionState);
    }
    if (!this.isStoredPreferences(parsed)) {
      this.sessionState = cloneState(DEFAULT_STATE);
      return cloneState(this.sessionState);
    }
    this.sessionState = {
      activeLocale: parsed.activeLocale,
      enabledLocales: [...parsed.enabledLocales],
    };
    return cloneState(this.sessionState);
  }

  enable(locale: string): LanguagePreferenceState {
    if (!isLocaleId(locale)) return this.read();
    const current = this.read();
    if (!current.enabledLocales.includes(locale)) current.enabledLocales.push(locale);
    return this.write(current);
  }

  disable(locale: string): LanguagePreferenceState {
    const current = this.read();
    current.enabledLocales = current.enabledLocales.filter((candidate) => candidate !== locale);
    if (current.activeLocale === locale) current.activeLocale = DEFAULT_STATE.activeLocale;
    if (!current.enabledLocales.includes(current.activeLocale)) {
      current.enabledLocales.unshift(current.activeLocale);
    }
    return this.write(current);
  }

  setActive(locale: string): LanguagePreferenceState {
    if (!isLocaleId(locale)) return this.read();
    const current = this.read();
    current.activeLocale = locale;
    if (!current.enabledLocales.includes(locale)) current.enabledLocales.push(locale);
    return this.write(current);
  }

  private write(state: LanguagePreferenceState): LanguagePreferenceState {
    this.sessionState = cloneState(state);
    const stored: StoredLanguagePreferences = {
      version: 1,
      deviceProfileId: this.deviceProfileId,
      ...cloneState(state),
    };
    try {
      this.storage.setItem(this.storageKey(), JSON.stringify(stored));
    } catch {
      // The active session remains usable when local preference persistence is unavailable.
    }
    return cloneState(this.sessionState);
  }

  private isStoredPreferences(value: unknown): value is StoredLanguagePreferences {
    if (!value || typeof value !== 'object') return false;
    const candidate = value as Partial<StoredLanguagePreferences>;
    return candidate.version === 1
      && candidate.deviceProfileId === this.deviceProfileId
      && isLocaleId(candidate.activeLocale)
      && Array.isArray(candidate.enabledLocales)
      && candidate.enabledLocales.length > 0
      && candidate.enabledLocales.every(isLocaleId)
      && candidate.enabledLocales.includes(candidate.activeLocale);
  }
}

function isLocaleId(value: unknown): value is string {
  return typeof value === 'string' && LOCALE_ID.test(value);
}

function cloneState(state: Readonly<LanguagePreferenceState>): LanguagePreferenceState {
  return { activeLocale: state.activeLocale, enabledLocales: [...state.enabledLocales] };
}
