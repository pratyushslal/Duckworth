import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { BrainAdapter, type BrainCaptureEnvelope } from './brain-adapter';

describe('BrainAdapter', () => {
  it('posts one versioned envelope and returns channel-neutral facts', () => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    const adapter = TestBed.inject(BrainAdapter);
    const http = TestBed.inject(HttpTestingController);
    const envelope: BrainCaptureEnvelope = {
      schemaVersion: 2,
      inputId: 'input-1',
      householdId: 'household-1',
      contextId: 'context-1',
      shoppingListId: 'list-1',
      source: { kind: 'text' },
      text: 'milk',
      locale: 'en-IN',
      countryCode: 'IN',
      occurredAt: '2026-08-12T08:00:00.000Z',
      idempotencyKey: 'key-1',
    };
    let received: unknown;
    adapter.capture(envelope).subscribe((value) => { received = value; });
    const request = http.expectOne('/api/v2/households/household-1/brain/captures');
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual(envelope);
    const response = { facts: { saved: [], merged: [], drafts: [], undo: [], warnings: [] } };
    request.flush(response);
    expect(received).toEqual(response);
    http.verify();
  });
});
