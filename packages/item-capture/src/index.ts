export interface CaptureUnitDefinition {
  id: string;
  capability: 'measure' | 'container' | 'both';
  dimensionId?: string;
  factorToBase?: number;
}

export type CaptureTemplateOperator =
  | { kind: 'literal'; values: readonly string[] }
  | { kind: 'number'; capture: string }
  | { kind: 'unit'; capture: string; role: 'measure' | 'container' | 'any' }
  | { kind: 'text'; capture: string; minTokens: number; maxTokens?: number }
  | { kind: 'optional'; operators: readonly CaptureTemplateOperator[] }
  | { kind: 'repeat'; operators: readonly CaptureTemplateOperator[]; max: number };

export interface CaptureRuntime {
  grammar: {
    templates: readonly {
      id: string;
      operators: readonly CaptureTemplateOperator[];
      defaults?: Readonly<Record<string, string | number>>;
    }[];
    separators: readonly string[];
    connectors: readonly string[];
    commandPrefixes: readonly string[];
  };
  numerals: ReadonlyMap<string, number>;
  unitAliases: ReadonlyMap<string, CaptureUnitDefinition>;
  maximumInputLength?: number;
  maximumTemplateSteps?: number;
}

export interface CaptureInterpretation {
  captureText: string;
  name: string;
  quantity: number | null;
  unit: string | null;
  packageSize: number | null;
  packageUnit: string | null;
  packageContainerUnit?: string;
  packQualifier?: string;
  packQualifierSpan?: { start: number; end: number };
  unitExplicit?: boolean;
}

export class InvalidCaptureError extends Error {}

interface SourceToken {
  raw: string;
  normalized: string;
  start: number;
  end: number;
}

interface CapturedValue {
  value: string | number | CaptureUnitDefinition;
  start: number;
  end: number;
}

interface MatchState {
  tokenIndex: number;
  captures: Readonly<Record<string, CapturedValue>>;
}

interface StepBudget { remaining: number; }

const DEFAULT_MAXIMUM_INPUT_LENGTH = 10_000;
const DEFAULT_MAXIMUM_TEMPLATE_STEPS = 50_000;
const MAXIMUM_EXPANDED_TEMPLATES = 512;

export function normalizeItemName(name: string): string {
  return normalizeDisplayName(name).toLowerCase();
}

export function interpretCapture(input: string, runtime: CaptureRuntime): CaptureInterpretation {
  if (!runtime) throw new InvalidCaptureError('Semantic runtime is required');
  const captureText = input.trim();
  if (!captureText || captureText.length > (runtime.maximumInputLength ?? DEFAULT_MAXIMUM_INPUT_LENGTH)) {
    throw new InvalidCaptureError('Capture is not valid');
  }
  const body = removeCommandPrefix(captureText, runtime.grammar.commandPrefixes);
  const tokens = tokenize(body.text, body.offset);
  if (tokens.length === 0) throw new InvalidCaptureError('Capture is not valid');
  const budget: StepBudget = {
    remaining: runtime.maximumTemplateSteps ?? DEFAULT_MAXIMUM_TEMPLATE_STEPS,
  };

  let best: { interpretation: CaptureInterpretation; score: number } | null = null;
  for (const template of runtime.grammar.templates) {
    const expanded = expandOperators(template.operators);
    for (const operators of expanded) {
      const result = matchOperators(operators, tokens, body.text, body.offset, runtime, budget);
      if (result) {
        const captures = applyDefaults(result.captures, template.defaults, runtime);
        const interpretation = interpretationFromMatch(captureText, captures, tokens, body.text);
        if (hasNumericIdentityConflict(interpretation, captures, captureText)) continue;
        const score = interpretationScore(interpretation, captures);
        if (!best || score > best.score) best = { interpretation, score };
      }
    }
  }
  if (best) return best.interpretation;
  throw new InvalidCaptureError('Capture is not valid');
}

function interpretationScore(
  interpretation: CaptureInterpretation,
  captures: Readonly<Record<string, CapturedValue>>,
): number {
  return (interpretation.quantity === null ? 0 : 2)
    + (interpretation.unit === null ? 0 : 2)
    + (interpretation.packageSize === null ? 0 : 4)
    + (interpretation.packageContainerUnit ? 1 : 0)
    + (captures.unit && captures.unit.end > captures.unit.start ? 1 : 0);
}

function applyDefaults(
  captures: Readonly<Record<string, CapturedValue>>,
  defaults: Readonly<Record<string, string | number>> | undefined,
  runtime: CaptureRuntime,
): Readonly<Record<string, CapturedValue>> {
  const result = { ...captures };
  for (const [capture, value] of Object.entries(defaults ?? {})) {
    if (result[capture]) continue;
    if (capture.toLowerCase().includes('unit') && typeof value === 'string') {
      const unit = [...runtime.unitAliases.values()].find((candidate) => candidate.id === value);
      if (!unit) throw new InvalidCaptureError(`Capture grammar references unknown unit ${value}`);
      result[capture] = { value: unit, start: 0, end: 0 };
    } else {
      result[capture] = { value, start: 0, end: 0 };
    }
  }
  return result;
}

function hasNumericIdentityConflict(
  interpretation: CaptureInterpretation,
  captures: Readonly<Record<string, CapturedValue>>,
  captureText: string,
): boolean {
  const quantity = captures.quantity;
  const unit = captures.unit;
  const unsupportedWordCount = Boolean(
    quantity
    && quantity.end > quantity.start
    && !/[\p{N}]/u.test(captureText.slice(quantity.start, quantity.end))
    && interpretation.unit === null
    && interpretation.packageSize === null,
  );
  return unsupportedWordCount || /\d/u.test(interpretation.name)
    && Boolean(quantity && unit && quantity.end === unit.start)
    || Boolean(quantity && quantity.end > quantity.start
      && captures.itemName && quantity.end === captures.itemName.start);
}

function interpretationFromMatch(
  captureText: string,
  captures: Readonly<Record<string, CapturedValue>>,
  tokens: readonly SourceToken[],
  bodyText: string,
): CaptureInterpretation {
  const nameCapture = captures.itemName;
  if (!nameCapture || typeof nameCapture.value !== 'string') throw new InvalidCaptureError('Capture is not valid');
  const name = normalizeDisplayName(nameCapture.value)
    .replace(/^[\p{P}\p{S}]+|[\p{P}\p{S}]+$/gu, '')
    .trim();
  if (!name || (tokens.length === 1 && numericValue(tokens[0].raw) !== null)) {
    throw new InvalidCaptureError('Capture is not valid');
  }
  const quantity = capturedNumber(captures.quantity);
  const packageSize = capturedNumber(captures.packageSize);
  if ((quantity !== null && (!Number.isFinite(quantity) || quantity <= 0))
    || (packageSize !== null && (!Number.isFinite(packageSize) || packageSize <= 0))) {
    throw new InvalidCaptureError('Capture is not valid');
  }
  const unitCapture = captures.unit;
  const unit = capturedUnit(unitCapture);
  const packageUnit = capturedUnit(captures.packageUnit);
  const packageContainerUnit = capturedUnit(captures.packageContainer);
  const packQualifier = capturedText(captures.packQualifier);
  const packQualifierCapture = captures.packQualifier;
  if ((packageSize === null) !== (packageUnit === null)) throw new InvalidCaptureError('Capture is not valid');
  if (bodyText.length > 0 && !/[\p{L}\p{N}]/u.test(name)) throw new InvalidCaptureError('Capture is not valid');
  return {
    captureText,
    name,
    quantity,
    unit: unitCapture && unitCapture.start === 0 && unitCapture.end === 0 && packageContainerUnit
      ? packageContainerUnit
      : unit,
    ...(unitCapture && unitCapture.start === 0 && unitCapture.end === 0 ? { unitExplicit: false } : {}),
    packageSize,
    packageUnit,
    ...(packageContainerUnit ? { packageContainerUnit } : {}),
    ...(packQualifier ? { packQualifier } : {}),
    ...(packQualifier && packQualifierCapture
      ? { packQualifierSpan: { start: packQualifierCapture.start, end: packQualifierCapture.end } }
      : {}),
  };
}

function capturedNumber(capture: CapturedValue | undefined): number | null {
  return typeof capture?.value === 'number' ? capture.value : null;
}

function capturedUnit(capture: CapturedValue | undefined): string | null {
  return capture && typeof capture.value === 'object' ? capture.value.id : null;
}

function capturedText(capture: CapturedValue | undefined): string | null {
  return capture && typeof capture.value === 'string' ? normalizeDisplayName(capture.value) : null;
}

function matchOperators(
  operators: readonly CaptureTemplateOperator[],
  tokens: readonly SourceToken[],
  bodyText: string,
  bodyOffset: number,
  runtime: CaptureRuntime,
  budget: StepBudget,
): MatchState | null {
  const matchFrom = (
    operatorIndex: number,
    tokenIndex: number,
    captures: Readonly<Record<string, CapturedValue>>,
  ): MatchState | null => {
    budget.remaining -= 1;
    if (budget.remaining < 0) throw new InvalidCaptureError('Capture exceeds semantic matching limits');
    if (operatorIndex === operators.length) {
      return tokenIndex === tokens.length ? { tokenIndex, captures } : null;
    }
    const operator = operators[operatorIndex];
    if (operator.kind === 'number') {
      const number = matchNumber(tokens, tokenIndex, runtime.numerals);
      if (!number) return null;
      return matchFrom(operatorIndex + 1, number.nextIndex, {
        ...captures,
        [operator.capture]: { value: number.value, start: tokens[tokenIndex].start, end: tokens[number.nextIndex - 1].end },
      });
    }
    if (operator.kind === 'unit') {
      const token = tokens[tokenIndex];
      if (!token) return null;
      const unit = runtime.unitAliases.get(token.normalized);
      if (!unit || !unitHasRole(unit, operator.role)) return null;
      return matchFrom(operatorIndex + 1, tokenIndex + 1, {
        ...captures,
        [operator.capture]: { value: unit, start: token.start, end: token.end },
      });
    }
    if (operator.kind === 'literal') {
      for (const literal of operator.values) {
        const literalTokens = tokenize(literal, 0).map((token) => token.normalized);
        if (literalTokens.length === 0) continue;
        const matches = literalTokens.every((value, index) => tokens[tokenIndex + index]?.normalized === value);
        if (!matches) continue;
        const result = matchFrom(operatorIndex + 1, tokenIndex + literalTokens.length, captures);
        if (result) return result;
      }
      return null;
    }
    if (operator.kind === 'text') {
      const maximum = Math.min(
        operator.maxTokens ?? tokens.length - tokenIndex,
        tokens.length - tokenIndex,
      );
      for (let length = maximum; length >= operator.minTokens; length -= 1) {
        const first = tokens[tokenIndex];
        const last = tokens[tokenIndex + length - 1];
        if (!first || !last) continue;
        const localStart = first.start - bodyOffset;
        const localEnd = last.end - bodyOffset;
        const value = bodyText.slice(localStart, localEnd);
        const result = matchFrom(operatorIndex + 1, tokenIndex + length, {
          ...captures,
          [operator.capture]: { value, start: first.start, end: last.end },
        });
        if (result) return result;
      }
    }
    return null;
  };
  return matchFrom(0, 0, {});
}

function expandOperators(operators: readonly CaptureTemplateOperator[]): CaptureTemplateOperator[][] {
  let expansions: CaptureTemplateOperator[][] = [[]];
  for (const operator of operators) {
    if (operator.kind === 'optional') {
      const included = expandOperators(operator.operators);
      expansions = expansions.flatMap((prefix) => [
        ...included.map((suffix) => [...prefix, ...suffix]),
        prefix,
      ]);
    } else if (operator.kind === 'repeat') {
      const repeated = expandOperators(operator.operators);
      const next: CaptureTemplateOperator[][] = [];
      for (const prefix of expansions) {
        next.push(prefix);
        let sequences: CaptureTemplateOperator[][] = [[]];
        for (let count = 1; count <= operator.max; count += 1) {
          sequences = sequences.flatMap((sequence) => repeated.map((entry) => [...sequence, ...entry]));
          next.push(...sequences.map((sequence) => [...prefix, ...sequence]));
          if (next.length > MAXIMUM_EXPANDED_TEMPLATES) throw new InvalidCaptureError('Capture grammar is too large');
        }
      }
      expansions = next;
    } else {
      expansions = expansions.map((prefix) => [...prefix, operator]);
    }
    if (expansions.length > MAXIMUM_EXPANDED_TEMPLATES) throw new InvalidCaptureError('Capture grammar is too large');
  }
  return expansions;
}

function matchNumber(
  tokens: readonly SourceToken[],
  tokenIndex: number,
  numerals: ReadonlyMap<string, number>,
): { value: number; nextIndex: number } | null {
  const direct = tokens[tokenIndex] ? numericValue(tokens[tokenIndex].raw) : null;
  if (direct !== null) return { value: direct, nextIndex: tokenIndex + 1 };
  const entries = [...numerals.entries()]
    .map(([text, value]) => ({ tokens: tokenize(text, 0).map((token) => token.normalized), value }))
    .sort((left, right) => right.tokens.length - left.tokens.length);
  for (const entry of entries) {
    if (entry.tokens.every((token, index) => tokens[tokenIndex + index]?.normalized === token)) {
      return { value: entry.value, nextIndex: tokenIndex + entry.tokens.length };
    }
  }
  return null;
}

function numericValue(value: string): number | null {
  if (/^[+-]?(?:infinity|nan)$/iu.test(value)) return Number(value);
  if (/^[+-]?\d+\/\d+$/u.test(value)) {
    const [numerator, denominator] = value.split('/').map(Number);
    return denominator === 0 ? Number.NaN : numerator / denominator;
  }
  if (/^[+-]?\d+(?:\.\d+)?$/u.test(value)) return Number(value);
  return null;
}

function unitHasRole(unit: CaptureUnitDefinition, role: 'measure' | 'container' | 'any'): boolean {
  if (role === 'any') return true;
  if (role === 'container') return unit.capability === 'container' || unit.capability === 'both';
  return unit.capability === 'measure' || unit.capability === 'both';
}

function removeCommandPrefix(text: string, prefixes: readonly string[]): { text: string; offset: number } {
  const normalized = text.normalize('NFKC').toLowerCase();
  const matches = prefixes
    .map((prefix) => prefix.trim())
    .filter(Boolean)
    .filter((prefix) => {
      const candidate = prefix.normalize('NFKC').toLowerCase();
      return normalized === candidate || normalized.startsWith(`${candidate} `);
    })
    .sort((left, right) => right.length - left.length);
  const prefix = matches[0];
  if (!prefix) return { text, offset: 0 };
  let offset = prefix.length;
  while (/\s/u.test(text[offset] ?? '')) offset += 1;
  return { text: text.slice(offset), offset };
}

function tokenize(text: string, offset: number): SourceToken[] {
  const tokens: SourceToken[] = [];
  // Keep letter-led model names such as "B12" intact. Numeric-led values such
  // as "500g" deliberately remain two tokens so quantity/measure templates can
  // still recognise them without requiring whitespace.
  const pattern = /[+-]?\d+\/\d+|[+-]?\d+(?:\.\d+)?|[xX](?=\d)|[\p{L}][\p{L}\p{M}\p{N}]*|×|[^\s]/gu;
  for (const match of text.matchAll(pattern)) {
    const raw = match[0];
    if (/^[\p{P}]+$/u.test(raw)) continue;
    const start = offset + (match.index ?? 0);
    tokens.push({ raw, normalized: raw.normalize('NFKC').toLowerCase(), start, end: start + raw.length });
  }
  return tokens;
}

function normalizeDisplayName(name: string): string {
  return name.trim().replace(/\s+/gu, ' ');
}
