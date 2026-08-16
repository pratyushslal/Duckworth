import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { Observable } from 'rxjs';

export interface CloudAssistSuggestion {
  itemName: string;
  quantity: number | null;
  unit: string | null;
  measures: Array<{ value: number; unit: string; role: string }>;
  attributes: Record<string, string>;
  rationale: string;
}

export interface CloudAssistLookupResult {
  suggestion: CloudAssistSuggestion | null;
  source?: string;
  acceptanceToken?: string;
  expiresAt?: string;
  requiresUserConfirmation: true;
}

@Injectable({ providedIn: 'root' })
export class CloudAssistService {
  private readonly http = inject(HttpClient);

  suggest(householdId: string, text: string, trigger: 'manual' | 'on_idle' | 'save' | 'typing', captureRevision = 0): Observable<CloudAssistLookupResult> {
    return this.http.post<CloudAssistLookupResult>(
      `/api/v1/households/${encodeURIComponent(householdId)}/cloud-assist`,
      { text, trigger, captureRevision },
    );
  }

  accept(householdId: string, token: string, text: string): Observable<{ suggestion: CloudAssistSuggestion; source: string; expiresAt: string }> {
    return this.http.post<{ suggestion: CloudAssistSuggestion; source: string; expiresAt: string }>(
      `/api/v1/households/${encodeURIComponent(householdId)}/cloud-assist/${encodeURIComponent(token)}/accept`,
      { text },
    );
  }
}
