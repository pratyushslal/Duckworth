import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { CaptureCombobox } from './capture-combobox';
import { CaptureAssistanceService } from '../core/capture-assistance.service';
import type { LanguagePackBundle } from '../core/language-pack-repository';

@Component({
  imports: [CaptureCombobox],
  template: `
    <app-capture-combobox
      label="Add an item"
      placeholder="Add an item…"
      [value]="value()"
      (valueChange)="value.set($event)"
    />
  `,
})
class TestHost {
  readonly value = signal('');
}

function typeInto(input: HTMLInputElement, value: string): void {
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

const biscuitPack: LanguagePackBundle = {
  schemaVersion: 1,
  checksum: 'sha256:1111111111111111111111111111111111111111111111111111111111111111',
  locale: 'en-IN',
  version: '1',
  fallbacks: [],
  ui: {},
  items: ['biscuits', 'biscotti', 'biscuit spread', 'biscuit sticks', 'biscuit tin', 'biscuit box'].map((primary) => ({
    id: `item.${primary}`,
    primary,
    aliases: [],
    category: 'snacks',
    compatibleUnits: ['pack'],
  })),
  units: [{ id: 'pack', primary: 'pack', aliases: ['packet'] }],
};

describe('CaptureCombobox', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [TestHost] }).compileComponents();
    TestBed.inject(CaptureAssistanceService).configure({
      activeLocale: 'en-IN',
      enabledLocales: ['en-IN'],
      packs: [biscuitPack],
      household: { version: 0, entries: [] },
      personal: {
        version: 0, entries: [], observations: [], suppressions: [], diagnostics: { skippedRecords: 0 },
      },
    });
  });

  it('renders at most five accessible options and exposes active-descendant state', async () => {
    const fixture = TestBed.createComponent(TestHost);
    fixture.detectChanges();
    const input = fixture.nativeElement.querySelector('input') as HTMLInputElement;

    input.value = 'bisc';
    input.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    fixture.detectChanges();

    expect(input.getAttribute('role')).toBe('combobox');
    expect(input.getAttribute('aria-autocomplete')).toBe('list');
    expect(input.getAttribute('aria-expanded')).toBe('true');
    expect(input.getAttribute('aria-label')).toBe('Add an item');
    const listbox = fixture.nativeElement.querySelector('[role="listbox"]') as HTMLElement;
    expect(listbox.id).toBe(input.getAttribute('aria-controls'));
    const options = listbox.querySelectorAll('[role="option"]');
    expect(options).toHaveLength(5);
    expect(options[0].getAttribute('aria-label')).toContain('Active language');

    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    fixture.detectChanges();
    expect(input.getAttribute('aria-activedescendant')).toBe(options[0].id);
    expect(options[0].getAttribute('aria-selected')).toBe('true');
  });

  it('moves the highlight with Down and Up without changing the draft', async () => {
    const fixture = TestBed.createComponent(TestHost);
    fixture.detectChanges();
    const input = fixture.nativeElement.querySelector('input') as HTMLInputElement;
    typeInto(input, 'bisc');
    fixture.detectChanges();

    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    fixture.detectChanges();

    expect(input.value).toBe('bisc');
    expect(fixture.componentInstance.value()).toBe('bisc');
    expect(fixture.nativeElement.querySelectorAll('[role="option"]')[0].getAttribute('aria-selected')).toBe('true');
  });

  it.each(['Tab', 'ArrowRight', 'Enter'])('accepts the highlighted full-text completion with %s', async (key) => {
    const fixture = TestBed.createComponent(TestHost);
    fixture.detectChanges();
    const input = fixture.nativeElement.querySelector('input') as HTMLInputElement;
    typeInto(input, 'bisc');
    fixture.detectChanges();
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));

    const acceptance = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
    input.dispatchEvent(acceptance);
    fixture.detectChanges();

    expect(acceptance.defaultPrevented).toBe(true);
    expect(fixture.componentInstance.value()).toBe('biscotti');
    expect(input.value).toBe('biscotti');
    expect(input.getAttribute('aria-expanded')).toBe('false');
  });

  it('leaves Enter available to the parent form when no suggestion is highlighted', () => {
    const fixture = TestBed.createComponent(TestHost);
    fixture.detectChanges();
    const input = fixture.nativeElement.querySelector('input') as HTMLInputElement;
    typeInto(input, 'बिस्कुट 2 pcs');
    fixture.detectChanges();

    const enter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    input.dispatchEvent(enter);

    expect(enter.defaultPrevented).toBe(false);
    expect(fixture.componentInstance.value()).toBe('बिस्कुट 2 pcs');
  });

  it('does not accept or submit suggestions while IME composition is active', () => {
    const fixture = TestBed.createComponent(TestHost);
    fixture.detectChanges();
    const input = fixture.nativeElement.querySelector('input') as HTMLInputElement;
    typeInto(input, 'bisc');
    fixture.detectChanges();
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    const enter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    input.dispatchEvent(enter);
    fixture.detectChanges();

    expect(enter.defaultPrevented).toBe(false);
    expect(fixture.componentInstance.value()).toBe('bisc');
  });

  it('dismisses on Escape and accepts by pointer without overwriting the draft beforehand', () => {
    const fixture = TestBed.createComponent(TestHost);
    fixture.detectChanges();
    const input = fixture.nativeElement.querySelector('input') as HTMLInputElement;
    typeInto(input, 'bisc');
    fixture.detectChanges();

    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    fixture.detectChanges();
    expect(input.value).toBe('bisc');
    expect(input.getAttribute('aria-expanded')).toBe('false');

    input.dispatchEvent(new FocusEvent('focus'));
    fixture.detectChanges();
    (fixture.nativeElement.querySelector('[role="option"]') as HTMLElement).click();
    fixture.detectChanges();
    expect(fixture.componentInstance.value()).toBe('biscotti');
  });

  it('announces result counts and highlighted source details through one restrained live region', () => {
    const fixture = TestBed.createComponent(TestHost);
    fixture.detectChanges();
    const input = fixture.nativeElement.querySelector('input') as HTMLInputElement;
    typeInto(input, 'bisc');
    fixture.detectChanges();
    const live = fixture.nativeElement.querySelector('[aria-live="polite"]') as HTMLElement;
    expect(live.textContent).toContain('5 suggestions available');

    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    fixture.detectChanges();
    expect(live.textContent).toContain('Active language');
    expect(live.textContent).toContain('1 of 5');
  });

  it('labels personal corrections without relying on color', () => {
    const assistance = TestBed.inject(CaptureAssistanceService);
    assistance.configure({
      activeLocale: 'en-IN', enabledLocales: ['en-IN'], packs: [], household: { version: 0, entries: [] },
      personal: {
        version: 1,
        entries: [{ text: 'biscuit', locale: 'en-IN', redirects: ['biscut'], kind: 'item' }],
        observations: [], suppressions: [], diagnostics: { skippedRecords: 0 },
      },
    });
    const fixture = TestBed.createComponent(TestHost);
    fixture.detectChanges();
    const input = fixture.nativeElement.querySelector('input') as HTMLInputElement;
    typeInto(input, 'biscut');
    fixture.detectChanges();

    const option = fixture.nativeElement.querySelector('[role="option"]') as HTMLElement;
    expect(option.textContent).toContain('Did you mean');
    expect(option.textContent).toContain('This device');
    expect(option.getAttribute('aria-label')).toContain('Did you mean');
  });

  it('keeps the user-owned draft unchanged when suggestion sources refresh', () => {
    const fixture = TestBed.createComponent(TestHost);
    fixture.detectChanges();
    const input = fixture.nativeElement.querySelector('input') as HTMLInputElement;
    typeInto(input, 'bisc');
    fixture.detectChanges();

    TestBed.inject(CaptureAssistanceService).configure({
      activeLocale: 'en-IN', enabledLocales: ['en-IN'],
      packs: [{ ...biscuitPack, version: '2', items: [{ ...biscuitPack.items[0], primary: 'biscuit refreshed' }] }],
      household: { version: 0, entries: [] },
      personal: { version: 0, entries: [], observations: [], suppressions: [], diagnostics: { skippedRecords: 0 } },
    });
    fixture.detectChanges();

    expect(input.value).toBe('bisc');
    expect(fixture.componentInstance.value()).toBe('bisc');
  });
});
