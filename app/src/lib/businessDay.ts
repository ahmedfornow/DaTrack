/**
 * THE date authority for DaTracker. Nothing else in this codebase may compute a
 * date of record.
 *
 * Two clocks exist and they are not the same thing:
 *
 *   - The **business clock** decides which day a record belongs to. The business
 *     day ends at 02:00 KSA, so a sale logged at 01:30 belongs to the *previous*
 *     calendar day. Night-shift promoters routinely log after midnight.
 *   - The **KSA wall clock** is real local time, used only for *displaying* when
 *     something happened ("logged at 21:45"). It never shifts.
 *
 * Everything here is derived from UTC arithmetic and reads only `getUTC*`, so
 * results are identical no matter what timezone the promoter's phone is set to.
 * That matters: mixing `toISOString()` (UTC) with `getDate()` (device-local)
 * produced off-by-one days that only appeared between midnight and 3am.
 */

/** Asia/Riyadh is UTC+3 all year. Saudi Arabia does not observe DST. */
export const KSA_UTC_OFFSET_HOURS = 3;

/** The business day ends at 02:00 KSA. Change this and every date follows. */
export const DAY_CUTOFF_HOUR = 2;

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

const KSA_OFFSET_MS = KSA_UTC_OFFSET_HOURS * HOUR_MS;

/**
 * Milliseconds to add to a UTC instant so that reading its *UTC* calendar date
 * yields the KSA business date: shift into KSA local time (+3h), then back out
 * by the cutoff (-2h) so the day boundary lands on midnight.
 */
const BUSINESS_SHIFT_MS = KSA_OFFSET_MS - DAY_CUTOFF_HOUR * HOUR_MS;

/** An ISO calendar date, `YYYY-MM-DD`. The shape stored in every `*_date` column. */
export type BusinessDate = string;

/** An ISO year-month, `YYYY-MM`. The shape stored in `targets.month`. */
export type BusinessMonth = string;

/** A point in time: a `Date`, or milliseconds since the epoch. */
export type Instant = Date | number;

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_PATTERN = /^\d{4}-\d{2}$/;

const toMs = (at: Instant): number => (typeof at === 'number' ? at : at.getTime());

const pad = (value: number, width = 2): string => String(value).padStart(width, '0');

/** Formats a UTC instant as `YYYY-MM-DD`, without `toISOString()`'s edge cases. */
const formatUTC = (ms: number): BusinessDate => {
  const d = new Date(ms);
  return `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
};

// ---------------------------------------------------------------------------
// Dates of record
// ---------------------------------------------------------------------------

/** The business date that the given instant belongs to. */
export function businessDateAt(at: Instant): BusinessDate {
  return formatUTC(toMs(at) + BUSINESS_SHIFT_MS);
}

/** Today's business date. Pass a clock to make callers testable. */
export function businessToday(now: Instant = Date.now()): BusinessDate {
  return businessDateAt(now);
}

/** Yesterday's business date — the "أمس" shortcut on the sign-in screen. */
export function businessYesterday(now: Instant = Date.now()): BusinessDate {
  return addDays(businessToday(now), -1);
}

/** Tomorrow's business date — the default date for a new route plan. */
export function businessTomorrow(now: Instant = Date.now()): BusinessDate {
  return addDays(businessToday(now), 1);
}

/** The business month that the given instant belongs to. */
export function businessMonthAt(at: Instant): BusinessMonth {
  return businessDateAt(at).slice(0, 7);
}

/** The current business month, `YYYY-MM`. */
export function businessMonth(now: Instant = Date.now()): BusinessMonth {
  return businessMonthAt(now);
}

/**
 * Day-of-month on the business clock, 1-31. This is the denominator for
 * "days logged this month" and the number of points on the month curve.
 */
export function businessDayOfMonth(now: Instant = Date.now()): number {
  return Number(businessToday(now).slice(8, 10));
}

// ---------------------------------------------------------------------------
// Date-string arithmetic — pure calendar maths, no timezone involved
// ---------------------------------------------------------------------------

/** Splits `YYYY-MM-DD` into parts. Throws on anything that is not a real date. */
export function parseBusinessDate(date: BusinessDate): {
  year: number;
  month: number;
  day: number;
} {
  if (!DATE_PATTERN.test(date)) {
    throw new RangeError(`Not a business date: ${JSON.stringify(date)}`);
  }
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  const day = Number(date.slice(8, 10));
  // Round-trip so 2026-02-30 and 2026-13-01 are rejected rather than rolled over.
  if (formatUTC(Date.UTC(year, month - 1, day)) !== date) {
    throw new RangeError(`Not a business date: ${JSON.stringify(date)}`);
  }
  return { year, month, day };
}

/** True when the string is a real `YYYY-MM-DD` date. */
export function isBusinessDate(value: unknown): value is BusinessDate {
  if (typeof value !== 'string') return false;
  try {
    parseBusinessDate(value);
    return true;
  } catch {
    return false;
  }
}

/** Adds (or subtracts) whole days, rolling months and years correctly. */
export function addDays(date: BusinessDate, days: number): BusinessDate {
  const { year, month, day } = parseBusinessDate(date);
  return formatUTC(Date.UTC(year, month - 1, day + days));
}

/** Whole days from `from` to `to`; negative when `to` is earlier. */
export function daysBetween(from: BusinessDate, to: BusinessDate): number {
  const a = parseBusinessDate(from);
  const b = parseBusinessDate(to);
  const diff = Date.UTC(b.year, b.month - 1, b.day) - Date.UTC(a.year, a.month - 1, a.day);
  return Math.round(diff / DAY_MS);
}

/** The first day of a month: `2026-08` becomes `2026-08-01`. */
export function monthStart(month: BusinessMonth): BusinessDate {
  if (!MONTH_PATTERN.test(month)) {
    throw new RangeError(`Not a business month: ${JSON.stringify(month)}`);
  }
  return `${month}-01`;
}

/** The first day of the current business month — the backfill floor. */
export function businessMonthStart(now: Instant = Date.now()): BusinessDate {
  return monthStart(businessMonth(now));
}

/**
 * The first date of a period ending today, inclusive. `startOfLastDays(7)`
 * covers today plus the six days before it — the dashboard's "آخر 7 أيام".
 */
export function startOfLastDays(days: number, now: Instant = Date.now()): BusinessDate {
  if (!Number.isInteger(days) || days < 1) {
    throw new RangeError(`Period length must be a positive integer, got ${days}`);
  }
  return addDays(businessToday(now), -(days - 1));
}

/**
 * Weekday index for a business date, 0 = Sunday, matching `Date#getDay`.
 * Computed in UTC so it does not depend on the device's timezone.
 */
export function weekdayIndex(date: BusinessDate): number {
  const { year, month, day } = parseBusinessDate(date);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

// ---------------------------------------------------------------------------
// Predicates
// ---------------------------------------------------------------------------

/** True when the date is today on the business clock. */
export function isBusinessToday(date: BusinessDate, now: Instant = Date.now()): boolean {
  return date === businessToday(now);
}

/** True when the date is later than today — a session that cannot exist yet. */
export function isFutureBusinessDate(date: BusinessDate, now: Instant = Date.now()): boolean {
  return daysBetween(businessToday(now), date) > 0;
}

/** True when the date falls inside the given business month. */
export function isInBusinessMonth(date: BusinessDate, month: BusinessMonth): boolean {
  parseBusinessDate(date);
  if (!MONTH_PATTERN.test(month)) {
    throw new RangeError(`Not a business month: ${JSON.stringify(month)}`);
  }
  return date.slice(0, 7) === month;
}

/**
 * True when a promoter may still sign in for this date: not in the future, and
 * inside the current business month. Prior months are closed.
 */
export function isBackfillable(date: BusinessDate, now: Instant = Date.now()): boolean {
  return (
    !isFutureBusinessDate(date, now) && isInBusinessMonth(date, businessMonth(now))
  );
}

// ---------------------------------------------------------------------------
// Display — real KSA wall clock, never the shifted business clock
// ---------------------------------------------------------------------------

/** Real KSA local time as `HH:mm`, for "logged at 21:45". */
export function ksaClockTime(at: Instant): string {
  const d = new Date(toMs(at) + KSA_OFFSET_MS);
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

/** Real KSA calendar date. Differs from the business date between 00:00 and 02:00. */
export function ksaCalendarDate(at: Instant): BusinessDate {
  return formatUTC(toMs(at) + KSA_OFFSET_MS);
}

/**
 * KSA `HH:mm` for a timestamp column, or `null` when there isn't one.
 *
 * Postgres hands back `timestamptz` as a string, and the obvious thing to do
 * with it — `new Date(value).toLocaleTimeString()` — renders in whatever
 * timezone the reader's device is set to. A supervisor on a laptop still set to
 * UTC would read every stock count as three hours earlier than it happened.
 * Parsing here keeps that decision inside the date authority.
 */
export function ksaClockTimeOf(value: string | null | undefined): string | null {
  if (typeof value !== 'string' || value === '') return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ksaClockTime(ms);
}

/**
 * A full KSA timestamp, `DD/MM/YYYY, HH:mm:ss`.
 *
 * Matches what `toLocaleString('en-GB')` produces on a phone already set to
 * Riyadh time, which is what the CSV export has always shown. The difference is
 * that this is KSA time by construction rather than by coincidence: the legacy
 * version renders in whatever timezone the exporting device happens to use, so
 * the same export from a laptop set to UTC would silently shift every row by
 * three hours.
 */
export function ksaTimestamp(at: Instant): string {
  const d = new Date(toMs(at) + KSA_OFFSET_MS);
  const date = `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}/${pad(d.getUTCFullYear(), 4)}`;
  const time = `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
  return `${date}, ${time}`;
}

/** `YYYY-MM-DD` rendered as `DD/MM/YYYY` for the generated English reports. */
export function formatReportDate(date: BusinessDate): string {
  const { year, month, day } = parseBusinessDate(date);
  return `${pad(day)}/${pad(month)}/${pad(year, 4)}`;
}
