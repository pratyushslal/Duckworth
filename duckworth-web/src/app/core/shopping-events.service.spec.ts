import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ShoppingEventsService } from './shopping-events.service';

class FakeEventSource {
  static instance: FakeEventSource;
  readonly listeners = new Map<string, (event: MessageEvent<string>) => void>();
  closed = false;

  constructor(readonly url: string) {
    FakeEventSource.instance = this;
  }

  addEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    this.listeners.set(type, listener as (event: MessageEvent<string>) => void);
  }

  close(): void {
    this.closed = true;
  }

  emit(type: string, data: unknown): void {
    this.listeners.get(type)?.({ data: JSON.stringify(data) } as MessageEvent<string>);
  }
}

describe('ShoppingEventsService', () => {
  beforeEach(() => {
    vi.stubGlobal('EventSource', FakeEventSource);
    TestBed.configureTestingModule({});
  });

  afterEach(() => vi.unstubAllGlobals());

  it('opens a household stream and emits parsed item changes', () => {
    const service = TestBed.inject(ShoppingEventsService);
    const received: unknown[] = [];
    const subscription = service.connect('family one').subscribe((event) => received.push(event));

    expect(FakeEventSource.instance.url).toBe('/api/households/family%20one/events');
    FakeEventSource.instance.emit('shopping-item.changed', { action: 'created', item: { id: 'item-1' } });
    expect(received).toEqual([{ action: 'created', item: { id: 'item-1' } }]);

    subscription.unsubscribe();
    expect(FakeEventSource.instance.closed).toBe(true);
  });
});
