/**
 * Monthly targets, per outlet, per shift.
 *
 * A promoter's target for a day is the target of the outlet and shift they
 * actually worked, so a monthly target is a sum across worked days rather than
 * a fixed number. That accumulation lives in `domain/rules.accumulateTarget`;
 * this module only supplies the per-day figures it needs.
 *
 * Targets are keyed by outlet, not by city, so a lookup table for one month is
 * safe to fetch whole — but anything derived from it must still be filtered by
 * the city-scoped outlets it is joined against.
 */

import { db } from '../lib/supabase';
import { businessMonth, type BusinessMonth } from '../lib/businessDay';
import { Shift, type Shift as ShiftValue } from '../domain/values';
import { failFrom, ok, type Result } from './errors';

const TARGET_COLUMNS = 'touch_point_id, shift, month, daily_target, gt_target';

export interface Target {
  readonly touchPointId: number;
  readonly shift: ShiftValue;
  readonly month: BusinessMonth;
  /** LAS per day. Routinely fractional. */
  readonly dailyTarget: number;
  /** Guided trials per day. */
  readonly gtTarget: number;
}

type Row = Record<string, unknown>;

/** A numeric column can arrive as a string from PostgREST for `numeric` types. */
function toNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function parseTarget(row: unknown): Target | null {
  if (row === null || row === undefined || typeof row !== 'object') return null;
  const record = row as Row;

  const touchPointId = record['touch_point_id'];
  const shift = Shift.tryParse(record['shift']);
  const month = record['month'];

  if (typeof touchPointId !== 'number') return null;
  if (shift === null) return null;
  if (typeof month !== 'string' || !/^\d{4}-\d{2}$/.test(month)) return null;

  return {
    touchPointId,
    shift,
    month,
    dailyTarget: toNumber(record['daily_target']) ?? 0,
    gtTarget: toNumber(record['gt_target']) ?? 0,
  };
}

/** The key used throughout for an outlet+shift pair. */
export const targetKey = (touchPointId: number, shift: ShiftValue): string =>
  `${touchPointId}-${shift}`;

/** A lookup table keyed by {@link targetKey}. */
export type TargetTable = ReadonlyMap<string, Target>;

export function indexTargets(targets: readonly Target[]): TargetTable {
  return new Map(targets.map((t) => [targetKey(t.touchPointId, t.shift), t]));
}

/** The daily LAS target for an outlet+shift, or `null` when none is set. */
export function dailyTargetFor(
  table: TargetTable,
  touchPointId: number | null,
  shift: ShiftValue | null,
): number | null {
  if (touchPointId === null || shift === null) return null;
  return table.get(targetKey(touchPointId, shift))?.dailyTarget ?? null;
}

/** The daily guided-trials target for an outlet+shift, or `null`. */
export function gtTargetFor(
  table: TargetTable,
  touchPointId: number | null,
  shift: ShiftValue | null,
): number | null {
  if (touchPointId === null || shift === null) return null;
  return table.get(targetKey(touchPointId, shift))?.gtTarget ?? null;
}

/** Every target for a month, as a lookup table. */
export async function tableForMonth(
  month: BusinessMonth = businessMonth(),
): Promise<Result<TargetTable>> {
  const { data, error } = await db.from('targets').select(TARGET_COLUMNS).eq('month', month);

  if (error) return failFrom(error, { action: 'قراءة الأهداف' });
  const parsed = (data ?? []).map(parseTarget).filter((t): t is Target => t !== null);
  return ok(indexTargets(parsed));
}

/**
 * The target for one outlet+shift+month.
 *
 * `maybeSingle` because a missing target is normal — a new outlet has none
 * until the supervisor sets one, and that must read as "no target" rather than
 * as an error.
 */
export async function forSession(
  touchPointId: number,
  shift: ShiftValue,
  month: BusinessMonth,
): Promise<Result<Target | null>> {
  const { data, error } = await db
    .from('targets')
    .select(TARGET_COLUMNS)
    .eq('touch_point_id', touchPointId)
    .eq('shift', shift)
    .eq('month', month)
    .maybeSingle();

  if (error) return failFrom(error, { action: 'قراءة هدف اليوم' });
  return ok(data === null ? null : parseTarget(data));
}
