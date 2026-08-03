import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterOutlet } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { ApiHealthService } from './core/api-health.service';
import { ShoppingItem, ShoppingItemsService } from './core/shopping-items.service';

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
  protected readonly householdId = 'household-demo';
  protected readonly apiStatus = signal<ApiStatus>('checking');
  protected readonly items = signal<ShoppingItem[]>([]);
  protected readonly itemName = signal('');
  protected readonly message = signal('');
  protected readonly busy = signal(false);

  constructor() {
    this.apiHealth.check().subscribe({
      next: () => this.apiStatus.set('ready'),
      error: () => this.apiStatus.set('offline'),
    });
    this.loadItems();
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
        this.items.update((items) => [...items, item]);
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

  protected markPurchased(item: ShoppingItem): void {
    this.busy.set(true);
    this.shoppingItems.updateStatus(this.householdId, item.id, 'purchased').subscribe({
      next: () => {
        this.items.update((items) => items.filter((candidate) => candidate.id !== item.id));
        this.message.set(`${item.name} marked purchased.`);
        this.busy.set(false);
      },
      error: () => {
        this.message.set('Could not update that item.');
        this.busy.set(false);
      },
    });
  }

  private loadItems(): void {
    this.shoppingItems.list(this.householdId).subscribe({
      next: (items) => this.items.set(items),
      error: () => this.message.set('Could not load the shopping list.'),
    });
  }
}
