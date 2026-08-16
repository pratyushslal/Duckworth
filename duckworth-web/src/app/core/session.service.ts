import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import type { RuntimeLane } from './runtime-identity';

export interface PairingResult {
  lane: RuntimeLane;
  householdId: string;
}

@Injectable({ providedIn: 'root' })
export class SessionService {
  private readonly http = inject(HttpClient);

  pair(pairingCode: string): Observable<PairingResult> {
    return this.http.post<PairingResult>('/api/v1/session/pair', { pairingCode });
  }
}
