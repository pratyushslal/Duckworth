import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { Observable } from 'rxjs';
import { tap } from 'rxjs';

export interface HouseholdCaptureSettings {
  automaticConversationClose: 'off' | 'after_idle';
  idleThresholdSeconds: number;
  gracePeriodSeconds: number;
  warningPolicy: 'silent' | 'prompt';
  cloudDraftAssist: 'disabled' | 'ask_before_each_use';
  cloudAssistOnSave: boolean;
  cloudAssistWhileTyping: boolean;
  onlineLookupConsent?: boolean;
  onlineLookupTrigger?: 'manual' | 'on_idle';
  suggestions: 'enabled' | 'disabled';
  entitlement: 'free' | 'premium';
}

@Injectable({ providedIn: 'root' })
export class HouseholdSettingsService {
  private readonly http = inject(HttpClient);
  private readonly cachedSettings = new Map<string, HouseholdCaptureSettings>();

  get(householdId: string): Observable<HouseholdCaptureSettings> {
    return this.http.get<HouseholdCaptureSettings>(this.url(householdId)).pipe(
      tap((settings) => this.remember(householdId, settings)),
    );
  }

  update(
    householdId: string,
    settings: HouseholdCaptureSettings,
  ): Observable<HouseholdCaptureSettings> {
    const { entitlement: _entitlement, ...update } = settings;
    return this.http.patch<HouseholdCaptureSettings>(this.url(householdId), update).pipe(
      tap((saved) => this.remember(householdId, saved)),
    );
  }

  cached(householdId: string): HouseholdCaptureSettings | undefined {
    return this.cachedSettings.get(householdId);
  }

  mayUseCloudAssist(householdId: string): boolean {
    const cached = this.cached(householdId);
    if (cached) return cached.entitlement === 'premium' && cached.onlineLookupConsent === true
      && (cached.cloudAssistOnSave || cached.cloudAssistWhileTyping);
    try {
      return globalThis.localStorage?.getItem(this.cloudAssistMarkerKey(householdId)) === 'enabled';
    } catch {
      return false;
    }
  }

  private url(householdId: string): string {
    return `/api/v1/households/${encodeURIComponent(householdId)}/capture-settings`;
  }

  private remember(householdId: string, settings: HouseholdCaptureSettings): void {
    this.cachedSettings.set(householdId, settings);
    const enabled = settings.entitlement === 'premium' && settings.onlineLookupConsent === true
      && (settings.cloudAssistOnSave || settings.cloudAssistWhileTyping);
    try {
      if (enabled) globalThis.localStorage?.setItem(this.cloudAssistMarkerKey(householdId), 'enabled');
      else globalThis.localStorage?.removeItem(this.cloudAssistMarkerKey(householdId));
    } catch {
      // Browser storage is an optional optimization; the API remains authoritative.
    }
  }

  private cloudAssistMarkerKey(householdId: string): string {
    return `duckworth.cloud-assist-opt-in:${householdId}`;
  }
}
