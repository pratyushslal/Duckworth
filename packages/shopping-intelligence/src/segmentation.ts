import type { SemanticRuntime, TemplateOperator } from './semantic-runtime.js';

export interface SourceSegment {
  text: string;
  start: number;
  end: number;
}

export function segmentCapture(text: string, runtime: SemanticRuntime): readonly SourceSegment[] {
  const trimmed = trimSpan(text, 0, text.length);
  if (!trimmed) return [];
  const referencePrefixes = new Set([
    ...(runtime.grammar.referencePrefixes ?? []),
    ...(runtime.grammar.correctionPrefixes ?? []),
  ].map(normalize));
  const withoutPrefix = removePrefix(
    trimmed,
    runtime.grammar.commandPrefixes.filter((prefix) => !referencePrefixes.has(normalize(prefix))),
  );
  if (!withoutPrefix) return [];
  const candidates = splitCandidates(text, withoutPrefix, runtime);
  const hasStrongSeparator = runtime.grammar.separators.some((separator) => (
    separator !== '-' && separator !== ':' && separator !== '(' && separator !== ')'
      && withoutPrefix.text.includes(separator)
  ));
  if (candidates.some((candidate) => isQuantityOnly(candidate.text, runtime))) {
    return Object.freeze([withoutPrefix]);
  }
  return candidates.length > 1 && (hasStrongSeparator || candidates.some((candidate) => isLikelyItem(candidate.text, runtime)))
    ? Object.freeze(candidates)
    : Object.freeze([withoutPrefix]);
}

function isQuantityOnly(text: string, runtime: SemanticRuntime): boolean {
  const tokens = text.normalize('NFKC').toLocaleLowerCase('und').split(/\s+/u).filter(Boolean);
  let hasNumber = false;
  const remaining = tokens.filter((token) => {
    const numeric = /^(?:\d+(?:[.,]\d+)?|[.,]\d+)$/u.test(token) || runtime.numerals.has(token);
    if (numeric) hasNumber = true;
    return !numeric;
  });
  return hasNumber && remaining.length > 0 && remaining.every((token) => runtime.unitAliases.has(token));
}

function splitCandidates(
  source: string,
  span: SourceSegment,
  runtime: SemanticRuntime,
): SourceSegment[] {
  const separators = runtime.grammar.separators
    .filter((separator) => separator.length > 0)
    .sort((left, right) => right.length - left.length);
  const connectorSeparators = runtime.grammar.connectors
    .filter((connector) => connector.length > 0)
    .sort((left, right) => right.length - left.length);
  const boundaries: Array<{ start: number; end: number }> = [];
  let index = span.start;
  while (index < span.end) {
    const separator = separators.find((candidate) => source.startsWith(candidate, index));
    if (separator && separator !== '-' && separator !== ':' && separator !== '(' && separator !== ')') {
      boundaries.push({ start: index, end: index + separator.length });
      index += separator.length;
      continue;
    }
    const connector = connectorSeparators.find((candidate) => {
      const before = index === span.start || /\s/u.test(source[index - 1]);
      const afterIndex = index + candidate.length;
      const after = afterIndex === span.end || /\s/u.test(source[afterIndex]);
      return before && after
        && source.slice(index, afterIndex).normalize('NFKC').toLowerCase()
          === candidate.normalize('NFKC').toLowerCase();
    });
    if (connector && shouldSplitConnector(connector, source, index, span, runtime)) {
      boundaries.push({ start: index, end: index + connector.length });
      index += connector.length;
      continue;
    }
    index += 1;
  }
  if (boundaries.length === 0) return [span];
  const segments: SourceSegment[] = [];
  let start = span.start;
  for (const boundary of boundaries) {
    const candidate = trimSpan(source, start, boundary.start);
    if (candidate) segments.push(candidate);
    start = boundary.end;
  }
  const last = trimSpan(source, start, span.end);
  if (last) segments.push(last);
  return segments;
}

function shouldSplitConnector(
  connector: string,
  source: string,
  index: number,
  span: SourceSegment,
  runtime: SemanticRuntime,
): boolean {
  const normalized = connector.normalize('NFKC').toLowerCase();
  const structuralLiterals = new Set(runtime.grammar.templates
    .flatMap((template) => collectLiterals(template.operators))
    .map((literal) => literal.normalize('NFKC').toLowerCase()));
  if (structuralLiterals.has(normalized)) return false;
  if (isInsideSemanticAttribute(source.slice(span.start, span.end), index - span.start, connector.length, runtime)) return false;
  const left = source.slice(span.start, index).trim();
  const right = source.slice(index + connector.length, span.end).trim();
  return isLikelyItem(left, runtime)
    || isLikelyItem(right, runtime)
    || (left.split(/\s+/u).length > 1 && right.split(/\s+/u).length > 1);
}

/**
 * Attribute phrases (for example "for iPhone 15") belong to the preceding item.
 * The country pack owns their grammar, preventing a new category from needing a
 * segmentation code change.
 */
function isInsideSemanticAttribute(text: string, connectorStart: number, connectorLength: number, runtime: SemanticRuntime): boolean {
  return [...runtime.categories.values()].some((category) => (category.attributePatterns ?? []).some((pattern) => {
    const match = new RegExp(pattern.expression, pattern.flags ?? 'iu').exec(text);
    if (!match || match.index === undefined) return false;
    const matchEnd = match.index + match[0].length;
    return match.index <= connectorStart && matchEnd >= connectorStart + connectorLength;
  }));
}

function collectLiterals(operators: readonly TemplateOperator[]): string[] {
  return operators.flatMap((operator) => {
    if (operator.kind === 'literal') return [...operator.values];
    if (operator.kind === 'optional' || operator.kind === 'repeat') {
      return collectLiterals(operator.operators);
    }
    return [];
  });
}

function isLikelyItem(text: string, runtime: SemanticRuntime): boolean {
  const normalized = text.normalize('NFKC').toLowerCase();
  if (runtime.concepts.byAlias.has(normalized) || runtime.products.byAlias.has(normalized)) return true;
  for (const alias of [...runtime.concepts.byAlias.keys(), ...runtime.products.byAlias.keys()]) {
    if (normalized.includes(alias)) return true;
  }
  for (const category of runtime.categories.values()) {
    if (category.signals.some((signal) => normalized.includes(signal.normalize('NFKC').toLowerCase()))) {
      return true;
    }
  }
  return /\d/u.test(text) && [...runtime.unitAliases.keys()].some((alias) => normalized.includes(alias));
}

function removePrefix(span: SourceSegment, prefixes: readonly string[]): SourceSegment | null {
  const normalized = span.text.normalize('NFKC').toLowerCase();
  const prefix = prefixes
    .filter((candidate) => normalized === candidate.normalize('NFKC').toLowerCase()
      || normalized.startsWith(`${candidate.normalize('NFKC').toLowerCase()} `))
    .sort((left, right) => right.length - left.length)[0];
  if (!prefix) return span;
  return trimSpan(span.text, prefix.length, span.text.length, span.start);
}

function normalize(text: string): string {
  return text.normalize('NFKC').toLocaleLowerCase('und').trim();
}

function trimSpan(source: string, start: number, end: number, base = 0): SourceSegment | null {
  while (start < end && /\s/u.test(source[start])) start += 1;
  while (end > start && /\s/u.test(source[end - 1])) end -= 1;
  if (start >= end) return null;
  return { text: source.slice(start, end), start: base + start, end: base + end };
}
