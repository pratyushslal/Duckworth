import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { App } from './app';
import { afterEach, beforeEach as vitestBeforeEach, describe, expect, it, vi } from 'vitest';

class FakeEventSource {
  addEventListener(): void {}
  close(): void {}
}

describe('App', () => {
  let httpTesting: HttpTestingController;

  vitestBeforeEach(() => vi.stubGlobal('EventSource', FakeEventSource));

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
      id: 'item-1', householdId: 'household-demo', name: 'Authoritative milk', status: 'active',
      createdAt: '2026-08-03T00:00:00.000Z', updatedAt: '2026-08-03T00:00:00.000Z', version: 1,
    }]);
    await fixture.whenStable();
    fixture.detectChanges();

    const row = fixture.nativeElement.querySelector('li') as HTMLElement;
    (row.querySelector('button') as HTMLButtonElement).click();
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
});
