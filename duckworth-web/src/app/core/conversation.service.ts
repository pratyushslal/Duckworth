import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { Observable } from 'rxjs';
import type { ShoppingItem } from './shopping-items.service';
import type { ContextRegistration } from './conversation-context.service';

export interface ConversationSession {
  id: string;
  householdId: string;
  shoppingListId?: string;
  contextId?: string | null;
  status: 'active' | 'idle' | 'close_pending' | 'closed';
  closedAt: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface ClarificationDraft {
  id: string;
  householdId: string;
  sessionId: string;
  text: string;
  reason: 'ambiguous_clause' | 'ambiguous_reference';
  status: 'open' | 'resolved' | 'dismissed';
  createdAt?: string;
  updatedAt?: string;
}

export interface UndoToken {
  eventId: string;
  itemId: string;
}

export interface CaptureAuditOperation {
  kind: 'create' | 'merge' | 'correct' | 'draft';
  itemName?: string;
  quantity?: number | null;
  unit?: string | null;
  packageSize?: number | null;
  packageUnit?: string | null;
  categoryId?: string | null;
  brandId?: string | null;
  targetItemId?: string;
  draftText?: string;
  reasonCode?: string;
}

export interface CaptureAudit {
  inputId: string;
  text: string;
  engineVersion: string;
  runtimeVersions: Record<string, string>;
  operations: CaptureAuditOperation[];
  warnings: Array<{ code: string; sourceStart?: number; sourceEnd?: number }>;
}

export interface ConversationCaptureResult {
  session: ConversationSession;
  pendingAction?: PendingConversationAction | null;
  saved: ShoppingItem[];
  merged: ShoppingItem[];
  drafts: ClarificationDraft[];
  undo: UndoToken[];
  captureAudit?: CaptureAudit;
}

export interface PendingConversationAction {
  id: string;
  householdId: string;
  shoppingListId: string;
  contextId: string;
  sessionId: string;
  type: 'close_session';
  origin: 'explicit_intent' | 'configured_idle_policy';
  previousStatus: 'active' | 'idle';
  status: 'pending' | 'confirmed' | 'cancelled' | 'expired';
  expiresAt: string;
  createdAt: string;
  resolvedAt: string | null;
}

export interface ConversationState {
  list: {
    id: string;
    householdId: string;
    name: string;
    status: 'active' | 'archived';
    isDefault: boolean;
    createdAt: string;
    updatedAt: string;
  };
  session: ConversationSession | null;
  pendingAction: PendingConversationAction | null;
  drafts: ClarificationDraft[];
}

export interface CaptureAuditExport {
  retention: { days: number };
  captures: CaptureAuditExportEntry[];
}

export interface CaptureAuditExportEntry {
  envelope: { inputId: string; text: string; householdId: string; [key: string]: unknown };
  result: unknown;
  committedEventIds: string[];
  createdAt: string;
  expiresAt: string;
  facts: unknown;
}

@Injectable({ providedIn: 'root' })
export class ConversationService {
  private readonly http = inject(HttpClient);

  capture(
    householdId: string,
    text: string,
    context?: ContextRegistration,
    source: 'text' | 'voice' | 'api' | 'assistant' = 'text',
    shoppingListId?: string,
    acceptedSuggestion?: {
      reference: string;
      originalText: string;
      replacement: { start: number; end: number; replacementText: string };
      productId?: string;
      conceptId?: string;
      brandId?: string;
    },
  ): Observable<ConversationCaptureResult> {
    return this.http.post<ConversationCaptureResult>(this.captureUrl(householdId), {
      text,
      source,
      ...(shoppingListId ? { shoppingListId } : {}),
      ...(acceptedSuggestion ? { acceptedSuggestion } : {}),
      ...(context ? {
        contextId: context.context.id,
        accessToken: context.accessToken,
        idempotencyKey: this.createIdempotencyKey(),
      } : {}),
    });
  }

  state(
    householdId: string,
    shoppingListId: string,
    context: ContextRegistration,
  ): Observable<ConversationState> {
    const params = new URLSearchParams({
      shoppingListId,
      contextId: context.context.id,
      accessToken: context.accessToken,
    });
    return this.http.get<ConversationState>(
      `${this.householdUrl(householdId)}/conversation-state?${params.toString()}`,
    );
  }

  confirmClose(
    householdId: string,
    actionId: string,
    context: ContextRegistration,
    shoppingListId: string,
  ): Observable<{ session: ConversationSession; pendingAction: PendingConversationAction }> {
    return this.http.post<{ session: ConversationSession; pendingAction: PendingConversationAction }>(
      `${this.householdUrl(householdId)}/conversation-pending-actions/${encodeURIComponent(actionId)}/confirm`,
      { contextId: context.context.id, accessToken: context.accessToken, shoppingListId },
    );
  }

  cancelClose(
    householdId: string,
    actionId: string,
    context: ContextRegistration,
    shoppingListId: string,
  ): Observable<{ session: ConversationSession; pendingAction: PendingConversationAction | null }> {
    return this.http.post<{ session: ConversationSession; pendingAction: PendingConversationAction | null }>(
      `${this.householdUrl(householdId)}/conversation-pending-actions/${encodeURIComponent(actionId)}/cancel`,
      { contextId: context.context.id, accessToken: context.accessToken, shoppingListId },
    );
  }

  evaluateIdle(
    householdId: string,
    shoppingListId: string,
    context: ContextRegistration,
  ): Observable<{ session: ConversationSession | null; pendingAction: PendingConversationAction | null }> {
    return this.http.post<{ session: ConversationSession | null; pendingAction: PendingConversationAction | null }>(
      `${this.householdUrl(householdId)}/conversation-lifecycle/evaluate`,
      { shoppingListId, contextId: context.context.id, accessToken: context.accessToken },
    );
  }

  close(householdId: string, sessionId: string): Observable<ConversationSession> {
    return this.http.post<ConversationSession>(
      `${this.householdUrl(householdId)}/conversation-sessions/${encodeURIComponent(sessionId)}/close`,
      {},
    );
  }

  listDrafts(householdId: string, sessionId: string): Observable<ClarificationDraft[]> {
    return this.http.get<ClarificationDraft[]>(
      `${this.householdUrl(householdId)}/conversation-sessions/${encodeURIComponent(sessionId)}/drafts`,
    );
  }

  resolveDraft(
    householdId: string,
    draftId: string,
    text: string,
  ): Observable<{ draft: ClarificationDraft; result: ConversationCaptureResult }> {
    return this.http.post<{ draft: ClarificationDraft; result: ConversationCaptureResult }>(
      `${this.householdUrl(householdId)}/conversation-drafts/${encodeURIComponent(draftId)}/resolve`,
      { text, source: 'text' },
    );
  }

  dismissDraft(householdId: string, draftId: string): Observable<ClarificationDraft> {
    return this.http.post<ClarificationDraft>(
      `${this.householdUrl(householdId)}/conversation-drafts/${encodeURIComponent(draftId)}/dismiss`,
      {},
    );
  }

  exportCaptureHistory(householdId: string, limit = 500): Observable<CaptureAuditExport> {
    return this.http.get<CaptureAuditExport>(
      `${this.householdUrl(householdId)}/brain/captures?limit=${encodeURIComponent(limit)}`,
    );
  }

  deleteCaptureHistory(householdId: string): Observable<{ deleted: number }> {
    return this.http.delete<{ deleted: number }>(`${this.householdUrl(householdId)}/brain/captures`);
  }

  undo(
    householdId: string,
    eventId: string,
  ): Observable<{ item: ShoppingItem; event: { id: string; inverseOfEventId: string } }> {
    return this.http.post<{ item: ShoppingItem; event: { id: string; inverseOfEventId: string } }>(
      `${this.householdUrl(householdId)}/shopping-item-events/${encodeURIComponent(eventId)}/undo`,
      {},
    );
  }

  private captureUrl(householdId: string): string {
    return `${this.householdUrl(householdId)}/conversation-captures`;
  }

  private householdUrl(householdId: string): string {
    return `/api/v1/households/${encodeURIComponent(householdId)}`;
  }

  private createIdempotencyKey(): string {
    const cryptoApi = globalThis.crypto;
    if (cryptoApi?.randomUUID) return cryptoApi.randomUUID();

    const bytes = new Uint8Array(16);
    if (cryptoApi?.getRandomValues) cryptoApi.getRandomValues(bytes);
    return `capture-${Date.now()}-${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
  }
}
