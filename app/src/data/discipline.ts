/**
 * Discipline records (`discipline`) — warnings and pay deductions.
 *
 * Readable by the supervisor and the manager, and by nobody else. A promoter
 * cannot read this table at all: RLS has no policy for their role, so the
 * request returns an empty list rather than a refusal. That is deliberate, and
 * it is a decision about how the team is managed rather than a technical one —
 * nobody should learn their pay was cut from a phone screen before a person has
 * spoken to them.
 *
 * Two rules the database also enforces, validated here first so a rejected
 * record names its own problem instead of surfacing a constraint violation:
 *
 *  - A deduction carries an amount; a warning never does. That pairing is what
 *    separates the two kinds, so a warning with an amount is not a warning and
 *    a deduction without one is not actionable.
 *  - `other` requires an explanation. An unexplained 'other' is no reason.
 *
 * `workDate` is the day the thing happened, not the day it was typed. Those
 * differ whenever something is recorded the morning after a night shift, and
 * payroll cares about the former.
 */

import { db } from '../lib/supabase';
import type { BusinessDate } from '../lib/businessDay';
import { oneLine } from '../domain/text';
import {
  DisciplineAmount,
  DisciplineKind,
  DisciplineReason,
  type DisciplineAmount as AmountValue,
  type DisciplineKind as KindValue,
  type DisciplineReason as ReasonValue,
} from '../domain/values';
import { failFrom, invalid, ok, type Result } from './errors';

const RECORD_COLUMNS =
  'id, promoter_id, work_date, kind, amount, reason, note, created_by, created_at';

/** Matches `discipline_note_len`. */
export const MAX_NOTE_LENGTH = 500;

export interface DisciplineRecord {
  readonly id: number;
  readonly promoterId: string;
  readonly workDate: BusinessDate;
  readonly kind: KindValue;
  /** Always set on a deduction, always null on a warning. */
  readonly amount: AmountValue | null;
  readonly reason: ReasonValue;
  readonly note: string | null;
  readonly createdBy: string;
  readonly createdAt: string | null;
}

type Row = Record<string, unknown>;

export function parseRecord(row: unknown): DisciplineRecord | null {
  if (row === null || row === undefined || typeof row !== 'object') return null;
  const record = row as Row;

  const id = record['id'];
  const promoterId = record['promoter_id'];
  const workDate = record['work_date'];
  const kind = DisciplineKind.tryParse(record['kind']);
  const reason = DisciplineReason.tryParse(record['reason']);
  const createdBy = record['created_by'];

  if (typeof id !== 'number') return null;
  if (typeof promoterId !== 'string' || promoterId === '') return null;
  if (typeof workDate !== 'string' || workDate === '') return null;
  if (kind === null || reason === null) return null;
  if (typeof createdBy !== 'string' || createdBy === '') return null;

  const note = record['note'];
  const createdAt = record['created_at'];

  return {
    id,
    promoterId,
    workDate,
    kind,
    amount: DisciplineAmount.tryParse(record['amount']),
    reason,
    note: typeof note === 'string' && note !== '' ? note : null,
    createdBy,
    createdAt: typeof createdAt === 'string' ? createdAt : null,
  };
}

// ---------------------------------------------------------------------------
// Validation — pure, so the rules are testable without a database
// ---------------------------------------------------------------------------

export interface NewRecord {
  readonly promoterId: string;
  readonly workDate: BusinessDate;
  readonly kind: KindValue;
  readonly amount: AmountValue | null;
  readonly reason: ReasonValue;
  readonly note: string;
}

/**
 * Names what is wrong with a record, or `null` when it can be written.
 *
 * Exposed so the UI can keep the submit button disabled and say why, rather
 * than composing something the database will reject.
 */
export function validateRecord(record: NewRecord): string | null {
  if (record.promoterId === '') return 'اختر المندوب أولاً';

  if (record.kind === 'deduction' && record.amount === null) {
    return 'اختر مقدار الخصم';
  }
  if (record.kind === 'warning' && record.amount !== null) {
    // Not reachable from the UI, which clears the amount when the kind flips.
    // Kept because the constraint exists and a silent mismatch would surface
    // as an unreadable 23514 at the worst moment.
    return 'الإنذار لا يحمل مقدار خصم';
  }
  if (record.reason === 'other' && oneLine(record.note, MAX_NOTE_LENGTH) === '') {
    return 'اكتب سبب المخالفة';
  }
  return null;
}

/** The note as stored: single line, bounded, and empty unless it is needed. */
export function noteFor(record: NewRecord): string | null {
  const cleaned = oneLine(record.note, MAX_NOTE_LENGTH);
  return cleaned === '' ? null : cleaned;
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

const parseList = (data: unknown): DisciplineRecord[] =>
  (Array.isArray(data) ? data : [])
    .map(parseRecord)
    .filter((record): record is DisciplineRecord => record !== null);

/**
 * The most recent records, newest first.
 *
 * Not city-scoped. There is one supervisor and one manager, and a deduction is
 * a payroll fact rather than a regional one — hiding half of them behind the
 * manager's city switcher would make the list quietly incomplete.
 */
export async function listRecent(limit = 50): Promise<Result<DisciplineRecord[]>> {
  const { data, error } = await db
    .from('discipline')
    .select(RECORD_COLUMNS)
    .order('work_date', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit);

  if (error) return failFrom(error, { action: 'قراءة السجل' });
  return ok(parseList(data));
}

/** Everything recorded against one promoter, newest first. */
export async function listForPromoter(
  promoterId: string,
): Promise<Result<DisciplineRecord[]>> {
  const { data, error } = await db
    .from('discipline')
    .select(RECORD_COLUMNS)
    .eq('promoter_id', promoterId)
    .order('work_date', { ascending: false })
    .limit(100);

  if (error) return failFrom(error, { action: 'قراءة سجل المندوب' });
  return ok(parseList(data));
}

export async function createRecord(
  record: NewRecord,
  createdBy: string,
): Promise<Result<DisciplineRecord>> {
  const problem = validateRecord(record);
  if (problem !== null) return invalid(problem);

  const { data, error } = await db
    .from('discipline')
    .insert({
      promoter_id: record.promoterId,
      work_date: record.workDate,
      kind: record.kind,
      amount: record.kind === 'deduction' ? record.amount : null,
      reason: record.reason,
      note: noteFor(record),
      created_by: createdBy,
    })
    .select(RECORD_COLUMNS)
    .single();

  if (error) {
    return failFrom(error, {
      action: 'تسجيل المخالفة',
      overrides: {
        '23514': 'القيم غير مكتملة — راجع المقدار والسبب',
        '42501': 'لا تملك صلاحية لتسجيل المخالفات',
      },
    });
  }

  const parsed = parseRecord(data);
  return parsed === null
    ? invalid('سُجّلت المخالفة لكن تعذّرت قراءتها — حدّث الصفحة')
    : ok(parsed);
}

/** Removes a record. Either the supervisor or the manager may undo one. */
export async function removeRecord(recordId: number): Promise<Result<true>> {
  const { error } = await db.from('discipline').delete().eq('id', recordId);
  if (error) return failFrom(error, { action: 'حذف المخالفة' });
  return ok(true);
}
