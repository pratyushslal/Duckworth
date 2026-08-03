import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterOutlet } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { ApiHealthService } from './core/api-health.service';
import { ShoppingItem, ShoppingItemsService } from './core/shopping-items.service';
import { ShoppingEventsService } from './core/shopping-events.service';

type ApiStatus = 'checking' | 'ready' | 'offline';

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
  protected readonly apiStatus = signal<ApiStatus>('checking');
  protected readonly items = signal<ShoppingItem[]>([]);
  protected readonly activeCount = computed(() => this.items().filter((item) => item.status === 'active').length);
  protected readonly itemName = signal('');
  protected readonly message = signal('');
  protected readonly rowMessages = signal<Record<string, string>>({});
  protected readonly busy = signal(false);
  protected readonly editingId = signal<string | null>(null);
  protected readonly editDraft = signal('');

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
      },
    });
  }

  protected addItem(): void {
    const name = this.itemName().trim();
    if (!name) {
      this.message.set('Enter an item name first.');
      return;
    }
    this.busy.set(true);
    this.message.set('');
    this.shoppingItems.add(this.householdId, name).subscribe({
      next: (item) => {
        this.items.update((items) => items.some((candidate) => candidate.id === item.id) ? items : [...items, item]);
        this.itemName.set('');
        this.message.set(`${item.name} added to the list.`);
        this.busy.set(false);
      },
      error: (error: HttpErrorResponse) => {
        this.message.set(error.status === 409 ? 'That item is already on the list.' : 'Could not add that item.');
        this.busy.set(false);
      },
    });
  }

  protected togglePurchased(item: ShoppingItem): void {
    this.busy.set(true);
    const status = item.status === 'purchased' ? 'active' : 'purchased';
    this.shoppingItems.update(this.householdId, item.id, { status, expectedVersion: item.version }).subscribe({
      next: (updated) => {
        this.replaceItem(updated);
        this.message.set(`${updated.name} ${status === 'purchased' ? 'marked purchased' : 'reopened'}.`);
        this.busy.set(false);
      },
      error: (error: HttpErrorResponse) => {
        this.handleUpdateError(error, item);
        this.busy.set(false);
      },
    });
  }

  protected beginEdit(item: ShoppingItem): void {
    this.editingId.set(item.id);
    this.editDraft.set(item.name);
    this.clearRowMessage(item.id);
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
    this.busy.set(true);
    this.shoppingItems.update(this.householdId, item.id, { name, expectedVersion: item.version }).subscribe({
      next: (updated) => {
        this.replaceItem(updated);
        this.cancelEdit();
        this.message.set(`${updated.name} updated.`);
        this.busy.set(false);
      },
      error: (error: HttpErrorResponse) => {
        this.handleUpdateError(error, item);
        this.busy.set(false);
      },
    });
  }

  private loadItems(): void {
    this.shoppingItems.list(this.householdId, true).subscribe({
      next: (items) => this.items.set(items),
      error: () => this.message.set('Could not load the shopping list.'),
    });
  }

  private replaceItem(updated: ShoppingItem): void {
    this.items.update((items) => items.map((item) => item.id === updated.id ? updated : item));
  }

  protected rowMessageFor(itemId: string): string | undefined {
    return this.rowMessages()[itemId];
  }

  private handleUpdateError(error: HttpErrorResponse, item: ShoppingItem): void {
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
}
