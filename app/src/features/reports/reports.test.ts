import { describe, it, expect } from 'vitest';
import {
  buildEndOfShiftReport,
  reviewBeforeSending,
  warningMessage,
} from './endOfShift';
import type { Sale } from '../../data/sales';
import type { StockItem } from '../../data/stock';
import { buildStockMessage, countedSummary } from './stockCount';

/**
 * These assertions pin the exact bytes the team sends over WhatsApp. The
 * expected strings were taken from the legacy generator, not written from
 * memory — separator length, spacing around colons, and the two blank lines
 * after the shift are all reproduced deliberately.
 */

function sale(overrides: Partial<Sale> = {}): Sale {
  const base: Sale = {
    id: 1,
    attendanceId: 10,
    promoterId: 'p1',
    workDate: '2026-08-25',
    deviceType: 'ILUMA i Prime',
    color: 'Garnet Red',
    saleType: 'SK',
    customerType: 'LAS',
    quantity: 1,
    createdAt: null,
  };
  return { ...base, ...overrides };
}

describe('end-of-shift report', () => {
  it('matches the legacy format exactly', () => {
    const report = buildEndOfShiftReport({
      outletName: 'QAS_Othaim Mall_HYP_MN_BR',
      workDate: '2026-08-25',
      shift: 'day',
      sales: [
        sale({ id: 1 }),
        sale({ id: 2, deviceType: 'ILUMA i One', color: 'Leaf Green', saleType: 'LD', customerType: 'LAU' }),
      ],
      guidedTrials: 7,
    });

    expect(report).toBe(
      [
        'QAS_Othaim Mall_HYP_MN_BR',
        'Date : 25/08/2026',
        'Shift : Day',
        '',
        '',
        '1. PRIME - Garnet Red | LAS | SK',
        '2. ONE - Leaf Green | LAU | LD',
        '______________________',
        'Total sales : 2',
        'Guided trials : 7',
      ].join('\n'),
    );
  });

  it('prints "No sales" instead of a numbered list when nothing was logged', () => {
    const report = buildEndOfShiftReport({
      outletName: 'QAS_Test_HYP',
      workDate: '2026-08-25',
      shift: 'night',
      sales: [],
      guidedTrials: 0,
    });

    expect(report).toBe(
      [
        'QAS_Test_HYP',
        'Date : 25/08/2026',
        'Shift : Night',
        '',
        '',
        'No sales',
        '______________________',
        'Total sales : 0',
        'Guided trials : 0',
      ].join('\n'),
    );
  });

  it('uses a 22-character separator', () => {
    const report = buildEndOfShiftReport({
      outletName: 'X',
      workDate: '2026-08-25',
      shift: 'day',
      sales: [],
      guidedTrials: 0,
    });
    const separator = report.split('\n').find((line) => line.startsWith('_'));
    expect(separator).toHaveLength(22);
  });

  it('derives the total from what actually printed', () => {
    const sales = [sale({ id: 1 }), sale({ id: 2 }), sale({ id: 3 })];
    const report = buildEndOfShiftReport({
      outletName: 'X',
      workDate: '2026-08-25',
      shift: 'day',
      sales,
      guidedTrials: 0,
    });
    const numbered = report.split('\n').filter((line) => /^\d+\. /.test(line));
    expect(numbered).toHaveLength(3);
    expect(report).toContain('Total sales : 3');
  });

  it('numbers sales in the order given', () => {
    const report = buildEndOfShiftReport({
      outletName: 'X',
      workDate: '2026-08-25',
      shift: 'day',
      sales: [sale({ id: 1, color: 'Breeze Blue' }), sale({ id: 2, color: 'Aspen Green' })],
      guidedTrials: 0,
    });
    expect(report.indexOf('1. PRIME - Breeze Blue')).toBeLessThan(
      report.indexOf('2. PRIME - Aspen Green'),
    );
  });

  describe('the body stays safe to forward', () => {
    it('contains no Arabic', () => {
      const report = buildEndOfShiftReport({
        outletName: 'QAS_Othaim Mall_HYP',
        workDate: '2026-08-25',
        shift: 'day',
        sales: [sale()],
        guidedTrials: 3,
      });
      expect(report).not.toMatch(/[؀-ۿ]/);
    });

    it('contains no emoji', () => {
      const report = buildEndOfShiftReport({
        outletName: 'QAS_Mall 🏬_HYP',
        workDate: '2026-08-25',
        shift: 'day',
        sales: [sale()],
        guidedTrials: 0,
      });
      expect(report).not.toMatch(/\p{Extended_Pictographic}/u);
      expect(report.split('\n')[0]).toBe('QAS_Mall _HYP');
    });

    it('collapses a multi-line outlet name that would break the message', () => {
      // The legacy generator prints this raw, so a pasted value would shatter
      // the report into extra lines mid-message.
      const report = buildEndOfShiftReport({
        outletName: 'QAS_Mall\nSkip to content\nSign in',
        workDate: '2026-08-25',
        shift: 'day',
        sales: [],
        guidedTrials: 0,
      });
      expect(report.split('\n')[0]).toBe('QAS_Mall Skip to content Sign in');
      // Header, date, shift, blank, blank, No sales, separator, 2 totals.
      expect(report.split('\n')).toHaveLength(9);
    });
  });

  it('formats the date as DD/MM/YYYY, not ISO', () => {
    const report = buildEndOfShiftReport({
      outletName: 'X',
      workDate: '2026-01-05',
      shift: 'day',
      sales: [],
      guidedTrials: 0,
    });
    expect(report).toContain('Date : 05/01/2026');
    expect(report).not.toContain('2026-01-05');
  });
});

describe('pre-send review', () => {
  const context = { outletName: 'Othaim', shiftLabel: 'نهاري', guidedTrials: 2 };

  it('warns when nothing was logged', () => {
    const review = reviewBeforeSending({ ...context, sales: [], target: 5 });
    expect(review.warnings.map((w) => w.kind)).toContain('no-sales');
    expect(warningMessage(review.warnings[0]!)).toContain('لم تسجّل');
  });

  it('warns below 70% achievement', () => {
    // 3 LAS against a target of 5 is 60%.
    const review = reviewBeforeSending({
      ...context,
      sales: [sale({ id: 1 }), sale({ id: 2 }), sale({ id: 3 })],
      target: 5,
    });
    expect(review.percent).toBe(60);
    expect(review.warnings.map((w) => w.kind)).toContain('below-target');
  });

  it('stays quiet at exactly 70%', () => {
    const sales = Array.from({ length: 7 }, (_, i) => sale({ id: i + 1 }));
    const review = reviewBeforeSending({ ...context, sales, target: 10 });
    expect(review.percent).toBe(70);
    expect(review.warnings).toEqual([]);
  });

  it('counts only LAS toward achievement', () => {
    const review = reviewBeforeSending({
      ...context,
      sales: [
        sale({ id: 1, customerType: 'LAS' }),
        sale({ id: 2, customerType: 'LAU' }),
        sale({ id: 3, customerType: 'LAU' }),
      ],
      target: 2,
    });
    expect(review.totalSales).toBe(3);
    expect(review.lasCount).toBe(1);
    expect(review.percent).toBe(50);
  });

  it('reports no percentage when the outlet has no target', () => {
    const review = reviewBeforeSending({ ...context, sales: [sale()], target: null });
    expect(review.percent).toBeNull();
    expect(review.warnings).toEqual([]);
  });

  it('does not divide by a zero target', () => {
    const review = reviewBeforeSending({ ...context, sales: [sale()], target: 0 });
    expect(review.percent).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Stock count message — report #2
// ---------------------------------------------------------------------------

const catalog: StockItem[] = [
  { id: 1, itemName: 'IQOS ILUMA PRIME i — Garnet Red', category: 'device', sortOrder: 1 },
  { id: 2, itemName: 'IQOS ILUMA PRIME i — Breeze Blue', category: 'device', sortOrder: 2 },
  { id: 3, itemName: 'IQOS ILUMA i — Leaf Green', category: 'device', sortOrder: 3 },
  { id: 4, itemName: 'IQOS ILUMA i ONE — Digital Violet', category: 'device', sortOrder: 4 },
  { id: 5, itemName: 'TEREA Sienna', category: 'terea', sortOrder: 5 },
];

describe('stock count message', () => {
  it('matches the legacy layout, including the uneven separators', () => {
    const message = buildStockMessage({
      outletName: 'QAS_Othaim Mall_HYP',
      workDate: '2026-08-25',
      catalog,
      quantities: new Map([[1, 4], [2, 0], [3, 12], [4, 7], [5, 30]]),
    });

    expect(message).toBe(
      [
        'Date: 25/08/2026',
        'Outlet: QAS_Othaim Mall_HYP',
        '________',
        'IQOS ILUMA PRIME i:',
        'GARNET RED: 4',
        'BREEZE BLUE: 0',
        '________',
        'IQOS ILUMA i:',
        'LEAF GREEN: 12',
        '________',
        'IQOS ILUMA i ONE:',
        'DIGITAL VIOLET: 7',
        '_______',
        'STARTER KITS',
        '',
        'SIENNA: 30',
      ].join('\n'),
    );
  });

  it('uses 8 underscores for device groups and 7 for starter kits', () => {
    const message = buildStockMessage({
      outletName: 'X',
      workDate: '2026-08-25',
      catalog,
      quantities: new Map(),
    });
    const runs = message.split('\n').filter((l) => /^_+$/.test(l)).map((l) => l.length);
    expect(runs).toEqual([8, 8, 8, 7]);
  });

  it('distinguishes an uncounted item from one counted zero', () => {
    // Blank means "not counted"; 0 means "counted, none left". Printing 0 for
    // both would fabricate a complete stocktake out of a partial one.
    const message = buildStockMessage({
      outletName: 'X',
      workDate: '2026-08-25',
      catalog,
      quantities: new Map([[1, 0]]),
    });
    expect(message).toContain('GARNET RED: 0');
    expect(message).toContain('BREEZE BLUE: ');
    expect(message).not.toContain('BREEZE BLUE: 0');
  });

  it('keeps ILUMA i separate from ONE and PRIME via the em dash', () => {
    const message = buildStockMessage({
      outletName: 'X',
      workDate: '2026-08-25',
      catalog,
      quantities: new Map([[3, 5]]),
    });
    const iluma = message.split('IQOS ILUMA i:')[1]?.split('________')[0] ?? '';
    expect(iluma).toContain('LEAF GREEN');
    expect(iluma).not.toContain('DIGITAL VIOLET');
    expect(iluma).not.toContain('GARNET RED');
  });

  it('sanitises the outlet name so a pasted value cannot break the message', () => {
    const message = buildStockMessage({
      outletName: 'QAS_Mall\nSkip to content',
      workDate: '2026-08-25',
      catalog: [],
      quantities: new Map(),
    });
    expect(message.split('\n')[1]).toBe('Outlet: QAS_Mall Skip to content');
  });

  it('carries no Arabic and no emoji', () => {
    const message = buildStockMessage({
      outletName: 'QAS_Mall 🏬',
      workDate: '2026-08-25',
      catalog,
      quantities: new Map([[1, 1]]),
    });
    expect(message).not.toMatch(/[؀-ۿ]/);
    expect(message).not.toMatch(/\p{Extended_Pictographic}/u);
  });

  it('reports counting progress', () => {
    expect(countedSummary(catalog, new Map([[1, 3], [2, 0]]))).toEqual({
      counted: 2,
      total: 5,
      complete: false,
    });
    const all = new Map(catalog.map((i) => [i.id, 1]));
    expect(countedSummary(catalog, all).complete).toBe(true);
  });
});
