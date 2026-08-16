import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ConversationService } from './conversation.service';
import type { ContextRegistration } from './conversation-context.service';

describe('ConversationService', () => {
  let service: ConversationService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    service = TestBed.inject(ConversationService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('submits one source-neutral command and maps the common brain result', () => {
    service.capture('family one', 'Add milk and bread').subscribe((result) => {
      expect(result.session.status).toBe('active');
      expect(result.saved).toHaveLength(2);
    });

    const request = http.expectOne('/api/v1/households/family%20one/conversation-captures');
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({ text: 'Add milk and bread', source: 'text' });
    request.flush({
      session: { id: 'session-1', householdId: 'family one', status: 'active', closedAt: null },
      saved: [{ id: 'milk' }, { id: 'bread' }],
      merged: [],
      drafts: [],
      undo: [],
    });
  });

  it('adds dynamic context authorization and a per-capture idempotency key', () => {
    const context = {
      context: {
        id: 'context-from-server',
        householdId: 'family one',
        deviceId: 'device-a',
        speakerId: 'speaker-a',
        label: 'Kitchen',
        status: 'active',
      },
      accessToken: 'opaque-token',
    } satisfies ContextRegistration;

    service.capture('family one', 'Add milk', context, 'voice').subscribe();

    const request = http.expectOne('/api/v1/households/family%20one/conversation-captures');
    expect(request.request.body).toMatchObject({
      text: 'Add milk',
      source: 'voice',
      contextId: 'context-from-server',
      accessToken: 'opaque-token',
    });
    expect(request.request.body.idempotencyKey).toEqual(expect.any(String));
    expect(request.request.body.idempotencyKey.length).toBeGreaterThan(0);
    request.flush({ session: {}, saved: [], merged: [], drafts: [], undo: [] });
  });
});
