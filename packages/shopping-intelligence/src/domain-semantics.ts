import type { MeasureRole, SemanticMeasure, SemanticPackageLevel } from './contracts.js';
import type { CategoryDefinition, SemanticRuntime, UnitDefinition } from './semantic-runtime.js';

export interface DomainSemanticExtraction {
  itemName?: string;
  category?: CategoryDefinition;
  requested?: { quantity: number; unitId: string; start: number; end: number };
  legacyPackage?: { size: number; unitId: string };
  measures: readonly SemanticMeasure[];
  packaging: readonly SemanticPackageLevel[];
  attributes: Readonly<Record<string, string | number>>;
}

/**
 * Reconciles syntactic/domain candidates with the category resolved from the
 * item identity. A unit is evidence only; it is not allowed to keep a role
 * that the final category does not declare.
 */
export function reconcileDomainSemantics(
  extraction: DomainSemanticExtraction,
  category: CategoryDefinition | undefined,
  packageSize: number | null,
  packageUnit: string | null,
  runtime: SemanticRuntime,
): DomainSemanticExtraction {
  if (!category) return { ...extraction, measures: [], legacyPackage: undefined };

  const measures = extraction.measures.filter((measure) => measureAllowedByCategory(measure, category));
  const packageRole = packageUnit === null ? undefined : category.unitRoles?.[packageUnit];
  const packageUnitDefinition = packageUnit === null ? undefined : runtime.units.get(packageUnit);
  if (packageSize !== null && packageUnit !== null && (packageRole === 'net_content' || packageRole === 'contained_count')
    && packageUnitDefinition
    && !measures.some((measure) => measure.role === 'net_content'
      && measure.value.kind === 'scalar'
      && measure.value.amount.value === packageSize
      && measure.value.amount.unitId === packageUnit)) {
    measures.push({
      role: packageRole as 'net_content' | 'contained_count',
      scope: 'package',
      value: { kind: 'scalar', amount: toMeasurement(packageSize, packageUnitDefinition, runtime) },
      confidence: 'confirmed',
      evidence: [{ kind: 'grammar_rule', ref: 'package_measure' }],
    });
  }
  const legacyPackage = measures.find(({ role }) => role === 'net_content' || role === 'contained_count')?.value;
  return {
    ...extraction,
    category,
    ...(legacyPackage?.kind === 'scalar'
      ? { legacyPackage: { size: legacyPackage.amount.value, unitId: legacyPackage.amount.unitId } }
      : { legacyPackage: undefined }),
    measures: Object.freeze(measures),
  };
}

interface NumericUnitSpan {
  value: number;
  unit: UnitDefinition;
  start: number;
  end: number;
}

interface RatioUnitSpan {
  numerator: NumericUnitSpan;
  denominator: NumericUnitSpan;
  start: number;
  end: number;
}

/**
 * Extracts numeric meaning independently from sentence order. Unit semantics live in the
 * runtime's country category data; code only combines the data-owned candidates.
 */
export function extractDomainSemantics(text: string, runtime: SemanticRuntime): DomainSemanticExtraction {
  const spans = numericUnitSpans(text, runtime);
  const ratios = ratioUnitSpans(text, runtime);
  const category = chooseCategory(text, spans, runtime);
  if (!category) return { measures: [], packaging: [], attributes: {} };

  const roles = category.unitRoles ?? {};
  // A leading scalar measure is a request ("1.5 kg potatoes"); the same
  // measure after a product name remains a product/package fact ("Pudin
  // Hara 15 ml"). Containers remain requests wherever they occur.
  const requestedSpan = spans.find(({ unit }) => unit.capability === 'container' || unit.capability === 'both')
    ?? spans.find((span) => span.start === 0 && roles[span.unit.id] !== undefined);
  const leadingQuantity = bareLeadingQuantity(text, spans);
  const requested = requestedSpan
    ? { quantity: requestedSpan.value, unitId: requestedSpan.unit.id, start: requestedSpan.start, end: requestedSpan.end }
    : leadingQuantity
      ? { quantity: leadingQuantity.value, unitId: 'piece', start: 0, end: leadingQuantity.end }
      : undefined;
  const ratioMeasures = ratios
    .flatMap((ratio): SemanticMeasure[] => {
      const role = category.ratioRoles?.find((rule) => (
        rule.numeratorUnitIds.includes(ratio.numerator.unit.id)
        && rule.denominatorUnitIds.includes(ratio.denominator.unit.id)
      ))?.role as MeasureRole | undefined;
      if (!role) return [];
      return [{
        role,
        scope: 'product',
        value: {
          kind: 'ratio',
          numerator: toMeasurement(ratio.numerator.value, ratio.numerator.unit, runtime),
          denominator: toMeasurement(ratio.denominator.value, ratio.denominator.unit, runtime),
        },
        confidence: 'confirmed',
        evidence: [{ kind: 'source_span', sourceStart: ratio.start, sourceEnd: ratio.end }],
      }];
    });
  const measures = [
    ...ratioMeasures,
    ...spans
    .filter((span) => span !== requestedSpan && !ratios.some((ratio) => overlaps(span, ratio)))
    .flatMap((span): SemanticMeasure[] => {
      const role = roles[span.unit.id] as MeasureRole | undefined;
      if (!role) return [];
      return [{
        role,
        scope: role === 'net_content' || role === 'contained_count' ? 'package' : 'product',
        value: { kind: 'scalar', amount: toMeasurement(span.value, span.unit, runtime) },
        confidence: 'confirmed',
        evidence: [{ kind: 'source_span', sourceStart: span.start, sourceEnd: span.end }],
      }];
    }),
  ];
  const legacyPackage = measures.find(({ role }) => role === 'net_content')?.value;
  const extractedAttributes = extractAttributes(text, category);
  const itemName = residualItemName(text, [
    ...spans.map(({ start, end }) => ({ start, end })),
    ...ratios.map(({ start, end }) => ({ start, end })),
    ...(requested ? [{ start: requested.start, end: requested.end }] : []),
    ...extractedAttributes.ranges,
  ], category.discardConnectors ?? []);
  const containedSpan = spans.find((span) => roles[span.unit.id] === 'contained_count');
  return {
    ...(itemName ? { itemName } : {}),
    category,
    ...(requested ? { requested } : {}),
    ...(legacyPackage?.kind === 'scalar' ? { legacyPackage: { size: legacyPackage.amount.value, unitId: legacyPackage.amount.unitId } } : {}),
    measures: Object.freeze(measures),
    packaging: requested && requestedSpan?.unit.capability === 'container'
      ? Object.freeze([{
        containerUnitId: requested.unitId,
        ...(containedSpan ? {
          containedCount: confirmed(containedSpan.value, containedSpan.start, containedSpan.end),
          containedUnitId: confirmed(containedSpan.unit.id, containedSpan.start, containedSpan.end),
        } : {}),
        evidence: [{ kind: 'source_span', sourceStart: requested.start, sourceEnd: requested.end }],
      }])
      : Object.freeze([]),
    attributes: Object.freeze(extractedAttributes.values),
  };
}

function numericUnitSpans(text: string, runtime: SemanticRuntime): NumericUnitSpan[] {
  const spans: NumericUnitSpan[] = [];
  for (const match of text.matchAll(/(?<![\p{L}\p{N}])(\d+(?:\.\d+)?)\s*([\p{L}%]+)(?![\p{L}\p{N}])/gu)) {
    const unit = runtime.unitAliases.get(normalize(match[2]));
    if (!unit) continue;
    spans.push({ value: Number(match[1]), unit, start: match.index ?? 0, end: (match.index ?? 0) + match[0].length });
  }
  return spans;
}

function ratioUnitSpans(text: string, runtime: SemanticRuntime): RatioUnitSpan[] {
  const ratios: RatioUnitSpan[] = [];
  for (const match of text.matchAll(/(?<![\p{L}\p{N}])(\d+(?:\.\d+)?)\s*([\p{L}%]+)\s*(?:\/|\bper\b)\s*(?:(\d+(?:\.\d+)?)\s*)?([\p{L}%]+)(?![\p{L}\p{N}])/giu)) {
    const numeratorUnit = runtime.unitAliases.get(normalize(match[2]));
    const denominatorUnit = runtime.unitAliases.get(normalize(match[4]));
    if (!numeratorUnit || !denominatorUnit) continue;
    const start = match.index ?? 0;
    ratios.push({
      numerator: { value: Number(match[1]), unit: numeratorUnit, start, end: start + match[0].indexOf(match[2]) + match[2].length },
      denominator: { value: match[3] ? Number(match[3]) : 1, unit: denominatorUnit, start, end: start + match[0].length },
      start,
      end: start + match[0].length,
    });
  }
  return ratios;
}

function chooseCategory(text: string, spans: readonly NumericUnitSpan[], runtime: SemanticRuntime): CategoryDefinition | undefined {
  const normalized = normalize(text);
  return [...runtime.categories.values()]
    .map((category) => ({
      category,
      score: category.signals.reduce((score, signal) => score + (containsPhrase(normalized, normalize(signal)) ? 1 : 0), 0)
        + spans.reduce((score, span) => score + (category.unitRoles?.[span.unit.id] ? 2 : 0), 0),
    }))
    .filter(({ score }) => score > 0)
    .sort((left, right) => right.score - left.score || left.category.id.localeCompare(right.category.id))[0]?.category;
}

function measureAllowedByCategory(measure: SemanticMeasure, category: CategoryDefinition): boolean {
  const value = measure.value;
  if (value.kind === 'scalar') return category.unitRoles?.[value.amount.unitId] === measure.role;
  return category.ratioRoles?.some((rule) => (
    rule.role === measure.role
    && rule.numeratorUnitIds.includes(value.numerator.unitId)
    && rule.denominatorUnitIds.includes(value.denominator.unitId)
  )) === true;
}

function bareLeadingQuantity(text: string, spans: readonly NumericUnitSpan[]): { value: number; end: number } | undefined {
  const match = text.match(/^\s*(\d+(?:\.\d+)?)(?=\s+\p{L})/u);
  if (!match) return undefined;
  const end = (match.index ?? 0) + match[0].length;
  if (spans.some((span) => span.start === (match.index ?? 0))) return undefined;
  return { value: Number(match[1]), end };
}

function residualItemName(text: string, ranges: readonly { start: number; end: number }[], discardConnectors: readonly string[]): string {
  // RegExp match offsets are UTF-16 code-unit indices, so retain the same indexing
  // representation while blanking matched spans.
  const characters = text.split('');
  ranges.forEach(({ start, end }) => {
    for (let index = start; index < end; index += 1) characters[index] = ' ';
  });
  const connectorPattern = discardConnectors.length > 0
    ? new RegExp(`\\b(?:${discardConnectors.map(escapeRegex).join('|')})\\b`, 'giu')
    : undefined;
  return characters.join('')
    .replace(connectorPattern ?? /$^/u, ' ')
    .replace(/[(),;:]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

function extractAttributes(text: string, category: CategoryDefinition): {
  values: Record<string, string | number>;
  ranges: { start: number; end: number }[];
} {
  const values: Record<string, string | number> = {};
  const ranges: { start: number; end: number }[] = [];
  for (const pattern of category.attributePatterns ?? []) {
    const matcher = new RegExp(pattern.expression, pattern.flags ?? 'iu');
    const match = matcher.exec(text);
    const value = match?.[pattern.valueGroup ?? 1]?.trim();
    if (!match || !value) continue;
    values[pattern.attributeId] = value;
    if (pattern.removeMatch) ranges.push({ start: match.index, end: match.index + match[0].length });
  }
  return { values, ranges };
}

function toMeasurement(value: number, unit: UnitDefinition, runtime: SemanticRuntime) {
  const base = unit.dimensionId
    ? [...runtime.units.values()].find((candidate) => candidate.dimensionId === unit.dimensionId && candidate.factorToBase === 1)
    : undefined;
  return unit.factorToBase === undefined
    ? { value, unitId: unit.id }
    : { value, unitId: unit.id, comparisonValue: value * unit.factorToBase, comparisonUnitId: base?.id ?? unit.id };
}

function normalize(value: string): string { return value.normalize('NFKC').toLocaleLowerCase(); }
function containsPhrase(value: string, phrase: string): boolean { return value === phrase || value.includes(`${phrase} `) || value.includes(` ${phrase}`); }
function escapeRegex(value: string): string { return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'); }
function overlaps(span: NumericUnitSpan, range: { start: number; end: number }): boolean { return span.start < range.end && range.start < span.end; }
function confirmed<T>(value: T, start: number, end: number) {
  return { value, confidence: 'confirmed' as const, evidence: [{ kind: 'source_span' as const, sourceStart: start, sourceEnd: end }] };
}
