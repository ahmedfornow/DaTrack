import { describe, it, expect } from 'vitest';
import { buildMonthSeries, summarize, type MonthSeriesInput } from './monthSeries';

/**
 * The curve is read as a trend, not a number, so the failure mode is a shape
 * that is subtly wrong — a gap that looks like it is closing when it is not.
 * These pin the arithmetic that produces the shape.
 */

const MONTH = '2026-09';

function input(overrides: Partial<MonthSeriesInput> = {}): MonthSeriesInput {
  return {
    month: MONTH,
    throughDay: 5,
    attendance: [],
    sales: [],
    targets: [],
    ...overrides,
  };
}

const work = (day: number, touchPointId = 10, shift: 'day' | 'night' = 'day') => ({
  workDate: `${MONTH}-${String(day).padStart(2, '0')}`,
  status: 'work',
  touchPointId,
  shift,
});

const off = (day: number) => ({
  workDate: `${MONTH}-${String(day).padStart(2, '0')}`,
  status: 'off',
  touchPointId: null,
  shift: null,
});

const sale = (day: number, customerType = 'LAS') => ({
  workDate: `${MONTH}-${String(day).padStart(2, '0')}`,
  customerType,
});

const TARGET = [{ touchPointId: 10, shift: 'day' as const, dailyTarget: 6 }];

describe('buildMonthSeries', () => {
  it('emits one point per day up to today, including quiet days', () => {
    // Skipping empty days would compress the axis and make a quiet week look
    // like a busy one.
    const points = buildMonthSeries(input({ sales: [sale(3)] }));
    expect(points.map((point) => point.day)).toEqual([1, 2, 3, 4, 5]);
    expect(points.map((point) => point.las)).toEqual([0, 0, 1, 0, 0]);
  });

  it('accumulates sales rather than resetting each day', () => {
    const points = buildMonthSeries(input({ sales: [sale(1), sale(3), sale(3), sale(5)] }));
    expect(points.map((point) => point.cumulativeLas)).toEqual([1, 1, 3, 3, 4]);
  });

  it('counts LAS only', () => {
    const points = buildMonthSeries(
      input({ sales: [sale(1, 'LAS'), sale(1, 'LAU'), sale(2, 'LAU')] }),
    );
    expect(points[points.length - 1]?.cumulativeLas).toBe(1);
  });

  it('accrues target only on days actually worked', () => {
    // A flat target-per-calendar-day measures people against days nobody asked
    // them to work, and makes every month look like a failure by the 30th.
    const points = buildMonthSeries(
      input({ attendance: [work(1), off(2), work(3)], targets: TARGET }),
    );
    expect(points.map((point) => point.cumulativeTarget)).toEqual([6, 6, 12, 12, 12]);
  });

  it('adds both shifts when one person works a double', () => {
    const points = buildMonthSeries(
      input({
        attendance: [work(1, 10, 'day'), work(1, 10, 'night')],
        targets: [
          { touchPointId: 10, shift: 'day', dailyTarget: 6 },
          { touchPointId: 10, shift: 'night', dailyTarget: 4 },
        ],
      }),
    );
    expect(points[0]?.cumulativeTarget).toBe(10);
  });

  it('treats an outlet with no target as zero rather than dropping the day', () => {
    const points = buildMonthSeries(input({ attendance: [work(1, 99)], targets: TARGET }));
    expect(points[0]?.cumulativeTarget).toBe(0);
    expect(points).toHaveLength(5);
  });

  it('ignores rows from another month', () => {
    const points = buildMonthSeries(
      input({
        sales: [sale(1), { workDate: '2026-08-30', customerType: 'LAS' }],
        attendance: [work(1), { ...work(1), workDate: '2026-08-30' }],
        targets: TARGET,
      }),
    );
    expect(points[points.length - 1]?.cumulativeLas).toBe(1);
    expect(points[points.length - 1]?.cumulativeTarget).toBe(6);
  });

  it('stops at today, not at the end of the month', () => {
    const points = buildMonthSeries(input({ throughDay: 3, sales: [sale(1), sale(9)] }));
    expect(points).toHaveLength(3);
    expect(points[2]?.cumulativeLas).toBe(1);
  });

  it('returns nothing on day zero rather than throwing', () => {
    expect(buildMonthSeries(input({ throughDay: 0 }))).toEqual([]);
  });

  it('clamps a nonsense day count', () => {
    expect(buildMonthSeries(input({ throughDay: 99 }))).toHaveLength(31);
  });
});

describe('summarize', () => {
  it('reads the totals off the last point', () => {
    const points = buildMonthSeries(
      input({ sales: [sale(1), sale(2), sale(3)], attendance: [work(1), work(2)], targets: TARGET }),
    );
    expect(summarize(points)).toEqual({ las: 3, target: 12, percent: 25 });
  });

  it('leaves the percentage unanswerable when no target has accrued', () => {
    // 0/0 is not 0% — it means nobody set a target, which is a different
    // problem with a different fix.
    const points = buildMonthSeries(input({ sales: [sale(1)] }));
    expect(summarize(points).percent).toBeNull();
  });

  it('handles an empty series', () => {
    expect(summarize([])).toEqual({ las: 0, target: 0, percent: null });
  });
});
