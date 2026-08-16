import {
  createAssistanceIndex,
  detectClarification,
  suggest,
  suggestSemantic,
  type AssistanceIndex,
  type AssistanceVocabularyEntry,
  type CaptureSuggestion,
  type SemanticSuggestion,
  type ClarificationCandidate,
} from '@duckworth/local-assistance';
import { Injectable, signal } from '@angular/core';
import type { HouseholdVocabularySnapshot } from './household-vocabulary';
import type { LanguagePackBundle } from './language-pack-repository';
import type { PersonalVocabularySnapshot } from './personal-vocabulary-store';
import { PersonalVocabularyStore } from './personal-vocabulary-store';
import type { RegionalProductPack } from './regional-product-repository';

export type SpellingDecision = 'prefer-later' | 'prefer-earlier' | 'keep-separate' | 'dismiss';

/** A conservative client-side decision used only to decide whether remote lookup is useful. */
export interface LocalCaptureResolution {
  status: 'resolved' | 'ambiguous' | 'unknown' | 'invalid';
  evidence: readonly string[];
}

export interface CaptureAssistanceSources {
  activeLocale: string;
  enabledLocales: readonly string[];
  packs: readonly LanguagePackBundle[];
  regionalProducts?: RegionalProductPack | null;
  household: HouseholdVocabularySnapshot;
  personal: PersonalVocabularySnapshot;
}

@Injectable({ providedIn: 'root' })
export class CaptureAssistanceService {
  private index: AssistanceIndex = createAssistanceIndex({ personal: [], household: [], locale: [] });
  private activeLocale = 'en-IN';
  private enabledLocales: readonly string[] = ['en-IN'];
  private sourceFingerprint = '';
  private skippedPersonalRecords = 0;
  private currentSources: CaptureAssistanceSources | null = null;
  private hiddenRedirects = new Set<string>();
  private readonly sourceRevision = signal(0);
  readonly revision = this.sourceRevision.asReadonly();

  configure(sources: CaptureAssistanceSources): boolean {
    const fingerprint = fingerprintSources(sources);
    if (fingerprint === this.sourceFingerprint) return false;

    this.index = createAssistanceIndex({
      personal: sources.personal.entries,
      household: sources.household.entries,
      regional: sources.regionalProducts ? projectRegionalProducts(sources.regionalProducts) : [],
      locale: sources.packs.flatMap(projectPack),
      observations: sources.personal.observations,
      suppressions: sources.personal.suppressions,
    });
    this.activeLocale = sources.activeLocale;
    this.enabledLocales = [...sources.enabledLocales];
    this.skippedPersonalRecords = sources.personal.diagnostics.skippedRecords;
    this.currentSources = sources;
    this.hiddenRedirects = new Set(sources.personal.entries
      .flatMap((entry) => entry.redirects ?? [])
      .map(matchingKey));
    this.sourceFingerprint = fingerprint;
    this.sourceRevision.update((revision) => revision + 1);
    return true;
  }

  suggest(input: string): CaptureSuggestion[] {
    return suggest(this.index, {
      input,
      activeLocale: this.activeLocale,
      enabledLocales: this.enabledLocales,
    }).filter((suggestion) => !this.isHiddenRedirect(suggestion.text));
  }

  suggestSemantic(input: string): SemanticSuggestion[] {
    return suggestSemantic(this.index, {
      input,
      activeLocale: this.activeLocale,
      enabledLocales: this.enabledLocales,
    }).filter((suggestion) => !this.isHiddenRedirect(suggestion.text));
  }

  resolveLocalCapture(input: string): LocalCaptureResolution {
    const normalized = matchingKey(input);
    if (!normalized) return { status: 'invalid', evidence: [] };
    const candidates = this.suggestSemantic(input);
    const exact = candidates.find((candidate) => (
      (candidate.productId || candidate.conceptId)
      && (normalized === matchingKey(candidate.text) || normalized.startsWith(`${matchingKey(candidate.text)} `))
    ));
    if (exact) return { status: 'resolved', evidence: [exact.source, exact.canonicalId ?? exact.text] };
    return candidates.length > 1
      ? { status: 'ambiguous', evidence: candidates.slice(0, 2).map((candidate) => candidate.source) }
      : { status: 'unknown', evidence: [] };
  }

  clarification(text: string): ClarificationCandidate | null {
    return detectClarification(this.index, { text, locale: this.activeLocale });
  }

  diagnostics(): { skippedPersonalRecords: number } {
    return { skippedPersonalRecords: this.skippedPersonalRecords };
  }

  observeSuccessfulCapture(text: string, store: PersonalVocabularyStore): ClarificationCandidate | null {
    this.updatePersonal(store.observe(text));
    const candidate = this.clarification(text);
    return candidate && store.canPrompt(candidate) ? candidate : null;
  }

  resolveClarification(
    candidate: ClarificationCandidate,
    decision: SpellingDecision,
    store: PersonalVocabularyStore,
  ): void {
    const personal = decision === 'prefer-later'
      ? store.prefer(candidate.later, [candidate.earlier])
      : decision === 'prefer-earlier'
        ? store.prefer(candidate.earlier, [candidate.later])
        : decision === 'keep-separate'
          ? store.keepSeparate(candidate.earlier, candidate.later)
          : store.dismiss(candidate);
    this.updatePersonal(personal);
  }

  private updatePersonal(personal: PersonalVocabularySnapshot): void {
    if (!this.currentSources) return;
    this.configure({ ...this.currentSources, personal });
  }

  private isHiddenRedirect(text: string): boolean {
    const key = matchingKey(text);
    return [...this.hiddenRedirects].some((redirect) => key === redirect || key.startsWith(`${redirect} `));
  }
}

function fingerprintSources(sources: CaptureAssistanceSources): string {
  const packs = sources.packs
    .map((pack) => `${pack.locale}@${pack.version}`)
    .sort();
  return JSON.stringify([
    sources.activeLocale,
    [...sources.enabledLocales].sort(),
    packs,
    sources.regionalProducts ? `${sources.regionalProducts.countryCode}@${sources.regionalProducts.version}` : null,
    sources.household.version,
    sources.personal.version,
  ]);
}

function projectRegionalProducts(pack: RegionalProductPack): AssistanceVocabularyEntry[] {
  return pack.products.map((product): AssistanceVocabularyEntry => ({
    text: product.primary,
    locale: 'en-IN',
    aliases: product.aliases,
    canonicalId: product.id,
    productId: product.id,
    brandId: product.brandId,
    conceptId: product.conceptId,
    kind: 'item',
  }));
}

function projectPack(pack: LanguagePackBundle): AssistanceVocabularyEntry[] {
  return [
    ...pack.items.map((item): AssistanceVocabularyEntry => ({
      text: item.primary,
      locale: pack.locale,
      aliases: item.aliases,
      canonicalId: item.id,
      kind: 'item',
    })),
    ...pack.units.map((unit): AssistanceVocabularyEntry => ({
      text: unit.primary,
      locale: pack.locale,
      aliases: unit.aliases,
      canonicalId: unit.id,
      kind: 'unit',
    })),
  ];
}

function matchingKey(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLocaleLowerCase('en-IN');
}
