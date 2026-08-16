import '@angular/compiler';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { ConversationLifecycleService } from './conversation-lifecycle.service';

describe('ConversationLifecycleService', () => {
  let service: ConversationLifecycleService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    service = TestBed.inject(ConversationLifecycleService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('hydrates the scoped list and lifecycle state on refresh', () => {
    service.hydrate('household-a', 'default:household-a', {
      context: {
        id: 'context-a', householdId: 'household-a', deviceId: 'device-a',
        speakerId: null, label: 'Kitchen', status: 'active',
      },
      accessToken: 'token-a',
    }).subscribe();

    const request = http.expectOne(
      '/api/v1/households/household-a/conversation-state?shoppingListId=default%3Ahousehold-a&contextId=context-a&accessToken=token-a',
    );
    request.flush({
      list: {
        id: 'default:household-a', householdId: 'household-a', name: 'Household list',
        status: 'active', isDefault: true, createdAt: '2026-08-11T00:00:00.000Z', updatedAt: '2026-08-11T00:00:00.000Z',
      },
      session: { id: 'session-a', householdId: 'household-a', shoppingListId: 'default:household-a', contextId: 'context-a', status: 'close_pending', closedAt: null },
      pendingAction: { id: 'action-a', status: 'pending' },
      drafts: [],
    });

    expect(service.state()?.session?.status).toBe('close_pending');
    expect(service.state()?.pendingAction?.id).toBe('action-a');
    expect(service.loading()).toBe(false);
  });

  it('re-registers once when the stored context is unauthorized', () => {
    const replacement = {
      context: {
        id: 'context-b', householdId: 'household-a', deviceId: 'device-a',
        speakerId: null, label: 'Kitchen', status: 'active' as const,
      },
      accessToken: 'token-b',
    };
    const replace = vi.fn(() => of(replacement));
    service.hydrateWithRecovery('household-a', 'default:household-a', {
      context: {
        id: 'context-a', householdId: 'household-a', deviceId: 'device-a',
        speakerId: null, label: 'Kitchen', status: 'active',
      },
      accessToken: 'stale-token',
    }, replace).subscribe();

    const first = http.expectOne((request) => request.url.includes('/conversation-state'));
    first.flush({ error: 'conversation_context_forbidden' }, { status: 403, statusText: 'Forbidden' });
    const second = http.expectOne((request) => request.url.includes('/conversation-state'));
    second.flush({
      list: {
        id: 'default:household-a', householdId: 'household-a', name: 'Household list',
        status: 'active', isDefault: true, createdAt: 'now', updatedAt: 'now',
      },
      session: null,
      pendingAction: null,
      drafts: [],
    });
    expect(replace).toHaveBeenCalledTimes(1);
    expect(service.state()?.session).toBeNull();
  });
});
