/**
 * The month CSV — report #4.
 *
 * The one report that downloads rather than being copied. It opens in Excel on
 * a Windows machine, which drives two details:
 *
 *  - A UTF-8 BOM leads the file. Without it Excel reads the Arabic promoter
 *    names as mojibake.
 *  - Every cell is quoted and embedded quotes are doubled, so an outlet name
 *    containing a comma cannot shift every column after it.
 *
 * Timestamps render in KSA time explicitly. The legacy export uses
 * `toLocaleString('en-GB')`, which reads the exporting device's timezone — the
 * same month exported from a laptop set to UTC would shift every row by three
 * hours, and nothing on the page would say so.
 */

import { ksaTimestamp, type BusinessDate, type BusinessMonth } from '../../lib/businessDay';
import { oneLine } from '../../domain/text';
import type { Shift } from '../../domain/values';

export const CSV_HEADERS = [
  'Date',
  'Promoter',
  'Outlet',
  'Shift',
  'Device',
  'Color',
  'Sale Type',
  'Customer',
  'Entered At',
] as const;

export interface CsvRow {
  readonly workDate: BusinessDate;
  readonly promoterName: string;
  readonly outletName: string;
  readonly shift: Shift;
  readonly deviceType: string;
  readonly color: string;
  readonly saleType: string;
  readonly customerType: string;
  /** ISO timestamp from `created_at`; rendered in KSA time. */
  readonly createdAt: string | null;
}

/** Quotes a cell and doubles any embedded quote, per RFC 4180. */
function cell(value: unknown): string {
  const text = oneLine(value, 200);
  return `"${text.replace(/"/gu, '""')}"`;
}

/** The CSV body, without the BOM. Exposed separately so tests can read it. */
export function buildMonthCsvBody(rows: readonly CsvRow[]): string {
  const lines: string[] = [CSV_HEADERS.map(cell).join(',')];

  for (const row of rows) {
    lines.push(
      [
        cell(row.workDate),
        cell(row.promoterName),
        cell(row.outletName),
        cell(row.shift),
        cell(row.deviceType),
        cell(row.color),
        cell(row.saleType),
        cell(row.customerType),
        cell(row.createdAt === null ? '' : ksaTimestamp(Date.parse(row.createdAt))),
      ].join(','),
    );
  }

  return lines.join('\n');
}

/** The complete file contents, BOM included. */
export function buildMonthCsv(rows: readonly CsvRow[]): string {
  return `﻿${buildMonthCsvBody(rows)}`;
}

/** `DaTracker_<city>_<YYYY-MM>.csv`, with anything path-unsafe removed. */
export function monthCsvFilename(city: string, month: BusinessMonth): string {
  const safeCity = oneLine(city, 40).replace(/[^\p{L}\p{N}_-]+/gu, '_');
  return `DaTracker_${safeCity}_${month}.csv`;
}
