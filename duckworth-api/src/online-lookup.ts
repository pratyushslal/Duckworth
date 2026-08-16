import type { CloudAssistSuggestion } from './cloud-assist.js';

export type OnlineLookupTrigger = 'manual' | 'on_idle';

export interface OnlineLookupRequest {
  phrase: string;
  locale: string;
  countryCode: string;
  trigger: OnlineLookupTrigger;
}

export interface OnlineLookupResult {
  providerId: string;
  candidate: CloudAssistSuggestion;
}

export interface OnlineLookupProvider {
  readonly id: string;
  readonly available: boolean;
  lookup(request: OnlineLookupRequest, signal: AbortSignal): Promise<CloudAssistSuggestion | null>;
}

/**
 * Server-owned, provider-neutral boundary. It makes remote lookup advisory,
 * bounded, and independently replaceable by licensed country catalog adapters.
 */
export class OnlineLookupRegistry {
  private readonly healthByProvider = new Map<string, { consecutiveFailures: number; circuitOpenUntil: number }>();

  constructor(
    private readonly providers: readonly OnlineLookupProvider[],
    private readonly now: () => number = Date.now,
    private readonly timeoutMilliseconds = 2_000,
  ) {}

  async lookup(request: OnlineLookupRequest): Promise<OnlineLookupResult | null> {
    for (const provider of this.providers) {
      if (!provider.available) continue;
      const health = this.healthByProvider.get(provider.id) ?? { consecutiveFailures: 0, circuitOpenUntil: 0 };
      if (this.now() < health.circuitOpenUntil) continue;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMilliseconds);
      try {
        const candidate = await provider.lookup(request, controller.signal);
        clearTimeout(timer);
        this.healthByProvider.set(provider.id, { consecutiveFailures: 0, circuitOpenUntil: 0 });
        return candidate ? { providerId: provider.id, candidate } : null;
      } catch {
        clearTimeout(timer);
        const consecutiveFailures = health.consecutiveFailures + 1;
        this.healthByProvider.set(provider.id, {
          consecutiveFailures,
          circuitOpenUntil: consecutiveFailures >= 3 ? this.now() + 30_000 : 0,
        });
      }
    }
    return null;
  }
}
