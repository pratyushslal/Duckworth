import { describe, expect, it } from 'vitest';
import { interpretCapture, normalizeItemName } from '@duckworth/item-capture';

describe('typed item capture', () => {
  it('interprets a decimal quantity, unit, and item name', () => {
    expect(interpretCapture('1.5 kg potatoes')).toEqual({
      captureText: '1.5 kg potatoes',
      name: 'potatoes',
      quantity: 1.5,
      unit: 'kg',
    });
  });

  it('keeps a bare item name incomplete', () => {
    expect(interpretCapture('milk')).toEqual({
      captureText: 'milk',
      name: 'milk',
      quantity: null,
      unit: null,
    });
  });

  it('interprets a quantity without guessing a unit', () => {
    expect(interpretCapture('2 milk')).toEqual({
      captureText: '2 milk',
      name: 'milk',
      quantity: 2,
      unit: null,
    });
  });

  it.each([
    ['500 grams flour', 'g'],
    ['2 kgs rice', 'kg'],
    ['750 millilitres juice', 'ml'],
    ['2 liters water', 'l'],
    ['6 pcs apples', 'piece'],
    ['3 packs batteries', 'pack'],
    ['4 packets crisps', 'packet'],
    ['2 bottles oil', 'bottle'],
    ['2 cartons milk', 'carton'],
    ['6 cans beans', 'can'],
    ['2 boxes cereal', 'box'],
    ['3 bags spinach', 'bag'],
    ['2 dozens eggs', 'dozen'],
  ])('canonicalizes recognized unit aliases in %s', (input, unit) => {
    expect(interpretCapture(input)).toMatchObject({ unit });
  });

  it.each(['', '   ', '0 milk', '-1 milk', 'Infinity milk', 'NaN milk', '2'])(
    'rejects invalid capture %j',
    (input) => {
      expect(() => interpretCapture(input)).toThrow('Capture is not valid');
    },
  );

  it('does not guess an unrecognized unit-like word', () => {
    expect(interpretCapture('2 trays eggs')).toEqual({
      captureText: '2 trays eggs',
      name: 'trays eggs',
      quantity: 2,
      unit: null,
    });
  });

  it('preserves item-name casing while normalizing its whitespace', () => {
    expect(interpretCapture('  2 kg Baby   Potatoes  ')).toEqual({
      captureText: '2 kg Baby   Potatoes',
      name: 'Baby Potatoes',
      quantity: 2,
      unit: 'kg',
    });
  });

  it('normalizes item names for duplicate and history lookup', () => {
    expect(normalizeItemName('  Baby   POTATOES  ')).toBe('baby potatoes');
  });
});
