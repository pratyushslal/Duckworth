/** Locale/runtime presentation data. Product and language additions belong here or in a validated pack, never in formatter logic. */
export const UNIT_DISPLAY_DATA: Readonly<Record<string, { singular: string; plural: string }>> = {
  l: { singular: 'litre', plural: 'litres' }, litre: { singular: 'litre', plural: 'litres' }, litres: { singular: 'litre', plural: 'litres' },
  liter: { singular: 'litre', plural: 'litres' }, liters: { singular: 'litre', plural: 'litres' },
  ml: { singular: 'millilitre', plural: 'millilitres' }, millilitre: { singular: 'millilitre', plural: 'millilitres' }, millilitres: { singular: 'millilitre', plural: 'millilitres' },
  g: { singular: 'gram', plural: 'grams' }, gm: { singular: 'gram', plural: 'grams' }, gms: { singular: 'gram', plural: 'grams' }, gram: { singular: 'gram', plural: 'grams' }, grams: { singular: 'gram', plural: 'grams' },
  kg: { singular: 'kilogram', plural: 'kilograms' }, kgs: { singular: 'kilogram', plural: 'kilograms' }, kilogram: { singular: 'kilogram', plural: 'kilograms' }, kilograms: { singular: 'kilogram', plural: 'kilograms' },
  mg: { singular: 'milligram', plural: 'milligrams' }, milligram: { singular: 'milligram', plural: 'milligrams' }, milligrams: { singular: 'milligram', plural: 'milligrams' },
  pack: { singular: 'pack', plural: 'packs' }, packs: { singular: 'pack', plural: 'packs' },
  pc: { singular: 'piece', plural: 'pieces' }, pcs: { singular: 'piece', plural: 'pieces' }, piece: { singular: 'piece', plural: 'pieces' }, pieces: { singular: 'piece', plural: 'pieces' },
};
