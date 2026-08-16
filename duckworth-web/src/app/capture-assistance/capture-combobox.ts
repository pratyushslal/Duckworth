import { Component, computed, inject, input, output, signal } from '@angular/core';
import type { SemanticSuggestion } from '@duckworth/local-assistance';
import { CaptureAssistanceService } from '../core/capture-assistance.service';

let nextComboboxId = 0;

@Component({
  selector: 'app-capture-combobox',
  templateUrl: './capture-combobox.html',
  styleUrl: './capture-combobox.scss',
  host: { class: 'capture-combobox' },
})
export class CaptureCombobox {
  private readonly assistance = inject(CaptureAssistanceService);
  readonly value = input.required<string>();
  readonly inputId = input('item-name');
  readonly label = input('Add an item');
  readonly placeholder = input('Add an item…');
  readonly valueChange = output<string>();
  readonly suggestionAccepted = output<SemanticSuggestion>();
  protected readonly open = signal(false);
  protected readonly highlightedIndex = signal(-1);
  protected readonly listboxId = `capture-suggestions-${++nextComboboxId}`;
  protected readonly suggestions = computed(() => {
    this.assistance.revision();
    return this.assistance.suggestSemantic(this.value()).slice(0, 5);
  });
  protected readonly expanded = computed(() => this.open() && this.suggestions().length > 0);
  protected readonly activeDescendant = computed(() => {
    const index = this.highlightedIndex();
    return this.expanded() && index >= 0 ? this.optionId(index) : null;
  });
  protected readonly liveMessage = computed(() => {
    if (!this.expanded()) return '';
    const index = this.highlightedIndex();
    const suggestions = this.suggestions();
    if (index >= 0 && suggestions[index]) {
      return `${this.optionAriaLabel(suggestions[index])}, ${index + 1} of ${suggestions.length}.`;
    }
    return `${suggestions.length} suggestions available. Use the arrow keys to review.`;
  });
  private composing = false;

  protected handleInput(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.highlightedIndex.set(-1);
    this.open.set(value.trim().length > 0);
    this.valueChange.emit(value);
  }

  protected handleFocus(): void {
    if (this.value().trim() && this.suggestions().length > 0) this.open.set(true);
  }

  protected handleBlur(): void {
    this.open.set(false);
    this.highlightedIndex.set(-1);
  }

  protected handleKeydown(event: KeyboardEvent): void {
    if (this.composing) return;
    const suggestions = this.suggestions();
    if (event.key === 'Escape') {
      if (this.expanded()) event.preventDefault();
      this.open.set(false);
      this.highlightedIndex.set(-1);
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (suggestions.length === 0) return;
      event.preventDefault();
      this.open.set(true);
      const current = this.highlightedIndex();
      this.highlightedIndex.set(event.key === 'ArrowDown'
        ? (current + 1) % suggestions.length
        : (current <= 0 ? suggestions.length - 1 : current - 1));
      return;
    }
    if ((event.key === 'Tab' || event.key === 'ArrowRight' || event.key === 'Enter')
      && this.highlightedIndex() >= 0 && this.expanded()) {
      event.preventDefault();
      this.accept(this.highlightedIndex());
    }
  }

  protected handleCompositionStart(): void {
    this.composing = true;
  }

  protected handleCompositionEnd(): void {
    this.composing = false;
  }

  protected accept(index: number): void {
    const suggestion = this.suggestions()[index];
    if (!suggestion) return;
    const nextValue = this.value().slice(0, suggestion.replacement.start)
      + suggestion.replacement.replacementText
      + this.value().slice(suggestion.replacement.end);
    this.suggestionAccepted.emit(suggestion);
    this.valueChange.emit(nextValue);
    this.open.set(false);
    this.highlightedIndex.set(-1);
  }

  protected optionId(index: number): string {
    return `${this.listboxId}-option-${index}`;
  }

  protected optionAriaLabel(suggestion: SemanticSuggestion): string {
    return `${suggestion.text}. ${this.kindLabel(suggestion)}. ${this.sourceLabel(suggestion)}.`;
  }

  protected kindLabel(suggestion: SemanticSuggestion): string {
    if (suggestion.kind === 'correction') return 'Did you mean';
    if (suggestion.kind === 'history') return 'History';
    return 'Completion';
  }

  protected sourceLabel(suggestion: SemanticSuggestion): string {
    switch (suggestion.source) {
      case 'personal': return 'This device';
      case 'household': return 'Household history';
      case 'regional-product': return 'Regional product';
      case 'active-locale': return 'Active language';
      case 'fallback-locale': return 'Additional language';
      default: return 'Suggestion';
    }
  }
}
