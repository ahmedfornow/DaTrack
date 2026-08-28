/**
 * Stock counts (`stock_catalog` + `stock_reports`).
 *
 * Two live bugs shaped this module.
 *
 * The legacy screen never pre-fills saved quantities: re-opening the stock tab
 * always renders empty inputs. The data is safe in `stock_reports`, but the
 * promoter sees nothing and cannot tell a saved count from an unsaved one.
 *
 * Worse, the legacy stock message reads the *DOM inputs* rather than the
 * database. After a page reload those inputs are blank, so the message copied
 * into WhatsApp prints every item with an empty value — a report that looks
 * filled in and says nothing.
 *
 * Both follow from the same mistake: treating the form as the source of truth.
 * Here the saved counts are loaded with the catalog, and the message is built
 * from values, not from elements.
 */

import { db } from '../lib/supabase';
import { StockCategory, type StockCategory as StockCategoryValue } from '../domain/values';
import { failFrom, invalid, ok, type Result } from './errors';

const CATALOG_COLUMNS = 'id, item_name, category, sort_order, active';
const REPORT_COLUMNS = 'id, attendance_id, promoter_id, item_id, quantity, reported_at';

export interface StockItem {
  readonly id: number;
  readonly itemName: string;
  readonly category: StockCategoryValue;
  readonly sortOrder: number;
}

export interface StockCount {
  readonly itemId: number;
  readonly quantity: number;
  readonly reportedAt: string | null;
}

type Row = Record<string, unknown>;

export function parseStockItem(row: unknown): StockItem | null {
  if (row === null || row === undefined || typeof row !== 'object') return null;
  const record = row as Row;

  const id = record['id'];
  const itemName = record['item_name'];
  const category = StockCategory.tryParse(record['category']);
  if (typeof id !== 'number') return null;
  if (typeof itemName !== 'string' || itemName === '') return null;
  if (category === null) return null;

  const sortOrder = record['sort_order'];
  return {
    id,
    itemName,
    category,
    sortOrder: typeof sortOrder === 'number' ? sortOrder : 0,
  };
}

export function parseStockCount(row: unknown): StockCount | null {
  if (row === null || row === undefined || typeof row !== 'object') return null;
  const record = row as Row;

  const itemId = record['item_id'];
  const quantity = record['quantity'];
  if (typeof itemId !== 'number') return null;
  if (typeof quantity !== 'number') return null;

  const reportedAt = record['reported_at'];
  return {
    itemId,
    quantity,
    reportedAt: typeof reportedAt === 'string' ? reportedAt : null,
  };
}

/** The active catalog, in display order. */
export async function listCatalog(): Promise<Result<StockItem[]>> {
  const { data, error } = await db
    .from('stock_catalog')
    .select(CATALOG_COLUMNS)
    .eq('active', true)
    .order('sort_order');

  if (error) return failFrom(error, { action: 'قراءة أصناف المخزون' });
  return ok((data ?? []).map(parseStockItem).filter((i): i is StockItem => i !== null));
}

/**
 * What was already counted for this session.
 *
 * This is the query the legacy app never makes, and its absence is why the
 * inputs render blank and the message comes out empty.
 */
export async function countsForSession(attendanceId: number): Promise<Result<StockCount[]>> {
  const { data, error } = await db
    .from('stock_reports')
    .select(REPORT_COLUMNS)
    .eq('attendance_id', attendanceId);

  if (error) return failFrom(error, { action: 'قراءة الجرد المحفوظ' });
  return ok((data ?? []).map(parseStockCount).filter((c): c is StockCount => c !== null));
}

/** Saved counts keyed by item id, for pre-filling the form. */
export function indexCounts(counts: readonly StockCount[]): ReadonlyMap<number, number> {
  return new Map(counts.map((count) => [count.itemId, count.quantity]));
}

export interface StockEntry {
  readonly itemId: number;
  readonly quantity: number;
}

/**
 * Saves the counts entered. Upserts on (attendance_id, item_id), so re-saving
 * corrects a figure rather than duplicating it.
 *
 * Only entries the promoter actually filled in are written. A blank field means
 * "not counted", which is different from "counted zero" — writing 0 for every
 * untouched row would fabricate a complete stocktake out of a partial one.
 */
export async function saveCounts(
  attendanceId: number,
  promoterId: string,
  entries: readonly StockEntry[],
): Promise<Result<number>> {
  const rows = entries
    .filter((entry) => Number.isInteger(entry.quantity) && entry.quantity >= 0)
    .map((entry) => ({
      attendance_id: attendanceId,
      promoter_id: promoterId,
      item_id: entry.itemId,
      quantity: entry.quantity,
    }));

  if (rows.length === 0) return invalid('أدخل كمية لصنف واحد على الأقل');

  const { error } = await db
    .from('stock_reports')
    .upsert(rows, { onConflict: 'attendance_id,item_id' });

  if (error) {
    return failFrom(error, {
      action: 'حفظ الجرد',
      overrides: { '23514': 'الكمية يجب أن تكون صفراً أو أكثر' },
    });
  }
  return ok(rows.length);
}
