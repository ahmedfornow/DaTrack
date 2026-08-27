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

  return (
    <section>
      <div className="mb-2 flex items-baseline justify-between">
        <h2 className="text-xs tracking-wide text-muted">عمليات الجلسة</h2>
        <p className="tabular text-xs text-muted" dir="ltr">
          SK {totals.sk} · MGM {totals.mgm} · LD {totals.ld} · LAU {totals.lau}
        </p>
      </div>

      <ul className="space-y-2">
        {groups.map((group) => {
          const last = group.ids[group.ids.length - 1];
          return (
            <li
              key={group.key}
              className="flex items-center justify-between gap-3 rounded-control border border-line-soft bg-surface-raised px-3 py-2.5"
            >
              <div className="min-w-0">
                <p className="truncate text-sm text-ink">
                  <span className="font-bold">{shortNameOf(group.deviceType)}</span>
                  <span className="mx-1 text-faint">—</span>
                  <span dir="ltr">{group.color}</span>
                </p>
                <p className="mt-0.5 text-xs text-muted" dir="ltr">
                  {group.saleType} · {group.customerType}
                </p>
              </div>

              <div className="flex shrink-0 items-center gap-2">
                <span className="tabular flex h-7 min-w-7 items-center justify-center rounded-lg bg-gold/12 px-2 text-sm font-bold text-gold">
                  {group.count}
                </span>
                <button
                  type="button"
                  disabled={busy || last === undefined}
                  onClick={() => {
                    if (last !== undefined) onRemoveOne(last);
                  }}
                  aria-label={`حذف عملية واحدة من ${shortNameOf(group.deviceType)} ${group.color}`}
                  className="min-h-tap w-11 rounded-control border border-line-soft text-behind disabled:opacity-40"
                >
                  −١
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
