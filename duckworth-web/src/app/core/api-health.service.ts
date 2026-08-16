import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import type { RuntimeLane } from './runtime-identity';

export interface ApiHealth {
  status: 'ok';
  lane?: RuntimeLane;
  instanceId?: string;
}

@Injectable({ providedIn: 'root' })
export class ApiHealthService {
  private readonly http = inject(HttpClient);

  check(): Observable<ApiHealth> {
    return this.http.get<ApiHealth>('/health');
  }
}
