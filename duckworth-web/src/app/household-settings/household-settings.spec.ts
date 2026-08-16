import '@angular/compiler';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { HouseholdSettings } from './household-settings';

describe('HouseholdSettings', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [HouseholdSettings], providers: [provideHttpClient(), provideHttpClientTesting()] });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('loads and saves the explicit idle-close policy', async () => {
    const fixture = TestBed.createComponent(HouseholdSettings);
    fixture.componentRef.setInput('householdId', 'household-a');
    fixture.detectChanges();
    const details = fixture.nativeElement.querySelector('details') as HTMLDetailsElement;
    details.open = true;
    details.dispatchEvent(new Event('toggle'));
    const get = http.expectOne('/api/v1/households/household-a/capture-settings');
    get.flush({
      automaticConversationClose: 'off', idleThresholdSeconds: 1800, gracePeriodSeconds: 300,
      warningPolicy: 'prompt', cloudDraftAssist: 'disabled', cloudAssistOnSave: false,
      cloudAssistWhileTyping: false, suggestions: 'enabled', entitlement: 'free',
    });
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Automatic conversation closure');
  });
});
