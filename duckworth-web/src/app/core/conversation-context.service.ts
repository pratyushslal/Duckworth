import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { of, tap, type Observable } from 'rxjs';
import { signal } from '@angular/core';

export interface ConversationContext {
  id: string;
  householdId: string;
  deviceId: string;
  speakerId: string | null;
  label: string;
  status: 'active' | 'closed';
  createdAt?: string;
  updatedAt?: string;
  closedAt?: string | null;
}

export interface ContextRegistration {
  context: ConversationContext;
  accessToken: string;
}

@Injectable({ providedIn: 'root' })
export class ConversationContextService {
  private readonly http = inject(HttpClient);
  private readonly storageKey = 'duckworth.conversation-context';
  readonly current = signal<ContextRegistration | null>(this.readStored());

  initialize(householdId: string, deviceId: string): Observable<ContextRegistration> {
    const stored = this.current();
    if (stored
      && stored.context.householdId === householdId
      && stored.context.deviceId === deviceId
      && stored.context.status === 'active') {
      return of(stored);
    }
    if (stored) this.clearIfCurrent(stored.context.id);
    return this.register(householdId, deviceId);
  }

  register(
    householdId: string,
    deviceId: string,
    speakerId: string | null = null,
    label?: string,
  ): Observable<ContextRegistration> {
    return this.http.post<ContextRegistration>(this.contextsUrl(householdId), {
      deviceId,
      ...(speakerId ? { speakerId } : {}),
      ...(label ? { label } : {}),
    }).pipe(tap((registration) => this.persist(registration)));
  }

  list(householdId: string): Observable<ConversationContext[]> {
    return this.http.get<ConversationContext[]>(this.contextsUrl(householdId));
  }

  close(householdId: string, contextId: string, accessToken: string): Observable<ConversationContext> {
    return this.http.post<ConversationContext>(
      `${this.contextsUrl(householdId)}/${encodeURIComponent(contextId)}/close`,
      { accessToken },
    ).pipe(tap(() => this.clearIfCurrent(contextId)));
  }

  handoff(
    householdId: string,
    contextId: string,
    accessToken: string,
    targetDeviceId: string,
    targetSpeakerId: string | null = null,
  ): Observable<{ handoffToken: string; expiresAt: string }> {
    return this.http.post<{ handoffToken: string; expiresAt: string }>(
      `${this.contextsUrl(householdId)}/${encodeURIComponent(contextId)}/handoff`,
      {
        accessToken,
        targetDeviceId,
        ...(targetSpeakerId ? { targetSpeakerId } : {}),
      },
    );
  }

  claim(
    householdId: string,
    handoffToken: string,
    deviceId: string,
    speakerId: string | null = null,
  ): Observable<ContextRegistration> {
    return this.http.post<ContextRegistration>(`${this.contextsUrl(householdId)}/claim`, {
      handoffToken,
      deviceId,
      ...(speakerId ? { speakerId } : {}),
    }).pipe(tap((registration) => this.persist(registration)));
  }

  clear(): void {
    const current = this.current();
    if (current) this.clearIfCurrent(current.context.id);
  }

  private persist(registration: ContextRegistration): void {
    this.current.set(registration);
    globalThis.localStorage?.setItem?.(this.storageKey, JSON.stringify(registration));
  }

  private clearIfCurrent(contextId: string): void {
    if (this.current()?.context.id !== contextId) return;
    this.current.set(null);
    globalThis.localStorage?.removeItem?.(this.storageKey);
  }

  private readStored(): ContextRegistration | null {
    try {
      const raw = globalThis.localStorage?.getItem?.(this.storageKey);
      return raw ? JSON.parse(raw) as ContextRegistration : null;
    } catch {
      return null;
    }
  }

  private contextsUrl(householdId: string): string {
    return `/api/v1/households/${encodeURIComponent(householdId)}/conversation-contexts`;
  }
}
