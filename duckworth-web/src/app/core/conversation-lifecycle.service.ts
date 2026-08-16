import { Injectable, inject, signal } from '@angular/core';
import { catchError, switchMap, tap, type Observable } from 'rxjs';
import type { ContextRegistration } from './conversation-context.service';
import {
  ConversationService,
  type ConversationState,
} from './conversation.service';

@Injectable({ providedIn: 'root' })
export class ConversationLifecycleService {
  private readonly conversation = inject(ConversationService);
  readonly state = signal<ConversationState | null>(null);
  readonly loading = signal(false);

  hydrate(
    householdId: string,
    shoppingListId: string,
    context: ContextRegistration,
  ): Observable<ConversationState> {
    this.loading.set(true);
    return this.conversation.state(householdId, shoppingListId, context).pipe(
      tap((state) => {
        this.state.set(state);
        this.loading.set(false);
      }),
      catchError((error: unknown) => {
        this.loading.set(false);
        throw error;
      }),
    );
  }

  hydrateWithRecovery(
    householdId: string,
    shoppingListId: string,
    context: ContextRegistration,
    replaceContext: () => Observable<ContextRegistration>,
  ): Observable<ConversationState> {
    return this.hydrate(householdId, shoppingListId, context).pipe(
      catchError((error: { status?: number }) => {
        if (error.status !== 401 && error.status !== 403 && error.status !== 404) throw error;
        return replaceContext().pipe(
          switchMap((replacement) => this.hydrate(householdId, shoppingListId, replacement)),
        );
      }),
    );
  }

  evaluateIdle(
    householdId: string,
    shoppingListId: string,
    context: ContextRegistration,
  ): Observable<{ session: ConversationState['session']; pendingAction: ConversationState['pendingAction'] }> {
    return this.conversation.evaluateIdle(householdId, shoppingListId, context);
  }

  clear(): void {
    this.state.set(null);
    this.loading.set(false);
  }
}
