/**
 * Domain rules, as pure functions.
 *
 * Everything here produces a number or a decision the team acts on. Getting one
 * wrong is worse than a crash, because a wrong achievement percentage looks
 * exactly like a right one. They live in one place so the UI, the reports and
 * the dashboards cannot disagree with each other.
 */

import type { AttendanceStatus, CustomerType, SaleType, Shift, ShiftMode } from './values';

// ---------------------------------------------------------------------------
// Sales
// ---------------------------------------------------------------------------

/**
 * Only LAS customers can receive MGM.
 *
 * The database enforces this too — `sell_ops_las_only_mgm` is confirmed present
 * on `sell_operations`. This guard exists so the UI can block the tap and
 * explain why, rather than letting a promoter compose an invalid sale and meet
 * a constraint violation on submit.
 */
export function isValidSalePair(customerType: CustomerType, saleType: SaleType): boolean {
  if (customerType === 'LAU') {
    return saleType !== 'MGM' && saleType !== 'SK+MGM';
  }
  return true;
}

/**
 * What choosing a customer type does to an already-chosen sale type.
 *
 * Picking LAU while MGM is selected clears the sale type rather than silently
 * keeping an invalid pair — a half-empty form is recoverable, a wrong row is
 * not.
 */
export function saleTypeAfterCustomerChange(
  saleType: SaleType | null,
  customerType: CustomerType,
): SaleType | null {
  if (saleType === null) return null;
  return isValidSalePair(customerType, saleType) ? saleType : null;
}

/** Only LAS counts toward target. LAU is tracked and displayed but never scored. */
export function countsTowardTarget(customerType: CustomerType): boolean {
  return customerType === 'LAS';
}

/**
 * Whether a sale contributes to the SK column. `SK+MGM` counts in both SK and
 * MGM, which is why these totals can exceed the number of sales — that is
 * intentional and matches what the team already reads.
 */
export function countsAsSk(saleType: SaleType): boolean {
  return saleType === 'SK' || saleType === 'SK+MGM';
}

/** Whether a sale contributes to the MGM column. See {@link countsAsSk}. */
export function countsAsMgm(saleType: SaleType): boolean {
  return saleType === 'MGM' || saleType === 'SK+MGM';
}

/** Whether a sale contributes to the LD column. LD never combines. */
export function countsAsLd(saleType: SaleType): boolean {
  return saleType === 'LD';
}

// ---------------------------------------------------------------------------
// Outlets and shifts
// ---------------------------------------------------------------------------

/** The shifts an outlet actually runs. A night-only outlet never offers day. */
export function shiftsFor(mode: ShiftMode): readonly Shift[] {
  if (mode === 'dual') return ['day', 'night'];
  return [mode];
}

/** Whether an outlet runs a given shift. */
export function runsShift(mode: ShiftMode, shift: Shift): boolean {
  return shiftsFor(mode).includes(shift);
}

/**
 * The shift to preselect for an outlet, given the shifts already registered for
 * that promoter on that date.
 *
 * Prefers a shift the outlet runs that is not yet taken; falls back to the
 * outlet's first shift when everything is taken, so the UI always has a
 * selection and the duplicate is caught by validation with a real message.
 */
export function defaultShiftFor(mode: ShiftMode, taken: readonly Shift[] = []): Shift {
  const runs = shiftsFor(mode);
  const free = runs.filter((shift) => !taken.includes(shift));
  const chosen = free[0] ?? runs[0];
  // `shiftsFor` never returns an empty list, so this is total.
  if (chosen === undefined) throw new Error(`no shifts for mode ${mode}`);
  return chosen;
}

/** Only `work` days carry an outlet and a shift. */
export function requiresOutlet(status: AttendanceStatus): boolean {
  return status === 'work';
}

// ---------------------------------------------------------------------------
// Achievement
// ---------------------------------------------------------------------------

/**
 * How a figure is doing against its target. Thresholds are fixed at 100% and
 * 70% and must stay identical everywhere they are shown — the colour is how
 * the team reads the number at a glance.
 */
export type AchievementBand = 'achieved' | 'close' | 'behind' | 'untargeted';

export function achievementBand(
  actual: number,
  target: number | null | undefined,
): AchievementBand {
  if (target === null || target === undefined || !Number.isFinite(target) || target <= 0) {
    return 'untargeted';
  }
  const pct = (actual / target) * 100;
  if (pct >= 100) return 'achieved';
  if (pct >= 70) return 'close';
  return 'behind';
}

/**
 * Achievement as a whole percentage, or `null` when there is no target to
 * divide by. Never returns `Infinity` or `NaN` — those reach the screen as
 * "Infinity%" and destroy trust in every other number on the page.
 */
export function achievementPercent(
  actual: number,
  target: number | null | undefined,
): number | null {
  if (target === null || target === undefined || !Number.isFinite(target) || target <= 0) {
    return null;
  }
  return Math.round((actual / target) * 100);
}

/**
 * A promoter's target for a day is the target of the outlet and shift they
 * worked, so a monthly target is the sum across the days actually worked —
 * never a fixed number. Only `work` days accumulate.
 */
export function accumulateTarget(
  days: readonly { status: AttendanceStatus; dailyTarget: number | null }[],
): number {
  const total = days.reduce((sum, day) => {
    if (day.status !== 'work') return sum;
    const target = day.dailyTarget;
    if (target === null || !Number.isFinite(target)) return sum;
    return sum + target;
  }, 0);
  // Targets are numeric in the database and routinely fractional; keep two
  // decimals so a month of 1.5s does not drift into float noise on screen.
  return Math.round(total * 100) / 100;
}
