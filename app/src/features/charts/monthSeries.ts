/**
 * The month curve: cumulative sales against cumulative target, day by day.
 *
 * The legacy app drew this with Chart.js. The rebuild dropped that dependency
 * and the curve went with it — it is the one thing the old app showed that the
 * new one did not. This rebuilds the series; `MonthCurve.tsx` draws it in plain
 * SVG, because a two-line chart does not justify 200KB of library.
 *
 * The shape of the question is what matters. A single achievement percentage
 * says whether you are behind; the curve says whether the gap is opening or
 * closing, which is the part that decides whether to do anything about it.
 *
 * Two rules, both of which produce plausible-looking wrong numbers when broken:
 *
 *  - **Only LAS is scored.** LAU is real activity and is tracked elsewhere, but
 *    it never counts toward a target.
 *  - **Target accrues only on days actually worked.** A flat line of
 *    target-per-calendar-day measures people against days nobody asked them to
 *    work, and makes every month look like a failure by the 30th.
 */

import type { BusinessDate } from '../../lib/businessDay';
import type { Shift } from '../../domain/values';

export interface SeriesAttendance {
  readonly workDate: BusinessDate;
  /** Only `work` days accrue target. */
  readonly status: string;
  readonly touchPointId: number | null;
  readonly shift: Shift | null;
}

export interface SeriesSale {
  readonly workDate: BusinessDate;
  readonly customerType: string;
}

export interface SeriesTarget {
  readonly touchPointId: number;
  readonly shift: Shift;
  readonly dailyTarget: number;
}

export interface MonthSeriesInput {
  /** `YYYY-MM`. Every day from the 1st to `throughDay` appears in the output. */
  readonly month: string;
  /** Day of month to stop at, inclusive — normally today. */
  readonly throughDay: number;
  readonly attendance: readonly SeriesAttendance[];
  readonly sales: readonly SeriesSale[];
  readonly targets: readonly SeriesTarget[];
}

export interface MonthPoint {
  /** 1-31. */
  readonly day: number;
  /** LAS logged on this day alone. */
  readonly las: number;
  /** LAS from the 1st through this day. */
  readonly cumulativeLas: number;
  /** Target accrued from the 1st through this day, over worked days only. */
  readonly cumulativeTarget: number;
}

const key = (touchPointId: number, shift: Shift): string => `${touchPointId}|${shift}`;

const dayOf = (date: BusinessDate): number => Number(date.slice(8, 10));

/**
 * Builds one point per day of the month so far.
 *
 * Days with no activity still appear, flat. Skipping them would compress the
 * horizontal axis and make a quiet week look like a busy one.
 */
export function buildMonthSeries(input: MonthSeriesInput): readonly MonthPoint[] {
  const targets = new Map(
    input.targets.map((target) => [key(target.touchPointId, target.shift), target.dailyTarget]),
  );

  const lasByDay = new Map<number, number>();
  for (const sale of input.sales) {
    if (sale.customerType !== 'LAS') continue;
    if (!sale.workDate.startsWith(input.month)) continue;
    const day = dayOf(sale.workDate);
    lasByDay.set(day, (lasByDay.get(day) ?? 0) + 1);
  }

  const targetByDay = new Map<number, number>();
  for (const row of input.attendance) {
    if (row.status !== 'work') continue;
    if (!row.workDate.startsWith(input.month)) continue;
    if (row.touchPointId === null || row.shift === null) continue;
    const day = dayOf(row.workDate);
    const daily = targets.get(key(row.touchPointId, row.shift)) ?? 0;
    targetByDay.set(day, (targetByDay.get(day) ?? 0) + daily);
  }

  const points: MonthPoint[] = [];
  let cumulativeLas = 0;
  let cumulativeTarget = 0;

  const through = Math.max(0, Math.min(31, input.throughDay));
  for (let day = 1; day <= through; day += 1) {
    const las = lasByDay.get(day) ?? 0;
    cumulativeLas += las;
    cumulativeTarget += targetByDay.get(day) ?? 0;
    points.push({ day, las, cumulativeLas, cumulativeTarget });
  }

  return points;
}

export interface SeriesSummary {
  readonly las: number;
  readonly target: number;
  /** `null` when no target has accrued — 0/0 is not 0%, it is unanswerable. */
  readonly percent: number | null;
}

/** The three numbers printed beside the curve, taken from its last point. */
export function summarize(points: readonly MonthPoint[]): SeriesSummary {
  const last = points[points.length - 1];
  if (last === undefined) return { las: 0, target: 0, percent: null };
  return {
    las: last.cumulativeLas,
    target: last.cumulativeTarget,
    percent: last.cumulativeTarget > 0
      ? Math.round((last.cumulativeLas / last.cumulativeTarget) * 100)
      : null,
  };
}
