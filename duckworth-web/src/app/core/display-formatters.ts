import { UNIT_DISPLAY_DATA } from './unit-display-data';

export function formatBrandName(brandName: string | null | undefined): string {
  const trimmed = brandName?.trim() ?? '';
  if (!trimmed) return '';
  return `${trimmed[0].toLocaleUpperCase()}${trimmed.slice(1)}`;
}

export function formatItemName(itemName: string, brandName?: string | null): string {
  const name = itemName.trim().replace(/\s+/gu, ' ');
  const brand = formatBrandName(brandName);
  if (!brand || !name) return name;
  if (name.toLocaleLowerCase().startsWith(brand.toLocaleLowerCase())) {
    return `${brand}${name.slice(brand.length)}`;
  }
  return `${brand} ${name}`;
}

export function formatMeasurement(quantity: number, unit: string | null | undefined): string {
  const value = Number.isInteger(quantity) ? String(quantity) : String(quantity);
  const normalizedUnit = unit?.trim().toLocaleLowerCase() ?? '';
  const label = UNIT_DISPLAY_DATA[normalizedUnit];
  const displayUnit = label
    ? (quantity === 1 ? label.singular : label.plural)
    : unit?.trim().toLocaleLowerCase() ?? '';
  return displayUnit ? `${value} ${displayUnit}` : value;
}

export function formatUnitLabel(unit: string | null | undefined): string {
  const normalizedUnit = unit?.trim().toLocaleLowerCase() ?? '';
  return UNIT_DISPLAY_DATA[normalizedUnit]?.singular ?? unit?.trim().toLocaleLowerCase() ?? '';
}

export function unitAriaLabel(unit: string | null | undefined): string {
  const normalizedUnit = unit?.trim().toLocaleLowerCase() ?? '';
  return UNIT_DISPLAY_DATA[normalizedUnit]?.singular ?? unit?.trim().toLocaleLowerCase() ?? 'unit';
}

export function measurementAriaLabel(quantity: number, unit: string | null | undefined): string {
  return unit?.trim() ? `${quantity} ${unitAriaLabel(unit)}` : String(quantity);
}
