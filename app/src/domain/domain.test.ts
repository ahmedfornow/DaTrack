import { describe, it, expect } from 'vitest';
import {
  AttendanceStatus,
  CustomerType,
  PlanStatus,
  Role,
  SaleType,
  Shift,
  ShiftMode,
  StockCategory,
  TaskKind,
  attendanceStatusForPlan,
} from './values';
import {
  accumulateTarget,
  achievementBand,
  achievementPercent,
  countsAsLd,
  countsAsMgm,
  countsAsSk,
  countsTowardTarget,
  defaultShiftFor,
  isValidSalePair,
  requiresOutlet,
  runsShift,
  saleTypeAfterCustomerChange,
  shiftsFor,
} from './rules';
import {
  CATALOG,
  DEVICE_TYPES,
  COLOR_SWATCH,
  DEVICE_COLORS,
  allCombinations,
  colorsFor,
  isValidCombination,
  shortNameOf,
} from './devices';
import { firstUrl, forReport, loginEmailFor, oneLine, shortOutletName, stripEmoji } from './text';

describe('vocabularies', () => {
  it('accepts exactly the documented values', () => {
    expect(Shift.values).toEqual(['day', 'night']);
    expect(ShiftMode.values).toEqual(['day', 'night', 'dual']);
    expect(SaleType.values).toEqual(['SK', 'MGM', 'SK+MGM', 'LD']);
    expect(CustomerType.values).toEqual(['LAS', 'LAU']);
    expect(AttendanceStatus.values).toEqual(['work', 'off', 'sick', 'leave', 'absent']);
    expect(PlanStatus.values).toEqual(['off', 'sick', 'annual', 'absent']);
    expect(Role.values).toEqual(['manager', 'supervisor', 'promoter']);
    // Matches stock_catalog_category_check, which allows a third value that
    // SCHEMA.md does not document.
    expect(StockCategory.values).toEqual(['device', 'terea', 'other']);
    expect(TaskKind.values).toEqual(['daily', 'weekly', 'once']);
  });

  it('rejects the near-misses text columns happily accept', () => {
    expect(CustomerType.is('las')).toBe(false);
    expect(CustomerType.is('LAS ')).toBe(false);
    expect(SaleType.is('SK + MGM')).toBe(false);
    expect(SaleType.is('LD+SK')).toBe(false);
    expect(Shift.is('Day')).toBe(false);
    expect(Role.is('admin')).toBe(false);
  });

  it('rejects non-strings without throwing', () => {
    for (const value of [null, undefined, 0, 1, {}, [], true]) {
      expect(Shift.is(value)).toBe(false);
      expect(Shift.tryParse(value)).toBeNull();
    }
  });

  it('names the field and the offending value when parsing fails', () => {
    expect(() => SaleType.parse('nope')).toThrow(/sale_type/);
    expect(() => SaleType.parse('nope')).toThrow(/"nope"/);
    expect(() => Shift.parse('nope', 'attendance.shift')).toThrow(/attendance\.shift/);
  });

  it('returns the value when parsing succeeds', () => {
    expect(SaleType.parse('SK+MGM')).toBe('SK+MGM');
    expect(CustomerType.tryParse('LAU')).toBe('LAU');
  });

  describe('plan status to attendance status', () => {
    it('maps the statuses that exist on both sides', () => {
      expect(attendanceStatusForPlan('off')).toBe('off');
      expect(attendanceStatusForPlan('sick')).toBe('sick');
      expect(attendanceStatusForPlan('absent')).toBe('absent');
    });

    it('refuses to invent an attendance status for annual leave', () => {
      // Substituting 'off' would report a booked holiday as an ordinary day off.
      expect(attendanceStatusForPlan('annual')).toBeNull();
    });
  });
});

describe('only LAS customers can receive MGM', () => {
  it('allows every sale type for LAS', () => {
    for (const saleType of SaleType.values) {
      expect(isValidSalePair('LAS', saleType)).toBe(true);
    }
  });

  it('blocks MGM and SK+MGM for LAU', () => {
    expect(isValidSalePair('LAU', 'MGM')).toBe(false);
    expect(isValidSalePair('LAU', 'SK+MGM')).toBe(false);
  });

  it('allows SK and LD for LAU', () => {
    expect(isValidSalePair('LAU', 'SK')).toBe(true);
    expect(isValidSalePair('LAU', 'LD')).toBe(true);
  });

  it('clears an invalid sale type when the customer switches to LAU', () => {
    expect(saleTypeAfterCustomerChange('MGM', 'LAU')).toBeNull();
    expect(saleTypeAfterCustomerChange('SK+MGM', 'LAU')).toBeNull();
  });

  it('keeps a still-valid sale type when the customer switches', () => {
    expect(saleTypeAfterCustomerChange('SK', 'LAU')).toBe('SK');
    expect(saleTypeAfterCustomerChange('MGM', 'LAS')).toBe('MGM');
    expect(saleTypeAfterCustomerChange(null, 'LAU')).toBeNull();
  });
});

describe('sale type counting', () => {
  it('counts SK+MGM in both the SK and MGM columns', () => {
    expect(countsAsSk('SK+MGM')).toBe(true);
    expect(countsAsMgm('SK+MGM')).toBe(true);
  });

  it('keeps LD out of SK and MGM', () => {
    expect(countsAsSk('LD')).toBe(false);
    expect(countsAsMgm('LD')).toBe(false);
    expect(countsAsLd('LD')).toBe(true);
  });

  it('scores LAS only', () => {
    expect(countsTowardTarget('LAS')).toBe(true);
    expect(countsTowardTarget('LAU')).toBe(false);
  });
});

describe('outlet shift modes', () => {
  it('gives a single-mode outlet exactly one shift', () => {
    expect(shiftsFor('day')).toEqual(['day']);
    expect(shiftsFor('night')).toEqual(['night']);
  });

  it('gives a dual outlet both', () => {
    expect(shiftsFor('dual')).toEqual(['day', 'night']);
  });

  it('never offers a day shift at a night-only outlet', () => {
    expect(runsShift('night', 'day')).toBe(false);
    expect(runsShift('night', 'night')).toBe(true);
  });

  describe('default shift selection', () => {
    it('picks the only shift a single-mode outlet runs', () => {
      expect(defaultShiftFor('night')).toBe('night');
      expect(defaultShiftFor('day')).toBe('day');
    });

    it('skips a shift already registered for that day', () => {
      expect(defaultShiftFor('dual', ['day'])).toBe('night');
      expect(defaultShiftFor('dual', ['night'])).toBe('day');
    });

    it('falls back rather than returning nothing when all are taken', () => {
      expect(defaultShiftFor('dual', ['day', 'night'])).toBe('day');
      expect(defaultShiftFor('night', ['night'])).toBe('night');
    });

    it('ignores a taken shift the outlet does not run', () => {
      expect(defaultShiftFor('day', ['night'])).toBe('day');
    });
  });

  it('requires an outlet only for work days', () => {
    expect(requiresOutlet('work')).toBe(true);
    for (const status of ['off', 'sick', 'leave', 'absent'] as const) {
      expect(requiresOutlet(status)).toBe(false);
    }
  });
});

describe('achievement', () => {
  it('uses the 100 and 70 percent thresholds', () => {
    expect(achievementBand(10, 10)).toBe('achieved');
    expect(achievementBand(11, 10)).toBe('achieved');
    expect(achievementBand(7, 10)).toBe('close');
    expect(achievementBand(9, 10)).toBe('close');
    expect(achievementBand(6.9, 10)).toBe('behind');
    expect(achievementBand(0, 10)).toBe('behind');
  });

  it('reports no band when there is no target', () => {
    expect(achievementBand(5, null)).toBe('untargeted');
    expect(achievementBand(5, undefined)).toBe('untargeted');
    expect(achievementBand(5, 0)).toBe('untargeted');
    expect(achievementBand(5, -1)).toBe('untargeted');
    expect(achievementBand(5, Number.NaN)).toBe('untargeted');
  });

  it('never puts Infinity or NaN on the screen', () => {
    expect(achievementPercent(5, 0)).toBeNull();
    expect(achievementPercent(5, null)).toBeNull();
    expect(achievementPercent(0, 0)).toBeNull();
    expect(achievementPercent(5, Number.NaN)).toBeNull();
    expect(achievementPercent(5, Number.POSITIVE_INFINITY)).toBeNull();
  });

  it('rounds to whole percentages', () => {
    expect(achievementPercent(1, 3)).toBe(33);
    expect(achievementPercent(2, 3)).toBe(67);
    expect(achievementPercent(10, 10)).toBe(100);
  });

  describe('accumulated target', () => {
    it('counts only work days', () => {
      expect(
        accumulateTarget([
          { status: 'work', dailyTarget: 3 },
          { status: 'off', dailyTarget: 3 },
          { status: 'sick', dailyTarget: 3 },
          { status: 'work', dailyTarget: 2 },
        ]),
      ).toBe(5);
    });

    it('treats a missing target as zero rather than skipping the day', () => {
      expect(
        accumulateTarget([
          { status: 'work', dailyTarget: null },
          { status: 'work', dailyTarget: 4 },
        ]),
      ).toBe(4);
    });

    it('keeps fractional targets from drifting into float noise', () => {
      const days = Array.from({ length: 10 }, () => ({
        status: 'work' as const,
        dailyTarget: 1.1,
      }));
      expect(accumulateTarget(days)).toBe(11);
    });

    it('is zero for an empty month', () => {
      expect(accumulateTarget([])).toBe(0);
    });
  });
});

describe('device catalog', () => {
  it('holds exactly 17 valid combinations', () => {
    expect(allCombinations()).toHaveLength(17);
  });

  it('matches the documented colours per line', () => {
    expect(CATALOG['ILUMA i Prime']).toHaveLength(5);
    expect(CATALOG['ILUMA i']).toHaveLength(6);
    expect(CATALOG['ILUMA i One']).toHaveLength(6);
  });

  it('rejects a miscased device, which the composite foreign key would too', () => {
    expect(isValidCombination('ILUMA i PRIME', 'Garnet Red')).toBe(false);
    expect(isValidCombination('ILUMA i Prime', 'Garnet Red')).toBe(true);
  });

  it('rejects a colour the line is not sold in', () => {
    // Garnet Red is Prime-only.
    expect(isValidCombination('ILUMA i', 'Garnet Red')).toBe(false);
    expect(isValidCombination('ILUMA i One', 'Aspen Green')).toBe(false);
  });

  it('offers only that line’s colours', () => {
    expect(colorsFor('ILUMA i Prime')).toContain('Garnet Red');
    expect(colorsFor('ILUMA i')).not.toContain('Garnet Red');
  });

  it('shortens known devices and passes through unknown ones', () => {
    expect(shortNameOf('ILUMA i Prime')).toBe('PRIME');
    expect(shortNameOf('ILUMA i One')).toBe('ONE');
    expect(shortNameOf('SOMETHING NEW')).toBe('SOMETHING NEW');
  });

  it('has a swatch for every colour and no extras', () => {
    expect(Object.keys(COLOR_SWATCH).sort()).toEqual([...DEVICE_COLORS].sort());
    for (const hex of Object.values(COLOR_SWATCH)) {
      expect(hex).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it('gives every colour a distinct swatch', () => {
    const hexes = Object.values(COLOR_SWATCH);
    expect(new Set(hexes).size).toBe(hexes.length);
  });

  it('lists every catalog colour in the colour vocabulary', () => {
    for (const device of DEVICE_TYPES) {
      for (const color of CATALOG[device]) {
        expect(DEVICE_COLORS).toContain(color);
      }
    }
  });
});

describe('text sanitising', () => {
  describe('oneLine', () => {
    it('flattens a pasted page into a single line', () => {
      const pasted = 'Al Othaim Mall\n\n  Buraydah   branch\t\topen 24h';
      expect(oneLine(pasted)).toBe('Al Othaim Mall Buraydah branch open 24h');
    });

    it('truncates to the cap', () => {
      expect(oneLine('x'.repeat(200), 24)).toHaveLength(24);
      expect(oneLine('abcdef', 3)).toBe('abc');
    });

    it('handles null, undefined and non-strings', () => {
      expect(oneLine(null)).toBe('');
      expect(oneLine(undefined)).toBe('');
      expect(oneLine(42)).toBe('42');
    });

    it('returns empty for a non-positive cap rather than a negative slice', () => {
      expect(oneLine('hello', 0)).toBe('');
      expect(oneLine('hello', -5)).toBe('');
    });
  });

  describe('firstUrl', () => {
    it('extracts a URL from surrounding prose', () => {
      expect(firstUrl('see https://maps.app.goo.gl/abc123 for directions')).toBe(
        'https://maps.app.goo.gl/abc123',
      );
    });

    it('takes the first when there are several', () => {
      expect(firstUrl('https://a.example https://b.example')).toBe('https://a.example');
    });

    it('returns empty for text with no URL', () => {
      expect(firstUrl('Buraydah, near the roundabout')).toBe('');
      expect(firstUrl('maps.google.com/place')).toBe('');
      expect(firstUrl(null)).toBe('');
    });

    it('rejects a non-http scheme', () => {
      expect(firstUrl('javascript:alert(1)')).toBe('');
      expect(firstUrl('ftp://files.example/x')).toBe('');
    });
  });

  describe('stripEmoji', () => {
    it('removes emoji from copied output', () => {
      expect(stripEmoji('Al Othaim 🏪 Buraydah')).toBe('Al Othaim Buraydah');
      expect(stripEmoji('☀️ Day shift 🌙')).toBe('Day shift');
    });

    it('leaves ordinary Latin and Arabic text alone', () => {
      expect(stripEmoji('Al Othaim Mall')).toBe('Al Othaim Mall');
      expect(stripEmoji('أوف')).toBe('أوف');
    });
  });

  describe('forReport', () => {
    it('makes a hostile field safe to print in a WhatsApp message', () => {
      const hostile = '  QAS_Al Othaim 🏪\n\nMall_TYPE_MN_BR   ';
      expect(forReport(hostile)).toBe('QAS_Al Othaim Mall_TYPE_MN_BR');
    });

    it('caps length so one bad row cannot dominate a message', () => {
      expect(forReport('y'.repeat(500), 70)).toHaveLength(70);
    });
  });

  describe('shortOutletName', () => {
    it('takes the human part of the naming convention', () => {
      expect(shortOutletName('QAS_Al Othaim Mall_TYPE_MN_BR')).toBe('Al Othaim Mall');
    });

    it('falls back to the whole name when the convention is not followed', () => {
      expect(shortOutletName('Al Othaim Mall')).toBe('Al Othaim Mall');
      expect(shortOutletName('QAS__TYPE')).toBe('QAS__TYPE');
    });

    it('never returns an empty label when the human part is blank', () => {
      // Whitespace is collapsed before the split, so the fallback is the
      // flattened name rather than the raw input.
      expect(shortOutletName('QAS_   _X')).toBe('QAS_ _X');
    });
  });

  it('builds the synthetic login email', () => {
    expect(loginEmailFor('1699')).toBe('1699@example.com');
  });
});

/**
 * Pins every vocabulary to the CHECK constraint the database actually carries,
 * verified against pg_constraint on 2026-08-27.
 *
 * These are not enums — they are text columns with checks — so the generated
 * types cannot express them and nothing else will notice if the two drift. A
 * vocabulary NARROWER than its constraint rejects rows the database happily
 * stores; WIDER, and it lets a write through that fails at the constraint with
 * a message no promoter can act on. Both have shipped here before.
 *
 * If one of these fails, confirm the live constraint before changing the
 * expectation — the database is the source of truth, not this file.
 */
describe('vocabularies match the live check constraints', () => {
  it.each([
    ['users_role_check', Role.values, ['manager', 'supervisor', 'promoter']],
    ['touch_points_shift_mode_chk', ShiftMode.values, ['day', 'night', 'dual']],
    ['stock_catalog_category_check', StockCategory.values, ['device', 'terea', 'other']],
    ['attendance_shift_check', Shift.values, ['day', 'night']],
    [
      'attendance_status_check',
      AttendanceStatus.values,
      ['work', 'off', 'sick', 'leave', 'absent'],
    ],
    ['sell_operations_customer_type_check', CustomerType.values, ['LAS', 'LAU']],
    ['sell_operations_sale_type_check', SaleType.values, ['SK', 'MGM', 'SK+MGM', 'LD']],
    ['route_plans_status_chk', PlanStatus.values, ['off', 'sick', 'annual', 'absent']],
    ['sup_tasks_kind_check', TaskKind.values, ['daily', 'weekly', 'once']],
  ])('%s', (_constraint, vocabulary, allowed) => {
    expect([...vocabulary].sort()).toEqual([...allowed].sort());
  });

  it('device_catalog_device_type_check', () => {
    expect([...DEVICE_TYPES].sort()).toEqual(
      ['ILUMA i Prime', 'ILUMA i', 'ILUMA i One'].sort(),
    );
  });
});
