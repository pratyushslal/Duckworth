export function classificationHintKey(value: {
  quantitySource?: string | null;
  unitSource?: string | null;
}): string | null {
  return value.quantitySource === 'policy_default' || value.unitSource === 'policy_default'
    ? 'itemDefaultsApplied'
    : null;
}
