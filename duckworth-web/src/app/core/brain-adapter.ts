import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { Observable } from 'rxjs';

export interface BrainCaptureEnvelope {
  schemaVersion: 2;
  inputId: string;
  householdId: string;
  contextId: string;
  shoppingListId: string;
  source: { kind: string; deviceId?: string; speakerId?: string };
  text: string;
  alternatives?: readonly { text: string; confidence?: number }[];
  locale: string;
  countryCode: string;
  occurredAt: string;
  idempotencyKey: string;
}

export interface BrainOutputFacts {
  saved: readonly unknown[];
  merged: readonly unknown[];
  drafts: readonly unknown[];
  undo: readonly { eventId: string; itemId: string }[];
  warnings: readonly { code: string; sourceStart?: number; sourceEnd?: number }[];
}

export interface BrainCaptureResponse {
  result?: unknown;
  facts: BrainOutputFacts;
  provenance?: { envelope: BrainCaptureEnvelope };
}

@Injectable({ providedIn: 'root' })
export class BrainAdapter {
  private readonly http = inject(HttpClient);

  capture(envelope: BrainCaptureEnvelope): Observable<BrainCaptureResponse> {
    return this.http.post<BrainCaptureResponse>(
      `/api/v2/households/${encodeURIComponent(envelope.householdId)}/brain/captures`,
      envelope,
    );
  }
}
