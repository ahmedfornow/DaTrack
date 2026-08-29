/**
 * Sales (`sell_operations`). One row per device sold.
 *
 * Three rules are enforced before any write, so a rejected sale names its own
 * problem instead of surfacing a constraint violation:
 *
 *  - Only LAS customers can receive MGM (`sell_ops_las_only_mgm`).
 *  - Device and colour must match `device_catalog` casing exactly, via a
 *    composite foreign key. `ILUMA i PRIME` fails where `ILUMA i Prime` works.
 *  - `work_date` is denormalised and must match the parent attendance row.
 *
 * That last one deserves emphasis: `work_date` has a column default, so
 * omitting it silently records the server's idea of today. For a sale logged at
 * 01:30 KSA that is the wrong business day. It is always passed explicitly from
 * the session, never defaulted.
 */

import { db } from '../lib/supabase';
import type { BusinessDate } from '../lib/businessDay';
import { isValidCombination, type DeviceColor, type DeviceType } from '../domain/devices';
import { countsAsLd, countsAsMgm, countsAsSk, isValidSalePair } from '../domain/rules';
import {
  CustomerType,
  SaleType,
  type CustomerType as CustomerTypeValue,
  type SaleType as SaleTypeValue,
} from '../domain/values';
import { failFrom, invalid, ok, type Result } from './errors';
import { insertIdempotently } from './idempotency';

const SALE_COLUMNS =
  'id, attendance_id, promoter_id, work_date, device_type, color, sale_type, customer_type, quantity, created_at';

export interface Sale {
  readonly id: number;
  readonly attendanceId: number;
  readonly promoterId: string;
  readonly workDate: BusinessDate;
  readonly deviceType: string;
  readonly color: string;
  readonly saleType: SaleTypeValue;
  readonly customerType: CustomerTypeValue;
  readonly quantity: number;
  readonly createdAt: string | null;
}

type Row = Record<string, unknown>;

export function parseSale(row: unknown): Sale | null {
  if (row === null || row === undefined || typeof row !== 'object') return null;
  const record = row as Row;

  const id = record['id'];
  const attendanceId = record['attendance_id'];
  const promoterId = record['promoter_id'];
  const workDate = record['work_date'];
  const deviceType = record['device_type'];
  const color = record['color'];
  const saleType = SaleType.tryParse(record['sale_type']);
  const customerType = CustomerType.tryParse(record['customer_type']);

  if (typeof id !== 'number') return null;
  if (typeof attendanceId !== 'number') return null;
  if (typeof promoterId !== 'string' || promoterId === '') return null;
  if (typeof workDate !== 'string' || workDate === '') return null;
  if (typeof deviceType !== 'string' || typeof color !== 'string') return null;
  if (saleType === null || customerType === null) return null;

  const quantity = record['quantity'];
  const createdAt = record['created_at'];

  return {
    id,
    attendanceId,
    promoterId,
    workDate,
    deviceType,
    color,
    saleType,
    customerType,
    quantity: typeof quantity === 'number' && quantity > 0 ? quantity : 1,
    createdAt: typeof createdAt === 'string' ? createdAt : null,
  };
}

// ---------------------------------------------------------------------------
// Aggregation — pure, and the single source for every count shown anywhere
// ---------------------------------------------------------------------------

export interface SaleTotals {
  /** Counts toward target. */
  readonly las: number;
  /** Tracked and displayed, never scored. */
  readonly lau: number;
  /** `SK+MGM` counts in both sk and mgm, so these can exceed {@link total}. */
  readonly sk: number;
  readonly mgm: number;
  readonly ld: number;
  readonly total: number;
}

export function summarize(sales: readonly Sale[]): SaleTotals {
  let las = 0;
  let lau = 0;
  let sk = 0;
  let mgm = 0;
  let ld = 0;

  for (const sale of sales) {
    if (sale.customerType === 'LAS') las += 1;
    else lau += 1;
    if (countsAsSk(sale.saleType)) sk += 1;
    if (countsAsMgm(sale.saleType)) mgm += 1;
    if (countsAsLd(sale.saleType)) ld += 1;
  }

  return { las, lau, sk, mgm, ld, total: sales.length };
}

export interface SaleGroup {
  readonly key: string;
  readonly deviceType: string;
  readonly color: string;
  readonly saleType: SaleTypeValue;
  readonly customerType: CustomerTypeValue;
  readonly count: number;
  /** Row ids in the group, oldest first. Deleting removes one, not the group. */
  readonly ids: readonly number[];
}

/**
 * Groups identical sales for the session list, most frequent first.
 *
 * The count is what the promoter reads, so the delete affordance must be
 * unambiguous about removing a single unit — see {@link removeOne}.
 */
export function groupSales(sales: readonly Sale[]): readonly SaleGroup[] {
  const groups = new Map<string, { group: Omit<SaleGroup, 'count' | 'ids'>; ids: number[] }>();

  for (const sale of sales) {
    const key = [sale.deviceType, sale.color, sale.saleType, sale.customerType].join('|');
    const existing = groups.get(key);
    if (existing === undefined) {
      groups.set(key, {
        group: {
          key,
          deviceType: sale.deviceType,
          color: sale.color,
          saleType: sale.saleType,
          customerType: sale.customerType,
        },
        ids: [sale.id],
      });
    } else {
      existing.ids.push(sale.id);
    }
  }

  return [...groups.values()]
    .map(({ group, ids }) => ({ ...group, count: ids.length, ids: [...ids].sort((a, b) => a - b) }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/** Every sale logged against one attendance session, newest first. */
export async function listForSession(attendanceId: number): Promise<Result<Sale[]>> {
  const { data, error } = await db
    .from('sell_operations')
    .select(SALE_COLUMNS)
    .eq('attendance_id', attendanceId)
    .order('created_at', { ascending: false });

  if (error) return failFrom(error, { action: 'قراءة مبيعات الجلسة' });
  return ok((data ?? []).map(parseSale).filter((s): s is Sale => s !== null));
}

/** Sales in chronological order — the order the end-of-shift report prints. */
export async function listForReport(attendanceId: number): Promise<Result<Sale[]>> {
  const { data, error } = await db
    .from('sell_operations')
    .select(SALE_COLUMNS)
    .eq('attendance_id', attendanceId)
    .order('created_at', { ascending: true });

  if (error) return failFrom(error, { action: 'قراءة مبيعات الجلسة' });
  return ok((data ?? []).map(parseSale).filter((s): s is Sale => s !== null));
}

export interface Combination {
  readonly deviceType: DeviceType;
  readonly color: DeviceColor;
  readonly saleType: SaleTypeValue;
  readonly customerType: CustomerTypeValue;
  /** How often this promoter has logged it in the window examined. */
  readonly count: number;
}

/**
 * The combinations a promoter logs most often, most frequent first.
 *
 * This is what makes a sale two taps instead of five. Rather than walking four
 * grids every time, the common case becomes one tap on a tile the promoter
 * recognises. Only combinations still valid in the catalog are offered — a
 * retired colour must not resurface as a shortcut that fails on submit.
 */
export function rankCombinations(
  sales: readonly Sale[],
  limit = 4,
): readonly Combination[] {
  const counts = new Map<string, Combination>();

  for (const sale of sales) {
    if (!isValidCombination(sale.deviceType, sale.color)) continue;
    const key = [sale.deviceType, sale.color, sale.saleType, sale.customerType].join('|');
    const existing = counts.get(key);
    if (existing === undefined) {
      counts.set(key, {
        deviceType: sale.deviceType as DeviceType,
        color: sale.color as DeviceColor,
        saleType: sale.saleType,
        customerType: sale.customerType,
        count: 1,
      });
    } else {
      counts.set(key, { ...existing, count: existing.count + 1 });
    }
  }

  return [...counts.values()].sort((a, b) => b.count - a.count).slice(0, limit);
}

/**
 * Recent sales for one promoter, used to seed the shortcuts.
 *
 * Looks back across days rather than only the current session, so the tiles are
 * useful on the first sale of a shift instead of appearing only after the
 * promoter has already done the long version once.
 */
export async function listRecentForPromoter(
  promoterId: string,
  since: BusinessDate,
): Promise<Result<Sale[]>> {
  const { data, error } = await db
    .from('sell_operations')
    .select(SALE_COLUMNS)
    .eq('promoter_id', promoterId)
    .gte('work_date', since)
    .order('created_at', { ascending: false })
    .limit(200);

  if (error) return failFrom(error, { action: 'قراءة المبيعات الأخيرة' });
  return ok((data ?? []).map(parseSale).filter((s): s is Sale => s !== null));
}

export interface NewSale {
  /** The session this sale belongs to. Supplies both promoter and work date. */
  readonly attendanceId: number;
  readonly promoterId: string;
  /** Must equal the parent attendance row's `work_date`. */
  readonly workDate: BusinessDate;
  readonly deviceType: DeviceType;
  readonly color: DeviceColor;
  readonly saleType: SaleTypeValue;
  readonly customerType: CustomerTypeValue;
}

/**
 * Validates a sale without touching the database. Exposed so the UI can block
 * an invalid tap and explain why, rather than letting one be composed and then
 * rejected on submit.
 */
export function validateSale(sale: NewSale): string | null {
  if (!isValidCombination(sale.deviceType, sale.color)) {
    return `${sale.deviceType} لا يتوفر باللون ${sale.color}`;
  }
  if (!isValidSalePair(sale.customerType, sale.saleType)) {
    return 'عروض MGM لعملاء LAS فقط';
  }
  return null;
}

/**
 * Records one sale. Quantity is always 1 by design — three devices sold means
 * three rows, which keeps the device and colour breakdowns exact.
 *
 * `clientOpId` identifies this logical sale across every attempt at writing it.
 * It belongs here rather than on {@link NewSale} because it describes the
 * *write*, not the sale: the same sale retried is one id, and the caller mints
 * it before this first attempt so that a failure which lands in the offline
 * queue keeps the same id. Omitting it preserves the previous behaviour
 * exactly, which is what the supervisor's paths still do.
 */
export async function create(
  sale: NewSale,
  clientOpId?: string,
): Promise<Result<Sale>> {
  const problem = validateSale(sale);
  if (problem !== null) return invalid(problem);

  const { data, error } = await insertIdempotently(
    {
      attendance_id: sale.attendanceId,
      promoter_id: sale.promoterId,
      work_date: sale.workDate,
      device_type: sale.deviceType,
      color: sale.color,
      sale_type: sale.saleType,
      customer_type: sale.customerType,
      quantity: 1,
    },
    clientOpId,
    (row) => db.from('sell_operations').insert(row).select(SALE_COLUMNS).single(),
  );

  if (error) {
    return failFrom(error, {
      action: 'تسجيل البيع',
      overrides: {
        // Composite FK onto device_catalog — a casing or catalog mismatch.
        '23503': 'هذا الجهاز بهذا اللون غير موجود في الكتالوج — حدّث الصفحة',
        '23514': 'عروض MGM لعملاء LAS فقط',
      },
    });
  }

  const parsed = parseSale(data);
  return parsed === null
    ? invalid('سُجّل البيع لكن تعذّرت قراءته — حدّث الصفحة')
    : ok(parsed);
}

/**
 * Removes a single sale row, scoped to its owner so a promoter can only delete
 * their own. Grouped rows show a count; this removes one unit of that group.
 */
export async function removeOne(saleId: number, promoterId: string): Promise<Result<true>> {
  const { error } = await db
    .from('sell_operations')
    .delete()
    .eq('id', saleId)
    .eq('promoter_id', promoterId);

  if (error) return failFrom(error, { action: 'حذف العملية' });
  return ok(true);
}

/** Supervisor delete — unscoped by promoter, still bounded by RLS to their city. */
export async function removeAsSupervisor(saleId: number): Promise<Result<true>> {
  const { error } = await db.from('sell_operations').delete().eq('id', saleId);
  if (error) return failFrom(error, { action: 'حذف العملية' });
  return ok(true);
}
