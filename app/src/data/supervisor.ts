/**
 * Supervisor-scoped reads.
 *
 * City scoping is enforced here, at the query layer, because forgetting it is
 * the single most expensive mistake this project has made. Filtering the
 * promoter list by city while leaving the attendance and sales those promoters
 * generated unscoped inflated achievement percentages across the whole team,
 * and every figure looked plausible.
 *
 * So: the promoter list is scoped by city, and everything divided against it is
 * scoped by that same promoter list. Both sides, every time.
 */

import { db } from '../lib/supabase';
import {
  businessMonth,
  businessToday,
  type BusinessDate,
  type BusinessMonth,
} from '../lib/businessDay';
import { Shift } from '../domain/values';
import { deriveStatus, slotKey, type StatusInput, type StatusReport } from '../features/supervisor/status';
import { failFrom, ok, type Result } from './errors';
import { parseOutlet, type Outlet } from './outlets';

type Row = Record<string, unknown>;

export interface TeamMember {
  readonly id: string;
  readonly fullName: string;
  readonly role: string;
  readonly loginNumber: string | null;
  readonly active: boolean;
}

function parseMember(row: unknown): TeamMember | null {
  if (row === null || row === undefined || typeof row !== 'object') return null;
  const record = row as Row;
  const id = record['id'];
  const fullName = record['full_name'];
  const role = record['role'];
  if (typeof id !== 'string' || id === '') return null;
  if (typeof fullName !== 'string' || fullName === '') return null;
  if (typeof role !== 'string') return null;

  const loginNumber = record['login_no'];
  const active = record['active'];
  return {
    id,
    fullName,
    role,
    loginNumber: typeof loginNumber === 'string' && loginNumber !== '' ? loginNumber : null,
    active: active === null || active === undefined ? true : active === true,
  };
}

/** Everyone in the city, any role. Deactivated included — the roster hides them. */
export async function listTeam(city: string): Promise<Result<TeamMember[]>> {
  const { data, error } = await db
    .from('users')
    .select('id, full_name, role, city, active, login_no')
    .eq('city', city)
    .order('role')
    .order('full_name');

  if (error) return failFrom(error, { action: 'قراءة فريق المدينة' });
  return ok((data ?? []).map(parseMember).filter((m): m is TeamMember => m !== null));
}

/**
 * The morning triage view: who has not reported, which outlet+shift pairs are
 * unstaffed, which have no target, and who has not finished the checklist.
 */
export async function loadStatus(
  city: string,
  now: number = Date.now(),
): Promise<Result<{ status: StatusReport; outlets: Outlet[]; date: BusinessDate }>> {
  const date = businessToday(now);
  const month: BusinessMonth = businessMonth(now);

  const [teamResult, outletResult] = await Promise.all([
    listTeam(city),
    db
      .from('touch_points')
      .select('id, name, unicode, maps_url, shift_mode, dual_shift, is_ds, city, active')
      .eq('active', true)
      .eq('city', city)
      .order('name'),
  ]);

  if (!teamResult.ok) return teamResult;
  if (outletResult.error) return failFrom(outletResult.error, { action: 'قراءة المواقع' });

  const outlets = (outletResult.data ?? [])
    .map(parseOutlet)
    .filter((o): o is Outlet => o !== null);

  const promoters = teamResult.data
    .filter((member) => member.role === 'promoter' && member.active)
    .map((member) => ({ id: member.id, fullName: member.fullName }));

  const promoterIds = promoters.map((p) => p.id);

  // With nobody in the city there is nothing to divide against, and `in ()`
  // with an empty list is a query PostgREST will not accept.
  if (promoterIds.length === 0) {
    return ok({
      status: deriveStatus({
        date,
        month,
        promoters: [],
        outlets: [],
        attendance: [],
        targetedPairs: new Set(),
        checklistItemCount: 0,
        checklistDone: new Map(),
      }),
      outlets,
      date,
    });
  }

  const [attendanceResult, targetResult, itemResult, responseResult] = await Promise.all([
    db
      .from('attendance')
      .select('promoter_id, touch_point_id, shift, status, work_date')
      .eq('work_date', date)
      .in('promoter_id', promoterIds),
    db.from('targets').select('touch_point_id, shift, month').eq('month', month),
    db.from('checklist_items').select('id').eq('active', true),
    db
      .from('checklist_responses')
      .select('promoter_id, checked, work_date')
      .eq('work_date', date)
      .in('promoter_id', promoterIds),
  ]);

  if (attendanceResult.error) {
    return failFrom(attendanceResult.error, { action: 'قراءة تسجيلات اليوم' });
  }

  const attendance: StatusInput['attendance'] = (attendanceResult.data ?? []).map((row) => {
    const record = row as Row;
    const touchPointId = record['touch_point_id'];
    return {
      promoterId: String(record['promoter_id'] ?? ''),
      touchPointId: typeof touchPointId === 'number' ? touchPointId : null,
      shift: Shift.tryParse(record['shift']),
      isWork: record['status'] === 'work',
    };
  });

  // Targets are keyed by outlet, so a whole month is safe to fetch — but only
  // pairs belonging to this city's outlets may count toward the report.
  const cityOutletIds = new Set(outlets.map((outlet) => outlet.id));
  const targetedPairs = new Set<string>();
  for (const row of targetResult.data ?? []) {
    const record = row as Row;
    const outletId = record['touch_point_id'];
    const shift = Shift.tryParse(record['shift']);
    if (typeof outletId !== 'number' || shift === null) continue;
    if (!cityOutletIds.has(outletId)) continue;
    targetedPairs.add(slotKey(outletId, shift));
  }

  const checklistItemCount = (itemResult.data ?? []).length;

  const checklistDone = new Map<string, number>();
  for (const row of responseResult.data ?? []) {
    const record = row as Row;
    if (record['checked'] !== true) continue;
    const promoterId = String(record['promoter_id'] ?? '');
    checklistDone.set(promoterId, (checklistDone.get(promoterId) ?? 0) + 1);
  }

  const status = deriveStatus({
    date,
    month,
    promoters,
    outlets: outlets.map((outlet) => ({
      id: outlet.id,
      name: outlet.name,
      shiftMode: outlet.shiftMode,
    })),
    attendance,
    targetedPairs,
    checklistItemCount,
    checklistDone,
  });

  return ok({ status, outlets, date });
}
