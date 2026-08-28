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
  businessDayOfMonth,
  businessMonth,
  businessMonthStart,
  businessToday,
  startOfLastDays,
  type BusinessDate,
  type BusinessMonth,
} from '../lib/businessDay';
import { CustomerType, SaleType, Shift } from '../domain/values';
import {
  aggregateCompliance,
  aggregateSales,
  type AggregateSale,
  type ComplianceAttendance,
  type ComplianceRow,
  type SalesAggregate,
} from '../features/supervisor/aggregate';
import type { PeriodKind } from '../features/reports/periodSummary';
import type { CsvRow } from '../features/reports/monthCsv';

import { deriveStatus, slotKey, type StatusInput, type StatusReport } from '../features/supervisor/status';
import { failFrom, invalid, ok, type Result } from './errors';
import { oneLine } from '../domain/text';
import { parseOutlet, type Outlet } from './outlets';

/** Everything the overview and team panels need for one period. */
export interface DashboardData {
  readonly start: BusinessDate;
  readonly period: PeriodKind;
  readonly sales: SalesAggregate;
  readonly compliance: readonly ComplianceRow[];
  readonly guidedTrials: number;
  readonly checkIns: number;
  readonly csvRows: readonly CsvRow[];
}

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

// ---------------------------------------------------------------------------
// Dashboard: period totals and month-to-date compliance
// ---------------------------------------------------------------------------

/**
 * Everything the overview and team panels show for a period.
 *
 * Scoped by the city's promoter list on both sides. Sales are additionally
 * inner-joined through attendance to `touch_points` on city, so a sale can only
 * count if the outlet it happened at belongs to this city.
 */
export async function loadDashboard(
  city: string,
  period: PeriodKind,
  now: number = Date.now(),
): Promise<Result<DashboardData>> {
  const start = period === 'today'
    ? businessToday(now)
    : period === 'week'
      ? startOfLastDays(7, now)
      : businessMonthStart(now);
  const month = businessMonth(now);
  const monthStart = businessMonthStart(now);

  const teamResult = await listTeam(city);
  if (!teamResult.ok) return teamResult;

  const promoters = teamResult.data
    .filter((member) => member.role === 'promoter' && member.active)
    .map((member) => ({ id: member.id, fullName: member.fullName }));
  const promoterIds = promoters.map((p) => p.id);

  if (promoterIds.length === 0) {
    return ok({
      start,
      period,
      sales: aggregateSales([]),
      compliance: [],
      guidedTrials: 0,
      checkIns: 0,
      csvRows: [],
    });
  }

  const [saleResult, attendanceResult, monthAttendanceResult, monthSaleResult, targetResult] =
    await Promise.all([
      db
        .from('sell_operations')
        .select(
          'promoter_id, work_date, device_type, color, sale_type, customer_type, created_at, users(full_name), attendance!inner(shift, touch_points!inner(name, city))',
        )
        .gte('work_date', start)
        .eq('attendance.touch_points.city', city)
        .order('work_date'),
      db
        .from('attendance')
        .select('promoter_id, guided_trials, status, work_date')
        .gte('work_date', start)
        .in('promoter_id', promoterIds),
      db
        .from('attendance')
        .select('promoter_id, work_date, touch_point_id, shift, status')
        .gte('work_date', monthStart)
        .in('promoter_id', promoterIds),
      db
        .from('sell_operations')
        .select('promoter_id, customer_type, work_date')
        .gte('work_date', monthStart)
        .in('promoter_id', promoterIds),
      db.from('targets').select('touch_point_id, shift, daily_target, month').eq('month', month),
    ]);

  if (saleResult.error) return failFrom(saleResult.error, { action: 'قراءة المبيعات' });
  if (attendanceResult.error) {
    return failFrom(attendanceResult.error, { action: 'قراءة التسجيلات' });
  }

  const aggregateInput: AggregateSale[] = [];
  const csvRows: CsvRow[] = [];

  for (const row of saleResult.data ?? []) {
    const record = row as Row;
    const saleType = SaleType.tryParse(record['sale_type']);
    const customerType = CustomerType.tryParse(record['customer_type']);
    if (saleType === null || customerType === null) continue;

    const user = record['users'] as Row | null;
    const parent = record['attendance'] as Row | null;
    const outlet = (parent?.['touch_points'] ?? null) as Row | null;

    const promoterName = typeof user?.['full_name'] === 'string' ? user['full_name'] : '';
    const outletName = typeof outlet?.['name'] === 'string' ? outlet['name'] : '';
    const deviceType = String(record['device_type'] ?? '');
    const color = String(record['color'] ?? '');

    aggregateInput.push({
      promoterId: String(record['promoter_id'] ?? ''),
      promoterName,
      outletName,
      deviceType,
      color,
      saleType,
      customerType,
    });

    csvRows.push({
      workDate: String(record['work_date'] ?? ''),
      promoterName,
      outletName,
      shift: Shift.tryParse(parent?.['shift']) ?? 'day',
      deviceType,
      color,
      saleType,
      customerType,
      createdAt: typeof record['created_at'] === 'string' ? record['created_at'] : null,
    });
  }

  let guidedTrials = 0;
  let checkIns = 0;
  for (const row of attendanceResult.data ?? []) {
    const record = row as Row;
    const trials = record['guided_trials'];
    guidedTrials += typeof trials === 'number' ? trials : 0;
    checkIns += 1;
  }

  const dailyTargets = new Map<string, number>();
  for (const row of targetResult.data ?? []) {
    const record = row as Row;
    const outletId = record['touch_point_id'];
    const shift = Shift.tryParse(record['shift']);
    if (typeof outletId !== 'number' || shift === null) continue;
    const target = record['daily_target'];
    const value = typeof target === 'number' ? target : Number(target);
    if (Number.isFinite(value)) dailyTargets.set(`${outletId}-${shift}`, value);
  }

  const monthAttendance: ComplianceAttendance[] = (monthAttendanceResult.data ?? []).map((row) => {
    const record = row as Row;
    const outletId = record['touch_point_id'];
    return {
      promoterId: String(record['promoter_id'] ?? ''),
      workDate: String(record['work_date'] ?? ''),
      touchPointId: typeof outletId === 'number' ? outletId : null,
      shift: Shift.tryParse(record['shift']),
      isWork: record['status'] === 'work',
    };
  });

  const lasByPromoter = new Map<string, number>();
  for (const row of monthSaleResult.data ?? []) {
    const record = row as Row;
    if (record['customer_type'] !== 'LAS') continue;
    const id = String(record['promoter_id'] ?? '');
    lasByPromoter.set(id, (lasByPromoter.get(id) ?? 0) + 1);
  }

  return ok({
    start,
    period,
    sales: aggregateSales(aggregateInput),
    compliance: aggregateCompliance({
      promoters,
      attendance: monthAttendance,
      lasByPromoter,
      dailyTargets,
      elapsedDays: businessDayOfMonth(now),
    }),
    guidedTrials,
    checkIns,
    csvRows,
  });
}

// ---------------------------------------------------------------------------
// User management
// ---------------------------------------------------------------------------

/**
 * Renames a person and sets their display login number.
 *
 * `login_no` is display only. The real credential is the email in `auth.users`
 * (`1699@example.com`), which this app cannot change — doing so needs the
 * service_role key, which must never reach client code. Changing the number
 * here without changing the email in the Supabase dashboard leaves a roster
 * that lies, so the UI says so at the point of editing.
 */
export async function updateMember(
  id: string,
  fullName: string,
  loginNumber: string,
): Promise<Result<true>> {
  const name = oneLine(fullName, 60);
  if (name === '') return invalid('الاسم مطلوب');

  const login = oneLine(loginNumber, 4).replace(/\D/gu, '');

  const { error } = await db
    .from('users')
    .update({ full_name: name, login_no: login === '' ? null : login })
    .eq('id', id);

  if (error) {
    return failFrom(error, {
      action: 'حفظ بيانات المستخدم',
      overrides: {
        '42501': 'لا تملك صلاحية تعديل المستخدمين',
        '23505': 'رقم الدخول مستخدم مسبقاً',
      },
    });
  }
  return ok(true);
}

/** Activates or deactivates a person. Deactivation preserves their history. */
export async function setMemberActive(id: string, active: boolean): Promise<Result<true>> {
  const { error } = await db.from('users').update({ active }).eq('id', id);
  if (error) {
    return failFrom(error, {
      action: 'تغيير حالة المستخدم',
      overrides: { '42501': 'لا تملك صلاحية تعديل المستخدمين' },
    });
  }
  return ok(true);
}

/**
 * Claims a spare account for a new promoter.
 *
 * Creating an auth user needs the service_role key, so the app cannot do it.
 * The workaround is pre-created inactive placeholder rows that a supervisor
 * renames and activates. Their password still has to be set from the Supabase
 * dashboard, which the UI states plainly rather than leaving to be discovered.
 */
export async function claimSpare(
  id: string,
  fullName: string,
  city: string,
): Promise<Result<true>> {
  const name = oneLine(fullName, 60);
  if (name === '') return invalid('اكتب اسم المندوب');

  const { error } = await db
    .from('users')
    .update({ full_name: name, active: true, city })
    .eq('id', id);

  if (error) {
    return failFrom(error, {
      action: 'تفعيل المندوب',
      overrides: { '42501': 'لا تملك صلاحية تعديل المستخدمين' },
    });
  }
  return ok(true);
}
