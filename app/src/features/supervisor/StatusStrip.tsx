/**
 * The status strip: what needs attention, before any totals.
 *
 * Four groups, ordered by how quickly they go stale. An unreported promoter at
 * 9am is a phone call; a missing target is a job for later in the week. Each
 * group collapses to nothing when it is empty, so a clear morning shows a
 * single line rather than four empty headings.
 */

import { formatReportDate, type BusinessDate } from '../../lib/businessDay';
import { SHIFT_LABEL } from '../../domain/labels';
import type { StatusReport } from './status';

export interface StatusStripProps {
  readonly status: StatusReport;
  readonly date: BusinessDate;
  readonly city: string;
  readonly loading: boolean;
}

export function StatusStrip({ status, date, city, loading }: StatusStripProps) {
  if (loading) {
    return (
      <section className="rounded-card border border-line bg-surface p-4">
        <p className="text-sm text-muted" aria-live="polite">
          جاري فحص اليوم…
        </p>
      </section>
    );
  }

  const { notReported, unstaffed, missingTargets, checklistGaps } = status;

  return (
    <section className="rounded-card border border-line bg-surface p-4">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-md font-bold text-ink">وضع اليوم</h2>
        <p className="tabular text-xs text-muted" dir="ltr">
          {formatReportDate(date)} · {city}
        </p>
      </div>

      {status.allClear ? (
        <p className="mt-3 rounded-control border border-achieved/25 bg-achieved/8 px-3 py-2 text-sm text-achieved">
          كل شيء تمام — الجميع سجّل، وكل المواقع مغطاة
        </p>
      ) : (
        <div className="mt-3 space-y-3">
          <Group
            tone="behind"
            title="لم يسجّلوا اليوم"
            count={notReported.length}
            items={notReported.map((promoter) => promoter.fullName)}
          />
          <Group
            tone="behind"
            title="مواقع بدون تغطية"
            count={unstaffed.length}
            items={unstaffed.map((slot) => `${slot.outletName} — ${SHIFT_LABEL[slot.shift]}`)}
          />
          <Group
            tone="close"
            title="لم يكملوا التشيك ليست"
            count={checklistGaps.length}
            items={checklistGaps.map((gap) => `${gap.fullName} (${gap.done}/${gap.total})`)}
          />
          <Group
            tone="close"
            title="بدون هدف هذا الشهر"
            count={missingTargets.length}
            items={missingTargets.map((slot) => `${slot.outletName} — ${SHIFT_LABEL[slot.shift]}`)}
          />
        </div>
      )}
    </section>
  );
}

function Group({
  tone,
  title,
  count,
  items,
}: {
  tone: 'behind' | 'close';
  title: string;
  count: number;
  items: readonly string[];
}) {
  if (count === 0) return null;

  const color = tone === 'behind' ? 'text-behind' : 'text-close';
  const border = tone === 'behind' ? 'border-behind/30' : 'border-close/30';
  const background = tone === 'behind' ? 'bg-behind/8' : 'bg-close/8';

  return (
    <div className={`rounded-control border ${border} ${background} px-3 py-2`}>
      <div className="flex items-baseline justify-between gap-3">
        <p className={`text-sm font-bold ${color}`}>{title}</p>
        <span className={`tabular text-sm font-bold ${color}`} dir="ltr">
          {count}
        </span>
      </div>
      <ul className="mt-1 space-y-0.5">
        {items.map((item) => (
          <li key={item} className="truncate text-xs text-muted">
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}
