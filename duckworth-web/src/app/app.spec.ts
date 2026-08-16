import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { EMPTY } from 'rxjs';
import { App } from './app';
import { ListPreferences } from './core/list-preferences';
import { UnitHistoryCache } from './core/unit-history-cache';
import { LanguagePackApiService } from './core/language-pack-api.service';
import { ConversationContextService } from './core/conversation-context.service';
import { HouseholdSettingsService } from './core/household-settings.service';
import { afterEach, beforeEach as vitestBeforeEach, describe, expect, it, vi } from 'vitest';

class FakeEventSource {
  static latest: FakeEventSource | undefined;
  private listener?: (event: MessageEvent<string>) => void;

  constructor() {
    FakeEventSource.latest = this;
  }

  addEventListener(_type: string, listener: (event: MessageEvent<string>) => void): void {
    this.listener = listener;
  }

  emit(value: unknown): void {
    this.listener?.({ data: JSON.stringify(value) } as MessageEvent<string>);
  }

  close(): void {}
}

class FakeStorage {
  private readonly values = new Map<string, string>();
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, value); }
}

describe('App', () => {
  let httpTesting: HttpTestingController;

  const flushConversationCapture = (saved: unknown[], merged: unknown[] = []): void => {
    httpTesting.expectOne('/api/v1/households/household-demo/conversation-captures').flush({
      session: { id: 'session-1', householdId: 'household-demo', status: 'active', closedAt: null },
      saved,
      merged,
      drafts: [],
      undo: [],
    });
  };

  vitestBeforeEach(() => {
    FakeEventSource.latest = undefined;
    vi.stubGlobal('EventSource', FakeEventSource);
    vi.stubGlobal('localStorage', new FakeStorage());
  });

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [
        provideHttpClient(), provideHttpClientTesting(),
        { provide: LanguagePackApiService, useValue: {
          getManifest: () => Promise.reject(new Error('offline in app unit tests')),
          downloadPack: () => Promise.reject(new Error('offline in app unit tests')),
          downloadRegionalProducts: () => Promise.reject(new Error('offline in app unit tests')),
        } },
        { provide: ConversationContextService, useValue: {
          current: signal(null),
          initialize: () => EMPTY,
          register: () => EMPTY,
          close: () => EMPTY,
        } },
      ],
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
    httpTesting.expectOne('/api/v1/households/household-demo/items?includePurchased=true&includeRemoved=true').flush([]);
  });

  it('waits for a verified runtime identity before loading data and marks sandbox clearly', async () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();

    const health = httpTesting.expectOne('/health');
    httpTesting.expectNone('/api/v1/households/household-demo/items?includePurchased=true&includeRemoved=true');
    health.flush({ status: 'ok', lane: 'sandbox', instanceId: 'sandbox-laptop' });
    httpTesting.expectOne('/api/v1/households/household-demo/items?includePurchased=true&includeRemoved=true').flush([]);
    await fixture.whenStable();
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).querySelector('[data-runtime-lane="sandbox"]')?.textContent)
      .toContain('Testing workspace');
  });

  it('shows each canonical item once per selected shop filter and keeps the all count canonical', async () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    httpTesting.expectOne('/health').flush({ status: 'ok' });
    httpTesting.expectOne('/api/v1/households/household-demo/items?includePurchased=true&includeRemoved=true').flush([
      { id: 'shared', name: 'Shared item', captureText: 'Shared item', status: 'active', quantity: 1, unit: 'piece', packageSize: null, packageUnit: null, attentionReasons: [], createdAt: '2026-08-13T00:00:00.000Z', shopTypes: [{ id: 'shop-one', label: 'Shop one' }, { id: 'shop-two', label: 'Shop two' }] },
      { id: 'second', name: 'Second item', captureText: 'Second item', status: 'active', quantity: 1, unit: 'piece', packageSize: null, packageUnit: null, attentionReasons: [], createdAt: '2026-08-13T00:01:00.000Z', shopTypes: [{ id: 'shop-two', label: 'Shop two' }] },
      { id: 'purchased', name: 'Purchased item', captureText: 'Purchased item', status: 'purchased', quantity: 1, unit: 'piece', packageSize: null, packageUnit: null, attentionReasons: [], createdAt: '2026-08-13T00:02:00.000Z', shopTypes: [{ id: 'shop-one', label: 'Shop one' }] },
    ]);
    await fixture.whenStable();
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('.count')?.textContent?.trim()).toBe('2');
    expect(root.querySelectorAll('.item-list li')).toHaveLength(3);
    (Array.from(root.querySelectorAll<HTMLButtonElement>('.shop-type-filter'))
      .find((button) => button.textContent?.includes('Shop one')) as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(root.querySelectorAll('.item-list li')).toHaveLength(1);
    expect(root.querySelector('.item-list')?.textContent).toContain('Shared item');
    expect(root.querySelector('.item-list')?.textContent).not.toContain('Purchased item');
  });

  it('keeps an unclassified item visible in the initial Unassigned filter', async () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    httpTesting.expectOne('/health').flush({ status: 'ok' });
    httpTesting.expectOne('/api/v1/households/household-demo/items?includePurchased=true&includeRemoved=true').flush([
      { id: 'unknown', name: 'unfamiliar item', captureText: 'unfamiliar item', status: 'active', quantity: 1, unit: 'piece', packageSize: null, packageUnit: null, attentionReasons: [], createdAt: '2026-08-13T00:00:00.000Z', shopTypes: [] },
      { id: 'known', name: 'milk', captureText: 'milk', status: 'active', quantity: 1, unit: 'piece', packageSize: null, packageUnit: null, attentionReasons: [], createdAt: '2026-08-13T00:00:00.000Z', shopTypes: [{ id: 'shop-one', label: 'Shop one' }] },
    ]);
    await fixture.whenStable();
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    const unassigned = Array.from(root.querySelectorAll<HTMLButtonElement>('.shop-type-filter'))
      .find((button) => button.textContent?.includes('Unassigned'));
    expect(unassigned?.textContent).toContain('1');
    unassigned?.click();
    fixture.detectChanges();
    expect(root.querySelector('.item-list')?.textContent).toContain('unfamiliar item');
    expect(root.querySelector('.item-list')?.textContent).not.toContain('milk');
  });

  it('renders the foundation screen when the API is ready', async () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    httpTesting.expectOne('/health').flush({ status: 'ok' });
    httpTesting.expectOne('/api/v1/households/household-demo/items?includePurchased=true&includeRemoved=true').flush([]);
    await fixture.whenStable();
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('h1')?.textContent).toContain('Shopping coordination starts here.');
    expect(compiled.querySelector('[role="status"]')?.textContent).toContain('API connected');
  });

  it('presents saved, merged, draft, undo, and close outcomes from one brain result', async () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    httpTesting.expectOne('/health').flush({ status: 'ok' });
    httpTesting.expectOne('/api/v1/households/household-demo/items?includePurchased=true&includeRemoved=true').flush([]);
    await fixture.whenStable();
    fixture.detectChanges();

    const input = fixture.nativeElement.querySelector('#item-name') as HTMLInputElement;
    input.value = 'Add Apple iPhone and 4 milk pouches of 1 litre each';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    fixture.detectChanges();
    (fixture.nativeElement.querySelector('.add-form button') as HTMLButtonElement).click();

    const capture = httpTesting.expectOne(
      '/api/v1/households/household-demo/conversation-captures',
    );
    expect(capture.request.body).toEqual({
      text: 'Add Apple iPhone and 4 milk pouches of 1 litre each',
      source: 'text',
    });
    capture.flush({
      session: { id: 'session-1', householdId: 'household-demo', status: 'active', closedAt: null },
      saved: [{ id: 'iphone', name: 'Apple iPhone' }, { id: 'milk', name: 'milk' }],
      merged: [{ id: 'butter', name: 'Amul butter' }],
      drafts: [{
        id: 'draft-1', householdId: 'household-demo', sessionId: 'session-1',
        text: 'the usual biscuits', reason: 'ambiguous_reference', status: 'open',
      }],
      undo: [{ eventId: 'event-1', itemId: 'butter' }],
    });
    httpTesting.expectOne('/api/v1/households/household-demo/items?includePurchased=true&includeRemoved=true').flush([]);
    await fixture.whenStable();
    fixture.detectChanges();

    const summary = fixture.nativeElement.querySelector('.conversation-summary') as HTMLElement;
    expect(summary.textContent).toContain('Saved 2');
    expect(summary.textContent).toContain('Updated 1');
    expect(summary.textContent).toContain('Needs clarification 1');
    const actions = Array.from(summary.querySelectorAll('button')).map((button) => button.textContent?.trim());
    expect(actions).toEqual(expect.arrayContaining(['Review', 'Dismiss', 'Undo']));
    expect(actions).not.toContain('Close conversation');
  });

  it('shows a temporary close prompt only for a server close-pending state', async () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    httpTesting.expectOne('/health').flush({ status: 'ok' });
    httpTesting.expectOne('/api/v1/households/household-demo/items?includePurchased=true&includeRemoved=true').flush([]);
    await fixture.whenStable();
    fixture.detectChanges();

    const input = fixture.nativeElement.querySelector('#item-name') as HTMLInputElement;
    input.value = 'done';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    fixture.detectChanges();
    (fixture.nativeElement.querySelector('.add-form button') as HTMLButtonElement).click();
    httpTesting.expectOne('/api/v1/households/household-demo/conversation-captures').flush({
      session: { id: 'session-pending', householdId: 'household-demo', status: 'close_pending', closedAt: null },
      pendingAction: { id: 'action-pending', status: 'pending' },
      saved: [], merged: [], drafts: [], undo: [],
    });
    httpTesting.expectOne('/api/v1/households/household-demo/items?includePurchased=true&includeRemoved=true').flush([]);
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.conversation-close-prompt')?.textContent)
      .toContain('Close this conversation?');
    expect(fixture.nativeElement.querySelector('button')?.textContent).not.toContain('Use this browser context');
    expect(fixture.nativeElement.textContent).not.toContain('Close context');
    expect(fixture.nativeElement.textContent).not.toContain('Close conversation');
  });

  it('presents the item identity before its quantity and pack count', async () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    httpTesting.expectOne('/health').flush({ status: 'ok' });
    httpTesting.expectOne('/api/v1/households/household-demo/items?includePurchased=true&includeRemoved=true').flush([{
      id: 'amul', householdId: 'household-demo', captureText: 'amul butter 500 gms 1 pac',
      name: 'Amul Butter', quantity: 1, unit: 'pack', packageSize: 500, packageUnit: 'g',
      brandId: 'brand.amul', productId: 'product.amul.butter', conceptId: 'grocery.butter.dairy',
      unitSource: 'explicit', unitConfirmedAt: '2026-08-05T00:00:00.000Z', attentionReasons: [],
      status: 'active', createdAt: '2026-08-05T00:00:00.000Z',
      updatedAt: '2026-08-05T00:00:00.000Z', version: 1,
    }]);
    await fixture.whenStable();
    fixture.detectChanges();

    const summary = fixture.nativeElement.querySelector('.item-summary') as HTMLElement;
    expect(summary.textContent?.replace(/\s+/gu, ' ').trim()).toBe('Amul Butter · 500 grams · 1 pack');
  });

  it('renders litres and recognized brands without ambiguous literals', async () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    httpTesting.expectOne('/health').flush({ status: 'ok' });
    httpTesting.expectOne('/api/v1/households/household-demo/items?includePurchased=true&includeRemoved=true').flush([{
      id: 'milk', householdId: 'household-demo', captureText: 'amul milk 1 l',
      name: 'milk', brandName: 'amul', quantity: 1, unit: 'l', packageSize: null, packageUnit: null,
      brandId: 'brand.amul', productId: null, conceptId: null, unitSource: 'explicit', unitConfirmedAt: null,
      attentionReasons: [], status: 'active', createdAt: '2026-08-05T00:00:00.000Z',
      updatedAt: '2026-08-05T00:00:00.000Z', version: 1,
    }]);
    await fixture.whenStable();
    fixture.detectChanges();

    const summary = fixture.nativeElement.querySelector('.item-summary') as HTMLElement;
    expect(summary.textContent?.replace(/\s+/gu, ' ').trim()).toBe('Amul milk · 1 litre');
    expect(summary.querySelector('.item-count')?.getAttribute('aria-label')).toBe('1 litre');
  });

  it('hides duplicate net content when package size is already displayed', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    httpTesting.expectOne('/health').flush({ status: 'ok' });
    httpTesting.expectOne('/api/v1/households/household-demo/items?includePurchased=true&includeRemoved=true').flush([]);

    const app = fixture.componentInstance as unknown as {
      semanticDetails: (item: {
        categoryId: string;
        packageSize: number | null;
        packageUnit: string | null;
        attributes: Record<string, unknown>;
      }) => string[];
    };

    expect(app.semanticDetails({
      categoryId: 'grocery',
      packageSize: 1,
      packageUnit: 'l',
      attributes: {
        'measure:net_content': '1 l',
        strength: '40 mg',
      },
    })).toEqual(['40 mg strength']);
  });

  it('keeps net content when package size is unavailable', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    httpTesting.expectOne('/health').flush({ status: 'ok' });
    httpTesting.expectOne('/api/v1/households/household-demo/items?includePurchased=true&includeRemoved=true').flush([]);

    const app = fixture.componentInstance as unknown as {
      semanticDetails: (item: {
        categoryId: string;
        packageSize: number | null;
        packageUnit: string | null;
        attributes: Record<string, unknown>;
      }) => string[];
    };

    expect(app.semanticDetails({
      categoryId: 'grocery',
      packageSize: null,
      packageUnit: null,
      attributes: { 'measure:net_content': '1 l' },
    })).toEqual(['1 l net content']);
  });

  it('opens one complete editor for an already structured packaged item', async () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    httpTesting.expectOne('/health').flush({ status: 'ok' });
    httpTesting.expectOne('/api/v1/households/household-demo/items?includePurchased=true&includeRemoved=true').flush([{
      id: 'amul', householdId: 'household-demo', captureText: 'amul butter 500 gms 1 pac',
      name: 'Amul Butter', quantity: 1, unit: 'pack', packageSize: 500, packageUnit: 'g',
      brandId: 'brand.amul', productId: 'product.amul.butter', conceptId: 'grocery.butter.dairy',
      unitSource: 'explicit', unitConfirmedAt: '2026-08-05T00:00:00.000Z', attentionReasons: [],
      status: 'active', createdAt: '2026-08-05T00:00:00.000Z',
      updatedAt: '2026-08-05T00:00:00.000Z', version: 1,
    }]);
    await fixture.whenStable();
    fixture.detectChanges();

    const row = fixture.nativeElement.querySelector('.item-list li') as HTMLElement;
    const edit = Array.from(row.querySelectorAll('button'))
      .find((button) => button.textContent?.trim() === 'Edit item') as HTMLButtonElement;
    expect(edit).toBeTruthy();
    edit.click();
    fixture.detectChanges();

    expect((row.querySelector('input[aria-label="Item name"]') as HTMLInputElement).value)
      .toBe('Amul Butter');
    expect((row.querySelector('input[aria-label="Quantity for Amul Butter"]') as HTMLInputElement).value)
      .toBe('1');
    expect((row.querySelector('input[aria-label="Unit for Amul Butter"]') as HTMLInputElement).value)
      .toBe('pack');
    expect((row.querySelector('input[aria-label="Package size for Amul Butter"]') as HTMLInputElement).value)
      .toBe('500');
    expect((row.querySelector('input[aria-label="Package unit for Amul Butter"]') as HTMLInputElement).value)
      .toBe('gram');
  });

  it('removes an accidental item with an immediate undo action', async () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    httpTesting.expectOne('/health').flush({ status: 'ok' });
    const item = {
      id: 'dukes', householdId: 'household-demo', captureText: 'Dukes Bourbon 50 g 1 pack',
      name: 'Dukes Bourbon', quantity: 1, unit: 'pack', packageSize: 50, packageUnit: 'g',
      brandId: 'brand.dukes', productId: 'product.dukes.bourbon', conceptId: 'grocery.biscuits.plain',
      unitSource: 'explicit', unitConfirmedAt: '2026-08-05T00:00:00.000Z', attentionReasons: [],
      status: 'active' as const, removedAt: null, createdAt: '2026-08-05T00:00:00.000Z',
      updatedAt: '2026-08-05T00:00:00.000Z', version: 1,
    };
    httpTesting.expectOne('/api/v1/households/household-demo/items?includePurchased=true&includeRemoved=true').flush([item]);
    await fixture.whenStable();
    fixture.detectChanges();

    const remove = Array.from(fixture.nativeElement.querySelectorAll('.item-list button') as NodeListOf<HTMLButtonElement>)
      .find((button) => button.textContent?.trim() === 'Remove') as HTMLButtonElement;
    expect(remove).toBeTruthy();
    remove.click();
    const removal = httpTesting.expectOne('/api/v1/households/household-demo/items/dukes');
    expect(removal.request.body).toEqual({ status: 'removed', expectedVersion: 1 });
    removal.flush({ ...item, status: 'removed', removedAt: '2026-08-06T00:00:00.000Z', version: 2 });
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.item-list')).toBeNull();
    const undo = Array.from(fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>)
      .find((button) => button.textContent?.trim() === 'Undo removal') as HTMLButtonElement;
    expect(undo).toBeTruthy();
    undo.click();
    const restoration = httpTesting.expectOne('/api/v1/households/household-demo/items/dukes');
    expect(restoration.request.body).toEqual({ status: 'active', expectedVersion: 2 });
    restoration.flush({ ...item, status: 'active', removedAt: null, version: 3 });
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.item-list')?.textContent).toContain('Dukes Bourbon');
  });

  it('restores a recently removed item after the application reloads', async () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    httpTesting.expectOne('/health').flush({ status: 'ok' });
    const removed = {
      id: 'dukes', householdId: 'household-demo', captureText: 'Dukes Bourbon 50 g 1 pack',
      name: 'Dukes Bourbon', quantity: 1, unit: 'pack', packageSize: 50, packageUnit: 'g',
      brandId: 'brand.dukes', productId: 'product.dukes.bourbon', conceptId: 'grocery.biscuits.plain',
      unitSource: 'explicit', unitConfirmedAt: '2026-08-05T00:00:00.000Z', attentionReasons: [],
      status: 'removed' as const, removedAt: '2026-08-06T00:00:00.000Z',
      createdAt: '2026-08-05T00:00:00.000Z', updatedAt: '2026-08-06T00:00:00.000Z', version: 2,
    };
    httpTesting.expectOne(
      '/api/v1/households/household-demo/items?includePurchased=true&includeRemoved=true',
    ).flush([removed]);
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.item-list')).toBeNull();
    const recent = fixture.nativeElement.querySelector('.recently-removed') as HTMLElement;
    expect(recent.textContent).toContain('Dukes Bourbon');
    const restore = Array.from(recent.querySelectorAll('button'))
      .find((button) => button.textContent?.trim() === 'Restore') as HTMLButtonElement;
    restore.click();

    const restoration = httpTesting.expectOne('/api/v1/households/household-demo/items/dukes');
    expect(restoration.request.body).toEqual({ status: 'active', expectedVersion: 2 });
    restoration.flush({ ...removed, status: 'active', removedAt: null, version: 3 });
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.item-list')?.textContent).toContain('Dukes Bourbon');
    expect(fixture.nativeElement.querySelector('.recently-removed')).toBeNull();
  });

  it('explicitly archives a reviewable snapshot without changing the active item', async () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    httpTesting.expectOne('/health').flush({ status: 'ok' });
    const bread = {
      id: 'bread', householdId: 'household-demo', captureText: '1 Bread', name: 'Bread', quantity: 1,
      unit: null, packageSize: null, packageUnit: null, brandId: null, productId: null, conceptId: null,
      unitSource: null, unitConfirmedAt: null, attentionReasons: [], status: 'active' as const, removedAt: null,
      createdAt: '2026-08-03T00:00:00.000Z', updatedAt: '2026-08-03T00:00:00.000Z', version: 1,
    };
    httpTesting.expectOne('/api/v1/households/household-demo/items?includePurchased=true&includeRemoved=true').flush([bread]);
    await fixture.whenStable();
    fixture.detectChanges();

    const archiveButton = Array.from(fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>)
      .find((button) => button.textContent?.trim() === 'Archive this list') as HTMLButtonElement;
    expect(archiveButton).toBeTruthy();
    archiveButton.click();
    fixture.detectChanges();
    const confirm = Array.from(fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>)
      .find((button) => button.textContent?.trim() === 'Confirm archive') as HTMLButtonElement;
    expect(confirm).toBeTruthy();
    confirm.click();

    const request = httpTesting.expectOne('/api/v1/households/household-demo/shopping-list-archives');
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({});
    request.flush({
      id: 'archive-1', householdId: 'household-demo', status: 'archived',
      createdAt: '2026-08-10T00:00:00.000Z', reopenedAt: null, items: [bread],
    });
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.item-list')?.textContent).toContain('Bread');
    const archive = fixture.nativeElement.querySelector('.list-archive') as HTMLElement;
    expect(archive.textContent).toContain('1 item');
    expect(Array.from(archive.querySelectorAll('button')).map((button) => button.textContent?.trim()))
      .toEqual(expect.arrayContaining(['Reopen', 'Copy to active list']));

    (Array.from(archive.querySelectorAll('button'))
      .find((button) => button.textContent?.trim() === 'Reopen') as HTMLButtonElement).click();
    httpTesting.expectOne(
      '/api/v1/households/household-demo/shopping-list-archives/archive-1/reopen',
    ).flush({
      id: 'archive-1', householdId: 'household-demo', status: 'reopened',
      createdAt: '2026-08-10T00:00:00.000Z', reopenedAt: '2026-08-11T00:00:00.000Z', items: [bread],
    });
    await fixture.whenStable();
    fixture.detectChanges();
    expect((fixture.nativeElement.querySelector('.list-archive') as HTMLElement).textContent)
      .toContain('Reopened for review');
    expect(fixture.nativeElement.querySelector('.item-list')?.textContent).toContain('Bread');

    const copy = Array.from(fixture.nativeElement.querySelectorAll('.list-archive button') as NodeListOf<HTMLButtonElement>)
      .find((button) => button.textContent?.trim() === 'Copy to active list') as HTMLButtonElement;
    copy.click();
    httpTesting.expectOne(
      '/api/v1/households/household-demo/shopping-list-archives/archive-1/copy',
    ).flush({
      archive: {
        id: 'archive-1', householdId: 'household-demo', status: 'reopened',
        createdAt: '2026-08-10T00:00:00.000Z', reopenedAt: '2026-08-11T00:00:00.000Z', items: [bread],
      },
      items: [bread],
    });
    httpTesting.expectOne('/api/v1/households/household-demo/items?includePurchased=true&includeRemoved=true').flush([bread]);
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.item-list')?.textContent).toContain('Bread');
  });

  it('defaults to Latest added and changes the persisted list order without an HTTP request', async () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    httpTesting.expectOne('/health').flush({ status: 'ok' });
    const base = {
      householdId: 'household-demo', quantity: 1, unit: null, unitSource: null, unitConfirmedAt: null,
      attentionReasons: [], status: 'active' as const, updatedAt: '2026-08-05T00:00:00.000Z', version: 1,
    };
    httpTesting.expectOne('/api/v1/households/household-demo/items?includePurchased=true&includeRemoved=true').flush([
      { ...base, id: 'older', captureText: '1 Milk', name: 'Milk', createdAt: '2026-08-03T00:00:00.000Z' },
      { ...base, id: 'newer', captureText: '1 Rice', name: 'Rice', createdAt: '2026-08-05T00:00:00.000Z' },
    ]);
    await fixture.whenStable();
    fixture.detectChanges();

    const select = fixture.nativeElement.querySelector('select[aria-label="Sort shopping items"]') as HTMLSelectElement;
    expect(select).toBeTruthy();
    expect(Array.from(select.options).map(({ text }) => text)).toEqual([
      'Latest added', 'Oldest added', 'Item name A–Z', 'Needs attention first',
    ]);
    expect(select.value).toBe('latest');
    expect(Array.from(fixture.nativeElement.querySelectorAll('.item-list li') as NodeListOf<HTMLElement>).map((row) => row.textContent))
      .toEqual([expect.stringContaining('Rice'), expect.stringContaining('Milk')]);

    select.value = 'oldest';
    select.dispatchEvent(new Event('change'));
    await fixture.whenStable();
    fixture.detectChanges();

    expect(Array.from(fixture.nativeElement.querySelectorAll('.item-list li') as NodeListOf<HTMLElement>).map((row) => row.textContent))
      .toEqual([expect.stringContaining('Milk'), expect.stringContaining('Rice')]);
    expect(new ListPreferences(localStorage, 'local-device').readSort('household-demo')).toBe('oldest');
    httpTesting.expectNone(() => true);
  });

  it('restores a valid saved sort choice for the local household profile', async () => {
    new ListPreferences(localStorage, 'local-device').writeSort('household-demo', 'name-asc');
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    httpTesting.expectOne('/health').flush({ status: 'ok' });
    const base = {
      householdId: 'household-demo', quantity: 1, unit: null, unitSource: null, unitConfirmedAt: null,
      attentionReasons: [], status: 'active' as const, createdAt: '2026-08-05T00:00:00.000Z',
      updatedAt: '2026-08-05T00:00:00.000Z', version: 1,
    };
    httpTesting.expectOne('/api/v1/households/household-demo/items?includePurchased=true&includeRemoved=true').flush([
      { ...base, id: 'rice', captureText: '1 Rice', name: 'Rice' },
      { ...base, id: 'milk', captureText: '1 Milk', name: 'Milk' },
    ]);
    await fixture.whenStable();
    fixture.detectChanges();

    expect((fixture.nativeElement.querySelector('select[aria-label="Sort shopping items"]') as HTMLSelectElement).value)
      .toBe('name-asc');
    expect(Array.from(fixture.nativeElement.querySelectorAll('.item-list li') as NodeListOf<HTMLElement>).map((row) => row.textContent))
      .toEqual([expect.stringContaining('Milk'), expect.stringContaining('Rice')]);
  });

  it('shows a successful create first under Latest added', async () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    httpTesting.expectOne('/health').flush({ status: 'ok' });
    httpTesting.expectOne('/api/v1/households/household-demo/items?includePurchased=true&includeRemoved=true').flush([{
      id: 'older', householdId: 'household-demo', captureText: '1 Bread', name: 'Bread', quantity: 1,
      unit: null, unitSource: null, unitConfirmedAt: null, attentionReasons: [], status: 'active',
      createdAt: '2026-08-03T00:00:00.000Z', updatedAt: '2026-08-03T00:00:00.000Z', version: 1,
    }]);
    await fixture.whenStable();
    fixture.detectChanges();

    const input = fixture.nativeElement.querySelector('#item-name') as HTMLInputElement;
    input.value = '1 Rice';
    input.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    fixture.detectChanges();
    (fixture.nativeElement.querySelector('.add-form button') as HTMLButtonElement).click();
    const newer = {
      id: 'newer', householdId: 'household-demo', captureText: '1 Rice', name: 'Rice', quantity: 1,
      unit: null, unitSource: null, unitConfirmedAt: null, attentionReasons: [], status: 'active',
      createdAt: '2026-08-05T00:00:00.000Z', updatedAt: '2026-08-05T00:00:00.000Z', version: 1,
    };
    flushConversationCapture([newer]);
    httpTesting.expectOne('/api/v1/households/household-demo/items?includePurchased=true&includeRemoved=true').flush([{
      id: 'older', householdId: 'household-demo', captureText: '1 Bread', name: 'Bread', quantity: 1,
      unit: null, unitSource: null, unitConfirmedAt: null, attentionReasons: [], status: 'active',
      createdAt: '2026-08-03T00:00:00.000Z', updatedAt: '2026-08-03T00:00:00.000Z', version: 1,
    }, newer]);
    await fixture.whenStable();
    fixture.detectChanges();

    expect(Array.from(fixture.nativeElement.querySelectorAll('.item-list li') as NodeListOf<HTMLElement>).map((row) => row.textContent))
      .toEqual([expect.stringContaining('Rice'), expect.stringContaining('Bread')]);
  });

  it('shows an SSE-created item first under Latest added', async () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    httpTesting.expectOne('/health').flush({ status: 'ok' });
    httpTesting.expectOne('/api/v1/households/household-demo/items?includePurchased=true&includeRemoved=true').flush([{
      id: 'older', householdId: 'household-demo', captureText: '1 Bread', name: 'Bread', quantity: 1,
      unit: null, unitSource: null, unitConfirmedAt: null, attentionReasons: [], status: 'active',
      createdAt: '2026-08-03T00:00:00.000Z', updatedAt: '2026-08-03T00:00:00.000Z', version: 1,
    }]);
    await fixture.whenStable();
    fixture.detectChanges();

    FakeEventSource.latest?.emit({
      action: 'created',
      item: {
        id: 'newer', householdId: 'household-demo', captureText: '1 Rice', name: 'Rice', quantity: 1,
        unit: null, unitSource: null, unitConfirmedAt: null, attentionReasons: [], status: 'active',
        createdAt: '2026-08-05T00:00:00.000Z', updatedAt: '2026-08-05T00:00:00.000Z', version: 1,
      },
    });
    fixture.detectChanges();

    expect(Array.from(fixture.nativeElement.querySelectorAll('.item-list li') as NodeListOf<HTMLElement>).map((row) => row.textContent))
      .toEqual([expect.stringContaining('Rice'), expect.stringContaining('Bread')]);
  });

  it('keeps a row edit draft attached to its item ID when the order changes', async () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    httpTesting.expectOne('/health').flush({ status: 'ok' });
    const base = {
      householdId: 'household-demo', quantity: 1, unit: null, unitSource: null, unitConfirmedAt: null,
      attentionReasons: [], status: 'active' as const, updatedAt: '2026-08-05T00:00:00.000Z', version: 1,
    };
    httpTesting.expectOne('/api/v1/households/household-demo/items?includePurchased=true&includeRemoved=true').flush([
      { ...base, id: 'bread', captureText: '1 Bread', name: 'Bread', createdAt: '2026-08-03T00:00:00.000Z' },
      { ...base, id: 'rice', captureText: '1 Rice', name: 'Rice', createdAt: '2026-08-05T00:00:00.000Z' },
    ]);
    await fixture.whenStable();
    fixture.detectChanges();

    const initialRows = Array.from(fixture.nativeElement.querySelectorAll('.item-list li') as NodeListOf<HTMLElement>);
    const breadRow = initialRows.find((row) => row.textContent?.includes('Bread')) as HTMLElement;
    (Array.from(breadRow.querySelectorAll('button')).find((button) => button.textContent?.trim() === 'Edit item') as HTMLButtonElement).click();
    fixture.detectChanges();
    const draft = breadRow.querySelector('input[aria-label="Item name"]') as HTMLInputElement;
    draft.value = 'Wholegrain Bread';
    draft.dispatchEvent(new Event('input'));

    const select = fixture.nativeElement.querySelector('select[aria-label="Sort shopping items"]') as HTMLSelectElement;
    select.value = 'oldest';
    select.dispatchEvent(new Event('change'));
    await fixture.whenStable();
    fixture.detectChanges();

    const reorderedRows = fixture.nativeElement.querySelectorAll('.item-list li') as NodeListOf<HTMLElement>;
    expect((reorderedRows[0].querySelector('input[aria-label="Item name"]') as HTMLInputElement).value)
      .toBe('Wholegrain Bread');
    expect(reorderedRows[1].textContent).toContain('Rice');
    httpTesting.expectNone(() => true);
  });

  it('shows rename failures beside the item being edited', async () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    httpTesting.expectOne('/health').flush({ status: 'ok' });
    httpTesting.expectOne('/api/v1/households/household-demo/items?includePurchased=true&includeRemoved=true').flush([{
      id: 'item-1', householdId: 'household-demo', captureText: 'Authoritative milk',
      name: 'Authoritative milk', quantity: null, unit: null, unitSource: null, unitConfirmedAt: null,
      attentionReasons: ['missing_quantity'], status: 'active',
      createdAt: '2026-08-03T00:00:00.000Z', updatedAt: '2026-08-03T00:00:00.000Z', version: 1,
    }]);
    await fixture.whenStable();
    fixture.detectChanges();

    const row = fixture.nativeElement.querySelector('li') as HTMLElement;
    (Array.from(row.querySelectorAll('button')).find((button) => button.textContent?.trim() === 'Edit item') as HTMLButtonElement).click();
    fixture.detectChanges();
    const input = row.querySelector('input[aria-label="Item name"]') as HTMLInputElement;
    input.value = 'milk';
    input.dispatchEvent(new Event('input'));
    (Array.from(row.querySelectorAll('button')).find((button) => button.textContent?.trim() === 'Save details') as HTMLButtonElement).click();
    httpTesting.expectOne('/api/v1/households/household-demo/items/item-1').flush({ error: 'internal_error' }, { status: 500, statusText: 'Server Error' });
    await fixture.whenStable();
    fixture.detectChanges();

    expect(row.querySelector('[role="alert"]')?.textContent).toContain("We couldn't save");
    expect(fixture.nativeElement.querySelector('.message')).toBeNull();
  });

  it('previews raw shorthand without interpreting it in the browser', async () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    httpTesting.expectOne('/health').flush({ status: 'ok' });
    httpTesting.expectOne('/api/v1/households/household-demo/items?includePurchased=true&includeRemoved=true').flush([]);
    await fixture.whenStable();
    fixture.detectChanges();

    const input = fixture.nativeElement.querySelector('#item-name') as HTMLInputElement;
    input.value = '1.5 kg potatoes';
    input.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.capture-preview')?.textContent).toContain('1.5 kg potatoes');
    expect(fixture.nativeElement.querySelector('.capture-preview')?.textContent).toContain('Quantity optional');
    httpTesting.expectNone(() => true);
  });

  it('does not reinterpret trailing shorthand in the browser', async () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    httpTesting.expectOne('/health').flush({ status: 'ok' });
    httpTesting.expectOne('/api/v1/households/household-demo/items?includePurchased=true&includeRemoved=true').flush([]);
    await fixture.whenStable();
    fixture.detectChanges();

    const input = fixture.nativeElement.querySelector('#item-name') as HTMLInputElement;
    input.value = 'biscuits 2 pcs';
    input.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.capture-preview')?.textContent).toContain('biscuits 2 pcs');
    expect(fixture.nativeElement.querySelector('.capture-preview')?.textContent).toContain('Quantity optional');
    httpTesting.expectNone(() => true);
  });

  it('keeps conversational capture raw until the authoritative brain responds', async () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    httpTesting.expectOne('/health').flush({ status: 'ok' });
    httpTesting.expectOne('/api/v1/households/household-demo/items?includePurchased=true&includeRemoved=true').flush([]);
    await fixture.whenStable();
    fixture.detectChanges();

    const input = fixture.nativeElement.querySelector('#item-name') as HTMLInputElement;
    input.value = 'I need 2 packs of Amul Butter 500 g';
    input.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    fixture.detectChanges();

    const preview = fixture.nativeElement.querySelector('.capture-preview') as HTMLElement;
    expect(preview.textContent?.replace(/\s+/gu, ' ').trim())
      .toBe('I need 2 packs of Amul Butter 500 g · Quantity optional');
    httpTesting.expectNone(() => true);
  });

  it('keeps multipack and fractional wording raw in the browser', async () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    httpTesting.expectOne('/health').flush({ status: 'ok' });
    httpTesting.expectOne('/api/v1/households/household-demo/items?includePurchased=true&includeRemoved=true').flush([]);
    await fixture.whenStable();
    fixture.detectChanges();

    const input = fixture.nativeElement.querySelector('#item-name') as HTMLInputElement;
    input.value = '2 trays of eggs 30 pcs each';
    input.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.capture-preview')?.textContent?.replace(/\s+/gu, ' ').trim())
      .toBe('2 trays of eggs 30 pcs each · Quantity optional');

    input.value = 'quarter kilo onions';
    input.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.capture-preview')?.textContent?.replace(/\s+/gu, ' ').trim())
      .toBe('quarter kilo onions · Quantity optional');
    httpTesting.expectNone(() => true);
  });

  it('previews a bare item with the safe one-piece default without blocking capture', async () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    httpTesting.expectOne('/health').flush({ status: 'ok' });
    httpTesting.expectOne('/api/v1/households/household-demo/items?includePurchased=true&includeRemoved=true').flush([]);
    await fixture.whenStable();
    fixture.detectChanges();

    const input = fixture.nativeElement.querySelector('#item-name') as HTMLInputElement;
    input.value = 'milk';
    input.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.capture-preview')?.textContent).toContain('1 piece');
    expect(fixture.nativeElement.querySelector('.capture-preview')?.textContent).not.toContain('Quantity optional');
    expect((fixture.nativeElement.querySelector('.add-form button') as HTMLButtonElement).disabled).toBe(false);
  });

  it('keeps unclear shorthand as a recoverable clarification draft', async () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    httpTesting.expectOne('/health').flush({ status: 'ok' });
    httpTesting.expectOne('/api/v1/households/household-demo/items?includePurchased=true&includeRemoved=true').flush([]);
    await fixture.whenStable();
    fixture.detectChanges();

    const input = fixture.nativeElement.querySelector('#item-name') as HTMLInputElement;
    input.value = '2';
    input.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    fixture.detectChanges();
    (fixture.nativeElement.querySelector('.add-form button') as HTMLButtonElement).click();
    httpTesting.expectOne('/api/v1/households/household-demo/conversation-captures').flush({
      session: { id: 'session-1', householdId: 'household-demo', status: 'active', closedAt: null },
      saved: [], merged: [], undo: [],
      drafts: [{
        id: 'draft-quantity', householdId: 'household-demo', sessionId: 'session-1',
        text: '2', reason: 'unparsed_clause', status: 'open',
      }],
    });
    httpTesting.expectOne('/api/v1/households/household-demo/items?includePurchased=true&includeRemoved=true').flush([]);
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.conversation-summary')?.textContent)
      .toContain('Needs clarification 1');
  });

  it('keeps capture responsive and unrelated rows enabled while saving', async () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    httpTesting.expectOne('/health').flush({ status: 'ok' });
    httpTesting.expectOne('/api/v1/households/household-demo/items?includePurchased=true&includeRemoved=true').flush([{
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
    const request = httpTesting.expectOne('/api/v1/households/household-demo/conversation-captures');
    fixture.detectChanges();

    expect(input.value).toBe('1.5 kg potatoes');
    expect(fixture.nativeElement.querySelector('.capture-preview')?.textContent).toContain('potatoes');
    expect(fixture.nativeElement.querySelector('.add-form button')?.textContent).toContain('Saving');
    expect((fixture.nativeElement.querySelector('li .secondary-button') as HTMLButtonElement).disabled).toBe(false);

    const potatoes = {
      id: 'item-2', householdId: 'household-demo', captureText: '1.5 kg potatoes', name: 'potatoes',
      quantity: 1.5, unit: 'kg', unitSource: 'explicit', unitConfirmedAt: '2026-08-04T00:00:00.000Z',
      attentionReasons: [], status: 'active', createdAt: '2026-08-04T00:00:00.000Z',
      updatedAt: '2026-08-04T00:00:00.000Z', version: 1,
    };
    request.flush({
      session: { id: 'session-1', householdId: 'household-demo', status: 'active', closedAt: null },
      saved: [potatoes], merged: [], drafts: [], undo: [],
    });
    httpTesting.expectOne('/api/v1/households/household-demo/items?includePurchased=true&includeRemoved=true').flush([potatoes]);
    await fixture.whenStable();
    fixture.detectChanges();
    expect(input.value).toBe('');
  });

  it('shows a direct details action for an item missing quantity', async () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    httpTesting.expectOne('/health').flush({ status: 'ok' });
    httpTesting.expectOne('/api/v1/households/household-demo/items?includePurchased=true&includeRemoved=true').flush([{
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
    httpTesting.expectOne('/api/v1/households/household-demo/items?includePurchased=true&includeRemoved=true').flush([{
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
    httpTesting.expectOne('/api/v1/households/household-demo/items?includePurchased=true&includeRemoved=true').flush([
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
    expect(request.request.body).toEqual({
      captureText: 'Milk',
      name: 'Milk',
      quantity: 2,
      confirmedUnit: 'cartons',
      packageSize: null,
      packageUnit: null,
      expectedVersion: 2,
    });
    fixture.detectChanges();
    expect((Array.from(rows[1].querySelectorAll('button')).find((button) => button.textContent?.trim() === 'Edit item') as HTMLButtonElement).disabled).toBe(false);
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
    httpTesting.expectOne('/api/v1/households/household-demo/items?includePurchased=true&includeRemoved=true').flush([{
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
    httpTesting.expectOne('/api/v1/households/household-demo/items?includePurchased=true&includeRemoved=true').flush([{
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
      quantity: 2, unit: 'carton', packageSize: null, packageUnit: null,
      brandId: null, productId: null, conceptId: null,
      unitSource: 'explicit', unitConfirmedAt: '2026-08-01T00:00:00.000Z',
      attentionReasons: [], status: 'purchased', removedAt: null, createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:00:00.000Z', version: 2,
    }]);
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    httpTesting.expectOne('/health').flush({ status: 'ok' });
    await fixture.whenStable();
    fixture.detectChanges();

    const input = fixture.nativeElement.querySelector('#item-name') as HTMLInputElement;
    input.value = 'milk';
    input.dispatchEvent(new Event('input'));
    await Promise.resolve();
    fixture.detectChanges();

    const preview = fixture.nativeElement.querySelector('.capture-preview') as HTMLElement;
    expect(preview.textContent).toContain('carton');
    expect(preview.textContent).toContain('From last time');
    httpTesting.expectOne('/api/v1/households/household-demo/items?includePurchased=true&includeRemoved=true').flush([]);
  });

  it('refreshes local suggestions from the last successful item list', async () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    httpTesting.expectOne('/health').flush({ status: 'ok' });
    httpTesting.expectOne('/api/v1/households/household-demo/items?includePurchased=true&includeRemoved=true').flush([{
      id: 'old-milk', householdId: 'household-demo', captureText: '2 cartons Milk', name: 'Milk',
      quantity: 2, unit: 'carton', packageSize: null, packageUnit: null,
      brandId: null, productId: null, conceptId: null,
      unitSource: 'explicit', unitConfirmedAt: '2026-08-01T00:00:00.000Z',
      attentionReasons: [], status: 'purchased', removedAt: null, createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:00:00.000Z', version: 2,
    }]);
    await fixture.whenStable();
    fixture.detectChanges();

    const input = fixture.nativeElement.querySelector('#item-name') as HTMLInputElement;
    input.value = 'milk';
    input.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.capture-preview')?.textContent).toContain('carton');
    expect(new UnitHistoryCache(localStorage).read('household-demo')['milk'].unit).toBe('carton');
  });

  it('lets the user accept a cached unit before adding the item', async () => {
    new UnitHistoryCache(localStorage).replaceFromItems('household-demo', [{
      id: 'old-milk', householdId: 'household-demo', captureText: '2 cartons Milk', name: 'Milk',
      quantity: 2, unit: 'carton', packageSize: null, packageUnit: null,
      brandId: null, productId: null, conceptId: null,
      unitSource: 'explicit', unitConfirmedAt: '2026-08-01T00:00:00.000Z',
      attentionReasons: [], status: 'purchased', removedAt: null, createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:00:00.000Z', version: 2,
    }]);
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    httpTesting.expectOne('/health').flush({ status: 'ok' });
    await fixture.whenStable();
    fixture.detectChanges();

    const input = fixture.nativeElement.querySelector('#item-name') as HTMLInputElement;
    input.value = 'milk';
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
    expect(create.request.body).toEqual({ input: 'milk', confirmedUnit: 'carton' });
    create.flush({
      id: 'item-1', householdId: 'household-demo', captureText: '2 milk', name: 'milk', quantity: 2,
      unit: 'carton', unitSource: 'explicit', unitConfirmedAt: '2026-08-04T00:00:00.000Z',
      attentionReasons: [], status: 'active', createdAt: '2026-08-04T00:00:00.000Z',
      updatedAt: '2026-08-04T00:00:00.000Z', version: 1,
    });
    httpTesting.expectOne('/api/v1/households/household-demo/items?includePurchased=true&includeRemoved=true').flush([]);
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
    httpTesting.expectOne('/api/v1/households/household-demo/items?includePurchased=true&includeRemoved=true').flush([
      { ...base, id: 'item-1', captureText: '1 Bread', name: 'Bread' },
      { ...base, id: 'item-2', captureText: '1 Rice', name: 'Rice' },
    ]);
    await fixture.whenStable();
    fixture.detectChanges();

    const rows = fixture.nativeElement.querySelectorAll('li') as NodeListOf<HTMLElement>;
    (Array.from(rows[0].querySelectorAll('button')).find((button) => button.textContent?.trim() === 'Purchased') as HTMLButtonElement).click();
    const purchase = httpTesting.expectOne('/api/v1/households/household-demo/items/item-1');
    fixture.detectChanges();

    expect((Array.from(rows[1].querySelectorAll('button')).find((button) => button.textContent?.trim() === 'Edit item') as HTMLButtonElement).disabled).toBe(false);
    purchase.flush({ ...base, id: 'item-1', captureText: '1 Bread', name: 'Bread', status: 'purchased', version: 2 });
  });

  it('validates custom unit length beside the row without making a request', async () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    httpTesting.expectOne('/health').flush({ status: 'ok' });
    httpTesting.expectOne('/api/v1/households/household-demo/items?includePurchased=true&includeRemoved=true').flush([{
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

  it('accepts a full history suggestion as raw capture text without submitting', async () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    httpTesting.expectOne('/health').flush({ status: 'ok' });
    httpTesting.expectOne('/api/v1/households/household-demo/items?includePurchased=true&includeRemoved=true').flush([{
      id: 'history-biscuits', householdId: 'household-demo', captureText: 'biscuits 2 pcs', name: 'biscuits',
      quantity: 2, unit: 'piece', productId: 'product.biscuits', conceptId: 'grocery.biscuits.plain', unitSource: 'explicit', unitConfirmedAt: '2026-08-05T00:00:00.000Z',
      attentionReasons: [], status: 'purchased', createdAt: '2026-08-05T00:00:00.000Z',
      updatedAt: '2026-08-05T00:00:00.000Z', version: 1,
    }]);
    await fixture.whenStable();
    fixture.detectChanges();
    const input = fixture.nativeElement.querySelector('#item-name') as HTMLInputElement;

    input.value = 'bisc';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    fixture.detectChanges();
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
    fixture.detectChanges();

    expect(input.value).toBe('biscuits 2 pcs');
    expect(fixture.nativeElement.querySelector('.capture-preview')?.textContent).toContain('biscuits 2 pcs');
    expect(fixture.nativeElement.querySelector('.capture-preview')?.textContent).toContain('Quantity optional');
    httpTesting.expectNone((request) => request.method === 'POST');
  });

  it('submits unsupported Unicode as ordinary free text when no dictionary suggestion exists', async () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    httpTesting.expectOne('/health').flush({ status: 'ok' });
    httpTesting.expectOne('/api/v1/households/household-demo/items?includePurchased=true&includeRemoved=true').flush([]);
    await fixture.whenStable();
    fixture.detectChanges();
    const input = fixture.nativeElement.querySelector('#item-name') as HTMLInputElement;

    input.value = 'बिस्कुट 2 pcs';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    fixture.detectChanges();
    (fixture.nativeElement.querySelector('.add-form button') as HTMLButtonElement).click();

    const create = httpTesting.expectOne('/api/v1/households/household-demo/conversation-captures');
    expect(create.request.body).toEqual({ text: 'बिस्कुट 2 pcs', source: 'text' });
    const unicodeItem = {
      id: 'unicode-item', householdId: 'household-demo', captureText: 'बिस्कुट 2 pcs', name: 'बिस्कुट',
      quantity: 2, unit: 'pcs', unitSource: 'explicit', unitConfirmedAt: '2026-08-05T00:00:00.000Z',
      attentionReasons: [], status: 'active', createdAt: '2026-08-05T00:00:00.000Z',
      updatedAt: '2026-08-05T00:00:00.000Z', version: 1,
    };
    create.flush({
      session: { id: 'session-1', householdId: 'household-demo', status: 'active', closedAt: null },
      saved: [unicodeItem], merged: [], drafts: [], undo: [],
    });
    httpTesting.expectOne('/api/v1/households/household-demo/items?includePurchased=true&includeRemoved=true').flush([unicodeItem]);
  });

  it('does not show a delayed Premium suggestion after the capture text has changed', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance as unknown as {
      requestCloudAssist: (text: string, trigger: 'typing') => void;
      updateItemName: (value: string) => void;
      cloudAssistTypingTimer: ReturnType<typeof setTimeout> | null;
    };
    fixture.detectChanges();
    httpTesting.expectOne('/health').flush({ status: 'ok' });
    httpTesting.expectOne('/api/v1/households/household-demo/items?includePurchased=true&includeRemoved=true').flush([]);

    TestBed.inject(HouseholdSettingsService).get('household-demo').subscribe();
    httpTesting.expectOne('/api/v1/households/household-demo/capture-settings').flush({
      automaticConversationClose: 'off', idleThresholdSeconds: 300, gracePeriodSeconds: 60,
      warningPolicy: 'silent', cloudDraftAssist: 'disabled', cloudAssistOnSave: false,
      cloudAssistWhileTyping: true, onlineLookupConsent: true, onlineLookupTrigger: 'on_idle', suggestions: 'enabled', entitlement: 'premium',
    });
    app.requestCloudAssist('first item', 'typing');
    const delayed = httpTesting.expectOne('/api/v1/households/household-demo/cloud-assist');

    app.updateItemName('second item');
    if (app.cloudAssistTypingTimer) clearTimeout(app.cloudAssistTypingTimer);
    delayed.flush({ suggestion: {
      itemName: 'First item', quantity: 1, unit: 'piece', measures: [], attributes: {}, rationale: 'old input',
    }, source: 'openrouter', acceptanceToken: 'expired', expiresAt: '2026-08-20T00:00:00.000Z', requiresUserConfirmation: true });
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).not.toContain('Use AI suggestion');
  });

  it('offers a deliberate Premium lookup without making capture or optional details mandatory', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    httpTesting.expectOne('/health').flush({ status: 'ok' });
    httpTesting.expectOne('/api/v1/households/household-demo/items?includePurchased=true&includeRemoved=true').flush([]);
    const input = fixture.nativeElement.querySelector('#item-name') as HTMLInputElement;
    input.value = 'mystery item';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    fixture.detectChanges();

    const lookup = fixture.nativeElement.querySelector('.capture-lookup-button') as HTMLButtonElement;
    expect(lookup.disabled).toBe(false);
    lookup.click();
    const settings = httpTesting.expectOne('/api/v1/households/household-demo/capture-settings');
    settings.flush({
      automaticConversationClose: 'off', idleThresholdSeconds: 300, gracePeriodSeconds: 60,
      warningPolicy: 'silent', cloudDraftAssist: 'disabled', cloudAssistOnSave: true,
      cloudAssistWhileTyping: false, onlineLookupConsent: true, onlineLookupTrigger: 'manual', suggestions: 'enabled', entitlement: 'premium',
    });
    const request = httpTesting.expectOne('/api/v1/households/household-demo/cloud-assist');
    expect(request.request.body).toEqual({ text: 'mystery item', trigger: 'manual', captureRevision: 1 });
    request.flush({ suggestion: null, requiresUserConfirmation: true });

    expect((fixture.nativeElement.querySelector('.add-form button') as HTMLButtonElement).disabled).toBe(false);
    httpTesting.expectNone('/api/v1/households/household-demo/conversation-captures');
  });

  it('asks once after two authoritative spelling variants and keeps the chosen preference private', async () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    httpTesting.expectOne('/health').flush({ status: 'ok' });
    httpTesting.expectOne('/api/v1/households/household-demo/items?includePurchased=true&includeRemoved=true').flush([]);
    await fixture.whenStable();
    fixture.detectChanges();

    const addCapture = async (spelling: string, id: string): Promise<void> => {
      const input = fixture.nativeElement.querySelector('#item-name') as HTMLInputElement;
      input.value = `${spelling} 1 pack`;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      fixture.detectChanges();
      (fixture.nativeElement.querySelector('.add-form button') as HTMLButtonElement).click();
      const item = {
        id, householdId: 'household-demo', captureText: `${spelling} 1 pack`, name: spelling,
        quantity: 1, unit: 'pack', unitSource: 'explicit', unitConfirmedAt: '2026-08-05T00:00:00.000Z',
        attentionReasons: [], status: 'active', createdAt: '2026-08-05T00:00:00.000Z',
        updatedAt: '2026-08-05T00:00:00.000Z', version: 1,
      };
      flushConversationCapture([item]);
      httpTesting.expectOne('/api/v1/households/household-demo/items?includePurchased=true&includeRemoved=true').flush([item]);
      await fixture.whenStable();
      fixture.detectChanges();
    };

    await addCapture('biscut', 'variant-1');
    expect(fixture.nativeElement.querySelector('app-spelling-clarification')).toBeNull();
    await addCapture('biscuit', 'variant-2');

    const prompt = fixture.nativeElement.querySelector('app-spelling-clarification') as HTMLElement;
    expect(prompt.textContent).toContain('Are “biscut” and “biscuit” the same item?');
    expect((fixture.nativeElement.querySelector('.item-list button') as HTMLButtonElement).disabled).toBe(false);
    (Array.from(prompt.querySelectorAll('button')).find((button) => button.textContent?.includes('Use biscuit')) as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('app-spelling-clarification')).toBeNull();

    const input = fixture.nativeElement.querySelector('#item-name') as HTMLInputElement;
    input.value = 'biscut';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    fixture.detectChanges();
    const optionTexts = Array.from(fixture.nativeElement.querySelectorAll('[role="option"]') as NodeListOf<HTMLElement>)
      .map((option) => option.textContent ?? '');
    expect(optionTexts).toHaveLength(1);
    expect(optionTexts[0]).toContain('biscuit');
    expect(optionTexts[0]).not.toContain('biscut');
  });
});
