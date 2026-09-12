import { describe, it, expect } from 'vitest';
import { buildDailyActivity, totalsFor, type DailyActivityInput } from './dailyActivity';

/**
 * The numbers a manager reads off one screen and acts on. Every test here is a
 * way one of them could be quietly wrong — and a wrong number is worse than a
 * blank one, because nobody questions it.
 */

const DATE = '2026-09-12';
const MONTH_START = '2026-09-01';

function input(overrides: Partial<DailyActivityInput> = {}): DailyActivityInput {
  return {
    date: DATE,
    monthStart: MONTH_START,
    promoters: [{ id: 'p1', fullName: 'Ahmed' }],
    outlets: [
      { id: 10, name: 'QAS_Buraidah Mall_A_MN_BR' },
      { id: 20, name: 'QAS_Othaim_B_MN_BR' },
    ],
    attendance: [],
    sales: [],
    targets: [],
    ...overrides,
  };
}

const work = (date: string, touchPointId = 10, shift: 'day' | 'night' = 'day') => ({
  promoterId: 'p1',
  workDate: date,
  status: 'work' as const,
  touchPointId,
  shift,
});

const off = (date: string, promoterId = 'p1') => ({
  promoterId,
  workDate: date,
  status: 'off' as const,
  touchPointId: null,
  shift: null,
});

const las = (date: string, promoterId = 'p1') => ({
  promoterId,
  workDate: date,
  customerType: 'LAS',
});

const lau = (date: string) => ({ promoterId: 'p1', workDate: date, customerType: 'LAU' });

describe('daily activity — today', () => {
  it('shows where a working promoter is', () => {
    const [row] = buildDailyActivity(
      input({
        attendance: [work(DATE)],
        targets: [{ touchPointId: 10, shift: 'day', dailyTarget: 6 }],
      }),
    );
    expect(row).toMatchObject({
      status: 'work',
      outletName: 'QAS_Buraidah Mall_A_MN_BR',
      shift: 'day',
      target: 6,
    });
  });

  it('keeps a promoter who registered nothing, rather than dropping the row', () => {
    // A missing person is the most useful thing on this screen. Omitting them
    // makes an incomplete team look complete.
    const [row] = buildDailyActivity(input());
    expect(row?.status).toBeNull();
    expect(row?.fullName).toBe('Ahmed');
  });

  it('shows a leave day as leave, with no outlet or shift', () => {
    const [row] = buildDailyActivity(input({ attendance: [off(DATE)] }));
    expect(row).toMatchObject({ status: 'off', shift: null, target: null });
  });

  it('prefers the working row when a dual-shift day has two', () => {
    const [row] = buildDailyActivity(
      input({
        attendance: [off(DATE), work(DATE, 20, 'night')],
        targets: [{ touchPointId: 20, shift: 'night', dailyTarget: 4 }],
      }),
    );
    expect(row).toMatchObject({ status: 'work', shift: 'night', target: 4 });
  });

  it('reads the target for the shift actually worked, not the outlet default', () => {
    const [row] = buildDailyActivity(
      input({
        attendance: [work(DATE, 10, 'night')],
        targets: [
          { touchPointId: 10, shift: 'day', dailyTarget: 9 },
          { touchPointId: 10, shift: 'night', dailyTarget: 3 },
        ],
      }),
    );
    expect(row?.target).toBe(3);
  });

  it('leaves the target null when none is set, rather than showing zero', () => {
    // Zero reads as "asked for nothing, delivered nothing". Null reads as
    // "nobody set a target", which is a different problem with a different fix.
    const [row] = buildDailyActivity(input({ attendance: [work(DATE)] }));
    expect(row?.target).toBeNull();
  });
});

describe('daily activity — counting', () => {
  it('scores LAS only, but still shows the LAU activity', () => {
    const [row] = buildDailyActivity(
      input({ attendance: [work(DATE)], sales: [las(DATE), las(DATE), lau(DATE)] }),
    );
    expect(row?.todayLas).toBe(2);
    expect(row?.todayTotal).toBe(3);
  });

  it('separates today from the rest of the month', () => {
    const [row] = buildDailyActivity(
      input({
        attendance: [work('2026-09-10'), work(DATE)],
        sales: [las('2026-09-10'), las('2026-09-10'), las(DATE)],
      }),
    );
    expect(row?.todayLas).toBe(1);
    expect(row?.monthLas).toBe(3);
  });

  it('accumulates the month target over days actually worked', () => {
    const [row] = buildDailyActivity(
      input({
        attendance: [work('2026-09-10'), work('2026-09-11'), work(DATE)],
        targets: [{ touchPointId: 10, shift: 'day', dailyTarget: 6 }],
      }),
    );
    expect(row?.monthTarget).toBe(18);
  });

  it('does not accumulate target on a day off', () => {
    // Measuring someone against a target for a day nobody asked them to work
    // understates achievement for the whole month.
    const [row] = buildDailyActivity(
      input({
        attendance: [work('2026-09-10'), off('2026-09-11'), work(DATE)],
        targets: [{ touchPointId: 10, shift: 'day', dailyTarget: 6 }],
      }),
    );
    expect(row?.monthTarget).toBe(12);
  });

  it('ignores days after the date being viewed', () => {
    // Looking back at the 12th must not fold in the 13th.
    const [row] = buildDailyActivity(
      input({
        attendance: [work(DATE), work('2026-09-13')],
        sales: [las(DATE), las('2026-09-13')],
        targets: [{ touchPointId: 10, shift: 'day', dailyTarget: 6 }],
      }),
    );
    expect(row?.monthTarget).toBe(6);
  });

  it('counts each promoter separately', () => {
    const rows = buildDailyActivity(
      input({
        promoters: [
          { id: 'p1', fullName: 'Ahmed' },
          { id: 'p2', fullName: 'Bandar' },
        ],
        attendance: [work(DATE), { ...work(DATE), promoterId: 'p2' }],
        sales: [las(DATE), las(DATE), las(DATE, 'p2')],
      }),
    );
    const byId = new Map(rows.map((row) => [row.promoterId, row]));
    expect(byId.get('p1')?.todayLas).toBe(2);
    expect(byId.get('p2')?.todayLas).toBe(1);
  });
});

describe('daily activity — ordering', () => {
  it('puts whoever has not registered at the top', () => {
    const rows = buildDailyActivity(
      input({
        promoters: [
          { id: 'p1', fullName: 'Ahmed' },
          { id: 'p2', fullName: 'Bandar' },
        ],
        attendance: [work(DATE)],
        targets: [{ touchPointId: 10, shift: 'day', dailyTarget: 6 }],
      }),
    );
    expect(rows[0]?.promoterId).toBe('p2');
  });

  it('then puts the furthest behind target first', () => {
    const rows = buildDailyActivity(
      input({
        promoters: [
          { id: 'p1', fullName: 'Ahmed' },
          { id: 'p2', fullName: 'Bandar' },
        ],
        attendance: [work(DATE), { ...work(DATE), promoterId: 'p2' }],
        sales: [las(DATE), las(DATE), las(DATE), las(DATE), las(DATE)],
        targets: [{ touchPointId: 10, shift: 'day', dailyTarget: 5 }],
      }),
    );
    // p1 is at 5/5, p2 at 0/5 — the one to phone is first.
    expect(rows[0]?.promoterId).toBe('p2');
  });
});

describe('totalsFor', () => {
  it('sums from the rows that actually print', () => {
    const rows = buildDailyActivity(
      input({
        promoters: [
          { id: 'p1', fullName: 'Ahmed' },
          { id: 'p2', fullName: 'Bandar' },
          { id: 'p3', fullName: 'Khalid' },
        ],
        attendance: [work(DATE), off(DATE, 'p2')],
        sales: [las(DATE), las(DATE)],
        targets: [{ touchPointId: 10, shift: 'day', dailyTarget: 6 }],
      }),
    );
    expect(totalsFor(rows)).toEqual({
      working: 1,
      off: 1,
      unregistered: 1,
      todayLas: 2,
      target: 6,
    });
  });
});
