import '@angular/compiler';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { ConversationContextService } from './conversation-context.service';

describe('ConversationContextService', () => {
  let service: ConversationContextService;
  let http: HttpTestingController;

  beforeEach(() => {
    globalThis.localStorage?.removeItem?.('duckworth.conversation-context');
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    service = TestBed.inject(ConversationContextService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
    globalThis.localStorage?.removeItem?.('duckworth.conversation-context');
  });

  it('registers a dynamic device and speaker without inventing a context id', () => {
    service.register('household-a', 'device-a', 'speaker-a', 'Kitchen').subscribe((result) => {
      expect(result.context.id).toBe('context-from-server');
      expect(result.accessToken).toBe('opaque-token');
    });
    const request = http.expectOne('/api/v1/households/household-a/conversation-contexts');
    expect(request.request.body).toEqual({
      deviceId: 'device-a', speakerId: 'speaker-a', label: 'Kitchen',
    });
    request.flush({
      context: { id: 'context-from-server', householdId: 'household-a', deviceId: 'device-a', speakerId: 'speaker-a', status: 'active' },
      accessToken: 'opaque-token',
    });
    expect(service.current()?.context.id).toBe('context-from-server');
  });

  it('restores a valid stored context without registering it again', () => {
    const stored = {
      context: {
        id: 'context-stored', householdId: 'household-a', deviceId: 'device-a',
        speakerId: null, label: 'Kitchen', status: 'active',
      },
      accessToken: 'stored-token',
    } as const;
    service.current.set(stored);

    service.initialize('household-a', 'device-a').subscribe((result) => {
      expect(result.context.id).toBe('context-stored');
    });

    http.expectNone('/api/v1/households/household-a/conversation-contexts');
    expect(service.current()?.accessToken).toBe('stored-token');
  });

  it('registers a new context when no stored context exists', () => {
    service.initialize('household-a', 'device-a').subscribe((result) => {
      expect(result.context.id).toBe('context-created');
    });

    const request = http.expectOne('/api/v1/households/household-a/conversation-contexts');
    expect(request.request.body).toEqual({ deviceId: 'device-a' });
    request.flush({
      context: {
        id: 'context-created', householdId: 'household-a', deviceId: 'device-a',
        speakerId: null, label: 'device-a', status: 'active',
      },
      accessToken: 'created-token',
    });
  });
});
