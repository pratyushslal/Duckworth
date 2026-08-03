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
    httpTesting.expectOne('/api/households/household-demo/items').flush([]);
  });

  it('renders the foundation screen when the API is ready', async () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    httpTesting.expectOne('/health').flush({ status: 'ok' });
    httpTesting.expectOne('/api/households/household-demo/items').flush([]);
    await fixture.whenStable();
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('h1')?.textContent).toContain('Shopping coordination starts here.');
    expect(compiled.querySelector('[role="status"]')?.textContent).toContain('API connected');
  });
});
