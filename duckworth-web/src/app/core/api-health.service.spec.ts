import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { ApiHealthService } from './api-health.service';

describe('ApiHealthService', () => {
  let httpTesting: HttpTestingController;

  afterEach(() => {
    httpTesting.verify();
  });

  it('checks API readiness through the health endpoint', () => {
    TestBed.configureTestingModule({
      providers: [
        ApiHealthService,
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });

    const service = TestBed.inject(ApiHealthService);
    httpTesting = TestBed.inject(HttpTestingController);

    service.check().subscribe((health) => {
      expect(health.status).toBe('ok');
    });

    const request = httpTesting.expectOne('/health');
    expect(request.request.method).toBe('GET');
    request.flush({ status: 'ok' });
  });
});
