/**
 * One row per promoter, for one day: where they are and how they are doing.
 *
 * This is the view a manager opens first. It answers four questions in a single
 * line — is this person working today, where, what were they asked for, and
 * what have they actually done — which previously needed three tabs and some
 * mental arithmetic.
 *
 * Pure, and separated from the queries that feed it, because the arithmetic is
 * the part worth testing. Every number here is derived from rows the promoters
 * already write; nothing about the promoter app changes to produce it.
 *
 * Two rules carried over from the rest of the app, and both easy to get wrong:
 *
 *  - **Only LAS counts toward a target.** LAU is tracked and shown, never
 *    scored. Mixing them inflates achievement across the whole team.
 *  - **A target belongs to an outlet and a shift**, not to a person. Someone
 *    working a night shift at a dual outlet is measured against that outlet's
 *    night target, not its day one.
 */

import type { BusinessDate } from '../../lib/businessDay';
import type { AttendanceStatus, Shift } from '../../domain/values';

/** An attendance row, reduced to what this file needs. */
export interface ActivityAttendance {
  readonly promoterId: string;
  readonly workDate: BusinessDate;
  readonly status: AttendanceStatus;
  readonly touchPointId: number | null;
  readonly shift: Shift | null;
}

/** A sale, reduced. Only `LAS` is scored — see the note above. */
export interface ActivitySale {
  readonly promoterId: string;
  readonly workDate: BusinessDate;
  readonly customerType: string;
}

export interface ActivityTarget {
  readonly touchPointId: number;
  readonly shift: Shift;
  readonly dailyTarget: number;
}

export interface ActivityPromoter {
  readonly id: string;
  readonly fullName: string;
}

export interface ActivityOutlet {
  readonly id: number;
  readonly name: string;
}

export interface DailyActivityInput {
  readonly date: BusinessDate;
  /** First day of the month `date` falls in — the month-to-date floor. */
  readonly monthStart: BusinessDate;
  readonly promoters: readonly ActivityPromoter[];
  readonly outlets: readonly ActivityOutlet[];
  /** Attendance from `monthStart` to `date` inclusive. */
  readonly attendance: readonly ActivityAttendance[];
  /** Sales from `monthStart` to `date` inclusive. */
  readonly sales: readonly ActivitySale[];
  readonly targets: readonly ActivityTarget[];
}

export interface DailyActivityRow {
  readonly promoterId: string;
  readonly fullName: string;
  /** `null` when the promoter has not registered the day at all. */
  readonly status: AttendanceStatus | null;
  readonly outletName: string | null;
  readonly shift: Shift | null;
  /** The outlet+shift target for the day, or `null` when none is set. */
  readonly target: number | null;
  /** LAS logged on `date`. */
  readonly todayLas: number;
  /** Everything logged on `date`, LAU included. */
  readonly todayTotal: number;
  /** LAS from the 1st of the month through `date`. */
  readonly monthLas: number;
  /** Target accumulated over the `work` days actually registered this month. */
  readonly monthTarget: number;
}

const targetKey = (touchPointId: number, shift: Shift): string => `${touchPointId}|${shift}`;

/**
 * Builds the table.
 *
 * Promoters with nothing registered still get a row — a missing person is the
 * most interesting thing on this screen, and a list that silently omits them
 * reads as a full team. That is the same blind spot the legacy checklist view
 * had.
 *
 * Ordering puts the unregistered first, then the lowest achievement, so the
 * person who needs a phone call is at the top.
 */
export function buildDailyActivity(input: DailyActivityInput): readonly DailyActivityRow[] {
  const outletName = new Map(input.outlets.map((outlet) => [outlet.id, outlet.name]));
  const targets = new Map(
    input.targets.map((target) => [targetKey(target.touchPointId, target.shift), target.dailyTarget]),
  );

  const rows = input.promoters.map((promoter) => {
    const mine = input.attendance.filter((row) => row.promoterId === promoter.id);

    // A promoter can hold two rows for one date at a dual-shift outlet. The
    // working one is what the manager wants to see; a leave row only matters
    // when there is no working row at all.
    const onDate = mine.filter((row) => row.workDate === input.date);
    const working = onDate.find((row) => row.status === 'work');
    const today = working ?? onDate[0] ?? null;

    const mySales = input.sales.filter(
      (sale) => sale.promoterId === promoter.id && sale.customerType === 'LAS',
    );
    const todayLas = mySales.filter((sale) => sale.workDate === input.date).length;
    const todayTotal = input.sales.filter(
      (sale) => sale.promoterId === promoter.id && sale.workDate === input.date,
    ).length;

    const target =
      today !== null && today.status === 'work' && today.touchPointId !== null && today.shift !== null
        ? (targets.get(targetKey(today.touchPointId, today.shift)) ?? null)
        : null;

    // Accumulates only on days actually worked, so someone who was off on
    // Tuesday is not measured against Tuesday's target.
    let monthTarget = 0;
    for (const row of mine) {
      if (row.status !== 'work') continue;
      if (row.workDate > input.date || row.workDate < input.monthStart) continue;
      if (row.touchPointId === null || row.shift === null) continue;
      monthTarget += targets.get(targetKey(row.touchPointId, row.shift)) ?? 0;
    }

    return {
      promoterId: promoter.id,
      fullName: promoter.fullName,
      status: today?.status ?? null,
      outletName:
        today?.touchPointId != null ? (outletName.get(today.touchPointId) ?? null) : null,
      shift: today !== null && today.status === 'work' ? today.shift : null,
      target,
      todayLas,
      todayTotal,
      monthLas: mySales.length,
      monthTarget,
    };
  });

  return [...rows].sort((a, b) => {
    // Unregistered first — that is the actionable state.
    const aMissing = a.status === null ? 0 : 1;
    const bMissing = b.status === null ? 0 : 1;
    if (aMissing !== bMissing) return aMissing - bMissing;

    // Then by how far behind today's target they are. No target means nothing
    // to be behind on, so those sink below anyone who has one.
    const aRatio = a.target !== null && a.target > 0 ? a.todayLas / a.target : Number.POSITIVE_INFINITY;
    const bRatio = b.target !== null && b.target > 0 ? b.todayLas / b.target : Number.POSITIVE_INFINITY;
    if (aRatio !== bRatio) return aRatio - bRatio;

    return a.fullName.localeCompare(b.fullName, 'ar');
  });
}

/** Team totals for the day, summed from the rows that actually print. */
export function totalsFor(rows: readonly DailyActivityRow[]): {
  working: number;
  off: number;
  unregistered: number;
  todayLas: number;
  target: number;
} {
  let working = 0;
  let off = 0;
  let unregistered = 0;
  let todayLas = 0;
  let target = 0;

  for (const row of rows) {
    if (row.status === null) unregistered += 1;
    else if (row.status === 'work') working += 1;
    else off += 1;

    todayLas += row.todayLas;
    target += row.target ?? 0;
  }

  return { working, off, unregistered, todayLas, target };
}
