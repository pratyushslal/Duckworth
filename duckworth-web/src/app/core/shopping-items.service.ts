import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

export type ShoppingItemStatus = 'active' | 'purchased';

export interface ShoppingItem {
  id: string;
  householdId: string;
  name: string;
  status: ShoppingItemStatus;
  createdAt: string;
  updatedAt: string;
  version: number;
}

@Injectable({ providedIn: 'root' })
export class ShoppingItemsService {
  private readonly http = inject(HttpClient);

  list(householdId: string, includePurchased = false): Observable<ShoppingItem[]> {
    const query = includePurchased ? '?includePurchased=true' : '';
    return this.http.get<ShoppingItem[]>(`${this.itemsUrl(householdId)}${query}`);
  }

  add(householdId: string, name: string): Observable<ShoppingItem> {
    return this.http.post<ShoppingItem>(this.itemsUrl(householdId), { name });
  }

  update(householdId: string, itemId: string, patch: { name?: string; status?: ShoppingItemStatus; expectedVersion: number }): Observable<ShoppingItem> {
    return this.http.patch<ShoppingItem>(`${this.itemsUrl(householdId)}/${itemId}`, patch);
  }

  private itemsUrl(householdId: string): string {
    return `/api/households/${encodeURIComponent(householdId)}/items`;
  }
}
