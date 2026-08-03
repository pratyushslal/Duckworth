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
}

@Injectable({ providedIn: 'root' })
export class ShoppingItemsService {
  private readonly http = inject(HttpClient);

  list(householdId: string): Observable<ShoppingItem[]> {
    return this.http.get<ShoppingItem[]>(this.itemsUrl(householdId));
  }

  add(householdId: string, name: string): Observable<ShoppingItem> {
    return this.http.post<ShoppingItem>(this.itemsUrl(householdId), { name });
  }

  updateStatus(householdId: string, itemId: string, status: ShoppingItemStatus): Observable<ShoppingItem> {
    return this.http.patch<ShoppingItem>(`${this.itemsUrl(householdId)}/${itemId}`, { status });
  }

  private itemsUrl(householdId: string): string {
    return `/api/households/${encodeURIComponent(householdId)}/items`;
  }
}
