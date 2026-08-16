import type { AssistanceVocabularyEntry } from '@duckworth/local-assistance';
import type { ShoppingItem } from './shopping-items.service';

export interface HouseholdVocabularySnapshot {
  version: number;
  entries: AssistanceVocabularyEntry[];
}

export class HouseholdVocabulary {
  private readonly items = new Map<string, ShoppingItem>();
  private sourceVersion = 0;
  private fingerprint = '';

  constructor(private readonly locale: string) {}

  replace(items: readonly ShoppingItem[]): void {
    const next = new Map(items.map((item) => [item.id, item]));
    this.apply(next);
  }

  merge(item: ShoppingItem): void {
    const next = new Map(this.items);
    next.set(item.id, item);
    this.apply(next);
  }

  snapshot(): HouseholdVocabularySnapshot {
    return {
      version: this.sourceVersion,
      entries: this.projectEntries(),
    };
  }

  private apply(next: Map<string, ShoppingItem>): void {
    const nextFingerprint = JSON.stringify([...next.values()]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((item) => [item.id, item.name, item.captureText, item.updatedAt, item.version]));
    if (nextFingerprint === this.fingerprint) return;
    this.items.clear();
    for (const [id, item] of next) this.items.set(id, item);
    this.fingerprint = nextFingerprint;
    this.sourceVersion += 1;
  }

  private projectEntries(): AssistanceVocabularyEntry[] {
    return [...this.items.values()]
      .filter((item) => item.status !== 'removed')
      .filter((item) => Boolean(item.productId || item.semanticLearningStatus === 'confirmed'))
      .sort((left, right) => left.id.localeCompare(right.id))
      .flatMap((item): AssistanceVocabularyEntry[] => {
        const name = item.name.trim();
        const capture = item.captureText.trim();
        const entries: AssistanceVocabularyEntry[] = [];
        if (name) {
          entries.push({
            text: name,
            locale: this.locale,
            canonicalId: item.id,
            confirmedAt: item.updatedAt,
            kind: 'item',
          });
        }
        if (capture) {
          entries.push({
            text: capture,
            locale: this.locale,
            canonicalId: `${item.id}:capture`,
            confirmedAt: item.updatedAt,
            kind: 'capture',
          });
        }
        return entries;
      });
  }
}
