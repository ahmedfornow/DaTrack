/**
 * Route plans — tomorrow's assignments, one row per promoter per day.
 *
 * Two rules here were learned the hard way.
 *
 * **Write before you clear.** The legacy save ran `delete()` then `insert()`.
 * When the insert failed, the day's plan was already gone. Here the upsert runs
 * first and only promoters actually set back to "none" are removed afterwards,
 * so a failed write can never destroy an existing plan.
 *
 * **Validate before touching the database.** Double-booking is detected in the
 * client and named — which outlet, which shift — rather than surfacing as a
 * unique-constraint violation the supervisor cannot interpret.
 *
 * The database enforces two separate uniqueness rules, and they do different
 * jobs: `route_plans_one_per_promoter_day` on (plan_date, promoter_id) and
 * `route_plans_plan_date_touch_point_id_shift_key` on (plan_date,
 * touch_point_id, shift). Leave rows escape the second because their outlet and
 * shift are NULL and Postgres treats NULLs as distinct.
 */

import { db } from '../lib/supabase';
import type { BusinessDate } from '../lib/businessDay';
import { SHIFT_LABEL } from '../domain/labels';
import { shortOutletName } from '../domain/text';
import { PlanStatus, Shift, type PlanStatus as PlanStatusValue, type Shift as ShiftValue } from '../domain/values';
import { failFrom, invalid, ok, type Result } from './errors';
import type { RouteAssignment } from '../features/reports/routePlanMessage';

const PLAN_COLUMNS = 'id, plan_date, promoter_id, touch_point_id, shift, status';

type Row = Record<string, unknown>;

/** The assignments for one date, keyed by promoter id. */
export type PlanMap = ReadonlyMap<string, RouteAssignment>;

export function parseAssignment(row: unknown): { promoterId: string; assignment: RouteAssignment } | null {
  if (row === null || row === undefined || typeof row !== 'object') return null;
  const record = row as Row;

  const promoterId = record['promoter_id'];
  if (typeof promoterId !== 'string' || promoterId === '') return null;

  const status = PlanStatus.tryParse(record['status']);
  if (status !== null) {
    return { promoterId, assignment: { kind: 'status', status } };
  }

  const touchPointId = record['touch_point_id'];
  const shift = Shift.tryParse(record['shift']);
  if (typeof touchPointId !== 'number' || shift === null) return null;

  return { promoterId, assignment: { kind: 'outlet', touchPointId, shift } };
}

/** Every assignment already saved for a date. */
export async function loadPlan(date: BusinessDate): Promise<Result<PlanMap>> {
  const { data, error } = await db.from('route_plans').select(PLAN_COLUMNS).eq('plan_date', date);

  if (error) return failFrom(error, { action: 'قراءة خطة اليوم' });

  const map = new Map<string, RouteAssignment>();
  for (const row of data ?? []) {
    const parsed = parseAssignment(row);
    if (parsed !== null) map.set(parsed.promoterId, parsed.assignment);
  }
  return ok(map);
}

// ---------------------------------------------------------------------------
// Validation — pure, so the conflict can be named without a round trip
// ---------------------------------------------------------------------------

export interface ConflictOutlet {
  readonly id: number;
  readonly name: string;
}

/**
 * The first outlet+shift assigned to more than one promoter, or `null`.
 *
 * The database blocks this outright, so the UI must too — but it can say which
 * outlet and shift, which the constraint violation cannot.
 */
export function findDoubleBooking(
  picks: PlanMap,
  outlets: readonly ConflictOutlet[],
): string | null {
  const taken = new Map<string, string>();

  for (const [promoterId, assignment] of picks) {
    if (assignment.kind !== 'outlet') continue;
    const key = `${assignment.touchPointId}-${assignment.shift}`;
    const existing = taken.get(key);
    if (existing !== undefined && existing !== promoterId) {
      const outlet = outlets.find((o) => o.id === assignment.touchPointId);
      const name = outlet !== undefined ? shortOutletName(outlet.name) : '';
      return `${name} — ${SHIFT_LABEL[assignment.shift]} معيّن له أكثر من مندوب`;
    }
    taken.set(key, promoterId);
  }

  return null;
}

// ---------------------------------------------------------------------------
// Saving
// ---------------------------------------------------------------------------

export interface SavePlanRequest {
  readonly date: BusinessDate;
  readonly createdBy: string;
  /** Every promoter in the city; those absent from `picks` are cleared. */
  readonly promoterIds: readonly string[];
  readonly picks: PlanMap;
  readonly outlets: readonly ConflictOutlet[];
}

/**
 * Saves the day's plan. Upserts every assignment, then removes only the
 * promoters explicitly set back to none.
 */
export async function savePlan(request: SavePlanRequest): Promise<Result<number>> {
  const { date, createdBy, promoterIds, picks, outlets } = request;

  const conflict = findDoubleBooking(picks, outlets);
  if (conflict !== null) return invalid(conflict);

  const rows = [...picks].map(([promoterId, assignment]) =>
    assignment.kind === 'status'
      ? {
          plan_date: date,
          promoter_id: promoterId,
          touch_point_id: null,
          shift: null,
          status: assignment.status,
          created_by: createdBy,
        }
      : {
          plan_date: date,
          promoter_id: promoterId,
          touch_point_id: assignment.touchPointId,
          shift: assignment.shift,
          status: null,
          created_by: createdBy,
        },
  );

  // Write first. A failure here leaves the previous plan intact.
  if (rows.length > 0) {
    const { error } = await db
      .from('route_plans')
      .upsert(rows, { onConflict: 'plan_date,promoter_id' });

    if (error) {
      return failFrom(error, {
        action: 'حفظ الخطة',
        overrides: {
          '23505': 'تعارض: موقع وفترة معيّن لهما أكثر من مندوب',
          '23514': 'قيمة غير مقبولة — راجع الخطة',
          '42P10': 'إعداد قاعدة البيانات ناقص — كلّم المطوّر',
          PGRST204: 'إعداد قاعدة البيانات ناقص — كلّم المطوّر',
        },
      });
    }
  }

  // Clear second, and only the promoters deliberately set back to none.
  const cleared = promoterIds.filter((id) => !picks.has(id));
  if (cleared.length > 0) {
    const { error } = await db
      .from('route_plans')
      .delete()
      .eq('plan_date', date)
      .in('promoter_id', cleared);

    if (error) {
      return failFrom(error, {
        action: 'مسح المندوبين المستبعدين',
        overrides: {
          // The assignments did save; only the removals failed. Say so, rather
          // than implying the whole save was lost.
          '42501': 'حُفظت التعيينات لكن تعذّر مسح المندوبين المستبعدين',
        },
      });
    }
  }

  return ok(rows.length);
}

/** The value used by the editor's dropdown, encoding either kind of pick. */
export function encodePick(assignment: RouteAssignment | undefined): string {
  if (assignment === undefined) return '';
  return assignment.kind === 'status'
    ? `st:${assignment.status}`
    : `tp:${assignment.touchPointId}:${assignment.shift}`;
}

/** Decodes a dropdown value back into an assignment. */
export function decodePick(value: string): RouteAssignment | null {
  if (value === '') return null;

  if (value.startsWith('st:')) {
    const status = PlanStatus.tryParse(value.slice(3));
    return status === null ? null : { kind: 'status', status };
  }

  if (value.startsWith('tp:')) {
    const [, rawId, rawShift] = value.split(':');
    const touchPointId = Number(rawId);
    const shift = Shift.tryParse(rawShift);
    if (!Number.isInteger(touchPointId) || shift === null) return null;
    return { kind: 'outlet', touchPointId, shift };
  }

  return null;
}

export type { PlanStatusValue, ShiftValue };
