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
import { failFrom, invalid, ok, type Result } from './errors';

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

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

export interface OutletDraft {
  readonly name: string;
  readonly unicode: string;
  readonly mapsUrl: string;
  readonly shiftMode: ShiftModeValue;
  readonly isDs: boolean;
}

/**
 * Sanitises a draft before it can reach the database.
 *
 * Returns the cleaned values or a reason. Rejecting prose in the URL field is
 * the specific guard here: a promoter once pasted a page of copied text into
 * it, and that text printed inside the team's route message for weeks.
 */
export function prepareOutlet(
  draft: OutletDraft,
): { ok: true; values: OutletDraft } | { ok: false; reason: string } {
  const name = oneLine(draft.name, 70);
  if (name === '') return { ok: false, reason: 'اسم الموقع مطلوب' };

  const rawUrl = String(draft.mapsUrl ?? '').trim();
  const mapsUrl = firstUrl(rawUrl);
  if (rawUrl !== '' && mapsUrl === '') {
    return { ok: false, reason: 'رابط الخريطة غير صالح — يجب أن يبدأ بـ https://' };
  }

  return {
    ok: true,
    values: {
      name,
      unicode: oneLine(draft.unicode, 24),
      mapsUrl,
      shiftMode: draft.shiftMode,
      isDs: draft.isDs,
    },
  };
}

/** Creates an outlet in the supervisor's city. */
export async function createOutlet(draft: OutletDraft, city: string): Promise<Result<Outlet>> {
  const prepared = prepareOutlet(draft);
  if (!prepared.ok) return invalid(prepared.reason);
  const { values } = prepared;

  const { data, error } = await db
    .from('touch_points')
    .insert({
      name: values.name,
      unicode: values.unicode === '' ? null : values.unicode,
      maps_url: values.mapsUrl === '' ? null : values.mapsUrl,
      shift_mode: values.shiftMode,
      // The legacy boolean is still written by the running app, so it stays in
      // sync until nothing reads it.
      dual_shift: values.shiftMode === 'dual',
      is_ds: values.isDs,
      city,
    })
    .select(OUTLET_COLUMNS)
    .single();

  if (error) {
    return failFrom(error, {
      action: 'إضافة الموقع',
      overrides: { '23505': 'الاسم مستخدم مسبقاً — أسماء المواقع فريدة' },
    });
  }

  const parsed = parseOutlet(data);
  return parsed === null ? invalid('أُضيف الموقع لكن تعذّرت قراءته — حدّث الصفحة') : ok(parsed);
}

/** Updates an outlet's details. */
export async function updateOutlet(id: number, draft: OutletDraft): Promise<Result<true>> {
  const prepared = prepareOutlet(draft);
  if (!prepared.ok) return invalid(prepared.reason);
  const { values } = prepared;

  const { error } = await db
    .from('touch_points')
    .update({
      name: values.name,
      unicode: values.unicode === '' ? null : values.unicode,
      maps_url: values.mapsUrl === '' ? null : values.mapsUrl,
      shift_mode: values.shiftMode,
      dual_shift: values.shiftMode === 'dual',
      is_ds: values.isDs,
    })
    .eq('id', id);

  if (error) {
    return failFrom(error, {
      action: 'تعديل الموقع',
      overrides: { '23505': 'الاسم مستخدم مسبقاً' },
    });
  }
  return ok(true);
}

/** Activates or deactivates an outlet. History is preserved either way. */
export async function setOutletActive(id: number, active: boolean): Promise<Result<true>> {
  const { error } = await db.from('touch_points').update({ active }).eq('id', id);
  if (error) return failFrom(error, { action: 'تغيير حالة الموقع' });
  return ok(true);
}
