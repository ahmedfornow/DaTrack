/**
 * One row per promoter: where they are today and how they are doing.
 *
 * Built for the manager, who wants the whole team on one screen rather than
 * three tabs and some arithmetic. It reads top to bottom in the order work
 * needs doing — whoever has not registered is first, then whoever is furthest
 * behind today's target.
 *
 * Two numbers sit side by side on purpose. Today answers "is this shift going
 * well"; the month answers "is this person going well". They are different
 * questions and the second one is easy to lose sight of mid-shift.
 */

import { ATTENDANCE_STATUS_LABEL, SHIFT_LABEL } from '../../domain/labels';
import { shortOutletName } from '../../domain/text';
import type { DailyActivityRow } from './dailyActivity';
import { totalsFor } from './dailyActivity';

export interface DailyActivityPanelProps {
  readonly rows: readonly DailyActivityRow[];
  readonly loading: boolean;
}

/** The three-colour scale used everywhere: >=100 green, >=70 gold, below red. */
function band(done: number, target: number | null): string {
  if (target === null || target <= 0) return 'text-muted';
  const percent = (done / target) * 100;
  if (percent >= 100) return 'text-achieved';
  if (percent >= 70) return 'text-close';
  return 'text-behind';
}

function barColor(done: number, target: number | null): string {
  if (target === null || target <= 0) return 'bg-absent';
  const percent = (done / target) * 100;
  if (percent >= 100) return 'bg-achieved';
  if (percent >= 70) return 'bg-close';
  return 'bg-behind';
}

export function DailyActivityPanel({ rows, loading }: DailyActivityPanelProps) {
  if (loading) {
    return (
      <section className="rounded-card border border-line bg-surface p-4">
        <p className="py-6 text-center text-sm text-faint">جاري التحميل…</p>
      </section>
    );
  }

  const totals = totalsFor(rows);

  return (
    <section className="rounded-card border border-line bg-surface p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-md font-bold text-ink">نشاط اليوم</h2>
        <span className="tabular text-xs text-muted" dir="ltr">
          {rows.length}
        </span>
      </div>

      {/* The day in one line, before any of the detail. */}
      <div className="mb-3 grid grid-cols-4 gap-2">
        <Summary label="دوام" value={totals.working} tone="text-ink" />
        <Summary label="إجازة" value={totals.off} tone="text-muted" />
        <Summary
          label="لم يسجل"
          value={totals.unregistered}
          tone={totals.unregistered > 0 ? 'text-behind' : 'text-muted'}
        />
        <Summary
          label="LAS"
          value={totals.todayLas}
          tone={band(totals.todayLas, totals.target > 0 ? totals.target : null)}
        />
      </div>

      {rows.length === 0 ? (
        <p className="py-6 text-center text-sm text-faint">لا مندوبين في هذه المدينة</p>
      ) : (
        <ul className="space-y-2">
          {rows.map((row) => {
            const percent =
              row.target !== null && row.target > 0
                ? Math.min(100, Math.round((row.todayLas / row.target) * 100))
                : 0;

            return (
              <li
                key={row.promoterId}
                className="rounded-control border border-line-soft bg-surface-raised px-3 py-2"
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-sm font-bold text-ink">{row.fullName}</span>
                  <span className="tabular shrink-0 text-sm" dir="ltr">
                    <span className={band(row.todayLas, row.target)}>{row.todayLas}</span>
                    <span className="text-faint">
                      {row.target !== null ? ` / ${row.target}` : ' / —'}
                    </span>
                  </span>
                </div>

                <div className="mt-0.5 flex items-center justify-between gap-2">
                  <span className="truncate text-xs text-muted">
                    {row.status === null ? (
                      <span className="text-behind">لم يسجل اليوم</span>
                    ) : row.status === 'work' ? (
                      <>
                        {row.outletName !== null ? shortOutletName(row.outletName) : '—'}
                        {row.shift !== null && ` · ${SHIFT_LABEL[row.shift]}`}
                      </>
                    ) : (
                      ATTENDANCE_STATUS_LABEL[row.status]
                    )}
                  </span>

                  {/* Month-to-date, so a good day at the end of a bad month
                      cannot read as a good month. */}
                  <span className="tabular shrink-0 text-xs text-faint" dir="ltr">
                    {row.monthLas}
                    {row.monthTarget > 0 && ` / ${Math.round(row.monthTarget)}`}
                    <span className="text-muted"> شهرياً</span>
                  </span>
                </div>

                <div
                  className="mt-1.5 h-1 overflow-hidden rounded-full bg-surface-sunken"
                  role="presentation"
                >
                  <div
                    className={`h-full rounded-full ${barColor(row.todayLas, row.target)}`}
                    style={{ width: `${percent}%` }}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function Summary({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="rounded-control border border-line-soft bg-surface-raised px-2 py-1.5 text-center">
      <span className={`tabular block text-lg font-bold ${tone}`} dir="ltr">
        {value}
      </span>
      <span className="block text-xs text-muted">{label}</span>
    </div>
  );
}
