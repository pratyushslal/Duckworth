import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { App } from './app';
import { UnitHistoryCache } from './core/unit-history-cache';
import { afterEach, beforeEach as vitestBeforeEach, describe, expect, it, vi } from 'vitest';

class FakeEventSource {
  addEventListener(): void {}
  close(): void {}
}

class FakeStorage {
  private readonly values = new Map<string, string>();
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, value); }
}

describe('App', () => {
  let httpTesting: HttpTestingController;

  vitestBeforeEach(() => {
    vi.stubGlobal('EventSource', FakeEventSource);
    vi.stubGlobal('localStorage', new FakeStorage());
  });

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    httpTesting = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpTesting.verify();
    vi.unstubAllGlobals();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    expect(app).toBeTruthy();
    fixture.detectChanges();
    httpTesting.expectOne('/health').flush({ status: 'ok' });
    httpTesting.expectOne('/api/v1/households/household-demo/items?includePurchased=true').flush([]);
  });

  it('renders the foundation screen when the API is ready', async () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    httpTesting.expectOne('/health').flush({ status: 'ok' });
    httpTesting.expectOne('/api/v1/households/household-demo/items?includePurchased=true').flush([]);
    await fixture.whenStable();
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('h1')?.textContent).toContain('Shopping coordination starts here.');
    expect(compiled.querySelector('[role="status"]')?.textContent).toContain('API connected');
  });

  it('shows rename failures beside the item being edited', async () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    httpTesting.expectOne('/health').flush({ status: 'ok' });
    httpTesting.expectOne('/api/v1/households/household-demo/items?includePurchased=true').flush([{
      id: 'item-1', householdId: 'household-demo', captureText: 'Authoritative milk',
      name: 'Authoritative milk', quantity: null, unit: null, unitSource: null, unitConfirmedAt: null,
      attentionReasons: ['missing_quantity'], status: 'active',
      createdAt: '2026-08-03T00:00:00.000Z', updatedAt: '2026-08-03T00:00:00.000Z', version: 1,
    }]);
    await fixture.whenStable();
    fixture.detectChanges();

    const row = fixture.nativeElement.querySelector('li') as HTMLElement;
    (Array.from(row.querySelectorAll('button')).find((button) => button.textContent?.trim() === 'Edit') as HTMLButtonElement).click();
    fixture.detectChanges();
    const input = row.querySelector('input[aria-label="Edit item"]') as HTMLInputElement;
    input.value = 'milk';
    input.dispatchEvent(new Event('input'));
    (Array.from(row.querySelectorAll('button')).find((button) => button.textContent?.trim() === 'Save') as HTMLButtonElement).click();
    httpTesting.expectOne('/api/v1/households/household-demo/items/item-1').flush({ error: 'internal_error' }, { status: 500, statusText: 'Server Error' });
    await fixture.whenStable();
    fixture.detectChanges();

    expect(row.querySelector('[role="alert"]')?.textContent).toContain("We couldn't save");
    expect(fixture.nativeElement.querySelector('.message')).toBeNull();
  });

  it('previews typed shorthand immediately without an HTTP request', async () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    httpTesting.expectOne('/health').flush({ status: 'ok' });
    httpTesting.expectOne('/api/v1/households/household-demo/items?includePurchased=true').flush([]);
    await fixture.whenStable();
    fixture.detectChanges();

    const input = fixture.nativeElement.querySelector('#item-name') as HTMLInputElement;
    input.value = '1.5 kg potatoes';
    input.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.capture-preview')?.textContent).toContain('1.5 kg');
    expect(fixture.nativeElement.querySelector('.capture-preview')?.textContent).toContain('potatoes');
    httpTesting.expectNone(() => true);
  });

  it('previews trailing quantity and unit shorthand immediately', async () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    httpTesting.expectOne('/health').flush({ status: 'ok' });
    httpTesting.expectOne('/api/v1/households/household-demo/items?includePurchased=true').flush([]);
    await fixture.whenStable();
    fixture.detectChanges();

    const input = fixture.nativeElement.querySelector('#item-name') as HTMLInputElement;
    input.value = 'biscuits 2 pcs';
    input.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.capture-preview')?.textContent).toContain('2 piece');
    expect(fixture.nativeElement.querySelector('.capture-preview')?.textContent).toContain('biscuits');
    httpTesting.expectNone(() => true);
  });

  it('previews a bare item as needing quantity without blocking capture', async () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    httpTesting.expectOne('/health').flush({ status: 'ok' });
    httpTesting.expectOne('/api/v1/households/household-demo/items?includePurchased=true').flush([]);
    await fixture.whenStable();
    fixture.detectChanges();

    const input = fixture.nativeElement.querySelector('#item-name') as HTMLInputElement;
    input.value = 'milk';
    input.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.capture-preview')?.textContent).toContain('Needs quantity');
    expect((fixture.nativeElement.querySelector('.add-form button') as HTMLButtonElement).disabled).toBe(false);
  });

  it('blocks invalid shorthand locally with accessible feedback', async () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    httpTesting.expectOne('/health').flush({ status: 'ok' });
    httpTesting.expectOne('/api/v1/households/household-demo/items?includePurchased=true').flush([]);
    await fixture.whenStable();
    fixture.detectChanges();

    const input = fixture.nativeElement.querySelector('#item-name') as HTMLInputElement;
    input.value = '2';
    input.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    fixture.detectChanges();
    (fixture.nativeElement.querySelector('.add-form button') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.capture-error[role="alert"]')?.textContent)
      .toContain('Add an item name after the quantity');
    httpTesting.expectNone(() => true);
  });

  it('keeps capture responsive and unrelated rows enabled while saving', async () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    httpTesting.expectOne('/health').flush({ status: 'ok' });
    httpTesting.expectOne('/api/v1/households/household-demo/items?includePurchased=true').flush([{
      id: 'item-1', householdId: 'household-demo', captureText: 'Bread', name: 'Bread',
      quantity: null, unit: null, unitSource: null, unitConfirmedAt: null,
      attentionReasons: ['missing_quantity'], status: 'active',
      createdAt: '2026-08-03T00:00:00.000Z', updatedAt: '2026-08-03T00:00:00.000Z', version: 1,
    }]);
    await fixture.whenStable();
    fixture.detectChanges();

    const input = fixture.nativeElement.querySelector('#item-name') as HTMLInputElement;
    input.value = '1.5 kg potatoes';
    input.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    fixture.detectChanges();
    (fixture.nativeElement.querySelector('.add-form button') as HTMLButtonElement).click();
    const request = httpTesting.expectOne('/api/v1/households/household-demo/items');
    fixture.detectChanges();

    expect(input.value).toBe('1.5 kg potatoes');
    expect(fixture.nativeElement.querySelector('.capture-preview')?.textContent).toContain('potatoes');
    expect(fixture.nativeElement.querySelector('.add-form button')?.textContent).toContain('Saving');
    expect((fixture.nativeElement.querySelector('li .secondary-button') as HTMLButtonElement).disabled).toBe(false);

    request.flush({
      id: 'item-2', householdId: 'household-demo', captureText: '1.5 kg potatoes', name: 'potatoes',
      quantity: 1.5, unit: 'kg', unitSource: 'explicit', unitConfirmedAt: '2026-08-04T00:00:00.000Z',
      attentionReasons: [], status: 'active', createdAt: '2026-08-04T00:00:00.000Z',
      updatedAt: '2026-08-04T00:00:00.000Z', version: 1,
    });
    await fixture.whenStable();
    fixture.detectChanges();
    expect(input.value).toBe('');
  });

  it('shows a direct details action for an item missing quantity', async () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    httpTesting.expectOne('/health').flush({ status: 'ok' });
    httpTesting.expectOne('/api/v1/households/household-demo/items?includePurchased=true').flush([{
      id: 'item-1', householdId: 'household-demo', captureText: 'Milk', name: 'Milk',
      quantity: null, unit: null, unitSource: null, unitConfirmedAt: null,
      attentionReasons: ['missing_quantity'], status: 'active',
      createdAt: '2026-08-03T00:00:00.000Z', updatedAt: '2026-08-03T00:00:00.000Z', version: 1,
    }]);
    await fixture.whenStable();
    fixture.detectChanges();

    const row = fixture.nativeElement.querySelector('li') as HTMLElement;
    expect(row.textContent).toContain('Needs details');
    expect(Array.from(row.querySelectorAll('button')).some((button) => button.textContent?.includes('Add details')))
      .toBe(true);
  });

  it('opens row-local quantity and unit fields with quantity focused', async () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    httpTesting.expectOne('/health').flush({ status: 'ok' });
    httpTesting.expectOne('/api/v1/households/household-demo/items?includePurchased=true').flush([{
      id: 'item-1', householdId: 'household-demo', captureText: 'Milk', name: 'Milk',
      quantity: null, unit: null, unitSource: null, unitConfirmedAt: null,
      attentionReasons: ['missing_quantity'], status: 'active',
      createdAt: '2026-08-03T00:00:00.000Z', updatedAt: '2026-08-03T00:00:00.000Z', version: 1,
    }]);
    await fixture.whenStable();
    fixture.detectChanges();

    const row = fixture.nativeElement.querySelector('li') as HTMLElement;
    (Array.from(row.querySelectorAll('button')).find((button) => button.textContent?.includes('Add details')) as HTMLButtonElement).click();
    await fixture.whenStable();
    fixture.detectChanges();

    const quantity = row.querySelector('input[aria-label="Quantity for Milk"]') as HTMLInputElement;
    const unit = row.querySelector('input[aria-label="Unit for Milk"]') as HTMLInputElement;
    expect(quantity).toBeTruthy();
    expect(unit).toBeTruthy();
    expect(document.activeElement).toBe(quantity);
    expect(Array.from(row.querySelectorAll('button')).map((button) => button.textContent?.trim()))
      .toEqual(expect.arrayContaining(['Save details', 'Cancel']));
  });

  it('saves structured details without disabling unrelated rows', async () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    httpTesting.expectOne('/health').flush({ status: 'ok' });
    httpTesting.expectOne('/api/v1/households/household-demo/items?includePurchased=true').flush([
      {
        id: 'item-1', householdId: 'household-demo', captureText: 'Milk', name: 'Milk',
        quantity: null, unit: null, unitSource: null, unitConfirmedAt: null,
        attentionReasons: ['missing_quantity'], status: 'active',
        createdAt: '2026-08-03T00:00:00.000Z', updatedAt: '2026-08-03T00:00:00.000Z', version: 2,
      },
      {
        id: 'item-2', householdId: 'household-demo', captureText: '1 bread', name: 'bread',
        quantity: 1, unit: null, unitSource: null, unitConfirmedAt: null,
        attentionReasons: [], status: 'active',
        createdAt: '2026-08-03T00:00:00.000Z', updatedAt: '2026-08-03T00:00:00.000Z', version: 1,
      },
    ]);
    await fixture.whenStable();
    fixture.detectChanges();

    const rows = fixture.nativeElement.querySelectorAll('li') as NodeListOf<HTMLElement>;
    (Array.from(rows[0].querySelectorAll('button')).find((button) => button.textContent?.includes('Add details')) as HTMLButtonElement).click();
    fixture.detectChanges();
    const quantity = rows[0].querySelector('input[aria-label="Quantity for Milk"]') as HTMLInputElement;
    quantity.value = '2';
    quantity.dispatchEvent(new Event('input'));
    const unit = rows[0].querySelector('input[aria-label="Unit for Milk"]') as HTMLInputElement;
    unit.value = 'cartons';
    unit.dispatchEvent(new Event('input'));
    (Array.from(rows[0].querySelectorAll('button')).find((button) => button.textContent?.trim() === 'Save details') as HTMLButtonElement).click();

    const request = httpTesting.expectOne('/api/v1/households/household-demo/items/item-1');
    expect(request.request.body).toEqual({ quantity: 2, confirmedUnit: 'cartons', expectedVersion: 2 });
    fixture.detectChanges();
    expect((Array.from(rows[1].querySelectorAll('button')).find((button) => button.textContent?.trim() === 'Edit') as HTMLButtonElement).disabled).toBe(false);
    expect(rows[0].textContent).toContain('Saving');

    request.flush({
      id: 'item-1', householdId: 'household-demo', captureText: 'Milk', name: 'Milk',
      quantity: 2, unit: 'cartons', unitSource: 'explicit', unitConfirmedAt: '2026-08-04T00:00:00.000Z',
      attentionReasons: [], status: 'active', createdAt: '2026-08-03T00:00:00.000Z',
      updatedAt: '2026-08-04T00:00:00.000Z', version: 3,
    });
    await fixture.whenStable();
    fixture.detectChanges();
    expect(rows[0].textContent).toContain('2 cartons');
    expect(rows[0].textContent).not.toContain('Needs details');
  });

  it('highlights an inferred unit with an easy non-blocking acceptance action', async () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    httpTesting.expectOne('/health').flush({ status: 'ok' });
    httpTesting.expectOne('/api/v1/households/household-demo/items?includePurchased=true').flush([{
      id: 'item-1', householdId: 'household-demo', captureText: '2 Milk', name: 'Milk',
      quantity: 2, unit: 'carton', unitSource: 'history', unitConfirmedAt: null,
      attentionReasons: ['unconfirmed_historical_unit'], status: 'active',
      createdAt: '2026-08-03T00:00:00.000Z', updatedAt: '2026-08-03T00:00:00.000Z', version: 4,
    }]);
    await fixture.whenStable();
    fixture.detectChanges();

    const row = fixture.nativeElement.querySelector('li') as HTMLElement;
    const notice = row.querySelector('.unit-suggestion') as HTMLElement;
    expect(notice.textContent).toContain('carton');
    expect(notice.textContent).toContain('From last time');
    expect(notice.textContent).toContain('Check before ordering');
    const accept = Array.from(row.querySelectorAll('button')).find((button) => button.textContent?.trim() === 'Accept carton') as HTMLButtonElement;
    expect(accept).toBeTruthy();
    expect(Array.from(row.querySelectorAll('button')).some((button) => button.textContent?.trim() === 'Change unit')).toBe(true);
    expect(accept.disabled).toBe(false);
    expect((Array.from(row.querySelectorAll('button')).find((button) => button.textContent?.trim() === 'Purchased') as HTMLButtonElement).disabled).toBe(false);
  });

  it('accepts a historical unit with one versioned update and removes the warning', async () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    httpTesting.expectOne('/health').flush({ status: 'ok' });
    httpTesting.expectOne('/api/v1/households/household-demo/items?includePurchased=true').flush([{
      id: 'item-1', householdId: 'household-demo', captureText: '2 Milk', name: 'Milk',
      quantity: 2, unit: 'carton', unitSource: 'history', unitConfirmedAt: null,
      attentionReasons: ['unconfirmed_historical_unit'], status: 'active',
      createdAt: '2026-08-03T00:00:00.000Z', updatedAt: '2026-08-03T00:00:00.000Z', version: 4,
    }]);
    await fixture.whenStable();
    fixture.detectChanges();

    const row = fixture.nativeElement.querySelector('li') as HTMLElement;
    (Array.from(row.querySelectorAll('button')).find((button) => button.textContent?.trim() === 'Accept carton') as HTMLButtonElement).click();
    const request = httpTesting.expectOne('/api/v1/households/household-demo/items/item-1');
    expect(request.request.body).toEqual({ confirmedUnit: 'carton', expectedVersion: 4 });
    fixture.detectChanges();
    expect(row.textContent).toContain('Accepting');

    request.flush({
      id: 'item-1', householdId: 'household-demo', captureText: '2 Milk', name: 'Milk', quantity: 2,
      unit: 'carton', unitSource: 'explicit', unitConfirmedAt: '2026-08-04T00:00:00.000Z',
      attentionReasons: [], status: 'active', createdAt: '2026-08-03T00:00:00.000Z',
      updatedAt: '2026-08-04T00:00:00.000Z', version: 5,
    });
    await fixture.whenStable();
    fixture.detectChanges();
    expect(row.querySelector('.unit-suggestion')).toBeNull();
    expect(row.textContent).not.toContain('Accept carton');
  });

  it('shows cached household history synchronously before the list request completes', async () => {
    const cache = new UnitHistoryCache(localStorage);
    cache.replaceFromItems('household-demo', [{
      id: 'old-milk', householdId: 'household-demo', captureText: '2 cartons Milk', name: 'Milk',
      quantity: 2, unit: 'carton', unitSource: 'explicit', unitConfirmedAt: '2026-08-01T00:00:00.000Z',
      attentionReasons: [], status: 'purchased', createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:00:00.000Z', version: 2,
    }]);
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    httpTesting.expectOne('/health').flush({ status: 'ok' });
    await fixture.whenStable();
    fixture.detectChanges();

    const input = fixture.nativeElement.querySelector('#item-name') as HTMLInputElement;
    input.value = '2 milk';
    input.dispatchEvent(new Event('input'));
    await Promise.resolve();
    fixture.detectChanges();

    const preview = fixture.nativeElement.querySelector('.capture-preview') as HTMLElement;
    expect(preview.textContent).toContain('2 carton');
    expect(preview.textContent).toContain('From last time');
    httpTesting.expectOne('/api/v1/households/household-demo/items?includePurchased=true').flush([]);
  });

  it('refreshes local suggestions from the last successful item list', async () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    httpTesting.expectOne('/health').flush({ status: 'ok' });
    httpTesting.expectOne('/api/v1/households/household-demo/items?includePurchased=true').flush([{
      id: 'old-milk', householdId: 'household-demo', captureText: '2 cartons Milk', name: 'Milk',
      quantity: 2, unit: 'carton', unitSource: 'explicit', unitConfirmedAt: '2026-08-01T00:00:00.000Z',
      attentionReasons: [], status: 'purchased', createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:00:00.000Z', version: 2,
    }]);
    await fixture.whenStable();
    fixture.detectChanges();

    const input = fixture.nativeElement.querySelector('#item-name') as HTMLInputElement;
    input.value = '2 milk';
    input.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.capture-preview')?.textContent).toContain('2 carton');
    expect(new UnitHistoryCache(localStorage).read('household-demo')['milk'].unit).toBe('carton');
  });

  it('lets the user accept a cached unit before adding the item', async () => {
    new UnitHistoryCache(localStorage).replaceFromItems('household-demo', [{
      id: 'old-milk', householdId: 'household-demo', captureText: '2 cartons Milk', name: 'Milk',
      quantity: 2, unit: 'carton', unitSource: 'explicit', unitConfirmedAt: '2026-08-01T00:00:00.000Z',
      attentionReasons: [], status: 'purchased', createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:00:00.000Z', version: 2,
    }]);
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    httpTesting.expectOne('/health').flush({ status: 'ok' });
    await fixture.whenStable();
    fixture.detectChanges();

    const input = fixture.nativeElement.querySelector('#item-name') as HTMLInputElement;
    input.value = '2 milk';
    input.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    fixture.detectChanges();
    const accept = Array.from(fixture.nativeElement.querySelectorAll('.capture-preview button') as NodeListOf<HTMLButtonElement>)
      .find((button) => button.textContent?.trim() === 'Accept carton') as HTMLButtonElement;
    expect(accept).toBeTruthy();
    accept.click();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.capture-preview')?.textContent).toContain('Accepted for this item');

    (fixture.nativeElement.querySelector('.add-form button') as HTMLButtonElement).click();
    const create = httpTesting.expectOne((request) => request.method === 'POST');
    expect(create.request.body).toEqual({ input: '2 milk', confirmedUnit: 'carton' });
    create.flush({
      id: 'item-1', householdId: 'household-demo', captureText: '2 milk', name: 'milk', quantity: 2,
      unit: 'carton', unitSource: 'explicit', unitConfirmedAt: '2026-08-04T00:00:00.000Z',
      attentionReasons: [], status: 'active', createdAt: '2026-08-04T00:00:00.000Z',
      updatedAt: '2026-08-04T00:00:00.000Z', version: 1,
    });
    httpTesting.expectOne('/api/v1/households/household-demo/items?includePurchased=true').flush([]);
  });

  it('keeps another row interactive while a purchase update is pending', async () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    httpTesting.expectOne('/health').flush({ status: 'ok' });
    const base = {
      householdId: 'household-demo', quantity: 1, unit: null, unitSource: null, unitConfirmedAt: null,
      attentionReasons: [], status: 'active' as const, createdAt: '2026-08-03T00:00:00.000Z',
      updatedAt: '2026-08-03T00:00:00.000Z', version: 1,
    };
    httpTesting.expectOne('/api/v1/households/household-demo/items?includePurchased=true').flush([
      { ...base, id: 'item-1', captureText: '1 Bread', name: 'Bread' },
      { ...base, id: 'item-2', captureText: '1 Rice', name: 'Rice' },
    ]);
    await fixture.whenStable();
    fixture.detectChanges();

    const rows = fixture.nativeElement.querySelectorAll('li') as NodeListOf<HTMLElement>;
    (Array.from(rows[0].querySelectorAll('button')).find((button) => button.textContent?.trim() === 'Purchased') as HTMLButtonElement).click();
    const purchase = httpTesting.expectOne('/api/v1/households/household-demo/items/item-1');
    fixture.detectChanges();

    expect((Array.from(rows[1].querySelectorAll('button')).find((button) => button.textContent?.trim() === 'Edit') as HTMLButtonElement).disabled).toBe(false);
    purchase.flush({ ...base, id: 'item-1', captureText: '1 Bread', name: 'Bread', status: 'purchased', version: 2 });
  });

  it('validates custom unit length beside the row without making a request', async () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    httpTesting.expectOne('/health').flush({ status: 'ok' });
    httpTesting.expectOne('/api/v1/households/household-demo/items?includePurchased=true').flush([{
      id: 'item-1', householdId: 'household-demo', captureText: 'Milk', name: 'Milk', quantity: null,
      unit: null, unitSource: null, unitConfirmedAt: null, attentionReasons: ['missing_quantity'],
      status: 'active', createdAt: '2026-08-03T00:00:00.000Z', updatedAt: '2026-08-03T00:00:00.000Z', version: 1,
    }]);
    await fixture.whenStable();
    fixture.detectChanges();
    const row = fixture.nativeElement.querySelector('li') as HTMLElement;
    (Array.from(row.querySelectorAll('button')).find((button) => button.textContent?.includes('Add details')) as HTMLButtonElement).click();
    fixture.detectChanges();
    const quantity = row.querySelector('input[aria-label="Quantity for Milk"]') as HTMLInputElement;
    quantity.value = '2';
    quantity.dispatchEvent(new Event('input'));
    const unit = row.querySelector('input[aria-label="Unit for Milk"]') as HTMLInputElement;
    unit.value = 'x'.repeat(33);
    unit.dispatchEvent(new Event('input'));
    (Array.from(row.querySelectorAll('button')).find((button) => button.textContent?.trim() === 'Save details') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(row.querySelector('[role="alert"]')?.textContent).toContain('32 characters');
    httpTesting.expectNone((request) => request.method === 'PATCH');
  });
});
