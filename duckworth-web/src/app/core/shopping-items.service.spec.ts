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

  it('adds an item and updates its status through the API', () => {
    service.add('household-demo', 'Milk').subscribe();
    const add = httpTesting.expectOne('/api/v1/households/household-demo/items');
    expect(add.request.method).toBe('POST');
    expect(add.request.body).toEqual({ name: 'Milk' });
    add.flush({});

    service.update('household-demo', 'item-1', { status: 'purchased', expectedVersion: 1 }).subscribe();
    const update = httpTesting.expectOne('/api/v1/households/household-demo/items/item-1');
    expect(update.request.method).toBe('PATCH');
    expect(update.request.body).toEqual({ status: 'purchased', expectedVersion: 1 });
    update.flush({});
  });
});
