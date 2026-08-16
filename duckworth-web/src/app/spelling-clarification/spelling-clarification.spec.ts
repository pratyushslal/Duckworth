import { TestBed } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';
import { SpellingClarification } from './spelling-clarification';

const candidate = {
  earlier: 'biscut',
  later: 'biscuit',
  locale: 'en-IN',
  confidence: 0.86,
};

describe('SpellingClarification', () => {
  it('explains every non-blocking outcome with native keyboard-operable buttons', () => {
    const fixture = TestBed.createComponent(SpellingClarification);
    fixture.componentRef.setInput('candidate', candidate);
    fixture.detectChanges();
    const section = fixture.nativeElement.querySelector('section') as HTMLElement;

    expect(section.getAttribute('role')).not.toBe('dialog');
    expect(section.getAttribute('aria-labelledby')).toBeTruthy();
    expect(section.textContent).toContain('Are “biscut” and “biscuit” the same item?');
    expect(section.textContent).toContain('Use biscuit');
    expect(section.textContent).toContain('Keep biscut');
    expect(section.textContent).toContain('Keep both separate');
    expect(section.textContent).toContain('Not now');
    const buttons = section.querySelectorAll('button');
    expect(buttons).toHaveLength(4);
    expect(Array.from(buttons).every((button) => button.type === 'button' && button.tabIndex === 0)).toBe(true);
  });

  it.each([
    ['Use biscuit', 'prefer-later'],
    ['Keep biscut', 'prefer-earlier'],
    ['Keep both separate', 'keep-separate'],
    ['Not now', 'dismiss'],
  ] as const)('emits %s as %s without blocking the page', (label, decision) => {
    const fixture = TestBed.createComponent(SpellingClarification);
    fixture.componentRef.setInput('candidate', candidate);
    const emitted = vi.fn();
    fixture.componentInstance.decision.subscribe(emitted);
    fixture.detectChanges();

    const button = Array.from(fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>)
      .find((candidateButton) => candidateButton.textContent?.includes(label))!;
    button.focus();
    button.click();

    expect(document.activeElement).toBe(button);
    expect(emitted).toHaveBeenCalledWith(decision);
  });
});
