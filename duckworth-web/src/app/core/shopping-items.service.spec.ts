import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ShoppingItemsService } from './shopping-items.service';

describe('ShoppingItemsService', () => {
  let service: ShoppingItemsService;
  let httpTesting: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    service = TestBed.inject(ShoppingItemsService);
    httpTesting = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpTesting.verify());

  it('lists items for the requested household', () => {
    service.list('family one').subscribe();
    const request = httpTesting.expectOne('/api/v1/households/family%20one/items');
    expect(request.request.method).toBe('GET');
    request.flush([]);
  });

  it('can include purchased and removed items for reload-safe restoration', () => {
    service.list('family one', true, true).subscribe();
    const request = httpTesting.expectOne(
      '/api/v1/households/family%20one/items?includePurchased=true&includeRemoved=true',
    );
    expect(request.request.method).toBe('GET');
    request.flush([]);
  });

  it('sends typed capture input and updates item status through the API', () => {
    service.add('household-demo', 'Milk').subscribe();
    const add = httpTesting.expectOne('/api/v1/households/household-demo/items');
    expect(add.request.method).toBe('POST');
    expect(add.request.body).toEqual({ input: 'Milk' });
    add.flush({});

    service.update('household-demo', 'item-1', { status: 'purchased', expectedVersion: 1 }).subscribe();
    const update = httpTesting.expectOne('/api/v1/households/household-demo/items/item-1');
    expect(update.request.method).toBe('PATCH');
    expect(update.request.body).toEqual({ status: 'purchased', expectedVersion: 1 });
    update.flush({});
  });

  it('sends quantity and an explicitly confirmed unit in a structured update', () => {
    service.update('household-demo', 'item-1', {
      quantity: 2.5,
      confirmedUnit: 'kg',
      expectedVersion: 3,
    }).subscribe();

    const request = httpTesting.expectOne('/api/v1/households/household-demo/items/item-1');
    expect(request.request.method).toBe('PATCH');
    expect(request.request.body).toEqual({ quantity: 2.5, confirmedUnit: 'kg', expectedVersion: 3 });
    request.flush({});
  });

  it('loads dynamic shop facets and changes only the selected item classification', () => {
    service.view('family one', 'shop-two').subscribe();
    const view = httpTesting.expectOne('/api/v1/households/family%20one/items/view?shopTypeId=shop-two');
    expect(view.request.method).toBe('GET');
    view.flush({ items: [], activeDistinctCount: 0, appliedShopTypeId: 'shop-two', facets: [] });

    service.updateClassification('family one', 'item one', {
      expectedVersion: 4,
      shopTypeDecisions: [{ tagId: 'shop-two', decision: 'exclude' }],
    }).subscribe();
    const update = httpTesting.expectOne('/api/v1/households/family%20one/items/item%20one/classification');
    expect(update.request.method).toBe('PATCH');
    expect(update.request.body).toEqual({
      expectedVersion: 4,
      shopTypeDecisions: [{ tagId: 'shop-two', decision: 'exclude' }],
    });
    update.flush({});
  });

  it('sends a versioned semantic correction without discarding the raw clause', () => {
    service.semanticCorrection('family one', 'item one', {
      schemaVersion: 1,
      idempotencyKey: 'ui-correction-1',
      itemId: 'item one',
      expectedItemVersion: 3,
      source: { captureInputId: 'capture-1', operationIndex: 0, sourceStart: 0, sourceEnd: 4, rawClause: 'milk' },
      corrected: { canonicalLabel: 'Whole milk', quantity: 2, unitId: 'piece' },
      learn: { mode: 'future_matching_items', scope: 'household' },
    }).subscribe();
    const request = httpTesting.expectOne('/api/v2/households/family%20one/items/item%20one/semantic-corrections');
    expect(request.request.body).toMatchObject({
      source: { captureInputId: 'capture-1', rawClause: 'milk' },
      corrected: { canonicalLabel: 'Whole milk', quantity: 2 },
    });
    request.flush({ item: { id: 'item one' }, correction: { eventId: 'event-1', replayed: false, learningMode: 'future_matching_items' }, overlayRevision: 1 });
  });

  it('submits a unit explicitly accepted during capture', () => {
    service.add('household-demo', '2 milk', 'carton').subscribe();
    const request = httpTesting.expectOne('/api/v1/households/household-demo/items');
    expect(request.request.body).toEqual({ input: '2 milk', confirmedUnit: 'carton' });
    request.flush({});
  });

  it('submits only an explicitly accepted regional product identity', () => {
    service.add('household-demo', 'Amul Butter 1 pack 500 g', undefined, 'product.amul.butter').subscribe();
    const request = httpTesting.expectOne('/api/v1/households/household-demo/items');
    expect(request.request.body).toEqual({
      input: 'Amul Butter 1 pack 500 g',
      productId: 'product.amul.butter',
    });
    request.flush({});
  });

  it('archives, lists, reopens, and copies shopping-list snapshots through dedicated routes', () => {
    service.archiveList('family one').subscribe();
    const archive = httpTesting.expectOne('/api/v1/households/family%20one/shopping-list-archives');
    expect(archive.request.method).toBe('POST');
    expect(archive.request.body).toEqual({});
    archive.flush({});

    service.listArchives('family one').subscribe();
    httpTesting.expectOne('/api/v1/households/family%20one/shopping-list-archives').flush([]);

    service.reopenArchive('family one', 'archive one').subscribe();
    httpTesting.expectOne(
      '/api/v1/households/family%20one/shopping-list-archives/archive%20one/reopen',
    ).flush({});

    service.copyArchive('family one', 'archive one').subscribe();
    httpTesting.expectOne(
      '/api/v1/households/family%20one/shopping-list-archives/archive%20one/copy',
    ).flush({});
  });
});
