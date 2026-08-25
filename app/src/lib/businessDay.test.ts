import { describe, it, expect } from 'vitest';
import {
  DAY_CUTOFF_HOUR,
  KSA_UTC_OFFSET_HOURS,
  addDays,
  businessDateAt,
  businessDayOfMonth,
  businessMonth,
  businessMonthStart,
  businessToday,
  businessTomorrow,
  businessYesterday,
  daysBetween,
  formatReportDate,
  isBackfillable,
  isBusinessDate,
  isBusinessToday,
  isFutureBusinessDate,
  isInBusinessMonth,
  ksaCalendarDate,
  ksaClockTime,
  monthStart,
  parseBusinessDate,
  startOfLastDays,
  weekdayIndex,
} from './businessDay';

/**
 * Every instant below is written in UTC on purpose. KSA is UTC+3, so the
 * business day (which ends at 02:00 KSA) rolls over at 23:00 UTC.
 *
 * These tests must pass under any host timezone. CI runs them twice, once under
 * Asia/Riyadh and once under America/Los_Angeles, because a developer machine
 * set to KSA time cannot detect a device-local bug.
 */
const at = (iso: string): number => {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) throw new Error(`bad test instant: ${iso}`);
  return ms;
};

describe('constants', () => {
  it('encodes KSA as UTC+3 with a 02:00 cutoff', () => {
    expect(KSA_UTC_OFFSET_HOURS).toBe(3);
    expect(DAY_CUTOFF_HOUR).toBe(2);
  });
});

describe('the 02:00 boundary', () => {
  // 2026-08-24T22:30:00Z is 2026-08-25 01:30 in Riyadh.
  it('puts 01:30 KSA on the previous business day', () => {
    expect(businessDateAt(at('2026-08-24T22:30:00Z'))).toBe('2026-08-24');
  });

  it('holds the previous day right up to 01:59:59.999 KSA', () => {
    expect(businessDateAt(at('2026-08-24T22:59:59.999Z'))).toBe('2026-08-24');
  });

  it('starts the new business day exactly at 02:00 KSA', () => {
    expect(businessDateAt(at('2026-08-24T23:00:00Z'))).toBe('2026-08-25');
  });

  it('keeps a late-evening shift on the same day', () => {
    // 23:00 KSA — a night promoter still logging "today".
    expect(businessDateAt(at('2026-08-25T20:00:00Z'))).toBe('2026-08-25');
  });

  it('treats midday as the obvious answer', () => {
    expect(businessDateAt(at('2026-08-25T09:00:00Z'))).toBe('2026-08-25');
  });

  it('accepts a Date as well as milliseconds', () => {
    expect(businessDateAt(new Date(at('2026-08-24T22:30:00Z')))).toBe('2026-08-24');
  });
});

describe('month rollover', () => {
  it('keeps 01:30 on the 1st inside the previous month', () => {
    // 2026-09-01 01:30 KSA still belongs to August.
    expect(businessDateAt(at('2026-08-31T22:30:00Z'))).toBe('2026-08-31');
    expect(businessMonth(at('2026-08-31T22:30:00Z'))).toBe('2026-08');
  });

  it('moves to the new month at 02:00 on the 1st', () => {
    expect(businessDateAt(at('2026-08-31T23:00:00Z'))).toBe('2026-09-01');
    expect(businessMonth(at('2026-08-31T23:00:00Z'))).toBe('2026-09');
  });

  it('reports day-of-month on the business clock', () => {
    expect(businessDayOfMonth(at('2026-08-31T22:30:00Z'))).toBe(31);
    expect(businessDayOfMonth(at('2026-08-31T23:00:00Z'))).toBe(1);
  });

  it('anchors the month start for backfill bounds', () => {
    expect(businessMonthStart(at('2026-08-31T22:30:00Z'))).toBe('2026-08-01');
    expect(businessMonthStart(at('2026-08-31T23:00:00Z'))).toBe('2026-09-01');
  });
});

describe('year rollover', () => {
  it('keeps New Year 01:30 in the old year', () => {
    expect(businessDateAt(at('2026-12-31T22:30:00Z'))).toBe('2026-12-31');
  });

  it('crosses into the new year at 02:00', () => {
    expect(businessDateAt(at('2026-12-31T23:00:00Z'))).toBe('2027-01-01');
  });
});

describe('no daylight saving', () => {
  it('applies the same offset in January and July', () => {
    // Identical clock position in both hemispheres' "DST season".
    expect(businessDateAt(at('2026-01-15T23:00:00Z'))).toBe('2026-01-16');
    expect(businessDateAt(at('2026-07-15T23:00:00Z'))).toBe('2026-07-16');
    expect(businessDateAt(at('2026-01-15T22:59:59Z'))).toBe('2026-01-15');
    expect(businessDateAt(at('2026-07-15T22:59:59Z'))).toBe('2026-07-15');
  });

  it('reads the same wall clock in winter and summer', () => {
    expect(ksaClockTime(at('2026-01-15T12:00:00Z'))).toBe('15:00');
    expect(ksaClockTime(at('2026-07-15T12:00:00Z'))).toBe('15:00');
  });
});

describe('today, yesterday, tomorrow', () => {
  const now = at('2026-09-01T00:30:00Z'); // 03:30 KSA on 1 September

  it('resolves today', () => {
    expect(businessToday(now)).toBe('2026-09-01');
  });

  it('resolves yesterday across a month boundary', () => {
    expect(businessYesterday(now)).toBe('2026-08-31');
  });

  it('resolves tomorrow — the default route-plan date', () => {
    expect(businessTomorrow(now)).toBe('2026-09-02');
  });

  it('resolves yesterday from an after-midnight instant', () => {
    // 01:30 KSA on 1 Sept: today is 31 Aug, so yesterday is 30 Aug.
    const afterMidnight = at('2026-08-31T22:30:00Z');
    expect(businessToday(afterMidnight)).toBe('2026-08-31');
    expect(businessYesterday(afterMidnight)).toBe('2026-08-30');
  });
});

describe('date arithmetic', () => {
  it('rolls forward over a month end', () => {
    expect(addDays('2026-08-31', 1)).toBe('2026-09-01');
  });

  it('rolls backward over a month start', () => {
    expect(addDays('2026-09-01', -1)).toBe('2026-08-31');
  });

  it('rolls over a year end', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });

  it('handles a leap year', () => {
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2028-02-29', 1)).toBe('2028-03-01');
  });

  it('handles a non-leap year', () => {
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01');
  });

  it('is a no-op for zero', () => {
    expect(addDays('2026-08-25', 0)).toBe('2026-08-25');
  });

  it('counts days between dates, signed', () => {
    expect(daysBetween('2026-08-01', '2026-08-25')).toBe(24);
    expect(daysBetween('2026-08-25', '2026-08-01')).toBe(-24);
    expect(daysBetween('2026-08-25', '2026-08-25')).toBe(0);
    expect(daysBetween('2026-12-31', '2027-01-01')).toBe(1);
  });
});

describe('parsing and validation', () => {
  it('splits a valid date', () => {
    expect(parseBusinessDate('2026-08-25')).toEqual({ year: 2026, month: 8, day: 25 });
  });

  it.each([
    ['2026-02-30', 'a day that does not exist'],
    ['2026-13-01', 'a month that does not exist'],
    ['2026-00-10', 'month zero'],
    ['2026-08-00', 'day zero'],
    ['2026-8-25', 'unpadded month'],
    ['26-08-25', 'two-digit year'],
    ['2026-08-25T00:00:00Z', 'a timestamp'],
    ['', 'an empty string'],
    ['not a date', 'nonsense'],
  ])('rejects %s (%s)', (value) => {
    expect(() => parseBusinessDate(value)).toThrow(RangeError);
    expect(isBusinessDate(value)).toBe(false);
  });

  it('rejects non-strings', () => {
    expect(isBusinessDate(null)).toBe(false);
    expect(isBusinessDate(undefined)).toBe(false);
    expect(isBusinessDate(20260825)).toBe(false);
    expect(isBusinessDate(new Date())).toBe(false);
  });

  it('accepts a leap day only in a leap year', () => {
    expect(isBusinessDate('2028-02-29')).toBe(true);
    expect(isBusinessDate('2026-02-29')).toBe(false);
  });

  it('validates month strings', () => {
    expect(monthStart('2026-08')).toBe('2026-08-01');
    expect(() => monthStart('2026-8')).toThrow(RangeError);
    expect(() => monthStart('2026-08-01')).toThrow(RangeError);
  });
});

describe('dashboard periods', () => {
  const now = at('2026-08-25T09:00:00Z'); // midday KSA on 25 August

  it('treats "today" as a one-day window', () => {
    expect(startOfLastDays(1, now)).toBe('2026-08-25');
  });

  it('makes "last 7 days" inclusive of today', () => {
    expect(startOfLastDays(7, now)).toBe('2026-08-19');
    expect(daysBetween(startOfLastDays(7, now), businessToday(now))).toBe(6);
  });

  it('spans a month boundary', () => {
    expect(startOfLastDays(7, at('2026-09-02T09:00:00Z'))).toBe('2026-08-27');
  });

  it('rejects a nonsensical window', () => {
    expect(() => startOfLastDays(0, now)).toThrow(RangeError);
    expect(() => startOfLastDays(-3, now)).toThrow(RangeError);
    expect(() => startOfLastDays(1.5, now)).toThrow(RangeError);
  });
});

describe('weekdays', () => {
  it('matches known anchors, 0 = Sunday', () => {
    expect(weekdayIndex('2026-08-25')).toBe(2); // Tuesday
    expect(weekdayIndex('2026-01-01')).toBe(4); // Thursday
    expect(weekdayIndex('2028-02-29')).toBe(2); // Tuesday
  });
});

describe('predicates', () => {
  const now = at('2026-08-25T09:00:00Z');

  it('identifies today', () => {
    expect(isBusinessToday('2026-08-25', now)).toBe(true);
    expect(isBusinessToday('2026-08-24', now)).toBe(false);
  });

  it('identifies future dates', () => {
    expect(isFutureBusinessDate('2026-08-26', now)).toBe(true);
    expect(isFutureBusinessDate('2026-08-25', now)).toBe(false);
    expect(isFutureBusinessDate('2026-08-24', now)).toBe(false);
  });

  it('checks month membership', () => {
    expect(isInBusinessMonth('2026-08-01', '2026-08')).toBe(true);
    expect(isInBusinessMonth('2026-08-31', '2026-08')).toBe(true);
    expect(isInBusinessMonth('2026-07-31', '2026-08')).toBe(false);
  });

  describe('backfill window', () => {
    it('allows earlier days in the current month', () => {
      expect(isBackfillable('2026-08-01', now)).toBe(true);
      expect(isBackfillable('2026-08-24', now)).toBe(true);
      expect(isBackfillable('2026-08-25', now)).toBe(true);
    });

    it('refuses the future', () => {
      expect(isBackfillable('2026-08-26', now)).toBe(false);
    });

    it('refuses a closed month', () => {
      expect(isBackfillable('2026-07-31', now)).toBe(false);
    });

    it('follows the business clock, not the calendar clock', () => {
      // 01:30 KSA on 1 September: the business month is still August, so
      // 31 August is backfillable and 1 September is the future.
      const afterMidnight = at('2026-08-31T22:30:00Z');
      expect(isBackfillable('2026-08-31', afterMidnight)).toBe(true);
      expect(isBackfillable('2026-09-01', afterMidnight)).toBe(false);
    });
  });
});

describe('display clock — real KSA time, never the business clock', () => {
  it('renders wall-clock time', () => {
    expect(ksaClockTime(at('2026-08-25T18:45:00Z'))).toBe('21:45');
    expect(ksaClockTime(at('2026-08-25T21:00:00Z'))).toBe('00:00');
  });

  it('diverges from the business date between midnight and 02:00', () => {
    // The moment that used to produce off-by-one bugs.
    const oneThirtyAm = at('2026-08-24T22:30:00Z');
    expect(ksaClockTime(oneThirtyAm)).toBe('01:30');
    expect(ksaCalendarDate(oneThirtyAm)).toBe('2026-08-25'); // what the phone shows
    expect(businessDateAt(oneThirtyAm)).toBe('2026-08-24'); // what we record
  });

  it('agrees with the business date during the working day', () => {
    const evening = at('2026-08-25T18:45:00Z');
    expect(ksaCalendarDate(evening)).toBe(businessDateAt(evening));
  });
});

describe('report formatting', () => {
  it('renders DD/MM/YYYY for the English report body', () => {
    expect(formatReportDate('2026-08-25')).toBe('25/08/2026');
    expect(formatReportDate('2026-01-05')).toBe('05/01/2026');
  });

  it('rejects a malformed date rather than printing garbage', () => {
    expect(() => formatReportDate('2026-2-5')).toThrow(RangeError);
  });
});
