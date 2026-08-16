import type {
  AssistanceVocabularyEntry,
  ClarificationCandidate,
  SpellingObservation,
  SpellingSuppression,
} from '@duckworth/local-assistance';
import type { RuntimeLane } from './runtime-identity';

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

interface PersonalEntryRecord {
  text: string;
  redirects: string[];
}

interface ObservationRecord {
  text: string;
  observedAt: string;
}

interface SuppressionRecord {
  first: string;
  second: string;
}

interface DismissalRecord extends SuppressionRecord {
  dismissedAt: string;
}

interface StoredPersonalVocabulary {
  version: 1;
  revision: number;
  profileId: string;
  locale: string;
  entries: PersonalEntryRecord[];
  observations: ObservationRecord[];
  suppressions: SuppressionRecord[];
  dismissals: DismissalRecord[];
  enabled?: boolean;
}

export interface PersonalVocabularySnapshot {
  version: number;
  entries: AssistanceVocabularyEntry[];
  observations: SpellingObservation[];
  suppressions: SpellingSuppression[];
  diagnostics: { skippedRecords: number };
  enabled?: boolean;
}

export interface PersonalVocabularyOptions {
  now?: () => Date;
  maxObservations?: number;
  maxObservationAgeMs?: number;
  lane?: RuntimeLane;
  instanceId?: string;
  householdId?: string;
}

const DEFAULT_MAX_OBSERVATIONS = 100;
const DEFAULT_MAX_OBSERVATION_AGE_MS = 90 * 24 * 60 * 60 * 1000;
const CLARIFICATION_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

export class PersonalVocabularyStore {
  private readonly now: () => Date;
  private readonly maxObservations: number;
  private readonly maxObservationAgeMs: number;
  private readonly lane: RuntimeLane;
  private readonly instanceId: string;
  private readonly householdId: string;
  private session: StoredPersonalVocabulary;

  constructor(
    private readonly storage: StorageLike,
    private readonly profileId: string,
    private readonly locale: string,
    options: PersonalVocabularyOptions = {},
  ) {
    this.now = options.now ?? (() => new Date());
    this.maxObservations = Math.max(0, options.maxObservations ?? DEFAULT_MAX_OBSERVATIONS);
    this.maxObservationAgeMs = Math.max(0, options.maxObservationAgeMs ?? DEFAULT_MAX_OBSERVATION_AGE_MS);
    this.lane = options.lane ?? 'sandbox';
    this.instanceId = options.instanceId ?? 'local-instance';
    this.householdId = options.householdId ?? 'unpaired-household';
    this.session = this.emptyRecord();
  }

  storageKey(): string {
    return `duckworth:personal-vocabulary:v2:${encodeURIComponent(this.lane)}:${encodeURIComponent(this.instanceId)}:${encodeURIComponent(this.householdId)}:${encodeURIComponent(this.profileId)}:${encodeURIComponent(this.locale)}`;
  }

  read(): PersonalVocabularySnapshot {
    const decoded = this.load();
    this.session = decoded.record;
    return this.project(decoded.record, decoded.skippedRecords, false);
  }

  assistanceSnapshot(): PersonalVocabularySnapshot {
    const decoded = this.load();
    this.session = decoded.record;
    return decoded.record.enabled === false
      ? { ...this.project(decoded.record, decoded.skippedRecords, true), entries: [], observations: [], enabled: false }
      : this.project(decoded.record, decoded.skippedRecords, true);
  }

  clear(): PersonalVocabularySnapshot {
    const decoded = this.load();
    const cleared = this.emptyRecord();
    cleared.enabled = decoded.record.enabled !== false;
    cleared.revision = decoded.record.revision;
    return this.persist(cleared, decoded.skippedRecords);
  }

  setEnabled(enabled: boolean): PersonalVocabularySnapshot {
    const decoded = this.load();
    decoded.record.enabled = enabled;
    return this.persist(decoded.record, decoded.skippedRecords);
  }

  exportJson(): string {
    return JSON.stringify(this.load().record);
  }

  prefer(text: string, redirects: readonly string[] = []): PersonalVocabularySnapshot {
    const decoded = this.load();
    const display = text.trim();
    if (!display) return this.project(decoded.record, decoded.skippedRecords, true);
    const redirectValues = uniqueNonEmpty(redirects).filter((redirect) => redirect !== display);
    decoded.record.entries = decoded.record.entries.filter((entry) => entry.text !== display);
    decoded.record.entries.push({ text: display, redirects: redirectValues });
    return this.persist(decoded.record, decoded.skippedRecords);
  }

  keepSeparate(first: string, second: string): PersonalVocabularySnapshot {
    const decoded = this.load();
    const left = first.trim();
    const right = second.trim();
    if (!left || !right || left === right) return this.project(decoded.record, decoded.skippedRecords, true);
    const key = pairKey(left, right);
    if (!decoded.record.suppressions.some((entry) => pairKey(entry.first, entry.second) === key)) {
      decoded.record.suppressions.push({ first: left, second: right });
    }
    return this.persist(decoded.record, decoded.skippedRecords);
  }

  observe(text: string, observedAt = this.now()): PersonalVocabularySnapshot {
    const decoded = this.load();
    const value = text.trim();
    if (!value || Number.isNaN(observedAt.getTime())) return this.project(decoded.record, decoded.skippedRecords, true);
    const observationKey = matchingKey(value);
    decoded.record.observations = decoded.record.observations
      .filter((entry) => matchingKey(entry.text) !== observationKey);
    decoded.record.observations.push({ text: value, observedAt: observedAt.toISOString() });
    decoded.record.observations = this.pruneObservations(decoded.record.observations);
    return this.persist(decoded.record, decoded.skippedRecords);
  }

  dismiss(candidate: ClarificationCandidate): PersonalVocabularySnapshot {
    const decoded = this.load();
    const key = pairKey(candidate.earlier, candidate.later);
    decoded.record.dismissals = decoded.record.dismissals
      .filter((entry) => pairKey(entry.first, entry.second) !== key);
    decoded.record.dismissals.push({
      first: candidate.earlier,
      second: candidate.later,
      dismissedAt: this.now().toISOString(),
    });
    decoded.record.dismissals = decoded.record.dismissals.slice(-100);
    return this.persist(decoded.record, decoded.skippedRecords);
  }

  canPrompt(candidate: ClarificationCandidate): boolean {
    const record = this.load().record;
    const key = pairKey(candidate.earlier, candidate.later);
    if (record.suppressions.some((entry) => pairKey(entry.first, entry.second) === key)) return false;
    const dismissal = record.dismissals.find((entry) => pairKey(entry.first, entry.second) === key);
    if (!dismissal) return true;
    const dismissedAt = new Date(dismissal.dismissedAt).getTime();
    const cooldownElapsed = this.now().getTime() - dismissedAt >= CLARIFICATION_COOLDOWN_MS;
    const newEvidence = record.observations.some((entry) => new Date(entry.observedAt).getTime() > dismissedAt);
    return cooldownElapsed && newEvidence;
  }

  private persist(record: StoredPersonalVocabulary, skippedRecords: number): PersonalVocabularySnapshot {
    record.revision += 1;
    this.session = record;
    try {
      this.storage.setItem(this.storageKey(), JSON.stringify(record));
    } catch {
      // Personal assistance remains usable for this session when persistence is unavailable.
    }
    return this.project(record, skippedRecords, true);
  }

  private load(): { record: StoredPersonalVocabulary; skippedRecords: number } {
    let raw: string | null;
    try {
      raw = this.storage.getItem(this.storageKey());
    } catch {
      return { record: this.session, skippedRecords: 0 };
    }
    if (!raw) return { record: this.session, skippedRecords: 0 };

    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch {
      return { record: this.emptyRecord(), skippedRecords: 1 };
    }
    if (!value || typeof value !== 'object') return { record: this.emptyRecord(), skippedRecords: 1 };
    const root = value as Partial<StoredPersonalVocabulary>;
    if (root.version !== 1 || root.profileId !== this.profileId || root.locale !== this.locale
      || typeof root.revision !== 'number' || !Number.isSafeInteger(root.revision) || root.revision < 0) {
      return { record: this.emptyRecord(), skippedRecords: 1 };
    }

    let skippedRecords = 0;
    const entries = Array.isArray(root.entries) ? root.entries.flatMap((entry) => {
      if (!isPersonalEntry(entry)) { skippedRecords += 1; return []; }
      return [{ text: entry.text.trim(), redirects: uniqueNonEmpty(entry.redirects) }];
    }) : [];
    if (!Array.isArray(root.entries)) skippedRecords += 1;
    const observations = Array.isArray(root.observations) ? root.observations.flatMap((entry) => {
      if (!isObservation(entry)) { skippedRecords += 1; return []; }
      return [{ text: entry.text.trim(), observedAt: entry.observedAt }];
    }) : [];
    if (!Array.isArray(root.observations)) skippedRecords += 1;
    const suppressions = Array.isArray(root.suppressions) ? root.suppressions.flatMap((entry) => {
      if (!isSuppression(entry)) { skippedRecords += 1; return []; }
      return [{ first: entry.first.trim(), second: entry.second.trim() }];
    }) : [];
    if (!Array.isArray(root.suppressions)) skippedRecords += 1;
    const dismissals = Array.isArray(root.dismissals) ? root.dismissals.flatMap((entry) => {
      if (!isDismissal(entry)) { skippedRecords += 1; return []; }
      return [{ first: entry.first.trim(), second: entry.second.trim(), dismissedAt: entry.dismissedAt }];
    }) : [];

    return {
      record: {
        version: 1,
        revision: root.revision,
        profileId: this.profileId,
        locale: this.locale,
        entries,
        observations: this.pruneObservations(observations),
        suppressions,
        dismissals,
        enabled: root.enabled !== false,
      },
      skippedRecords,
    };
  }

  private project(
    record: StoredPersonalVocabulary,
    skippedRecords: number,
    includeRedirects: boolean,
  ): PersonalVocabularySnapshot {
    return {
      version: record.revision,
      entries: record.entries.map((entry) => ({
        text: entry.text,
        locale: this.locale,
        ...(includeRedirects ? { redirects: [...entry.redirects] } : {}),
        kind: 'item',
      })),
      observations: record.observations.map((entry) => ({ text: entry.text, locale: this.locale })),
      suppressions: record.suppressions.map((entry) => ({
        locale: this.locale,
        first: entry.first,
        second: entry.second,
      })),
      diagnostics: { skippedRecords },
      enabled: record.enabled !== false,
    };
  }

  private pruneObservations(observations: readonly ObservationRecord[]): ObservationRecord[] {
    if (this.maxObservations === 0) return [];
    const minimumTime = this.now().getTime() - this.maxObservationAgeMs;
    return observations
      .filter((entry) => new Date(entry.observedAt).getTime() >= minimumTime)
      .sort((left, right) => left.observedAt.localeCompare(right.observedAt))
      .slice(-this.maxObservations);
  }

  private emptyRecord(): StoredPersonalVocabulary {
    return {
      version: 1,
      revision: 0,
      profileId: this.profileId,
      locale: this.locale,
      entries: [],
      observations: [],
      suppressions: [],
      dismissals: [],
      enabled: true,
    };
  }
}

function isPersonalEntry(value: unknown): value is PersonalEntryRecord {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Partial<PersonalEntryRecord>;
  return typeof entry.text === 'string' && entry.text.trim().length > 0
    && Array.isArray(entry.redirects)
    && entry.redirects.every((redirect) => typeof redirect === 'string' && redirect.trim().length > 0);
}

function isObservation(value: unknown): value is ObservationRecord {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Partial<ObservationRecord>;
  return typeof entry.text === 'string' && entry.text.trim().length > 0
    && typeof entry.observedAt === 'string'
    && !Number.isNaN(new Date(entry.observedAt).getTime());
}

function isSuppression(value: unknown): value is SuppressionRecord {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Partial<SuppressionRecord>;
  return typeof entry.first === 'string' && entry.first.trim().length > 0
    && typeof entry.second === 'string' && entry.second.trim().length > 0
    && entry.first.trim() !== entry.second.trim();
}

function isDismissal(value: unknown): value is DismissalRecord {
  if (!isSuppression(value)) return false;
  const entry = value as Partial<DismissalRecord>;
  return typeof entry.dismissedAt === 'string' && !Number.isNaN(new Date(entry.dismissedAt).getTime());
}

function uniqueNonEmpty(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function pairKey(first: string, second: string): string {
  return [matchingKey(first), matchingKey(second)].sort().join('\u0000');
}

function matchingKey(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLocaleLowerCase('en-IN');
}
