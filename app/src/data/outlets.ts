/**
 * Outlets (`touch_points`).
 *
 * Every read here is city-scoped. Filtering the promoter list by city while
 * leaving the data those promoters generated unscoped is what inflated
 * achievement percentages before — so scoping lives at this layer, where it
 * cannot be forgotten by a caller.
 *
 * Text fields are sanitised on the way out as well as the way in. A row can
 * reach the database through the Supabase dashboard or a migration, bypassing
 * any input guard, and a pasted page of text has printed inside a team-wide
 * WhatsApp message before.
 */

import { db } from '../lib/supabase';
import { firstUrl, oneLine, shortOutletName } from '../domain/text';
import { shiftsFor } from '../domain/rules';
import { ShiftMode, type Shift, type ShiftMode as ShiftModeValue } from '../domain/values';
import { failFrom, ok, type Result } from './errors';

const OUTLET_COLUMNS =
  'id, name, unicode, maps_url, shift_mode, dual_shift, is_ds, city, active';

export interface Outlet {
  readonly id: number;
  /** The full stored name, `QAS_Outlet Name_TYPE_MN_BR`, sanitised. */
  readonly name: string;
  /** The human part, for display. */
  readonly shortName: string;
  /** POS code, printed in the route message. */
  readonly unicode: string | null;
  /** Always a real URL or null — never prose. */
  readonly mapsUrl: string | null;
  readonly shiftMode: ShiftModeValue;
  /** Direct Sales outlets get their own section in the route message. */
  readonly isDs: boolean;
  readonly city: string;
  readonly active: boolean;
  /** The shifts this outlet runs, derived from {@link shiftMode}. */
  readonly shifts: readonly Shift[];
}

type Row = Record<string, unknown>;

/**
 * Parses an outlet row.
 *
 * `shift_mode` falls back to the legacy `dual_shift` boolean, then to `'day'`.
 * The legacy column is still written by the current app and has not been
 * dropped, so a row could carry only that.
 */
export function parseOutlet(row: unknown): Outlet | null {
  if (row === null || row === undefined || typeof row !== 'object') return null;
  const record = row as Row;

  const id = record['id'];
  const rawName = record['name'];
  if (typeof id !== 'number') return null;
  if (typeof rawName !== 'string' || rawName.trim() === '') return null;

  const shiftMode =
    ShiftMode.tryParse(record['shift_mode']) ?? (record['dual_shift'] === true ? 'dual' : 'day');

  const name = oneLine(rawName, 120);
  const unicode = oneLine(record['unicode'], 24);
  const mapsUrl = firstUrl(record['maps_url']);
  const city = record['city'];
  const active = record['active'];

  return {
    id,
    name,
    shortName: shortOutletName(rawName),
    unicode: unicode === '' ? null : unicode,
    mapsUrl: mapsUrl === '' ? null : mapsUrl,
    shiftMode,
    isDs: record['is_ds'] === true,
    city: typeof city === 'string' ? city : '',
    active: active === null || active === undefined ? true : active === true,
    shifts: shiftsFor(shiftMode),
  };
}

const parseAll = (rows: unknown[]): Outlet[] =>
  rows.map(parseOutlet).filter((o): o is Outlet => o !== null);

/** Active outlets in a city — what a promoter can sign in to. */
export async function listActive(city: string): Promise<Result<Outlet[]>> {
  const { data, error } = await db
    .from('touch_points')
    .select(OUTLET_COLUMNS)
    .eq('active', true)
    .eq('city', city)
    .order('name');

  if (error) return failFrom(error, { action: 'قراءة المواقع' });
  return ok(parseAll(data ?? []));
}

/** Every outlet in a city, active first — the supervisor's management view. */
export async function listAll(city: string): Promise<Result<Outlet[]>> {
  const { data, error } = await db
    .from('touch_points')
    .select(OUTLET_COLUMNS)
    .eq('city', city)
    .order('active', { ascending: false })
    .order('name');

  if (error) return failFrom(error, { action: 'قراءة المواقع' });
  return ok(parseAll(data ?? []));
}

/** The distinct cities that have outlets — drives the manager's city switcher. */
export async function listCities(): Promise<Result<string[]>> {
  const { data, error } = await db.from('touch_points').select('city');
  if (error) return failFrom(error, { action: 'قراءة المدن' });

  const cities = new Set<string>();
  for (const row of data ?? []) {
    const city = (row as Row)['city'];
    if (typeof city === 'string' && city !== '') cities.add(city);
  }
  return ok([...cities].sort());
}

/** Index outlets by id, for joining against rows that carry only the id. */
export function byId(outlets: readonly Outlet[]): ReadonlyMap<number, Outlet> {
  return new Map(outlets.map((outlet) => [outlet.id, outlet]));
}
