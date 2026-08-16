import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import type { components } from '../api/generated/schema';

type GeneratedShoppingItem = components['schemas']['def-0'];
export type ShoppingItem = Omit<
  GeneratedShoppingItem,
  'shoppingListId' | 'categoryId' | 'categoryConfidence' | 'attributes'
> & Partial<Pick<
  GeneratedShoppingItem,
  'shoppingListId' | 'categoryId' | 'categoryConfidence' | 'attributes'
>> & {
  shopTypes?: Array<{ id: string; label: string }>;
  quantitySource?: 'explicit' | 'history' | 'catalog_default' | 'policy_default' | null;
  semanticLearningStatus?: 'unreviewed' | 'confirmed';
};
export type ShoppingItemStatus = ShoppingItem['status'];

export interface ShopTypeFacet {
  id: string;
  label: string;
  activeDistinctCount: number;
}

export interface ShoppingItemView {
  items: ShoppingItem[];
  activeDistinctCount: number;
  appliedShopTypeId: string | null;
  facets: ShopTypeFacet[];
}

export interface ShoppingItemClassificationPatch {
  expectedVersion: number;
  shopTypeDecisions: Array<{
    tagId: string;
    decision: 'include' | 'exclude' | 'clear';
  }>;
}

export interface SemanticCorrectionCommand {
  schemaVersion: 1;
  idempotencyKey: string;
  itemId: string;
  expectedItemVersion: number;
  source: {
    captureInputId: string;
    operationIndex: number;
    sourceStart: number;
    sourceEnd: number;
    rawClause: string;
  };
  corrected: {
    canonicalLabel?: string;
    quantity?: number | null;
    unitId?: string | null;
    packageSize?: number | null;
    packageUnitId?: string | null;
  };
  learn: { mode: 'none' | 'this_item_only' | 'future_matching_items'; scope: 'household' };
}

export interface ShoppingListArchive {
  id: string;
  householdId: string;
  status: 'archived' | 'reopened';
  items: ShoppingItem[];
  createdAt: string;
  reopenedAt: string | null;
}

export interface ShoppingList {
  id: string;
  householdId: string;
  name: string;
  status: 'active' | 'archived';
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

@Injectable({ providedIn: 'root' })
export class ShoppingItemsService {
  private readonly http = inject(HttpClient);

  list(householdId: string, includePurchased = false, includeRemoved = false): Observable<ShoppingItem[]> {
    const query = new URLSearchParams({
      ...(includePurchased ? { includePurchased: 'true' } : {}),
      ...(includeRemoved ? { includeRemoved: 'true' } : {}),
    }).toString();
    return this.http.get<ShoppingItem[]>(`${this.itemsUrl(householdId)}${query ? `?${query}` : ''}`);
  }

  add(householdId: string, input: string, confirmedUnit?: string, productId?: string): Observable<ShoppingItem> {
    return this.http.post<ShoppingItem>(this.itemsUrl(householdId), {
      input,
      ...(confirmedUnit ? { confirmedUnit } : {}),
      ...(productId ? { productId } : {}),
    });
  }

  update(householdId: string, itemId: string, patch: {
    captureText?: string;
    name?: string;
    status?: ShoppingItemStatus;
    quantity?: number | null;
    confirmedUnit?: string | null;
    packageSize?: number | null;
    packageUnit?: string | null;
    expectedVersion: number;
  }): Observable<ShoppingItem> {
    return this.http.patch<ShoppingItem>(`${this.itemsUrl(householdId)}/${itemId}`, patch);
  }

  semanticCorrection(
    householdId: string,
    itemId: string,
    command: SemanticCorrectionCommand,
  ): Observable<{ item: ShoppingItem; correction: { eventId: string; replayed: boolean; learningMode: string }; overlayRevision: number }> {
    return this.http.post<{ item: ShoppingItem; correction: { eventId: string; replayed: boolean; learningMode: string }; overlayRevision: number }>(
      `/api/v2/households/${encodeURIComponent(householdId)}/items/${encodeURIComponent(itemId)}/semantic-corrections`,
      command,
    );
  }

  view(householdId: string, shopTypeId?: string): Observable<ShoppingItemView> {
    const query = shopTypeId ? `?${new URLSearchParams({ shopTypeId }).toString()}` : '';
    return this.http.get<ShoppingItemView>(`${this.itemsUrl(householdId)}/view${query}`);
  }

  updateClassification(
    householdId: string,
    itemId: string,
    patch: ShoppingItemClassificationPatch,
  ): Observable<ShoppingItem> {
    return this.http.patch<ShoppingItem>(
      `${this.itemsUrl(householdId)}/${encodeURIComponent(itemId)}/classification`,
      patch,
    );
  }

  listLists(householdId: string): Observable<ShoppingList[]> {
    return this.http.get<ShoppingList[]>(
      `/api/v1/households/${encodeURIComponent(householdId)}/shopping-lists`,
    );
  }

  archiveList(householdId: string): Observable<ShoppingListArchive> {
    return this.http.post<ShoppingListArchive>(this.archivesUrl(householdId), {});
  }

  listArchives(householdId: string): Observable<ShoppingListArchive[]> {
    return this.http.get<ShoppingListArchive[]>(this.archivesUrl(householdId));
  }

  reopenArchive(householdId: string, archiveId: string): Observable<ShoppingListArchive> {
    return this.http.post<ShoppingListArchive>(
      `${this.archivesUrl(householdId)}/${encodeURIComponent(archiveId)}/reopen`,
      {},
    );
  }

  copyArchive(
    householdId: string,
    archiveId: string,
  ): Observable<{ archive: ShoppingListArchive; items: ShoppingItem[] }> {
    return this.http.post<{ archive: ShoppingListArchive; items: ShoppingItem[] }>(
      `${this.archivesUrl(householdId)}/${encodeURIComponent(archiveId)}/copy`,
      {},
    );
  }

  private itemsUrl(householdId: string): string {
    return `/api/v1/households/${encodeURIComponent(householdId)}/items`;
  }

  private archivesUrl(householdId: string): string {
    return `/api/v1/households/${encodeURIComponent(householdId)}/shopping-list-archives`;
  }
}
