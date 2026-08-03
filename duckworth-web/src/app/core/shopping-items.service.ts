import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import type { components } from '../api/generated/schema';

export type ShoppingItem = components['schemas']['def-0'];
export type ShoppingItemStatus = ShoppingItem['status'];

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
    return `/api/v1/households/${encodeURIComponent(householdId)}/items`;
  }
}
