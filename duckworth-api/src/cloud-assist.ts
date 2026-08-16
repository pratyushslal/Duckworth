export interface CloudAssistSuggestion {
  itemName: string;
  quantity: number | null;
  unit: string | null;
  measures: Array<{ value: number; unit: string; role: string }>;
  attributes: Record<string, string>;
  rationale: string;
}

export interface CloudAssistClientOptions {
  apiKey?: string;
  model?: string;
  fetch?: typeof globalThis.fetch;
}

/**
 * Server-only OpenRouter adapter. It asks for a schema-bound suggestion, never
 * treats that suggestion as a committed shopping-item change, and requests a
 * zero-data-retention compatible provider path.
 */
export class CloudAssistClient {
  private readonly apiKey: string | undefined;
  private readonly model: string;
  private readonly fetcher: typeof globalThis.fetch;

  constructor(options: CloudAssistClientOptions = {}) {
    this.apiKey = options.apiKey?.trim();
    this.model = options.model?.trim() || 'openai/gpt-4.1-mini';
    this.fetcher = options.fetch ?? globalThis.fetch;
  }

  get available(): boolean { return Boolean(this.apiKey); }

  async suggest(text: string, signal?: AbortSignal): Promise<CloudAssistSuggestion | null> {
    if (!this.apiKey) return null;
    const response = await this.fetcher('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        'content-type': 'application/json',
      },
      ...(signal ? { signal } : {}),
      body: JSON.stringify({
        model: this.model,
        messages: [
          {
            role: 'system',
            content: 'Extract a shopping-item suggestion. Ignore filler and incorrect grammar. Do not infer a medicine dose as package size. Return only JSON matching the schema.',
          },
          { role: 'user', content: text },
        ],
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'shopping_item_suggestion',
            strict: true,
            schema: suggestionSchema,
          },
        },
        provider: { data_collection: 'deny', zdr: true, require_parameters: true },
        temperature: 0,
      }),
    });
    if (!response.ok) throw new CloudAssistProviderError(response.status);
    const payload = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const content = payload.choices?.[0]?.message?.content;
    if (!content) throw new CloudAssistProviderError(502);
    try {
      return validateSuggestion(JSON.parse(content));
    } catch (error) {
      if (error instanceof CloudAssistProviderError) throw error;
      throw new CloudAssistProviderError(502);
    }
  }
}

export class CloudAssistProviderError extends Error {
  constructor(readonly statusCode: number) { super('cloud_assist_provider_error'); }
}

const suggestionSchema = {
  type: 'object', additionalProperties: false,
  required: ['itemName', 'quantity', 'unit', 'measures', 'attributes', 'rationale'],
  properties: {
    itemName: { type: 'string', minLength: 1, maxLength: 160 },
    quantity: { type: ['number', 'null'], minimum: 0 },
    unit: { type: ['string', 'null'], maxLength: 40 },
    measures: {
      type: 'array', maxItems: 8,
      items: {
        type: 'object', additionalProperties: false, required: ['value', 'unit', 'role'],
        properties: { value: { type: 'number', minimum: 0 }, unit: { type: 'string', minLength: 1, maxLength: 40 }, role: { type: 'string', minLength: 1, maxLength: 60 } },
      },
    },
    attributes: { type: 'object', additionalProperties: { type: 'string', maxLength: 120 }, maxProperties: 12 },
    rationale: { type: 'string', maxLength: 320 },
  },
} as const;

function validateSuggestion(value: unknown): CloudAssistSuggestion {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new CloudAssistProviderError(502);
  const candidate = value as Partial<CloudAssistSuggestion>;
  if (typeof candidate.itemName !== 'string' || !candidate.itemName.trim()
    || (candidate.quantity !== null && (typeof candidate.quantity !== 'number' || !Number.isFinite(candidate.quantity)))
    || (candidate.unit !== null && typeof candidate.unit !== 'string')
    || !Array.isArray(candidate.measures) || !candidate.measures.every((measure) => (
      Number.isFinite(measure.value) && typeof measure.unit === 'string' && typeof measure.role === 'string'
    ))
    || !candidate.attributes || typeof candidate.attributes !== 'object' || Array.isArray(candidate.attributes)
    || typeof candidate.rationale !== 'string') {
    throw new CloudAssistProviderError(502);
  }
  return {
    itemName: candidate.itemName.trim(), quantity: candidate.quantity, unit: candidate.unit,
    measures: candidate.measures.map((measure) => ({ value: measure.value, unit: measure.unit, role: measure.role })),
    attributes: Object.fromEntries(Object.entries(candidate.attributes).filter(([, attribute]) => typeof attribute === 'string')),
    rationale: candidate.rationale,
  };
}
