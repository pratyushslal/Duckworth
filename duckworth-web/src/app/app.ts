import { Component, ElementRef, computed, effect, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterOutlet } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { interpretCapture, normalizeItemName, type CaptureInterpretation } from '@duckworth/item-capture';
import { ApiHealthService } from './core/api-health.service';
import { ShoppingItem, ShoppingItemsService } from './core/shopping-items.service';
import { ShoppingEventsService } from './core/shopping-events.service';
import { UnitHistoryCache, type UnitHistoryMap } from './core/unit-history-cache';

type ApiStatus = 'checking' | 'ready' | 'offline';
type CapturePreview = Omit<CaptureInterpretation, 'unit'> & {
  unit: string | null;
  unitSource: 'explicit' | 'history' | null;
};

@Component({
  selector: 'app-root',
  imports: [FormsModule, RouterOutlet],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  private readonly apiHealth = inject(ApiHealthService);
  private readonly shoppingItems = inject(ShoppingItemsService);
  private readonly shoppingEvents = inject(ShoppingEventsService);
  protected readonly householdId = 'household-demo';
  private readonly unitHistoryCache = new UnitHistoryCache(localStorage);
  protected readonly unitHistory = signal<UnitHistoryMap>(this.unitHistoryCache.read(this.householdId));
  protected readonly apiStatus = signal<ApiStatus>('checking');
  protected readonly items = signal<ShoppingItem[]>([]);
  protected readonly activeCount = computed(() => this.items().filter((item) => item.status === 'active').length);
  protected readonly itemName = signal('');
  protected readonly capturePreview = computed<CapturePreview | null>(() => {
    const input = this.itemName();
    if (!input.trim()) return null;
    try {
      const parsed = interpretCapture(input);
      if (parsed.unit) return { ...parsed, unitSource: 'explicit' };
      const historical = this.unitHistory()[normalizeItemName(parsed.name)];
      if (historical) return { ...parsed, unit: historical.unit, unitSource: 'history' };
      return { ...parsed, unitSource: null };
    } catch {
      return null;
    }
  });
  protected readonly captureErrorMessage = signal('');
  protected readonly captureConfirmedUnit = signal<string | null>(null);
  protected readonly message = signal('');
  protected readonly rowMessages = signal<Record<string, string>>({});
  protected readonly addPending = signal(false);
  protected readonly editingId = signal<string | null>(null);
  protected readonly editDraft = signal('');
  protected readonly detailsEditingId = signal<string | null>(null);
  protected readonly detailsQuantityDraft = signal('');
  protected readonly detailsUnitDraft = signal('');
  protected readonly detailsOriginalUnit = signal<string | null>(null);
  protected readonly pendingItemIds = signal<ReadonlySet<string>>(new Set());
  private readonly detailsQuantityInput = viewChild<ElementRef<HTMLInputElement>>('detailsQuantityInput');
  private readonly detailsFocusEffect = effect(() => {
    if (this.detailsEditingId()) this.detailsQuantityInput()?.nativeElement.focus();
  });

  constructor() {
    this.apiHealth.check().subscribe({
      next: () => this.apiStatus.set('ready'),
      error: () => this.apiStatus.set('offline'),
    });
    this.loadItems();
    this.shoppingEvents.connect(this.householdId).subscribe({
      next: ({ action, item }) => {
        if (action === 'created' && item.status === 'active') {
          this.items.update((items) => items.some((candidate) => candidate.id === item.id) ? items : [...items, item]);
        }
        if (action === 'updated') {
          this.items.update((items) => items.map((candidate) => candidate.id === item.id ? item : candidate));
        }
        this.rememberExplicitUnit(item);
      },
    });
  }

  protected addItem(): void {
    if (this.addPending()) return;
    const name = this.itemName().trim();
    if (!name) {
      this.message.set('Enter an item name first.');
      return;
    }
    if (!this.capturePreview()) {
      this.captureErrorMessage.set('Add an item name after the quantity.');
      return;
    }
    this.addPending.set(true);
    this.message.set('');
    this.shoppingItems.add(this.householdId, name, this.captureConfirmedUnit() ?? undefined).subscribe({
      next: (item) => {
        this.items.update((items) => items.some((candidate) => candidate.id === item.id) ? items : [...items, item]);
        this.rememberExplicitUnit(item);
        this.itemName.set('');
        this.captureConfirmedUnit.set(null);
        this.captureErrorMessage.set('');
        this.message.set(`${item.name} added to the list.`);
        this.addPending.set(false);
      },
      error: (error: HttpErrorResponse) => {
        this.message.set(error.status === 409 ? 'That item is already on the list.' : 'Could not add that item.');
        this.addPending.set(false);
      },
    });
  }

  protected updateItemName(value: string): void {
    this.itemName.set(value);
    this.captureConfirmedUnit.set(null);
    this.captureErrorMessage.set('');
  }

  protected acceptCaptureUnit(): void {
    const preview = this.capturePreview();
    if (preview?.unitSource === 'history' && preview.unit) this.captureConfirmedUnit.set(preview.unit);
  }

  protected togglePurchased(item: ShoppingItem): void {
    if (this.isItemPending(item.id)) return;
    this.setItemPending(item.id, true);
    const status = item.status === 'purchased' ? 'active' : 'purchased';
    this.shoppingItems.update(this.householdId, item.id, { status, expectedVersion: item.version }).subscribe({
      next: (updated) => {
        this.replaceItem(updated);
        this.message.set(`${updated.name} ${status === 'purchased' ? 'marked purchased' : 'reopened'}.`);
        this.setItemPending(item.id, false);
      },
      error: (error: HttpErrorResponse) => {
        this.handleUpdateError(error, item);
        this.setItemPending(item.id, false);
      },
    });
  }

  protected beginEdit(item: ShoppingItem): void {
    this.editingId.set(item.id);
    this.editDraft.set(item.name);
    this.clearRowMessage(item.id);
  }

  protected beginDetails(item: ShoppingItem): void {
    this.detailsEditingId.set(item.id);
    this.detailsQuantityDraft.set(item.quantity?.toString() ?? '');
    this.detailsUnitDraft.set(item.unit ?? '');
    this.detailsOriginalUnit.set(item.unit);
    this.clearRowMessage(item.id);
  }

  protected cancelDetails(): void {
    this.detailsEditingId.set(null);
    this.detailsQuantityDraft.set('');
    this.detailsUnitDraft.set('');
    this.detailsOriginalUnit.set(null);
  }

  protected saveDetails(item: ShoppingItem): void {
    const quantity = Number(this.detailsQuantityDraft());
    if (!Number.isFinite(quantity) || quantity <= 0) {
      this.setRowMessage(item.id, 'Enter a quantity greater than zero.');
      return;
    }
    const unit = this.detailsUnitDraft().trim();
    if (unit.length > 32) {
      this.setRowMessage(item.id, 'Keep the unit to 32 characters or fewer.');
      return;
    }
    const unitChanged = unit !== (this.detailsOriginalUnit() ?? '');
    this.setItemPending(item.id, true);
    this.shoppingItems.update(this.householdId, item.id, {
      quantity,
      ...(unitChanged ? { confirmedUnit: unit || null } : {}),
      expectedVersion: item.version,
    }).subscribe({
      next: (updated) => {
        this.replaceItem(updated);
        this.cancelDetails();
        this.message.set(`${updated.name} details saved.`);
        this.setItemPending(item.id, false);
      },
      error: (error: HttpErrorResponse) => {
        this.handleUpdateError(error, item);
        this.setItemPending(item.id, false);
      },
    });
  }

  protected isItemPending(itemId: string): boolean {
    return this.pendingItemIds().has(itemId);
  }

  protected acceptHistoricalUnit(item: ShoppingItem): void {
    if (!item.unit || this.isItemPending(item.id)) return;
    this.setItemPending(item.id, true);
    this.clearRowMessage(item.id);
    this.shoppingItems.update(this.householdId, item.id, {
      confirmedUnit: item.unit,
      expectedVersion: item.version,
    }).subscribe({
      next: (updated) => {
        this.replaceItem(updated);
        this.message.set(`${updated.unit} accepted for ${updated.name}.`);
        this.setItemPending(item.id, false);
      },
      error: (error: HttpErrorResponse) => {
        this.handleUpdateError(error, item);
        this.setItemPending(item.id, false);
      },
    });
  }

  protected hasAttention(item: ShoppingItem, reason: ShoppingItem['attentionReasons'][number]): boolean {
    return item.attentionReasons.includes(reason);
  }

  protected cancelEdit(): void {
    this.editingId.set(null);
    this.editDraft.set('');
  }

  protected saveEdit(item: ShoppingItem): void {
    const name = this.editDraft().trim();
    if (!name) {
      this.setRowMessage(item.id, 'Enter an item name before saving.');
      return;
    }
    if (this.isItemPending(item.id)) return;
    this.setItemPending(item.id, true);
    this.shoppingItems.update(this.householdId, item.id, { name, expectedVersion: item.version }).subscribe({
      next: (updated) => {
        this.replaceItem(updated);
        this.cancelEdit();
        this.message.set(`${updated.name} updated.`);
        this.setItemPending(item.id, false);
      },
      error: (error: HttpErrorResponse) => {
        this.handleUpdateError(error, item);
        this.setItemPending(item.id, false);
      },
    });
  }

  private loadItems(): void {
    this.shoppingItems.list(this.householdId, true).subscribe({
      next: (items) => {
        this.items.set(items);
        this.unitHistory.set(this.unitHistoryCache.replaceFromItems(this.householdId, items));
      },
      error: () => this.message.set('Could not load the shopping list.'),
    });
  }

  private replaceItem(updated: ShoppingItem): void {
    this.items.update((items) => items.map((item) => item.id === updated.id ? updated : item));
    this.rememberExplicitUnit(updated);
  }

  private rememberExplicitUnit(item: ShoppingItem): void {
    this.unitHistory.set(this.unitHistoryCache.mergeExplicitItem(this.householdId, item));
  }

  protected rowMessageFor(itemId: string): string | undefined {
    return this.rowMessages()[itemId];
  }

  private handleUpdateError(error: HttpErrorResponse, item: ShoppingItem): void {
    if (error.status === 409 && error.error?.error === 'duplicate_item') {
      this.setRowMessage(item.id, 'That name is already on the list. Choose a different name.');
      return;
    }
    if (error.status === 409 && error.error?.currentItem) {
      this.replaceItem(error.error.currentItem as ShoppingItem);
      this.setRowMessage(item.id, 'This item changed in another tab. The latest version is shown; review your change and try again.');
      return;
    }
    if (error.status === 400) {
      this.setRowMessage(item.id, 'That item change was not valid. Check the name and try again.');
      return;
    }
    if (error.status === 404) {
      this.setRowMessage(item.id, 'This item is no longer available. Refresh the list to continue.');
      return;
    }
    this.setRowMessage(item.id, `We couldn't save “${item.name}”. Check your connection and try again.`);
  }

  private setRowMessage(itemId: string, message: string): void {
    this.rowMessages.update((messages) => ({ ...messages, [itemId]: message }));
  }

  private clearRowMessage(itemId: string): void {
    this.rowMessages.update((messages) => {
      const next = { ...messages };
      delete next[itemId];
      return next;
    });
  }

  private setItemPending(itemId: string, pending: boolean): void {
    this.pendingItemIds.update((ids) => {
      const next = new Set(ids);
      if (pending) next.add(itemId);
      else next.delete(itemId);
      return next;
    });
  }
}
