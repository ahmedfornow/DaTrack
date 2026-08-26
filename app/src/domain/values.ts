/**
 * The closed value sets this app depends on.
 *
 * The database stores every one of these as plain `text` — there are no
 * Postgres enums, which the generated types confirm (`Enums: { [_ in never]:
 * never }`). So `sale_type` arrives as `string`, and nothing below the
 * application layer distinguishes `'LAS'` from `'las'` or `'SK+MGM '`.
 *
 * That makes this file the enforcement point. Values are parsed where data
 * enters the app, so a bad value fails loudly at the boundary instead of
 * quietly producing a plausible-looking wrong number further in.
 */

export interface Vocabulary<T extends string> {
  /** Every valid value, in the order the UI should offer them. */
  readonly values: readonly T[];
  /** Narrowing guard for untrusted input. */
  is(value: unknown): value is T;
  /** Returns the value, or `null` when it is not valid. */
  tryParse(value: unknown): T | null;
  /** Returns the value, or throws naming the field and what arrived. */
  parse(value: unknown, field?: string): T;
}

function vocabulary<T extends string>(name: string, values: readonly T[]): Vocabulary<T> {
  const allowed: ReadonlySet<string> = new Set(values);

  const is = (value: unknown): value is T =>
    typeof value === 'string' && allowed.has(value);

  return {
    values,
    is,
    tryParse: (value: unknown): T | null => (is(value) ? value : null),
    parse: (value: unknown, field = name): T => {
      if (is(value)) return value;
      throw new TypeError(
        `${field}: expected one of ${values.join(' | ')}, got ${JSON.stringify(value)}`,
      );
    },
  };
}

// ---------------------------------------------------------------------------
// Shifts
// ---------------------------------------------------------------------------

const SHIFT_VALUES = ['day', 'night'] as const;
export type Shift = (typeof SHIFT_VALUES)[number];
export const Shift = vocabulary<Shift>('shift', SHIFT_VALUES);

/**
 * Which shifts an outlet runs. Drives the sign-in buttons, the target fields,
 * the route-plan rows, and the lines in the generated route message. A
 * night-only outlet must never offer a day shift.
 */
const SHIFT_MODE_VALUES = ['day', 'night', 'dual'] as const;
export type ShiftMode = (typeof SHIFT_MODE_VALUES)[number];
export const ShiftMode = vocabulary<ShiftMode>('shift_mode', SHIFT_MODE_VALUES);

// ---------------------------------------------------------------------------
// Sales
// ---------------------------------------------------------------------------

/** `LD` is standalone — mutually exclusive with SK and MGM by construction. */
const SALE_TYPE_VALUES = ['SK', 'MGM', 'SK+MGM', 'LD'] as const;
export type SaleType = (typeof SALE_TYPE_VALUES)[number];
export const SaleType = vocabulary<SaleType>('sale_type', SALE_TYPE_VALUES);

/** Only LAS counts toward target. LAU is tracked and displayed, never scored. */
const CUSTOMER_TYPE_VALUES = ['LAS', 'LAU'] as const;
export type CustomerType = (typeof CUSTOMER_TYPE_VALUES)[number];
export const CustomerType = vocabulary<CustomerType>('customer_type', CUSTOMER_TYPE_VALUES);

// ---------------------------------------------------------------------------
// Attendance and planning
// ---------------------------------------------------------------------------

/**
 * What a promoter's day was. Only `work` carries an outlet and a shift.
 *
 * Note this set differs from the route plan's: attendance has `leave`
 * (استئذان, a short absence) and the plan has `annual` (a booked holiday).
 * They are not the same concept and must not be mapped onto each other.
 */
const ATTENDANCE_STATUS_VALUES = ['work', 'off', 'sick', 'leave', 'absent'] as const;
export type AttendanceStatus = (typeof ATTENDANCE_STATUS_VALUES)[number];
export const AttendanceStatus = vocabulary<AttendanceStatus>(
  'attendance.status',
  ATTENDANCE_STATUS_VALUES,
);

/** A planned non-working day. A plan row is either an assignment or one of these. */
const PLAN_STATUS_VALUES = ['off', 'sick', 'annual', 'absent'] as const;
export type PlanStatus = (typeof PLAN_STATUS_VALUES)[number];
export const PlanStatus = vocabulary<PlanStatus>('route_plans.status', PLAN_STATUS_VALUES);

/**
 * The attendance status a planned leave day should preselect at sign-in, or
 * `null` when the plan status has no attendance equivalent.
 *
 * `annual` deliberately maps to nothing: there is no annual option on the
 * attendance grid, and silently substituting `off` would misreport a booked
 * holiday as an ordinary day off.
 */
export function attendanceStatusForPlan(status: PlanStatus): AttendanceStatus | null {
  return status === 'annual' ? null : status;
}

// ---------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------

const ROLE_VALUES = ['manager', 'supervisor', 'promoter'] as const;
export type Role = (typeof ROLE_VALUES)[number];
export const Role = vocabulary<Role>('role', ROLE_VALUES);

/**
 * Stock catalog grouping. Drives the headings in the stock message.
 *
 * `other` is accepted because `stock_catalog_category_check` allows it, even
 * though `SCHEMA.md` documents only two values and nothing uses the third yet.
 * A parser narrower than its check constraint turns a legitimate row into a
 * crash on the promoter's stock screen.
 */
const STOCK_CATEGORY_VALUES = ['device', 'terea', 'other'] as const;
export type StockCategory = (typeof STOCK_CATEGORY_VALUES)[number];
export const StockCategory = vocabulary<StockCategory>('category', STOCK_CATEGORY_VALUES);

/** Supervisor reminder cadence. */
const TASK_KIND_VALUES = ['daily', 'weekly', 'once'] as const;
export type TaskKind = (typeof TASK_KIND_VALUES)[number];
export const TaskKind = vocabulary<TaskKind>('kind', TASK_KIND_VALUES);
