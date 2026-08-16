import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { Observable } from 'rxjs';

export interface HouseholdSuggestion {
  itemIdentityKey: string;
  message: string;
  sourceEventIds: string[];
}

export interface SuggestionFeedback {
  itemIdentityKey: string;
  status: 'accepted' | 'dismissed' | 'restored';
}

export interface LearnedSemanticEntry {
  id: string;
  householdId: string;
  kind: string;
  value: Record<string, string | number>;
  supportingEventIds: string[];
  status: 'active' | 'suppressed' | 'cleared';
}

export interface HouseholdQualityMetrics {
  correctionCount: number;
  undoCount: number;
  activeLearningCount: number;
  suppressedLearningCount: number;
  unresolvedCount: number;
  conflictCount: number;
}

export interface SemanticCorrectionRecord {
  id: string;
  itemId: string;
  inverseOfEventId: string | null;
  source: { captureInputId: string; operationIndex: number; sourceStart: number; sourceEnd: number; rawClause: string };
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  changedFields: string[];
  createdAt: string;
}

export interface LearningControl {
  householdId: string;
  overlayRevision: number;
  entries: LearnedSemanticEntry[];
  corrections: SemanticCorrectionRecord[];
  metrics: HouseholdQualityMetrics;
}

@Injectable({ providedIn: 'root' })
export class HouseholdLearningService {
  private readonly http = inject(HttpClient);

  list(householdId: string): Observable<HouseholdSuggestion[]> {
    return this.http.get<HouseholdSuggestion[]>(this.url(householdId));
  }

  accept(householdId: string, identityKey: string): Observable<SuggestionFeedback> {
    return this.feedback(householdId, identityKey, 'accept');
  }

  dismiss(householdId: string, identityKey: string): Observable<SuggestionFeedback> {
    return this.feedback(householdId, identityKey, 'dismiss');
  }

  restore(householdId: string, identityKey: string): Observable<SuggestionFeedback> {
    return this.feedback(householdId, identityKey, 'restore');
  }

  learned(householdId: string): Observable<LearnedSemanticEntry[]> {
    return this.http.get<LearnedSemanticEntry[]>(`/api/v1/households/${encodeURIComponent(householdId)}/learning`);
  }

  setLearnedStatus(householdId: string, id: string, status: LearnedSemanticEntry['status']): Observable<LearnedSemanticEntry> {
    return this.http.patch<LearnedSemanticEntry>(
      `/api/v1/households/${encodeURIComponent(householdId)}/learning/${encodeURIComponent(id)}`,
      { status },
    );
  }

  control(householdId: string): Observable<LearningControl> {
    return this.http.get<LearningControl>(`/api/v2/households/${encodeURIComponent(householdId)}/learning-control`);
  }

  quality(householdId: string): Observable<HouseholdQualityMetrics> {
    return this.http.get<HouseholdQualityMetrics>(`/api/v2/households/${encodeURIComponent(householdId)}/diagnostics/quality`);
  }

  undoCorrection(householdId: string, eventId: string): Observable<{ eventId: string; inverseOfEventId: string }> {
    return this.http.post<{ eventId: string; inverseOfEventId: string }>(
      `/api/v2/households/${encodeURIComponent(householdId)}/semantic-corrections/${encodeURIComponent(eventId)}/undo`,
      {},
    );
  }

  private feedback(
    householdId: string,
    identityKey: string,
    action: 'accept' | 'dismiss' | 'restore',
  ): Observable<SuggestionFeedback> {
    return this.http.post<SuggestionFeedback>(
      `${this.url(householdId)}/${encodeURIComponent(identityKey)}/${action}`,
      {},
    );
  }

  private url(householdId: string): string {
    return `/api/v1/households/${encodeURIComponent(householdId)}/suggestions`;
  }
}
