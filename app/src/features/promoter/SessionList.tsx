/**
 * The sales logged in this session, grouped.
 *
 * Identical sales collapse into one row with a count, because a promoter who
 * sold four of the same device wants to see "4", not four identical lines to
 * scroll past. The delete affordance removes a single unit of the group, which
 * the label says explicitly — the legacy trash icon sat next to a count and
 * looked like it would remove all of them.
 */

import { shortNameOf } from '../../domain/devices';
import { groupSales, summarize, type Sale } from '../../data/sales';
import { Swatch } from './Swatch';

export interface SessionListProps {
  readonly sales: readonly Sale[];
  readonly onRemoveOne: (saleId: number) => void;
  readonly busy: boolean;
}

export function SessionList({ sales, onRemoveOne, busy }: SessionListProps) {
  if (sales.length === 0) {
    return (
      <p className="rounded-card border border-dashed border-line-soft px-4 py-6 text-center text-sm text-faint">
        لا مبيعات بعد
      </p>
    );
  }

  const groups = groupSales(sales);
  const totals = summarize(sales);

  // Quieter than the tiles above on purpose: this list is for checking, and the
  // tiles are for acting. Rows are separated by rules rather than boxed.
  return (
    <section>
      <div className="mb-1 flex items-baseline justify-between gap-3">
        <h2 className="text-md font-bold text-ink">مبيعات الجلسة</h2>
        <p className="tabular text-xs text-faint" dir="ltr">
          SK {totals.sk} · MGM {totals.mgm} · LD {totals.ld} · LAU {totals.lau}
        </p>
      </div>

      <ul>
        {groups.map((group) => {
          const last = group.ids[group.ids.length - 1];
          return (
            <li
              key={group.key}
              className="flex items-center gap-3 border-b border-line-soft py-2"
            >
              <Swatch color={group.color} className="h-4.5 w-4.5" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-right text-sm text-ink" dir="ltr">
                  <span className="font-bold">{shortNameOf(group.deviceType)}</span>
                  <span className="mx-1 text-faint">—</span>
                  {group.color}
                </p>
                <p className="text-right text-xs text-faint" dir="ltr">
                  {group.saleType} · {group.customerType}
                </p>
              </div>

              <div className="flex shrink-0 items-center gap-2">
                <span className="tabular min-w-6 text-center text-md font-bold text-gold">
                  {group.count}
                </span>
                <button
                  type="button"
                  disabled={busy || last === undefined}
                  onClick={() => {
                    if (last !== undefined) onRemoveOne(last);
                  }}
                  aria-label={`حذف عملية واحدة من ${shortNameOf(group.deviceType)} ${group.color}`}
                  className="min-h-tap w-11 rounded-control border border-line text-sm text-muted disabled:opacity-40"
                >
                  {/* LTR and Latin digits, matching the count pill beside it.
                      Written as `−١` inside the RTL row it rendered as `١−`,
                      which reads as a garbled symbol rather than "remove one". */}
                  <span dir="ltr">−1</span>
                </button>
              </div>
            </li>
          );
        })}
      </ul>

      <p className="mt-3 text-center text-xs text-faint">
        <span className="tabular">{totals.total}</span> عملية ·{' '}
        <span className="tabular">{groups.length}</span> صنف
      </p>
    </section>
  );
}
