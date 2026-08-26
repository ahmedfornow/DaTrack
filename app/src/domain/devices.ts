/**
 * The device catalog: 17 valid device+colour combinations.
 *
 * Casing matters. `sell_operations` has a composite foreign key onto
 * `device_catalog`, so `ILUMA i PRIME` fails the insert where `ILUMA i Prime`
 * succeeds. Every string here is written exactly as the database stores it.
 *
 * This list also drives the sale-entry grid, so it is kept in code rather than
 * loaded at startup — a promoter mid-shift should never wait on a network round
 * trip to see the buttons. `data/devices.ts` cross-checks it against
 * `device_catalog` so drift surfaces as a real error rather than a failed
 * insert in someone's hand.
 */

const DEVICE_VALUES = ['ILUMA i Prime', 'ILUMA i', 'ILUMA i One'] as const;
export type DeviceType = (typeof DEVICE_VALUES)[number];
export const DEVICE_TYPES: readonly DeviceType[] = DEVICE_VALUES;

const COLOR_VALUES = [
  'Midnight Black',
  'Aspen Green',
  'Electric Purple',
  'Garnet Red',
  'Breeze Blue',
  'Leaf Green',
  'Vivid Terracotta',
  'Digital Violet',
] as const;
export type DeviceColor = (typeof COLOR_VALUES)[number];
export const DEVICE_COLORS: readonly DeviceColor[] = COLOR_VALUES;

/** Which colours each line is sold in. */
export const CATALOG: Readonly<Record<DeviceType, readonly DeviceColor[]>> = {
  'ILUMA i Prime': [
    'Midnight Black',
    'Aspen Green',
    'Electric Purple',
    'Garnet Red',
    'Breeze Blue',
  ],
  'ILUMA i': [
    'Leaf Green',
    'Vivid Terracotta',
    'Digital Violet',
    'Midnight Black',
    'Breeze Blue',
    'Electric Purple',
  ],
  'ILUMA i One': [
    'Leaf Green',
    'Vivid Terracotta',
    'Digital Violet',
    'Midnight Black',
    'Breeze Blue',
    'Electric Purple',
  ],
};

/** Compact labels for the sale grid and the report body, where space is tight. */
export const SHORT_NAME: Readonly<Record<DeviceType, string>> = {
  'ILUMA i Prime': 'PRIME',
  'ILUMA i': 'ILUMA i',
  'ILUMA i One': 'ONE',
};

export function isDeviceType(value: unknown): value is DeviceType {
  return typeof value === 'string' && (DEVICE_VALUES as readonly string[]).includes(value);
}

export function isDeviceColor(value: unknown): value is DeviceColor {
  return typeof value === 'string' && (COLOR_VALUES as readonly string[]).includes(value);
}

/** True only for a pairing the database will accept. */
export function isValidCombination(device: unknown, color: unknown): boolean {
  if (!isDeviceType(device) || !isDeviceColor(color)) return false;
  return CATALOG[device].includes(color);
}

/** The colours to offer once a device is chosen. */
export function colorsFor(device: DeviceType): readonly DeviceColor[] {
  return CATALOG[device];
}

/** Short label, falling back to the raw value for a row that predates a rename. */
export function shortNameOf(device: string): string {
  return isDeviceType(device) ? SHORT_NAME[device] : device;
}

/** Every valid pairing, flattened — 17 of them. */
export function allCombinations(): readonly { device: DeviceType; color: DeviceColor }[] {
  return DEVICE_VALUES.flatMap((device) =>
    CATALOG[device].map((color) => ({ device, color })),
  );
}

/**
 * The data-visualisation palette *is* the product.
 *
 * Charts broken down by device or colour use the actual colour of the thing
 * sold, so the app's chart language comes from the catalog rather than from a
 * library default. Semantic colours — green achieved, gold close, red behind —
 * live in the design tokens and never overlap with these.
 *
 * These hex values are approximations of the retail finishes, chosen to be
 * mutually distinguishable and legible on the dark surface. They are not
 * sampled from brand assets; if PMI artwork becomes available, correct them
 * here and every chart follows.
 */
export const COLOR_SWATCH: Readonly<Record<DeviceColor, string>> = {
  'Midnight Black': '#3b4049',
  'Aspen Green': '#5f7d6b',
  'Electric Purple': '#7b5ea7',
  'Garnet Red': '#9d3b4a',
  'Breeze Blue': '#6f9fc4',
  'Leaf Green': '#7fa860',
  'Vivid Terracotta': '#c2694a',
  'Digital Violet': '#5b5fa8',
};
