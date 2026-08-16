import { describe, expect, it } from 'vitest';
import { formatBrandName, formatItemName, formatMeasurement, unitAriaLabel } from './display-formatters';

describe('display formatters', () => {
  it('makes litre unmistakable instead of rendering a lowercase l', () => {
    expect(formatMeasurement(1, 'l')).toBe('1 litre');
    expect(formatMeasurement(2, 'l')).toBe('2 litres');
    expect(formatMeasurement(1, 'liter')).toBe('1 litre');
    expect(formatMeasurement(500, 'g')).toBe('500 grams');
    expect(unitAriaLabel('l')).toBe('litre');
  });

  it('capitalizes a recognized brand without changing the item wording', () => {
    expect(formatBrandName('amul')).toBe('Amul');
    expect(formatItemName('amul butter', 'amul')).toBe('Amul butter');
    expect(formatItemName('butter', 'amul')).toBe('Amul butter');
  });
});
