import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CloudAssistService } from './cloud-assist.service';

describe('CloudAssistService', () => {
  let service: CloudAssistService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    service = TestBed.inject(CloudAssistService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('sends a trigger-scoped request only to the household server endpoint', () => {
    service.suggest('family one', '1 strip of Telma 40 mg', 'save').subscribe();
    const request = http.expectOne('/api/v1/households/family%20one/cloud-assist');
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({ text: '1 strip of Telma 40 mg', trigger: 'save', captureRevision: 0 });
    request.flush({
      requiresUserConfirmation: true,
      suggestion: { itemName: 'Telma', quantity: 1, unit: 'strip', measures: [], attributes: {}, rationale: 'review' },
    });
  });
});
