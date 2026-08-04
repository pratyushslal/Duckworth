import { describe, expect, it } from 'vitest';
import { HouseholdEventHub } from '../src/event-hub.js';
import type { ShoppingItem } from '../src/shopping-items.js';

const item: ShoppingItem = {
  id: 'item-1',
  householdId: 'family-a',
  captureText: 'Milk',
  name: 'Milk',
  quantity: null,
  unit: null,
  unitSource: null,
  unitConfirmedAt: null,
  attentionReasons: ['missing_quantity'],
  status: 'active',
  createdAt: '2026-08-03T00:00:00.000Z',
  updatedAt: '2026-08-03T00:00:00.000Z',
  version: 1,
};

describe('household event hub', () => {
  it('publishes events only to subscribers for the same household', () => {
    const hub = new HouseholdEventHub();
    const familyEvents: unknown[] = [];
    const otherEvents: unknown[] = [];
    hub.subscribe('family-a', (event) => familyEvents.push(event));
    hub.subscribe('family-b', (event) => otherEvents.push(event));

    hub.publish('family-a', { action: 'created', item });

    expect(familyEvents).toEqual([{ action: 'created', item }]);
    expect(otherEvents).toEqual([]);
  });

  it('stops delivering events after unsubscribe', () => {
    const hub = new HouseholdEventHub();
    const events: unknown[] = [];
    const unsubscribe = hub.subscribe('family-a', (event) => events.push(event));
    unsubscribe();
    hub.publish('family-a', { action: 'updated', item });
    expect(events).toEqual([]);
  });
});
