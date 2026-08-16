export interface SuggestionRequest {
  input: string;
  activeLocale: string;
  enabledLocales: readonly string[];
  limit?: number;
}

export interface CaptureSuggestion {
  text: string;
  source: 'personal' | 'household' | 'regional-product' | 'active-locale' | 'fallback-locale';
  kind: 'completion' | 'history' | 'correction';
  canonicalId?: string;
  productId?: string;
  brandId?: string;
  conceptId?: string;
}

export interface SemanticSuggestion extends CaptureSuggestion {
  suggestionId: string;
  replacement: { start: number; end: number; replacementText: string };
  protectedPrefix: string;
  protectedSuffix: string;
  acceptanceReference: string;
  originalText?: string;
}

export interface AssistanceVocabularyEntry {
  text: string;
  locale: string;
  aliases?: readonly string[];
  redirects?: readonly string[];
  canonicalId?: string;
  productId?: string;
  brandId?: string;
  conceptId?: string;
  confirmedAt?: string;
  kind?: 'item' | 'unit' | 'capture';
}

export interface SpellingObservation {
  text: string;
  locale: string;
}

export interface ClarificationCandidate {
  earlier: string;
  later: string;
  locale: string;
  confidence: number;
}

export interface SpellingSuppression {
  locale: string;
  first: string;
  second: string;
}

export interface AssistanceSources {
  personal: readonly AssistanceVocabularyEntry[];
  household: readonly AssistanceVocabularyEntry[];
  regional?: readonly AssistanceVocabularyEntry[];
  locale: readonly AssistanceVocabularyEntry[];
  observations?: readonly SpellingObservation[];
  suppressions?: readonly SpellingSuppression[];
}

const assistanceIndexSources: unique symbol = Symbol('assistanceIndexSources');
const assistanceIndexCompiled: unique symbol = Symbol('assistanceIndexCompiled');

const MAX_INDEXED_PREFIX_LENGTH = 4;
const FUZZY_PREFIX_LENGTH = 2;

interface CompiledEntry {
  readonly entry: AssistanceVocabularyEntry;
  readonly localeKey: string;
  readonly values: readonly string[];
  readonly tokens: readonly string[];
}

interface CompiledSource {
  readonly entries: readonly CompiledEntry[];
  readonly prefixBuckets: ReadonlyMap<string, ReadonlyMap<string, readonly number[]>>;
  readonly tokenBuckets: ReadonlyMap<string, ReadonlyMap<string, readonly number[]>>;
  readonly fuzzyBuckets: ReadonlyMap<string, ReadonlyMap<string, readonly number[]>>;
}

interface CompiledSources {
  readonly personal: CompiledSource;
  readonly household: CompiledSource;
  readonly regional: CompiledSource;
  readonly locale: CompiledSource;
}

export interface AssistanceIndex {
  readonly [assistanceIndexSources]: AssistanceSources;
  readonly [assistanceIndexCompiled]: CompiledSources;
}

function matchingKey(value: string, locale: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLocaleLowerCase(locale);
}

function freezeMap<T>(map: Map<string, T>): ReadonlyMap<string, T> {
  return map;
}

function compileSource(entries: readonly AssistanceVocabularyEntry[]): CompiledSource {
  const compiledEntries = entries.map((entry) => {
    const localeKey = entry.locale;
    const values = [entry.text, ...(entry.aliases ?? []), ...(entry.redirects ?? [])]
      .map((value) => matchingKey(value, localeKey))
      .filter(Boolean);
    const tokens = matchingKey(entry.text, localeKey).split(' ').filter(Boolean);
    return Object.freeze({ entry, localeKey, values: Object.freeze(values), tokens: Object.freeze(tokens) });
  });
  const prefixBuckets = new Map<string, Map<string, number[]>>();
  const tokenBuckets = new Map<string, Map<string, number[]>>();
  const fuzzyBuckets = new Map<string, Map<string, number[]>>();
  const add = (buckets: Map<string, Map<string, number[]>>, locale: string, key: string, index: number): void => {
    const byKey = buckets.get(locale) ?? new Map<string, number[]>();
    const indexes = byKey.get(key) ?? [];
    if (!indexes.includes(index)) indexes.push(index);
    byKey.set(key, indexes);
    buckets.set(locale, byKey);
  };
  compiledEntries.forEach((compiled, index) => {
    compiled.values.forEach((value) => {
      const maximum = Math.min(MAX_INDEXED_PREFIX_LENGTH, Array.from(value).length);
      for (let length = 1; length <= maximum; length += 1) {
        add(prefixBuckets, compiled.localeKey, value.slice(0, length), index);
      }
      const fuzzyPrefix = Array.from(value).slice(0, FUZZY_PREFIX_LENGTH).join('');
      add(fuzzyBuckets, compiled.localeKey, `${fuzzyPrefix}|${Array.from(value).length}`, index);
    });
    compiled.tokens.forEach((token) => {
      const maximum = Math.min(MAX_INDEXED_PREFIX_LENGTH, Array.from(token).length);
      for (let length = 1; length <= maximum; length += 1) {
        add(tokenBuckets, compiled.localeKey, token.slice(0, length), index);
      }
    });
  });
  const freezeBuckets = (buckets: Map<string, Map<string, number[]>>): ReadonlyMap<string, ReadonlyMap<string, readonly number[]>> => (
    freezeMap(new Map([...buckets.entries()].map(([locale, values]) => [
      locale,
      freezeMap(new Map([...values.entries()].map(([key, indexes]) => [key, Object.freeze([...indexes])]))),
    ])))
  );
  return Object.freeze({
    entries: Object.freeze(compiledEntries),
    prefixBuckets: freezeBuckets(prefixBuckets),
    tokenBuckets: freezeBuckets(tokenBuckets),
    fuzzyBuckets: freezeBuckets(fuzzyBuckets),
  });
}

function compiledCandidates(
  source: CompiledSource,
  input: string,
  locale: string,
  tokenAware = false,
): readonly CompiledEntry[] {
  const key = matchingKey(input, locale);
  if (!key) return [];
  const buckets = tokenAware ? source.tokenBuckets : source.prefixBuckets;
  const byLocale = buckets.get(locale);
  if (!byLocale) return [];
  const lookupBase = tokenAware ? (key.split(' ').at(-1) ?? key) : key;
  const lookupKey = Array.from(lookupBase).slice(0, MAX_INDEXED_PREFIX_LENGTH).join('');
  const fuzzyByLocale = source.fuzzyBuckets.get(locale) ?? new Map<string, readonly number[]>();
  const lookupPoints = Array.from(lookupBase);
  const fuzzyPrefix = lookupPoints.slice(0, FUZZY_PREFIX_LENGTH).join('');
  const fuzzyIndexes = [] as number[];
  for (let length = Math.max(1, lookupPoints.length - 2); length <= lookupPoints.length + 2; length += 1) {
    fuzzyIndexes.push(...(fuzzyByLocale.get(`${fuzzyPrefix}|${length}`) ?? []));
  }
  const indexes = [...new Set([...(byLocale.get(lookupKey) ?? []), ...fuzzyIndexes])];
  return indexes.map((index) => source.entries[index]).filter((entry): entry is CompiledEntry => Boolean(entry));
}

function compiledEntriesForLocales(
  source: CompiledSource,
  entries: readonly AssistanceVocabularyEntry[],
  input: string,
  localeFilter: (locale: string) => boolean,
  tokenAware = false,
): readonly AssistanceVocabularyEntry[] {
  const locales = [...new Set(entries.map((entry) => entry.locale).filter(localeFilter))];
  const candidates = locales.flatMap((locale) => compiledCandidates(source, input, locale, tokenAware).map(({ entry }) => entry));
  return [...new Map(candidates.map((entry) => [entry, entry])).values()];
}

type MatchClass = 0 | 1 | 2;

function damerauLevenshtein(left: string, right: string, maximumDistance = Number.POSITIVE_INFINITY): number {
  const leftPoints = Array.from(left);
  const rightPoints = Array.from(right);
  if (Math.abs(leftPoints.length - rightPoints.length) > maximumDistance) return maximumDistance + 1;
  const distance = Array.from(
    { length: leftPoints.length + 1 },
    () => Array<number>(rightPoints.length + 1).fill(0),
  );
  for (let row = 0; row <= leftPoints.length; row += 1) distance[row][0] = row;
  for (let column = 0; column <= rightPoints.length; column += 1) distance[0][column] = column;
  for (let row = 1; row <= leftPoints.length; row += 1) {
    let rowMinimum = Number.POSITIVE_INFINITY;
    for (let column = 1; column <= rightPoints.length; column += 1) {
      const substitution = leftPoints[row - 1] === rightPoints[column - 1] ? 0 : 1;
      distance[row][column] = Math.min(
        distance[row - 1][column] + 1,
        distance[row][column - 1] + 1,
        distance[row - 1][column - 1] + substitution,
      );
      if (row > 1 && column > 1
        && leftPoints[row - 1] === rightPoints[column - 2]
        && leftPoints[row - 2] === rightPoints[column - 1]) {
        distance[row][column] = Math.min(distance[row][column], distance[row - 2][column - 2] + 1);
      }
      rowMinimum = Math.min(rowMinimum, distance[row][column]);
    }
    if (rowMinimum > maximumDistance) return maximumDistance + 1;
  }
  return distance[leftPoints.length][rightPoints.length];
}

function matchClass(entry: AssistanceVocabularyEntry, input: string): MatchClass | null {
  const inputKey = matchingKey(input, entry.locale);
  if (!inputKey) return null;
  const candidateKeys = [entry.text, ...(entry.aliases ?? []), ...(entry.redirects ?? [])]
    .map((candidate) => matchingKey(candidate, entry.locale));
  if (candidateKeys.some((candidate) => candidate === inputKey)) return 0;
  if (candidateKeys.some((candidate) => candidate.startsWith(inputKey))) return 1;
  const maximumDistance = Array.from(inputKey).length >= 6 ? 2 : 1;
  if (Array.from(inputKey).length >= 4
    && candidateKeys.some((candidate) => damerauLevenshtein(candidate, inputKey, maximumDistance) <= maximumDistance)) return 2;
  return null;
}

function matchesRedirect(entry: AssistanceVocabularyEntry, input: string): boolean {
  if (!entry.redirects?.length) return false;
  return matchClass({ ...entry, text: entry.redirects[0], aliases: entry.redirects.slice(1), redirects: [] }, input) !== null;
}

function preservesQuantities(entry: AssistanceVocabularyEntry, input: string): boolean {
  if (entry.kind === 'capture') return true;
  if (entry.productId) return true;
  const suggestionQuantities = entry.text.match(/\d+(?:\.\d+)?/gu) ?? [];
  if (suggestionQuantities.length === 0) return true;
  const inputQuantities = input.match(/\d+(?:\.\d+)?/gu) ?? [];
  return suggestionQuantities.length === inputQuantities.length
    && suggestionQuantities.every((quantity, index) => quantity === inputQuantities[index]);
}

function projectEntries(
  entries: readonly AssistanceVocabularyEntry[],
  request: SuggestionRequest,
  source: CaptureSuggestion['source'],
  kind: CaptureSuggestion['kind'],
  localeFilter: (locale: string) => boolean,
): CaptureSuggestion[] {
  return entries
    .filter((entry) => entry.kind !== 'unit' && localeFilter(entry.locale) && preservesQuantities(entry, request.input))
    .map((entry) => ({ entry, match: matchClass(entry, request.input) }))
    .filter((candidate): candidate is { entry: AssistanceVocabularyEntry; match: MatchClass } => candidate.match !== null)
    .sort((left, right) => left.match - right.match
      || (source === 'household' ? (right.entry.confirmedAt ?? '').localeCompare(left.entry.confirmedAt ?? '') : 0)
      || (left.entry.canonicalId ?? '').localeCompare(right.entry.canonicalId ?? '')
      || matchingKey(left.entry.text, left.entry.locale).localeCompare(matchingKey(right.entry.text, right.entry.locale)))
    .map(({ entry, match }): CaptureSuggestion => ({
      text: entry.text,
      source,
      kind: match === 2 || (source === 'personal' && matchesRedirect(entry, request.input))
        ? 'correction'
        : entry.kind === 'capture' ? 'history' : kind,
      ...(entry.canonicalId ? { canonicalId: entry.canonicalId } : {}),
      ...(entry.productId ? { productId: entry.productId } : {}),
      ...(entry.brandId ? { brandId: entry.brandId } : {}),
      ...(entry.conceptId ? { conceptId: entry.conceptId } : {}),
    }));
}

function projectUnitEntries(
  entries: readonly AssistanceVocabularyEntry[],
  request: SuggestionRequest,
  source: Extract<CaptureSuggestion['source'], 'active-locale' | 'fallback-locale'>,
  localeFilter: (locale: string) => boolean,
): CaptureSuggestion[] {
  const trailingUnit = /^(.*\b\d+(?:\.\d+)?)\s+(\S+)\s*$/u.exec(request.input);
  if (!trailingUnit) return [];
  const prefix = trailingUnit[1].trim().replace(/\s+/gu, ' ');
  const unitInput = trailingUnit[2];
  return entries
    .filter((entry) => entry.kind === 'unit' && localeFilter(entry.locale))
    .map((entry) => ({ entry, match: matchClass(entry, unitInput) }))
    .filter((candidate): candidate is { entry: AssistanceVocabularyEntry; match: MatchClass } => candidate.match !== null)
    .sort((left, right) => left.match - right.match
      || (left.entry.canonicalId ?? '').localeCompare(right.entry.canonicalId ?? '')
      || matchingKey(left.entry.text, left.entry.locale).localeCompare(matchingKey(right.entry.text, right.entry.locale)))
    .map(({ entry }): CaptureSuggestion => ({
      text: `${prefix} ${entry.text}`,
      source,
      kind: 'completion',
      ...(entry.canonicalId ? { canonicalId: entry.canonicalId } : {}),
    }));
}

export function createAssistanceIndex(sources: AssistanceSources): AssistanceIndex {
  return {
    [assistanceIndexSources]: sources,
    [assistanceIndexCompiled]: {
      personal: compileSource(sources.personal),
      household: compileSource(sources.household),
      regional: compileSource(sources.regional ?? []),
      locale: compileSource(sources.locale),
    },
  };
}

export interface AssistanceIndexStats {
  records: number;
  prefixBuckets: number;
  tokenBuckets: number;
}

export function assistanceIndexStats(index: AssistanceIndex): AssistanceIndexStats {
  const compiled = index[assistanceIndexCompiled];
  const all = [compiled.personal, compiled.household, compiled.regional, compiled.locale];
  return {
    records: all.reduce((total, source) => total + source.entries.length, 0),
    prefixBuckets: all.reduce((total, source) => total + [...source.prefixBuckets.values()].reduce((subtotal, values) => subtotal + values.size, 0), 0),
    tokenBuckets: all.reduce((total, source) => total + [...source.tokenBuckets.values()].reduce((subtotal, values) => subtotal + values.size, 0), 0),
  };
}

export function suggest(index: AssistanceIndex, request: SuggestionRequest): CaptureSuggestion[] {
  const input = matchingKey(request.input, request.activeLocale);
  if (!input) return [];
  const limit = Math.max(0, Math.min(request.limit ?? 5, 5));
  const sources = index[assistanceIndexSources];
  const compiled = index[assistanceIndexCompiled];
  const enabled = (locale: string) => request.enabledLocales.includes(locale);
  const ranked = [
    ...rankedEntries(sources.personal, request, 'personal', 'completion', enabled, 0, compiled.personal),
    ...rankedEntries(sources.household, request, 'household', 'history', enabled, 1, compiled.household),
    ...rankedEntries(sources.regional ?? [], request, 'regional-product', 'completion', enabled, 2, compiled.regional),
    ...rankedEntries(sources.locale, request, 'active-locale', 'completion', (locale) => locale === request.activeLocale, 3, compiled.locale),
    ...projectUnitEntries(sources.locale, request, 'active-locale', (locale) => locale === request.activeLocale).map((suggestion) => ({ suggestion, match: 1 as MatchClass, sourceRank: 3, confirmedAt: undefined })),
    ...rankedEntries(sources.locale, request, 'fallback-locale', 'completion', (locale) => enabled(locale) && locale !== request.activeLocale, 4, compiled.locale),
    ...projectUnitEntries(sources.locale, request, 'fallback-locale', (locale) => enabled(locale) && locale !== request.activeLocale).map((suggestion) => ({ suggestion, match: 1 as MatchClass, sourceRank: 4, confirmedAt: undefined })),
  ];
  const seen = new Set<string>();
  return ranked.sort((left, right) => left.match - right.match || left.sourceRank - right.sourceRank
    || (left.suggestion.source === 'household' && right.suggestion.source === 'household'
      ? (right.confirmedAt ?? '').localeCompare(left.confirmedAt ?? '') : 0)
    || (left.suggestion.canonicalId ?? '').localeCompare(right.suggestion.canonicalId ?? '')).map(({ suggestion }) => suggestion).filter((suggestion) => {
    const key = matchingKey(suggestion.text, request.activeLocale);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, limit);
}

function rankedEntries(
  entries: readonly AssistanceVocabularyEntry[],
  request: SuggestionRequest,
  source: CaptureSuggestion['source'],
  kind: CaptureSuggestion['kind'],
  localeFilter: (locale: string) => boolean,
  sourceRank: number,
  compiled?: CompiledSource,
): Array<{ suggestion: CaptureSuggestion; match: MatchClass; sourceRank: number; confirmedAt?: string }> {
  const candidates = compiled
    ? compiledEntriesForLocales(compiled, entries, request.input, localeFilter)
    : entries;
  return candidates
    .filter((entry) => entry.kind !== 'unit' && localeFilter(entry.locale) && preservesQuantities(entry, request.input))
    .map((entry) => ({ entry, match: matchClass(entry, request.input) }))
    .filter((candidate): candidate is { entry: AssistanceVocabularyEntry; match: MatchClass } => candidate.match !== null)
    .map(({ entry, match }) => ({
      match,
      sourceRank,
      confirmedAt: entry.confirmedAt,
      suggestion: {
        text: entry.text,
        source,
        kind: match === 2 || (source === 'personal' && matchesRedirect(entry, request.input)) ? 'correction' : entry.kind === 'capture' ? 'history' : kind,
        ...(entry.canonicalId ? { canonicalId: entry.canonicalId } : {}),
        ...(entry.productId ? { productId: entry.productId } : {}),
        ...(entry.brandId ? { brandId: entry.brandId } : {}),
        ...(entry.conceptId ? { conceptId: entry.conceptId } : {}),
      },
    }));
}

export function suggestSemantic(index: AssistanceIndex, request: SuggestionRequest): SemanticSuggestion[] {
  const limit = Math.max(0, Math.min(request.limit ?? 5, 5));
  const candidates = [...tokenAwareSuggestions(index[assistanceIndexSources], request, index[assistanceIndexCompiled]), ...suggest(index, request)];
  const seen = new Set<string>();
  return candidates.filter((suggestion) => {
    const key = [suggestion.productId, suggestion.canonicalId, suggestion.brandId, suggestion.conceptId, matchingKey(suggestion.text, request.activeLocale)].join('|');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, limit).map((suggestion) => {
    const edit = replacementForSuggestion(request.input, suggestion);
    const suggestionId = [suggestion.canonicalId, suggestion.productId, suggestion.brandId, suggestion.conceptId, suggestion.text]
      .filter(Boolean)
      .join('|');
    return {
      ...suggestion,
      suggestionId,
      replacement: edit,
      protectedPrefix: request.input.slice(0, edit.start),
      protectedSuffix: request.input.slice(edit.end),
      acceptanceReference: `local:${encodeURIComponent(suggestionId)}:${encodeURIComponent(request.input)}`,
      originalText: request.input,
    };
  });
}

function tokenAwareSuggestions(sources: AssistanceSources, request: SuggestionRequest, compiled?: CompiledSources): CaptureSuggestion[] {
  const numericStart = request.input.search(/[\p{N}]/u);
  const itemText = (numericStart < 0 ? request.input : request.input.slice(0, numericStart)).trim();
  const typed = itemText.split(/\s+/u).filter(Boolean).map((token) => matchingKey(token, request.activeLocale));
  if (typed.length < 2) return [];
  const entries: Array<{ entry: AssistanceVocabularyEntry; source: CaptureSuggestion['source'] }> = [
    ...((compiled ? compiledEntriesForLocales(compiled.regional, sources.regional ?? [], itemText, () => true, true) : sources.regional ?? [])
      .map((entry) => ({ entry, source: 'regional-product' as const }))),
    ...((compiled ? compiledEntriesForLocales(compiled.locale, sources.locale, itemText, (locale) => locale === request.activeLocale, true) : sources.locale.filter((entry) => entry.locale === request.activeLocale))
      .map((entry) => ({ entry, source: 'active-locale' as const }))),
    ...((compiled ? compiledEntriesForLocales(compiled.household, sources.household, itemText, (locale) => locale === request.activeLocale, true) : sources.household.filter((entry) => entry.locale === request.activeLocale))
      .map((entry) => ({ entry, source: 'household' as const }))),
  ];
  return entries.map(({ entry, source }) => {
    const candidate = entry.text.split(/\s+/u).filter(Boolean).map((token) => matchingKey(token, entry.locale));
    if (candidate.length < typed.length) return null;
    let score = 0;
    for (let index = 0; index < typed.length - 1; index += 1) {
      if (candidate[index] === typed[index]) continue;
      if (damerauLevenshtein(candidate[index], typed[index], 1) > 1) return null;
      score += 1;
    }
    const active = typed[typed.length - 1];
    if (!candidate[typed.length - 1].startsWith(active)) return null;
    score += candidate.length - typed.length;
    return { entry, source, score };
  }).filter((candidate): candidate is { entry: AssistanceVocabularyEntry; source: CaptureSuggestion['source']; score: number } => candidate !== null)
    .sort((left, right) => left.score - right.score || left.source.localeCompare(right.source) || left.entry.text.localeCompare(right.entry.text))
    .map(({ entry, source, score }) => ({
      text: entry.text,
      source,
      kind: score === 0 ? 'completion' : 'correction',
      ...(entry.canonicalId ? { canonicalId: entry.canonicalId } : {}),
      ...(entry.productId ? { productId: entry.productId } : {}),
      ...(entry.brandId ? { brandId: entry.brandId } : {}),
      ...(entry.conceptId ? { conceptId: entry.conceptId } : {}),
    }));
}

function replacementForSuggestion(input: string, suggestion: CaptureSuggestion): SemanticSuggestion['replacement'] {
  const numericStart = input.search(/[\p{N}]/u);
  const itemEnd = numericStart < 0 ? input.length : input.slice(0, numericStart).trimEnd().length;
  if (suggestion.source === 'active-locale' || suggestion.source === 'fallback-locale') {
    const unitMatch = /^(.*\b\d+(?:\.\d+)?)\s+(\S+)\s*$/u.exec(input);
    if (unitMatch && suggestion.kind === 'completion') {
      const start = unitMatch[1].length + 1;
      return { start, end: input.length, replacementText: suggestion.text.slice(start) || suggestion.text };
    }
  }
  return { start: 0, end: itemEnd, replacementText: suggestion.text };
}

export function detectClarification(
  index: AssistanceIndex,
  observation: SpellingObservation,
): ClarificationCandidate | null {
  const later = matchingKey(observation.text, observation.locale);
  if (Array.from(later).length < 5 || /\p{N}/u.test(later)) return null;
  const sources = index[assistanceIndexSources];
  const suppressedPairs = new Set((sources.suppressions ?? [])
    .filter((suppression) => suppression.locale === observation.locale)
    .map((suppression) => [
      matchingKey(suppression.first, suppression.locale),
      matchingKey(suppression.second, suppression.locale),
    ].sort().join('\u0000')));
  const matches = (sources.observations ?? [])
    .filter((earlier) => earlier.locale === observation.locale)
    .map((earlier) => {
      const earlierKey = matchingKey(earlier.text, earlier.locale);
      const distance = damerauLevenshtein(earlierKey, later);
      const confidence = 1 - (distance / Math.max(Array.from(earlierKey).length, Array.from(later).length));
      return { earlier, earlierKey, distance, confidence };
    })
    .filter((candidate) => Array.from(candidate.earlierKey).length >= 5
      && !/\p{N}/u.test(candidate.earlierKey)
      && candidate.earlierKey !== later
      && candidate.distance === 1
      && candidate.confidence >= 0.8
      && !suppressedPairs.has([candidate.earlierKey, later].sort().join('\u0000')));
  if (matches.length !== 1) return null;
  return {
    earlier: matches[0].earlier.text,
    later: observation.text,
    locale: observation.locale,
    confidence: matches[0].confidence,
  };
}
