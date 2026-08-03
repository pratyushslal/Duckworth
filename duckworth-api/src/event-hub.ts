import type { ShoppingItem } from './shopping-items.js';

export type ShoppingItemEventAction = 'created' | 'updated';

export interface ShoppingItemEvent {
  action: ShoppingItemEventAction;
  item: ShoppingItem;
}

type Subscriber = (event: ShoppingItemEvent) => void;

export class HouseholdEventHub {
  private readonly subscribers = new Map<string, Set<Subscriber>>();

  subscribe(householdId: string, subscriber: Subscriber): () => void {
    const listeners = this.subscribers.get(householdId) ?? new Set<Subscriber>();
    listeners.add(subscriber);
    this.subscribers.set(householdId, listeners);
    return () => {
      listeners.delete(subscriber);
      if (listeners.size === 0) this.subscribers.delete(householdId);
    };
  }

  publish(householdId: string, event: ShoppingItemEvent): void {
    this.subscribers.get(householdId)?.forEach((subscriber) => subscriber(event));
  }
}
