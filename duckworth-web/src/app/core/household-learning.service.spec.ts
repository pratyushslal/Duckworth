import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HouseholdLearningService } from './household-learning.service';

describe('HouseholdLearningService', () => {
  let service: HouseholdLearningService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    service = TestBed.inject(HouseholdLearningService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('lists suggestions and sends explicit reversible feedback', () => {
    service.list('family one').subscribe();
    const list = http.expectOne('/api/v1/households/family%20one/suggestions');
    expect(list.request.method).toBe('GET');
    list.flush([]);

    const key = '["amul butter","pack",500,"g"]';
    service.dismiss('family one', key).subscribe();
    const dismissed = http.expectOne(
      `/api/v1/households/family%20one/suggestions/${encodeURIComponent(key)}/dismiss`,
    );
    expect(dismissed.request.method).toBe('POST');
    dismissed.flush({});

    service.restore('family one', key).subscribe();
    const restored = http.expectOne(
      `/api/v1/households/family%20one/suggestions/${encodeURIComponent(key)}/restore`,
    );
    expect(restored.request.method).toBe('POST');
    restored.flush({});
  });

  it('lists governed learning entries and can clear or restore their influence', () => {
    service.learned('family one').subscribe();
    const list = http.expectOne('/api/v1/households/family%20one/learning');
    expect(list.request.method).toBe('GET');
    list.flush([]);

    service.setLearnedStatus('family one', 'entry one', 'cleared').subscribe();
    const update = http.expectOne('/api/v1/households/family%20one/learning/entry%20one');
    expect(update.request.method).toBe('PATCH');
    expect(update.request.body).toEqual({ status: 'cleared' });
    update.flush({ id: 'entry one', status: 'cleared' });
  });

  it('loads correction provenance and can undo one correction', () => {
    service.control('family one').subscribe();
    const control = http.expectOne('/api/v2/households/family%20one/learning-control');
    expect(control.request.method).toBe('GET');
    control.flush({ householdId: 'family one', overlayRevision: 2, entries: [], corrections: [], metrics: {
      correctionCount: 0, undoCount: 0, activeLearningCount: 0, suppressedLearningCount: 0, unresolvedCount: 0, conflictCount: 0,
    } });

    service.undoCorrection('family one', 'event 1').subscribe();
    const undo = http.expectOne('/api/v2/households/family%20one/semantic-corrections/event%201/undo');
    expect(undo.request.method).toBe('POST');
    undo.flush({ eventId: 'event 2', inverseOfEventId: 'event 1' });
  });
});
