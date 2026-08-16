import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HouseholdSettingsService, type HouseholdCaptureSettings } from './household-settings.service';

describe('HouseholdSettingsService', () => {
  let service: HouseholdSettingsService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    service = TestBed.inject(HouseholdSettingsService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('loads and updates capture settings for one household', () => {
    const settings: HouseholdCaptureSettings = {
      automaticConversationClose: 'off',
      idleThresholdSeconds: 1800,
      gracePeriodSeconds: 300,
      warningPolicy: 'prompt',
      cloudDraftAssist: 'disabled',
      cloudAssistOnSave: false,
      cloudAssistWhileTyping: false,
      suggestions: 'enabled',
      entitlement: 'free',
    };
    service.get('family one').subscribe();
    const get = http.expectOne('/api/v1/households/family%20one/capture-settings');
    expect(get.request.method).toBe('GET');
    get.flush(settings);

    service.update('family one', settings).subscribe();
    const patch = http.expectOne('/api/v1/households/family%20one/capture-settings');
    expect(patch.request.method).toBe('PATCH');
    expect(patch.request.body).toEqual({
      automaticConversationClose: 'off',
      idleThresholdSeconds: 1800,
      gracePeriodSeconds: 300,
      warningPolicy: 'prompt',
      cloudDraftAssist: 'disabled',
      cloudAssistOnSave: false,
      cloudAssistWhileTyping: false,
      suggestions: 'enabled',
    });
    patch.flush(settings);
  });

  it('remembers an explicit Premium cloud-assistance opt-in without sending entitlement data', () => {
    const premium: HouseholdCaptureSettings = {
      automaticConversationClose: 'off', idleThresholdSeconds: 1800, gracePeriodSeconds: 300,
      warningPolicy: 'prompt', cloudDraftAssist: 'disabled', cloudAssistOnSave: true,
      cloudAssistWhileTyping: false, onlineLookupConsent: true, onlineLookupTrigger: 'manual', suggestions: 'enabled', entitlement: 'premium',
    };
    service.get('family one').subscribe();
    http.expectOne('/api/v1/households/family%20one/capture-settings').flush(premium);

    expect(service.cached('family one')).toEqual(premium);
    expect(service.mayUseCloudAssist('family one')).toBe(true);

    service.update('family one', premium).subscribe();
    const patch = http.expectOne('/api/v1/households/family%20one/capture-settings');
    expect(patch.request.body).not.toHaveProperty('entitlement');
    patch.flush(premium);
  });
});
