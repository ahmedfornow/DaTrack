import { describe, it, expect } from 'vitest';
import { parseOutlet, byId, type Outlet } from './outlets';
import {
  dailyTargetFor,
  gtTargetFor,
  indexTargets,
  parseTarget,
  targetKey,
  type Target,
} from './targets';
import { groupSales, parseSale, summarize, validateSale, type Sale } from './sales';
import { allCombinations } from '../domain/devices';
import { catalogSummary, diffCatalog } from './devices';

// ---------------------------------------------------------------------------
// Outlets
// ---------------------------------------------------------------------------

describe('parseOutlet', () => {
  const base = {
    id: 1,
    name: 'QAS_Othaim Mall_HYP_MN_BR',
    unicode: '12345',
    maps_url: 'https://maps.google.com/?q=1',
    shift_mode: 'dual',
    dual_shift: true,
    is_ds: false,
    city: 'Qassim',
    active: true,
  };

  it('extracts the human part of the name for display', () => {
    expect(parseOutlet(base)?.shortName).toBe('Othaim Mall');
  });

  it('falls back to the whole name when the convention is not followed', () => {
    expect(parseOutlet({ ...base, name: 'Corner Shop' })?.shortName).toBe('Corner Shop');
  });

  it('derives the shifts an outlet runs', () => {
    expect(parseOutlet(base)?.shifts).toEqual(['day', 'night']);
    expect(parseOutlet({ ...base, shift_mode: 'night' })?.shifts).toEqual(['night']);
    expect(parseOutlet({ ...base, shift_mode: 'day' })?.shifts).toEqual(['day']);
  });

  it('falls back to the legacy dual_shift boolean when shift_mode is absent', () => {
    const legacy = parseOutlet({ ...base, shift_mode: null, dual_shift: true });
    expect(legacy?.shiftMode).toBe('dual');
    expect(legacy?.shifts).toEqual(['day', 'night']);
  });

  it('falls back to day when neither column is usable', () => {
    expect(parseOutlet({ ...base, shift_mode: 'weekends', dual_shift: false })?.shiftMode).toBe(
      'day',
    );
  });

  describe('sanitising on the way out', () => {
    it('collapses a pasted multi-line name', () => {
      const pasted = parseOutlet({ ...base, name: 'QAS_Othaim\n\n  Mall_HYP' });
      expect(pasted?.name).toBe('QAS_Othaim Mall_HYP');
      expect(pasted?.name).not.toContain('\n');
    });

    it('rejects prose in the map field rather than printing it', () => {
      // The exact failure: page text pasted into maps_url, then printed in a
      // team-wide message for weeks.
      const junk = parseOutlet({
        ...base,
        maps_url: 'Skip to main content Sign in Directions Save Nearby',
      });
      expect(junk?.mapsUrl).toBeNull();
    });

    it('extracts a real URL from surrounding text', () => {
      const messy = parseOutlet({ ...base, maps_url: 'see https://maps.app.goo.gl/abc here' });
      expect(messy?.mapsUrl).toBe('https://maps.app.goo.gl/abc');
    });

    it('truncates an overlong POS code', () => {
      const long = parseOutlet({ ...base, unicode: '1'.repeat(80) });
      expect(long?.unicode?.length).toBe(24);
    });
  });

  it('treats a null active flag as active', () => {
    expect(parseOutlet({ ...base, active: null })?.active).toBe(true);
    expect(parseOutlet({ ...base, active: false })?.active).toBe(false);
  });

  it('rejects rows without an id or a name', () => {
    expect(parseOutlet({ ...base, id: 'one' })).toBeNull();
    expect(parseOutlet({ ...base, name: '   ' })).toBeNull();
    expect(parseOutlet(null)).toBeNull();
  });

  it('indexes by id', () => {
    const outlets = [parseOutlet(base), parseOutlet({ ...base, id: 2 })].filter(
      (o): o is Outlet => o !== null,
    );
    expect(byId(outlets).get(2)?.id).toBe(2);
    expect(byId(outlets).has(99)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Targets
// ---------------------------------------------------------------------------

describe('targets', () => {
  const row = {
    touch_point_id: 1,
    shift: 'day',
    month: '2026-08',
    daily_target: 3.5,
    gt_target: 10,
  };

  it('parses a target', () => {
    expect(parseTarget(row)).toEqual({
      touchPointId: 1,
      shift: 'day',
      month: '2026-08',
      dailyTarget: 3.5,
      gtTarget: 10,
    });
  });

  it('accepts numerics returned as strings', () => {
    // PostgREST can serialise `numeric` as a string; reading that as 0 would
    // silently zero a whole outlet's target.
    const parsed = parseTarget({ ...row, daily_target: '3.5', gt_target: '10' });
    expect(parsed?.dailyTarget).toBe(3.5);
    expect(parsed?.gtTarget).toBe(10);
  });

  it('rejects an unparseable month or shift', () => {
    expect(parseTarget({ ...row, month: 'August' })).toBeNull();
    expect(parseTarget({ ...row, month: '2026-08-01' })).toBeNull();
    expect(parseTarget({ ...row, shift: 'evening' })).toBeNull();
  });

  it('defaults missing figures to zero rather than NaN', () => {
    const parsed = parseTarget({ ...row, daily_target: null, gt_target: undefined });
    expect(parsed?.dailyTarget).toBe(0);
    expect(parsed?.gtTarget).toBe(0);
  });

  describe('lookup', () => {
    const table = indexTargets([
      parseTarget(row),
      parseTarget({ ...row, shift: 'night', daily_target: 2 }),
      parseTarget({ ...row, touch_point_id: 2, daily_target: 7 }),
    ].filter((t): t is Target => t !== null));

    it('keys on outlet and shift together', () => {
      expect(targetKey(1, 'day')).toBe('1-day');
      expect(dailyTargetFor(table, 1, 'day')).toBe(3.5);
      expect(dailyTargetFor(table, 1, 'night')).toBe(2);
      expect(dailyTargetFor(table, 2, 'day')).toBe(7);
      expect(gtTargetFor(table, 1, 'day')).toBe(10);
    });

    it('returns null for an outlet with no target set', () => {
      expect(dailyTargetFor(table, 99, 'day')).toBeNull();
      expect(gtTargetFor(table, 99, 'day')).toBeNull();
    });

    it('returns null for a leave day, which has no outlet or shift', () => {
      expect(dailyTargetFor(table, null, null)).toBeNull();
      expect(dailyTargetFor(table, 1, null)).toBeNull();
      expect(dailyTargetFor(table, null, 'day')).toBeNull();
    });
  });
});

// ---------------------------------------------------------------------------
// Sales
// ---------------------------------------------------------------------------

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

describe('parseSale', () => {
  it('rejects an unknown sale or customer type', () => {
    const row = {
      id: 1,
      attendance_id: 1,
      promoter_id: 'p1',
      work_date: '2026-08-25',
      device_type: 'ILUMA i',
      color: 'Leaf Green',
      sale_type: 'SK',
      customer_type: 'LAS',
    };
    expect(parseSale(row)).not.toBeNull();
    expect(parseSale({ ...row, sale_type: 'sk' })).toBeNull();
    expect(parseSale({ ...row, customer_type: 'las' })).toBeNull();
  });

  it('rejects a row missing a column the code reads', () => {
    // Selecting sale_type while reading customer_type made every LAS count read
    // zero for weeks. An absent column must never parse.
    expect(
      parseSale({
        id: 1,
        attendance_id: 1,
        promoter_id: 'p1',
        work_date: '2026-08-25',
        device_type: 'ILUMA i',
        color: 'Leaf Green',
        sale_type: 'SK',
      }),
    ).toBeNull();
  });
});

describe('summarize', () => {
  it('counts LAS and LAU separately', () => {
    const totals = summarize([
      sale({ customerType: 'LAS' }),
      sale({ customerType: 'LAS' }),
      sale({ customerType: 'LAU', saleType: 'SK' }),
    ]);
    expect(totals.las).toBe(2);
    expect(totals.lau).toBe(1);
    expect(totals.total).toBe(3);
  });

  it('counts SK+MGM in both columns, so the parts can exceed the whole', () => {
    const totals = summarize([sale({ saleType: 'SK+MGM' })]);
    expect(totals.sk).toBe(1);
    expect(totals.mgm).toBe(1);
    expect(totals.total).toBe(1);
    expect(totals.sk + totals.mgm).toBeGreaterThan(totals.total);
  });

  it('keeps LD out of SK and MGM', () => {
    const totals = summarize([sale({ saleType: 'LD' })]);
    expect(totals).toMatchObject({ ld: 1, sk: 0, mgm: 0 });
  });

  it('returns zeroes for an empty session', () => {
    expect(summarize([])).toEqual({ las: 0, lau: 0, sk: 0, mgm: 0, ld: 0, total: 0 });
  });
});

describe('groupSales', () => {
  it('groups identical sales and counts them', () => {
    const groups = groupSales([sale({ id: 1 }), sale({ id: 2 }), sale({ id: 3, color: 'Breeze Blue' })]);
    expect(groups).toHaveLength(2);
    expect(groups[0]?.count).toBe(2);
    expect(groups[0]?.ids).toEqual([1, 2]);
  });

  it('does not merge sales differing only by customer type', () => {
    const groups = groupSales([sale({ customerType: 'LAS' }), sale({ id: 2, customerType: 'LAU' })]);
    expect(groups).toHaveLength(2);
  });

  it('orders by count, then stably by key', () => {
    const groups = groupSales([
      sale({ id: 1, color: 'Breeze Blue' }),
      sale({ id: 2 }),
      sale({ id: 3 }),
    ]);
    expect(groups[0]?.count).toBe(2);
    expect(groups[1]?.count).toBe(1);
  });

  it('totals across groups match the input length', () => {
    const sales = [sale({ id: 1 }), sale({ id: 2 }), sale({ id: 3, saleType: 'LD' })];
    const summed = groupSales(sales).reduce((n, g) => n + g.count, 0);
    expect(summed).toBe(sales.length);
  });
});

describe('validateSale', () => {
  const base = {
    attendanceId: 1,
    promoterId: 'p1',
    workDate: '2026-08-25',
  } as const;

  it('accepts every combination in the catalog', () => {
    for (const { device, color } of allCombinations()) {
      expect(
        validateSale({ ...base, deviceType: device, color, saleType: 'SK', customerType: 'LAS' }),
      ).toBeNull();
    }
  });

  it('rejects a colour the device is not sold in', () => {
    // Aspen Green is Prime-only; ILUMA i One would fail the composite FK.
    const problem = validateSale({
      ...base,
      deviceType: 'ILUMA i One',
      color: 'Aspen Green',
      saleType: 'SK',
      customerType: 'LAS',
    });
    expect(problem).toContain('Aspen Green');
  });

  it('blocks MGM for a LAU customer, naming the rule', () => {
    for (const saleType of ['MGM', 'SK+MGM'] as const) {
      const problem = validateSale({
        ...base,
        deviceType: 'ILUMA i',
        color: 'Leaf Green',
        saleType,
        customerType: 'LAU',
      });
      expect(problem).toBe('عروض MGM لعملاء LAS فقط');
    }
  });

  it('allows SK and LD for a LAU customer', () => {
    for (const saleType of ['SK', 'LD'] as const) {
      expect(
        validateSale({
          ...base,
          deviceType: 'ILUMA i',
          color: 'Leaf Green',
          saleType,
          customerType: 'LAU',
        }),
      ).toBeNull();
    }
  });
});

// ---------------------------------------------------------------------------
// Catalog drift
// ---------------------------------------------------------------------------

describe('diffCatalog', () => {
  const everything = allCombinations().map(({ device, color }) => ({
    device_type: device,
    color,
    active: true,
  }));

  it('reports in sync when the database matches the app', () => {
    const drift = diffCatalog(everything);
    expect(drift.inSync).toBe(true);
    expect(drift.missingFromApp).toEqual([]);
    expect(drift.missingFromDatabase).toEqual([]);
  });

  it('flags a combination the app offers but the database lacks', () => {
    // Every sale of this pairing would fail the composite foreign key.
    const withoutOne = everything.slice(1);
    const drift = diffCatalog(withoutOne);
    expect(drift.inSync).toBe(false);
    expect(drift.missingFromDatabase).toHaveLength(1);
  });

  it('flags a colour added to the database that the app cannot sell', () => {
    const drift = diffCatalog([
      ...everything,
      { device_type: 'ILUMA i', color: 'Sunset Coral', active: true },
    ]);
    expect(drift.inSync).toBe(false);
    expect(drift.missingFromApp).toEqual([{ device: 'ILUMA i', color: 'Sunset Coral' }]);
  });

  it('treats a retired row as intentional, not drift', () => {
    const drift = diffCatalog([
      ...everything,
      { device_type: 'ILUMA i', color: 'Discontinued Teal', active: false },
    ]);
    expect(drift.inSync).toBe(true);
  });

  it('ignores malformed rows rather than throwing', () => {
    const drift = diffCatalog([...everything, { device_type: null, color: 42 }]);
    expect(drift.inSync).toBe(true);
  });

  it('knows its own size: 3 lines, 17 combinations', () => {
    expect(catalogSummary()).toEqual({ lines: 3, combinations: 17 });
  });
});
