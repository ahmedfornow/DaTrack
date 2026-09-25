/**
 * A dot in the colour of the device sold.
 *
 * "Garnet Red" is a word a promoter has to read; the colour is something they
 * recognise before reading anything. Uses the same palette as the supervisor's
 * colour breakdown, so a device looks the same on both sides of the app.
 */

import { COLOR_SWATCH, type DeviceColor } from '../../domain/devices';

export function Swatch({ color, className = '' }: { color: string; className?: string }) {
  const hex = COLOR_SWATCH[color as DeviceColor] as string | undefined;
  return (
    <span
      aria-hidden="true"
      className={`inline-block shrink-0 rounded-full border border-white/20 ${className}`}
      style={hex !== undefined ? { background: hex } : undefined}
    />
  );
}
