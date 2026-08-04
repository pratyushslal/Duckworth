export type CanonicalUnit =
  | 'g'
  | 'kg'
  | 'ml'
  | 'l'
  | 'piece'
  | 'pack'
  | 'packet'
  | 'bottle'
  | 'carton'
  | 'can'
  | 'box'
  | 'bag'
  | 'dozen';

const UNIT_ALIASES: Readonly<Record<string, CanonicalUnit>> = {
  g: 'g', gram: 'g', grams: 'g',
  kg: 'kg', kgs: 'kg', kilogram: 'kg', kilograms: 'kg',
  ml: 'ml', milliliter: 'ml', milliliters: 'ml', millilitre: 'ml', millilitres: 'ml',
  l: 'l', liter: 'l', liters: 'l', litre: 'l', litres: 'l',
  piece: 'piece', pieces: 'piece', pc: 'piece', pcs: 'piece',
  pack: 'pack', packs: 'pack',
  packet: 'packet', packets: 'packet',
  bottle: 'bottle', bottles: 'bottle',
  carton: 'carton', cartons: 'carton',
  can: 'can', cans: 'can',
  box: 'box', boxes: 'box',
  bag: 'bag', bags: 'bag',
  dozen: 'dozen', dozens: 'dozen',
};

export interface CaptureInterpretation {
  captureText: string;
  name: string;
  quantity: number | null;
  unit: CanonicalUnit | null;
}

export class InvalidCaptureError extends Error {}

function normalizeDisplayName(name: string): string {
  return name.trim().replace(/\s+/g, ' ');
}

export function normalizeItemName(name: string): string {
  return normalizeDisplayName(name).toLowerCase();
}

export function interpretCapture(input: string): CaptureInterpretation {
  const captureText = input.trim();
  if (!captureText) throw new InvalidCaptureError('Capture is not valid');

  const quantityMatch = /^(\d+(?:\.\d+)?)\s+(.+)$/.exec(captureText);
  if (quantityMatch) {
    const quantity = Number(quantityMatch[1]);
    if (!Number.isFinite(quantity) || quantity <= 0) throw new InvalidCaptureError('Capture is not valid');
    const unitMatch = /^(\S+)\s+(.+)$/.exec(quantityMatch[2]);
    const unit = unitMatch ? UNIT_ALIASES[unitMatch[1].toLocaleLowerCase()] : undefined;
    if (unit && unitMatch) {
      return {
        captureText,
        name: normalizeDisplayName(unitMatch[2]),
        quantity,
        unit,
      };
    }

    return { captureText, name: normalizeDisplayName(quantityMatch[2]), quantity, unit: null };
  }

  const trailingQuantityMatch = /^(.+)\s+([+-]?\d+(?:\.\d+)?|Infinity|NaN)\s+(\S+)$/i.exec(captureText);
  if (trailingQuantityMatch) {
    const unit = UNIT_ALIASES[trailingQuantityMatch[3].toLocaleLowerCase()];
    if (unit) {
      const quantity = Number(trailingQuantityMatch[2]);
      if (!Number.isFinite(quantity) || quantity <= 0) throw new InvalidCaptureError('Capture is not valid');
      return {
        captureText,
        name: normalizeDisplayName(trailingQuantityMatch[1]),
        quantity,
        unit,
      };
    }
  }

  if (/^(?:[+-]?\d+(?:\.\d+)?|Infinity|NaN)(?:\s|$)/i.test(captureText)) {
    throw new InvalidCaptureError('Capture is not valid');
  }
  return { captureText, name: normalizeDisplayName(captureText), quantity: null, unit: null };
}
