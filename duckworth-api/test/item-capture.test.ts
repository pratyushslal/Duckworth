import { describe, expect, it } from 'vitest';
import { interpretCapture as interpretCaptureWithRuntime, normalizeItemName } from '@duckworth/item-capture';
import { loadSemanticRuntime } from '../src/semantic-runtime-loader.js';

const runtime = await loadSemanticRuntime('./language-packs', 'en-IN', 'IN');
const interpretCapture = (input: string) => interpretCaptureWithRuntime(input, runtime);

describe('typed item capture', () => {
  it('interprets a decimal quantity, unit, and item name', () => {
    expect(interpretCapture('1.5 kg potatoes')).toEqual({
      captureText: '1.5 kg potatoes',
      name: 'potatoes',
      quantity: 1.5,
      unit: 'kg',
      packageSize: null,
      packageUnit: null,
    });
  });

  it('keeps a bare item name incomplete', () => {
    expect(interpretCapture('milk')).toEqual({
      captureText: 'milk',
      name: 'milk',
      quantity: null,
      unit: null,
      packageSize: null,
      packageUnit: null,
    });
  });

  it('interprets a quantity without guessing a unit', () => {
    expect(interpretCapture('2 milk')).toEqual({
      captureText: '2 milk',
      name: 'milk',
      quantity: 2,
      unit: null,
      packageSize: null,
      packageUnit: null,
    });
  });

  it('interprets an item name followed by quantity and a recognized unit', () => {
    expect(interpretCapture('biscuits 2 pcs')).toEqual({
      captureText: 'biscuits 2 pcs',
      name: 'biscuits',
      quantity: 2,
      unit: 'piece',
      packageSize: null,
      packageUnit: null,
    });
  });

  it('separates a requested pack count from its package size', () => {
    expect(interpretCapture('amul butter 1 pack 500 gm')).toEqual({
      captureText: 'amul butter 1 pack 500 gm',
      name: 'amul butter',
      quantity: 1,
      unit: 'pack',
      packageSize: 500,
      packageUnit: 'g',
    });
  });

  it('separates package size from pack count when they are entered in reverse order with common aliases', () => {
    expect(interpretCapture('amul butter 500 gms 1 pac')).toEqual({
      captureText: 'amul butter 500 gms 1 pac',
      name: 'amul butter',
      quantity: 1,
      unit: 'pack',
      packageSize: 500,
      packageUnit: 'g',
    });
  });

  it('separates a leading container count joined with of from its package size', () => {
    expect(interpretCapture('1 pack of Amul Butter 500 gms')).toEqual({
      captureText: '1 pack of Amul Butter 500 gms',
      name: 'Amul Butter',
      quantity: 1,
      unit: 'pack',
      packageSize: 500,
      packageUnit: 'g',
    });
  });

  it('keeps a trailing container after a piece count and package size', () => {
    expect(interpretCapture('Coca Cola 5 pieces of 1 litre bottle')).toEqual({
      captureText: 'Coca Cola 5 pieces of 1 litre bottle',
      name: 'Coca Cola',
      quantity: 5,
      unit: 'piece',
      packageSize: 1,
      packageUnit: 'l',
      packageContainerUnit: 'bottle',
    });
  });

  it.each([
    '200ml Thums Up x 24',
    '200 ml Thums Up x 24 pieces',
    '200 ml Thums Up 24 pieces',
  ])('interprets size-first multiplication as a piece count: %s', (input) => {
    expect(interpretCapture(input)).toMatchObject({
      name: 'Thums Up',
      quantity: 24,
      unit: 'piece',
      packageSize: 200,
      packageUnit: 'ml',
    });
  });

  it.each([
    'maggi noodles 1 pack of 8 pieces',
    'maggi noodles 1 big pack of 8 pieces',
    'maggi noodles 1 family pack of 8 pieces',
    'maggi noodles 1 large family pack of 8 pieces',
  ])('interprets a pack qualifier without absorbing it into the item name: %s', (input) => {
    expect(interpretCapture(input)).toMatchObject({
      name: 'maggi noodles',
      quantity: 1,
      unit: 'pack',
      packageSize: 8,
      packageUnit: 'piece',
    });
  });

  it('retains a captured pack qualifier as source evidence', () => {
    expect(interpretCapture('maggi noodles 1 big pack of 8 pieces')).toMatchObject({
      packQualifier: 'big',
      packQualifierSpan: { start: 16, end: 19 },
    });
  });

  it('supports a spoken count and package size before the item name', () => {
    expect(interpretCapture('two packs of 500 g Amul Butter')).toEqual({
      captureText: 'two packs of 500 g Amul Butter',
      name: 'Amul Butter',
      quantity: 2,
      unit: 'pack',
      packageSize: 500,
      packageUnit: 'g',
    });
  });

  it('keeps a name ending in a number when no recognized trailing unit exists', () => {
    expect(interpretCapture('Formula 1')).toMatchObject({
      name: 'Formula 1',
      quantity: null,
      unit: null,
    });
  });

  it('rejects a non-positive trailing quantity with a recognized unit', () => {
    expect(() => interpretCapture('biscuits 0 pcs')).toThrow('Capture is not valid');
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
    ['2 trays eggs', 'tray'],
    ['3 pouches puree', 'pouch'],
    ['2 jars coffee', 'jar'],
    ['2 tubs yoghurt', 'tub'],
    ['4 rolls tissue', 'roll'],
    ['2 loaves bread', 'loaf'],
    ['3 bunches bananas', 'bunch'],
    ['2 pairs socks', 'pair'],
    ['4 bars soap', 'bar'],
    ['2 pks butter', 'pack'],
    ['2 pk butter', 'pack'],
    ['2 kilos onions', 'kg'],
  ])('canonicalizes recognized unit aliases in %s', (input, unit) => {
    expect(interpretCapture(input)).toMatchObject({ unit });
  });

  it.each(['', '   ', '0 milk', '-1 milk', 'Infinity milk', 'NaN milk', '2'])(
    'rejects invalid capture %j',
    (input) => {
      expect(() => interpretCapture(input)).toThrow('Capture is not valid');
    },
  );

  it('recognizes a common grocery container unit', () => {
    expect(interpretCapture('2 trays eggs')).toEqual({
      captureText: '2 trays eggs',
      name: 'eggs',
      quantity: 2,
      unit: 'tray',
      packageSize: null,
      packageUnit: null,
    });
  });

  it('does not guess an unknown unit-like word', () => {
    expect(interpretCapture('2 blorps eggs')).toEqual({
      captureText: '2 blorps eggs',
      name: 'blorps eggs',
      quantity: 2,
      unit: null,
      packageSize: null,
      packageUnit: null,
    });
  });

  it('preserves item-name casing while normalizing its whitespace', () => {
    expect(interpretCapture('  2 kg Baby   Potatoes  ')).toEqual({
      captureText: '2 kg Baby   Potatoes',
      name: 'Baby Potatoes',
      quantity: 2,
      unit: 'kg',
      packageSize: null,
      packageUnit: null,
    });
  });

  it('normalizes item names for duplicate and history lookup', () => {
    expect(normalizeItemName('  Baby   POTATOES  ')).toBe('baby potatoes');
  });
});
