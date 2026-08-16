import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { SessionService } from './session.service';

describe('SessionService', () => {
  it('pairs through the same-origin session endpoint', () => {
    TestBed.configureTestingModule({
      providers: [SessionService, provideHttpClient(), provideHttpClientTesting()],
    });
    const service = TestBed.inject(SessionService);
    const http = TestBed.inject(HttpTestingController);
    let result: { lane: string; householdId: string } | undefined;

    service.pair('family-code').subscribe((value) => { result = value; });

    const request = http.expectOne('/api/v1/session/pair');
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({ pairingCode: 'family-code' });
    request.flush({ lane: 'live', householdId: 'family-a' });
    expect(result).toEqual({ lane: 'live', householdId: 'family-a' });
    http.verify();
  });
});
