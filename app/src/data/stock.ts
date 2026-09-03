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

// ---------------------------------------------------------------------------
// Supervisor read-back: what has actually been counted, by outlet
// ---------------------------------------------------------------------------

/**
 * One item's latest count at an outlet.
 *
 * `itemName` keeps the catalog's full name; shortening for display is the
 * view's job, the same way outlet names are handled everywhere else.
 */
export interface OutletStockLine {
  readonly itemId: number;
  readonly itemName: string;
  readonly quantity: number;
  readonly reportedAt: string | null;
}

export interface OutletStockReport {
  /** Full raw `touch_points.name`, so the caller can shorten it consistently. */
  readonly outlet: string;
  readonly lines: readonly OutletStockLine[];
  readonly itemCount: number;
  /** Summed from the lines that actually print, so the two can never disagree. */
  readonly totalUnits: number;
  readonly lastReportedAt: string | null;
}

/** A raw joined row, before grouping. Exported so tests can build one. */
export interface StockReportRow {
  readonly outlet: string;
  readonly itemId: number;
  readonly itemName: string;
  readonly quantity: number;
  readonly reportedAt: string | null;
}

/**
 * Groups raw rows into one block per outlet, keeping only the newest count for
 * each item.
 *
 * That last part is a deliberate departure from the legacy screen, which lists
 * every row it fetched. Over a month that prints the same item once per day —
 * twenty rows deep, oldest values indistinguishable from current ones — which
 * does not answer the question the screen exists to answer. A supervisor
 * looking at stock wants to know what is on the shelf now, so each item appears
 * once, at its most recent figure.
 *
 * Input must be ordered newest-first; the first row seen for an item wins.
 * Outlets are ordered by most recent activity, so whoever counted last is at
 * the top and an outlet that has gone quiet sinks.
 */
export function groupStockByOutlet(
  rows: readonly StockReportRow[],
): readonly OutletStockReport[] {
  const byOutlet = new Map<string, Map<number, OutletStockLine>>();

  for (const row of rows) {
    let items = byOutlet.get(row.outlet);
    if (items === undefined) {
      items = new Map();
      byOutlet.set(row.outlet, items);
    }
    // Newest-first input means an item already present is the fresher figure.
    if (!items.has(row.itemId)) {
      items.set(row.itemId, {
        itemId: row.itemId,
        itemName: row.itemName,
        quantity: row.quantity,
        reportedAt: row.reportedAt,
      });
    }
  }

  const reports: OutletStockReport[] = [];

  for (const [outlet, items] of byOutlet) {
    const lines = [...items.values()].sort((a, b) => a.itemName.localeCompare(b.itemName));
    let totalUnits = 0;
    let lastReportedAt: string | null = null;

    for (const line of lines) {
      totalUnits += line.quantity;
      if (line.reportedAt !== null && (lastReportedAt === null || line.reportedAt > lastReportedAt)) {
        lastReportedAt = line.reportedAt;
      }
    }

    reports.push({ outlet, lines, itemCount: lines.length, totalUnits, lastReportedAt });
  }

  return reports.sort((a, b) => {
    if (a.lastReportedAt === b.lastReportedAt) return a.outlet.localeCompare(b.outlet);
    if (a.lastReportedAt === null) return 1;
    if (b.lastReportedAt === null) return -1;
    return b.lastReportedAt.localeCompare(a.lastReportedAt);
  });
}

/** Parses one joined row, tolerating PostgREST returning an embed as an array. */
function parseReportRow(row: unknown): StockReportRow | null {
  if (row === null || row === undefined || typeof row !== 'object') return null;
  const record = row as Row;

  const embedded = (value: unknown): Row | null => {
    const inner = Array.isArray(value) ? value[0] : value;
    return inner !== null && typeof inner === 'object' ? (inner as Row) : null;
  };

  const item = embedded(record['stock_catalog']);
  const attendance = embedded(record['attendance']);
  const outletRow = attendance === null ? null : embedded(attendance['touch_points']);

  const itemId = record['item_id'];
  const quantity = record['quantity'];
  const reportedAt = record['reported_at'];
  const itemName = item?.['item_name'];
  const outlet = outletRow?.['name'];

  if (typeof itemId !== 'number' || typeof quantity !== 'number') return null;
  if (typeof itemName !== 'string' || itemName === '') return null;
  // A stock report always hangs off an attendance row that has an outlet, so a
  // row without one is malformed rather than a leave day — drop it instead of
  // inventing a bucket to file it under.
  if (typeof outlet !== 'string' || outlet === '') return null;

  return {
    outlet,
    itemId,
    itemName,
    quantity,
    reportedAt: typeof reportedAt === 'string' ? reportedAt : null,
  };
}

/**
 * The counts submitted in a period, city-scoped, grouped by outlet.
 *
 * City scoping is server-side through the attendance row's outlet, which is the
 * same join the sales queries use. Filtering only the outlet list and not the
 * rows is the mistake that has inflated supervisor figures before.
 */
export async function loadOutletCounts(
  city: string,
  since: string,
  limit = 2000,
): Promise<Result<readonly OutletStockReport[]>> {
  const { data, error } = await db
    .from('stock_reports')
    .select(
      'item_id, quantity, reported_at, stock_catalog(item_name), attendance!inner(touch_points!inner(name, city))',
    )
    .gte('reported_at', `${since}T00:00:00`)
    .eq('attendance.touch_points.city', city)
    .order('reported_at', { ascending: false })
    .limit(limit);

  if (error) return failFrom(error, { action: 'قراءة جرد المواقع' });

  const rows = (data ?? [])
    .map(parseReportRow)
    .filter((row): row is StockReportRow => row !== null);

  return ok(groupStockByOutlet(rows));
}
