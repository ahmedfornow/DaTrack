import { describe, it, expect } from 'vitest';
import {
  aggregateCompliance,
  aggregateSales,
  type AggregateSale,
  type ComplianceAttendance,
} from './aggregate';

function sale(overrides: Partial<AggregateSale> = {}): AggregateSale {
  const base: AggregateSale = {
    promoterId: 'p1',
    promoterName: 'Ahmed',
    outletName: 'QAS_Othaim Mall_HYP',
    deviceType: 'ILUMA i Prime',
    color: 'Garnet Red',
    saleType: 'SK',
    customerType: 'LAS',
  };
  return { ...base, ...overrides };
}

describe('aggregateSales', () => {
  it('splits LAS from LAU', () => {
    const result = aggregateSales([
      sale({ customerType: 'LAS' }),
      sale({ customerType: 'LAS' }),
      sale({ customerType: 'LAU' }),
    ]);
    expect(result.las).toBe(2);
    expect(result.lau).toBe(1);
    expect(result.total).toBe(3);
  });

  it('counts SK+MGM in both columns, so parts can exceed the whole', () => {
    const result = aggregateSales([sale({ saleType: 'SK+MGM' })]);
    const promoter = result.byPromoter[0];
    expect(promoter?.sk).toBe(1);
    expect(promoter?.mgm).toBe(1);
    expect(result.total).toBe(1);
  });

  it('ranks promoters by LAS, not by total activity', () => {
    // Khalid has more sales but fewer LAS; only LAS is scored.
    const result = aggregateSales([
      sale({ promoterName: 'Ahmed', customerType: 'LAS' }),
      sale({ promoterName: 'Ahmed', customerType: 'LAS' }),
      sale({ promoterName: 'Khalid', customerType: 'LAS' }),
      sale({ promoterName: 'Khalid', customerType: 'LAU' }),
      sale({ promoterName: 'Khalid', customerType: 'LAU' }),
    ]);
    expect(result.byPromoter.map((p) => p.name)).toEqual(['Ahmed', 'Khalid']);
    expect(result.byPromoter[0]?.las).toBe(2);
  });

  it('breaks a ranking tie by name, so the order is stable', () => {
    const result = aggregateSales([
      sale({ promoterName: 'Zaid' }),
      sale({ promoterName: 'Ahmed' }),
    ]);
    expect(result.byPromoter.map((p) => p.name)).toEqual(['Ahmed', 'Zaid']);
  });

  it('aggregates by outlet independently of promoter', () => {
    const result = aggregateSales([
      sale({ promoterName: 'Ahmed', outletName: 'A' }),
      sale({ promoterName: 'Khalid', outletName: 'A' }),
      sale({ promoterName: 'Ahmed', outletName: 'B' }),
    ]);
    expect(result.byOutlet.find((o) => o.name === 'A')?.las).toBe(2);
    expect(result.byOutlet.find((o) => o.name === 'B')?.las).toBe(1);
  });

  it('breaks sales down by device and by device+colour', () => {
    const result = aggregateSales([
      sale({ deviceType: 'ILUMA i Prime', color: 'Garnet Red' }),
      sale({ deviceType: 'ILUMA i Prime', color: 'Garnet Red' }),
      sale({ deviceType: 'ILUMA i', color: 'Leaf Green' }),
    ]);
    expect(result.byDevice[0]).toEqual({ label: 'ILUMA i Prime', count: 2 });
    expect(result.byColor[0]).toEqual({ label: 'ILUMA i Prime — Garnet Red', count: 2 });
  });

  it('returns empty aggregates for no sales', () => {
    const result = aggregateSales([]);
    expect(result).toMatchObject({ las: 0, lau: 0, total: 0 });
    expect(result.byPromoter).toEqual([]);
    expect(result.byOutlet).toEqual([]);
  });

  it('keeps promoter totals summing to the overall totals', () => {
    const sales = [
      sale({ promoterName: 'Ahmed', customerType: 'LAS' }),
      sale({ promoterName: 'Khalid', customerType: 'LAU' }),
      sale({ promoterName: 'Khalid', customerType: 'LAS' }),
    ];
    const result = aggregateSales(sales);
    const summedLas = result.byPromoter.reduce((n, p) => n + p.las, 0);
    const summedLau = result.byPromoter.reduce((n, p) => n + p.lau, 0);
    expect(summedLas).toBe(result.las);
    expect(summedLau).toBe(result.lau);
    expect(summedLas + summedLau).toBe(result.total);
  });
});

describe('aggregateCompliance', () => {
  const promoters = [
    { id: 'p1', fullName: 'Ahmed' },
    { id: 'p2', fullName: 'Khalid' },
  ];

  const attendance: ComplianceAttendance[] = [
    { promoterId: 'p1', workDate: '2026-08-01', touchPointId: 1, shift: 'day', isWork: true },
    { promoterId: 'p1', workDate: '2026-08-02', touchPointId: 1, shift: 'day', isWork: true },
    { promoterId: 'p2', workDate: '2026-08-01', touchPointId: 1, shift: 'night', isWork: true },
  ];

  const dailyTargets = new Map([
    ['1-day', 5],
    ['1-night', 3],
  ]);

  it('accumulates target across worked days only', () => {
    const rows = aggregateCompliance({
      promoters,
      attendance,
      lasByPromoter: new Map([['p1', 7]]),
      dailyTargets,
      elapsedDays: 2,
    });
    const ahmed = rows.find((r) => r.promoterId === 'p1');
    expect(ahmed?.target).toBe(10); // two day shifts at 5
    expect(ahmed?.las).toBe(7);
    expect(ahmed?.achievement).toBe(70);
  });

  it('does not accumulate target for a leave day', () => {
    const rows = aggregateCompliance({
      promoters,
      attendance: [
        ...attendance,
        { promoterId: 'p1', workDate: '2026-08-03', touchPointId: null, shift: null, isWork: false },
      ],
      lasByPromoter: new Map([['p1', 7]]),
      dailyTargets,
      elapsedDays: 3,
    });
    const ahmed = rows.find((r) => r.promoterId === 'p1');
    // The day counts as logged, but adds nothing to the target.
    expect(ahmed?.daysLogged).toBe(3);
    expect(ahmed?.target).toBe(10);
  });

  it('uses the target of the shift actually worked', () => {
    const rows = aggregateCompliance({
      promoters,
      attendance,
      lasByPromoter: new Map(),
      dailyTargets,
      elapsedDays: 2,
    });
    expect(rows.find((r) => r.promoterId === 'p2')?.target).toBe(3);
  });

  it('counts a date once even when both shifts were worked', () => {
    const rows = aggregateCompliance({
      promoters,
      attendance: [
        { promoterId: 'p1', workDate: '2026-08-01', touchPointId: 1, shift: 'day', isWork: true },
        { promoterId: 'p1', workDate: '2026-08-01', touchPointId: 1, shift: 'night', isWork: true },
      ],
      lasByPromoter: new Map(),
      dailyTargets,
      elapsedDays: 1,
    });
    const ahmed = rows.find((r) => r.promoterId === 'p1');
    expect(ahmed?.daysLogged).toBe(1);
    // But both shifts contribute their target.
    expect(ahmed?.target).toBe(8);
  });

  it('reports no achievement when no target is set', () => {
    const rows = aggregateCompliance({
      promoters,
      attendance,
      lasByPromoter: new Map([['p1', 4]]),
      dailyTargets: new Map(),
      elapsedDays: 2,
    });
    expect(rows.find((r) => r.promoterId === 'p1')?.achievement).toBeNull();
  });

  it('lists the least compliant first', () => {
    const rows = aggregateCompliance({
      promoters,
      attendance,
      lasByPromoter: new Map(),
      dailyTargets,
      elapsedDays: 5,
    });
    // Khalid logged 1 day, Ahmed 2.
    expect(rows.map((r) => r.fullName)).toEqual(['Khalid', 'Ahmed']);
  });

  it('includes a promoter with no attendance at all', () => {
    const rows = aggregateCompliance({
      promoters,
      attendance: [],
      lasByPromoter: new Map(),
      dailyTargets,
      elapsedDays: 5,
    });
    expect(rows).toHaveLength(2);
    expect(rows[0]?.daysLogged).toBe(0);
    expect(rows[0]?.complete).toBe(false);
  });

  it('marks a promoter complete once they match the elapsed days', () => {
    const rows = aggregateCompliance({
      promoters,
      attendance,
      lasByPromoter: new Map(),
      dailyTargets,
      elapsedDays: 2,
    });
    expect(rows.find((r) => r.promoterId === 'p1')?.complete).toBe(true);
    expect(rows.find((r) => r.promoterId === 'p2')?.complete).toBe(false);
  });

  it('rounds a fractional accumulated target to two places', () => {
    const rows = aggregateCompliance({
      promoters: [{ id: 'p1', fullName: 'Ahmed' }],
      attendance: [
        { promoterId: 'p1', workDate: '2026-08-01', touchPointId: 1, shift: 'day', isWork: true },
        { promoterId: 'p1', workDate: '2026-08-02', touchPointId: 1, shift: 'day', isWork: true },
        { promoterId: 'p1', workDate: '2026-08-03', touchPointId: 1, shift: 'day', isWork: true },
      ],
      lasByPromoter: new Map(),
      dailyTargets: new Map([['1-day', 1.1]]),
      elapsedDays: 3,
    });
    // 1.1 * 3 is 3.3000000000000003 in float arithmetic.
    expect(rows[0]?.target).toBe(3.3);
  });
});
