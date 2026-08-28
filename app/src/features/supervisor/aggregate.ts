/**
 * Aggregations for the supervisor surface.
 *
 * Pure, because these produce the numbers the team acts on. A wrong
 * achievement percentage looks exactly like a right one — there is no crash, no
 * blank screen, just a figure someone uses to judge a promoter. The rules
 * encoded here are the ones that have been broken before:
 *
 *  - Only LAS counts toward target. LAU is tracked and displayed, never scored.
 *  - Target accumulates only on `work` days, so a promoter's monthly target is
 *    the sum across days they actually worked, not a fixed number.
 *  - `SK+MGM` counts in both the SK and MGM columns, so those totals can exceed
 *    the number of sales. That is deliberate and matches what the team reads.
 */

import { achievementPercent } from '../../domain/rules';
import { shortOutletName } from '../../domain/text';
import type { CustomerType, SaleType, Shift } from '../../domain/values';

export interface AggregateSale {
  readonly promoterId: string;
  readonly promoterName: string;
  readonly outletName: string;
  readonly deviceType: string;
  readonly color: string;
  readonly saleType: SaleType;
  readonly customerType: CustomerType;
}

export interface NamedTotals {
  readonly name: string;
  readonly las: number;
  readonly lau: number;
  readonly sk: number;
  readonly mgm: number;
  readonly ld: number;
}

export interface CountedItem {
  readonly label: string;
  readonly count: number;
}

export interface SalesAggregate {
  readonly byPromoter: readonly NamedTotals[];
  readonly byOutlet: readonly NamedTotals[];
  readonly byDevice: readonly CountedItem[];
  readonly byColor: readonly CountedItem[];
  readonly las: number;
  readonly lau: number;
  readonly total: number;
}

function blank(name: string): NamedTotals {
  return { name, las: 0, lau: 0, sk: 0, mgm: 0, ld: 0 };
}

function add(totals: NamedTotals, sale: AggregateSale): NamedTotals {
  return {
    name: totals.name,
    las: totals.las + (sale.customerType === 'LAS' ? 1 : 0),
    lau: totals.lau + (sale.customerType === 'LAU' ? 1 : 0),
    sk: totals.sk + (sale.saleType === 'SK' || sale.saleType === 'SK+MGM' ? 1 : 0),
    mgm: totals.mgm + (sale.saleType === 'MGM' || sale.saleType === 'SK+MGM' ? 1 : 0),
    ld: totals.ld + (sale.saleType === 'LD' ? 1 : 0),
  };
}

/** Everything the dashboard and the period summary need from a set of sales. */
export function aggregateSales(sales: readonly AggregateSale[]): SalesAggregate {
  const byPromoter = new Map<string, NamedTotals>();
  const byOutlet = new Map<string, NamedTotals>();
  const byDevice = new Map<string, number>();
  const byColor = new Map<string, number>();

  for (const sale of sales) {
    byPromoter.set(sale.promoterName, add(byPromoter.get(sale.promoterName) ?? blank(sale.promoterName), sale));
    byOutlet.set(sale.outletName, add(byOutlet.get(sale.outletName) ?? blank(sale.outletName), sale));
    byDevice.set(sale.deviceType, (byDevice.get(sale.deviceType) ?? 0) + 1);
    const colorKey = `${sale.deviceType} — ${sale.color}`;
    byColor.set(colorKey, (byColor.get(colorKey) ?? 0) + 1);
  }

  const las = sales.filter((sale) => sale.customerType === 'LAS').length;

  const rank = (totals: Map<string, NamedTotals>): NamedTotals[] =>
    [...totals.values()].sort((a, b) => b.las - a.las || a.name.localeCompare(b.name));

  const count = (map: Map<string, number>): CountedItem[] =>
    [...map.entries()]
      .map(([label, n]) => ({ label, count: n }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));

  return {
    byPromoter: rank(byPromoter),
    byOutlet: rank(byOutlet),
    byDevice: count(byDevice),
    byColor: count(byColor),
    las,
    lau: sales.length - las,
    total: sales.length,
  };
}

// ---------------------------------------------------------------------------
// Compliance: days logged and achievement, month to date
// ---------------------------------------------------------------------------

export interface ComplianceAttendance {
  readonly promoterId: string;
  readonly workDate: string;
  readonly touchPointId: number | null;
  readonly shift: Shift | null;
  readonly isWork: boolean;
}

export interface ComplianceInput {
  readonly promoters: readonly { id: string; fullName: string }[];
  readonly attendance: readonly ComplianceAttendance[];
  /** LAS counts only, keyed by promoter id. */
  readonly lasByPromoter: ReadonlyMap<string, number>;
  /** Daily target by `outletId-shift`. */
  readonly dailyTargets: ReadonlyMap<string, number>;
  /** Days elapsed in the business month, the denominator for days logged. */
  readonly elapsedDays: number;
}

export interface ComplianceRow {
  readonly promoterId: string;
  readonly fullName: string;
  /** Distinct dates with any attendance row. */
  readonly daysLogged: number;
  readonly elapsedDays: number;
  readonly las: number;
  /** Accumulated across worked days only. */
  readonly target: number;
  readonly achievement: number | null;
  readonly complete: boolean;
}

/**
 * Per-promoter compliance, least compliant first — the supervisor is looking
 * for who to chase, so the top of the list should be the answer.
 */
export function aggregateCompliance(input: ComplianceInput): readonly ComplianceRow[] {
  const { promoters, attendance, lasByPromoter, dailyTargets, elapsedDays } = input;

  const dates = new Map<string, Set<string>>();
  const targets = new Map<string, number>();

  for (const row of attendance) {
    const seen = dates.get(row.promoterId) ?? new Set<string>();
    seen.add(row.workDate);
    dates.set(row.promoterId, seen);

    // Only a worked day carries a target. A day off contributes nothing to
    // either side of the ratio.
    if (!row.isWork || row.touchPointId === null || row.shift === null) continue;
    const target = dailyTargets.get(`${row.touchPointId}-${row.shift}`) ?? 0;
    targets.set(row.promoterId, (targets.get(row.promoterId) ?? 0) + target);
  }

  return promoters
    .map((promoter) => {
      const daysLogged = dates.get(promoter.id)?.size ?? 0;
      const las = lasByPromoter.get(promoter.id) ?? 0;
      const target = Math.round((targets.get(promoter.id) ?? 0) * 100) / 100;
      return {
        promoterId: promoter.id,
        fullName: promoter.fullName,
        daysLogged,
        elapsedDays,
        las,
        target,
        achievement: achievementPercent(las, target),
        complete: daysLogged >= elapsedDays,
      };
    })
    .sort((a, b) => a.daysLogged - b.daysLogged || a.fullName.localeCompare(b.fullName));
}

/** Convenience for the period summary, which wants outlet display names. */
export function toOutletSummary(
  aggregate: SalesAggregate,
): readonly { name: string; las: number; lau: number }[] {
  return aggregate.byOutlet.map((outlet) => ({
    name: outlet.name,
    las: outlet.las,
    lau: outlet.lau,
  }));
}

/** The display label for an outlet row. */
export const outletLabel = (name: string): string => shortOutletName(name);
