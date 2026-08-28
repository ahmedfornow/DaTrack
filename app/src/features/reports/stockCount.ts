/**
 * The stock count message — report #2.
 *
 * Built from values rather than from form elements. The legacy generator reads
 * the DOM inputs directly, so after a page reload — when the inputs render
 * blank because saved counts are never loaded — it copies out a message with
 * every quantity empty. It looks complete and says nothing.
 *
 * Grouping matches the legacy string-matching on `item_name`, because the
 * catalog is named to suit it and the headings the team reads depend on it:
 *
 *   PRIME        -> IQOS ILUMA PRIME i
 *   "ILUMA i —"  -> IQOS ILUMA i        (the em dash is what excludes ONE/PRIME)
 *   ONE          -> IQOS ILUMA i ONE
 *   TEREA        -> STARTER KITS
 *
 * Separator lengths differ between the device groups (8 underscores) and the
 * starter kits (7). That asymmetry is in the legacy output, so it is reproduced
 * rather than tidied — the team reads these daily and a changed shape reads as
 * a changed report.
 */

import { formatReportDate, type BusinessDate } from '../../lib/businessDay';
import { forReport } from '../../domain/text';
import type { StockItem } from '../../data/stock';

const GROUP_SEPARATOR = '_'.repeat(8);
const KITS_SEPARATOR = '_'.repeat(7);

export interface StockMessageInput {
  readonly outletName: string;
  readonly workDate: BusinessDate;
  readonly catalog: readonly StockItem[];
  /** Item id to quantity. A missing entry prints as blank, matching legacy. */
  readonly quantities: ReadonlyMap<number, number>;
}

/** The colour or flavour part: everything after the last em dash, uppercased. */
function colorOnly(itemName: string): string {
  const parts = itemName.split('—');
  const tail = parts[parts.length - 1] ?? itemName;
  return forReport(tail, 40).toUpperCase();
}

export function buildStockMessage(input: StockMessageInput): string {
  const { outletName, workDate, catalog, quantities } = input;

  const value = (itemId: number): string => {
    const quantity = quantities.get(itemId);
    // Blank, not zero: an uncounted item and an item counted zero are
    // different facts, and the legacy message prints the former as empty.
    return quantity === undefined ? '' : String(quantity);
  };

  const lines: string[] = [
    `Date: ${formatReportDate(workDate)}`,
    `Outlet: ${forReport(outletName, 70)}`,
  ];

  const group = (heading: string, items: readonly StockItem[]): void => {
    lines.push(GROUP_SEPARATOR);
    lines.push(`${heading}:`);
    for (const item of items) {
      lines.push(`${colorOnly(item.itemName)}: ${value(item.id)}`);
    }
  };

  group(
    'IQOS ILUMA PRIME i',
    catalog.filter((item) => item.itemName.includes('PRIME')),
  );
  group(
    'IQOS ILUMA i',
    catalog.filter((item) => item.itemName.includes('ILUMA i —')),
  );
  group(
    'IQOS ILUMA i ONE',
    catalog.filter((item) => item.itemName.includes('ONE')),
  );

  lines.push(KITS_SEPARATOR);
  lines.push('STARTER KITS');
  lines.push('');
  for (const item of catalog.filter((i) => i.itemName.includes('TEREA'))) {
    const flavour = forReport(item.itemName.replace('TEREA ', ''), 40).toUpperCase();
    lines.push(`${flavour}: ${value(item.id)}`);
  }

  return lines.join('\n');
}

/** How much of the catalog has actually been counted — shown before copying. */
export function countedSummary(
  catalog: readonly StockItem[],
  quantities: ReadonlyMap<number, number>,
): { counted: number; total: number; complete: boolean } {
  const counted = catalog.filter((item) => quantities.has(item.id)).length;
  return { counted, total: catalog.length, complete: counted === catalog.length };
}
