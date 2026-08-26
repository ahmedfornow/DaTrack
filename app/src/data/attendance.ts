/**
 * Attendance sessions — the anchor every sale and stock count hangs off.
 *
 * One subtlety drives most of this file. `attendance.shift` is NOT NULL and
 * defaults to `'day'`, so a leave row (off / sick / leave / absent) silently
 * occupies the day slot even though a leave day has no shift. Combined with
 * `UNIQUE (promoter_id, work_date, shift)` that produces two behaviours the
 * database will not stop:
 *
 *  1. A promoter marked `off` who then signs in for a DAY shift hits 23505,
 *     which the legacy app reports as "already registered for the same shift" —
 *     describing something that did not happen.
 *  2. The same promoter CAN sign in for a NIGHT shift, because the stored
 *     shift differs. The result is a promoter simultaneously off and working.
 *
 * So conflicts are detected here, in the client, before any write — named
 * specifically, and covering the case the constraint misses.
 */

import { db } from '../lib/supabase';
import {
  businessMonthStart,
  businessToday,
  isBackfillable,
  type BusinessDate,
} from '../lib/businessDay';
import { ATTENDANCE_STATUS_LABEL, SHIFT_LABEL } from '../domain/labels';
import { requiresOutlet } from '../domain/rules';
import { AttendanceStatus, Shift, type Shift as ShiftValue } from '../domain/values';
import { failFrom, invalid, ok, type Result } from './errors';

/** Every column read below, so the select can never drift from the parse. */
const SESSION_COLUMNS =
  'id, promoter_id, work_date, touch_point_id, shift, status, guided_trials, checked_in_at';

const SESSION_WITH_OUTLET = `${SESSION_COLUMNS}, touch_points(id, name, shift_mode, city)`;

export interface SessionOutlet {
  readonly id: number;
  readonly name: string;
  readonly shiftMode: string;
  readonly city: string;
}

export interface Session {
  readonly id: number;
  readonly promoterId: string;
  readonly workDate: BusinessDate;
  readonly status: AttendanceStatus;
  readonly touchPointId: number | null;
  /**
   * The shift as stored. For a non-work row this is the column default and
   * carries no meaning — read {@link workingShift} instead.
   */
  readonly storedShift: ShiftValue;
  /** The shift this session actually represents. `null` on a leave day. */
  readonly workingShift: ShiftValue | null;
  readonly guidedTrials: number;
  readonly checkedInAt: string | null;
  readonly outlet: SessionOutlet | null;
}

type Row = Record<string, unknown>;

function parseOutlet(value: unknown): SessionOutlet | null {
  // PostgREST returns an object for a to-one embed, but an array if the
  // relationship is inferred as to-many. Accept both rather than silently
  // dropping the outlet name.
  const row = Array.isArray(value) ? value[0] : value;
  if (row === null || row === undefined || typeof row !== 'object') return null;
  const record = row as Row;
  const { id, name, shift_mode: shiftMode, city } = record;
  if (typeof id !== 'number' || typeof name !== 'string') return null;
  return {
    id,
    name,
    shiftMode: typeof shiftMode === 'string' ? shiftMode : 'day',
    city: typeof city === 'string' ? city : '',
  };
}

/** Parses a row, rejecting anything whose closed values are not recognised. */
export function parseSession(row: unknown): Session | null {
  if (row === null || row === undefined || typeof row !== 'object') return null;
  const record = row as Row;

  const id = record['id'];
  const promoterId = record['promoter_id'];
  const workDate = record['work_date'];
  const status = AttendanceStatus.tryParse(record['status']);
  const storedShift = Shift.tryParse(record['shift']);

  if (typeof id !== 'number') return null;
  if (typeof promoterId !== 'string' || promoterId === '') return null;
  if (typeof workDate !== 'string' || workDate === '') return null;
  if (status === null || storedShift === null) return null;

  const touchPointId = record['touch_point_id'];
  const guidedTrials = record['guided_trials'];
  const checkedInAt = record['checked_in_at'];

  return {
    id,
    promoterId,
    workDate,
    status,
    touchPointId: typeof touchPointId === 'number' ? touchPointId : null,
    storedShift,
    workingShift: status === 'work' ? storedShift : null,
    guidedTrials: typeof guidedTrials === 'number' ? guidedTrials : 0,
    checkedInAt: typeof checkedInAt === 'string' ? checkedInAt : null,
    outlet: parseOutlet(record['touch_points']),
  };
}

// ---------------------------------------------------------------------------
// Conflict detection — pure, so it is testable without a database
// ---------------------------------------------------------------------------

export interface SignInIntent {
  readonly status: AttendanceStatus;
  /** Required when the status is `work`; ignored otherwise. */
  readonly shift: ShiftValue | null;
}

export type SignInConflict =
  /** The same working shift is already registered for that date. */
  | { readonly kind: 'same-shift'; readonly existing: Session }
  /** The day is already marked as leave, so no work can be logged against it. */
  | { readonly kind: 'day-marked-leave'; readonly existing: Session }
  /** A leave status is being added to a day that already has a record. */
  | { readonly kind: 'day-already-recorded'; readonly existing: Session };

/**
 * The shift value the database will actually store, accounting for the column
 * default that applies to every non-work row.
 */
export function storedShiftFor(intent: SignInIntent): ShiftValue {
  return intent.status === 'work' && intent.shift !== null ? intent.shift : 'day';
}

/**
 * Finds the conflict a sign-in would hit, or `null` when it is safe.
 *
 * Deliberately stricter than the unique constraint: a day marked as leave
 * blocks work on *either* shift, which the constraint permits.
 */
export function findSignInConflict(
  existing: readonly Session[],
  intent: SignInIntent,
): SignInConflict | null {
  const leaveRow = existing.find((session) => session.status !== 'work');

  if (intent.status === 'work') {
    if (leaveRow !== undefined) {
      return { kind: 'day-marked-leave', existing: leaveRow };
    }
    const clash = existing.find((session) => session.workingShift === intent.shift);
    return clash !== undefined ? { kind: 'same-shift', existing: clash } : null;
  }

  const any = existing[0];
  return any !== undefined ? { kind: 'day-already-recorded', existing: any } : null;
}

/** The Arabic sentence for a conflict, naming what is already there. */
export function conflictMessage(conflict: SignInConflict): string {
  const { existing } = conflict;
  switch (conflict.kind) {
    case 'same-shift': {
      const shift = existing.workingShift;
      const label = shift !== null ? SHIFT_LABEL[shift] : '';
      return `سجّلت هذا اليوم مسبقاً في الفترة ال${label}ة — افتح الجلسة بدل تسجيلها من جديد`;
    }
    case 'day-marked-leave':
      return `هذا اليوم مسجل كـ${ATTENDANCE_STATUS_LABEL[existing.status]} — احذف السجل أولاً إذا كنت ستداوم`;
    case 'day-already-recorded':
      return `هذا اليوم مسجل مسبقاً كـ${ATTENDANCE_STATUS_LABEL[existing.status]}`;
  }
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/** Every session a promoter has on one business date. */
export async function sessionsOn(
  promoterId: string,
  date: BusinessDate,
): Promise<Result<Session[]>> {
  const { data, error } = await db
    .from('attendance')
    .select(SESSION_WITH_OUTLET)
    .eq('promoter_id', promoterId)
    .eq('work_date', date)
    .order('checked_in_at', { ascending: false });

  if (error) return failFrom(error, { action: 'قراءة سجل اليوم' });
  return ok((data ?? []).map(parseSession).filter((s): s is Session => s !== null));
}

/** Every session in the current business month, newest first. */
export async function sessionsThisMonth(
  promoterId: string,
  now: number = Date.now(),
): Promise<Result<Session[]>> {
  const { data, error } = await db
    .from('attendance')
    .select(SESSION_WITH_OUTLET)
    .eq('promoter_id', promoterId)
    .gte('work_date', businessMonthStart(now))
    .order('work_date', { ascending: false });

  if (error) return failFrom(error, { action: 'قراءة سجل الشهر' });
  return ok((data ?? []).map(parseSession).filter((s): s is Session => s !== null));
}

export interface SignInRequest {
  readonly promoterId: string;
  readonly date: BusinessDate;
  readonly status: AttendanceStatus;
  readonly touchPointId: number | null;
  readonly shift: ShiftValue | null;
}

/**
 * Registers a day. Validates in the client first so the message names the
 * specific conflict — running duplicate detection after the insert leaves the
 * user with a constraint violation they cannot interpret.
 */
export async function signIn(
  request: SignInRequest,
  now: number = Date.now(),
): Promise<Result<Session>> {
  const { promoterId, date, status, touchPointId, shift } = request;

  if (!isBackfillable(date, now)) {
    return invalid(
      date > businessToday(now)
        ? 'لا يمكن تسجيل يوم في المستقبل'
        : 'يمكن تسجيل أيام الشهر الحالي فقط',
    );
  }

  // Build the row up front so the compiler can prove a work row carries both an
  // outlet and a shift. `attendance.shift` is NOT NULL, so omitting the column
  // is what lets a leave row take the default — passing null would be rejected.
  let row: {
    promoter_id: string;
    work_date: string;
    status: AttendanceStatus;
    touch_point_id?: number;
    shift?: ShiftValue;
  };

  if (requiresOutlet(status)) {
    if (touchPointId === null) return invalid('اختر موقع الدوام أولاً');
    if (shift === null) return invalid('اختر الفترة أولاً');
    row = {
      promoter_id: promoterId,
      work_date: date,
      status,
      touch_point_id: touchPointId,
      shift,
    };
  } else {
    row = { promoter_id: promoterId, work_date: date, status };
  }

  const existing = await sessionsOn(promoterId, date);
  if (!existing.ok) return existing;

  const conflict = findSignInConflict(existing.data, { status, shift });
  if (conflict !== null) return invalid(conflictMessage(conflict));

  const { data, error } = await db
    .from('attendance')
    .insert(row)
    .select(SESSION_WITH_OUTLET)
    .single();

  if (error) {
    return failFrom(error, {
      action: 'تسجيل اليوم',
      overrides: {
        // Reachable only if another device wrote between the check and here.
        '23505': 'هذا اليوم سُجّل للتو من جهاز آخر — حدّث الصفحة',
        '23514': 'يوم الدوام يحتاج موقعاً وفترة',
      },
    });
  }

  const parsed = parseSession(data);
  return parsed === null
    ? invalid('تم التسجيل لكن تعذّرت قراءة السجل — حدّث الصفحة')
    : ok(parsed);
}

/** Removes a day. Blocked by the database while sales still reference it. */
export async function removeSession(
  sessionId: number,
  promoterId: string,
): Promise<Result<true>> {
  const { error } = await db
    .from('attendance')
    .delete()
    .eq('id', sessionId)
    .eq('promoter_id', promoterId);

  if (error) {
    return failFrom(error, {
      action: 'حذف اليوم',
      overrides: {
        '23503': 'لا يمكن حذف يوم عليه مبيعات — احذف مبيعاته أولاً',
      },
    });
  }
  return ok(true);
}

/** Records guided trials without disturbing anything else on the row. */
export async function setGuidedTrials(
  sessionId: number,
  guidedTrials: number,
): Promise<Result<true>> {
  if (!Number.isInteger(guidedTrials) || guidedTrials < 0) {
    return invalid('عدد الـ Guided Trials يجب أن يكون رقماً صحيحاً');
  }

  const { error } = await db
    .from('attendance')
    .update({ guided_trials: guidedTrials })
    .eq('id', sessionId);

  if (error) return failFrom(error, { action: 'حفظ عدد الـ Guided Trials' });
  return ok(true);
}
