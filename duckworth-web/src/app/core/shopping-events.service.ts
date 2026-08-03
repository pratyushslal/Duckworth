import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { ShoppingItem } from './shopping-items.service';

export interface ShoppingItemEvent {
  action: 'created' | 'updated';
  item: ShoppingItem;
}

@Injectable({ providedIn: 'root' })
export class ShoppingEventsService {
  connect(householdId: string): Observable<ShoppingItemEvent> {
    return new Observable((subscriber) => {
      const source = new EventSource(`/api/households/${encodeURIComponent(householdId)}/events`);
      const listener = (event: MessageEvent<string>) => {
        try {
          subscriber.next(JSON.parse(event.data) as ShoppingItemEvent);
        } catch {
          subscriber.error(new Error('Received an invalid shopping event'));
        }
      };
      source.addEventListener('shopping-item.changed', listener);
      return () => source.close();
    });
  }
}
