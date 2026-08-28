/**
 * Every day of the current month, registered or not.
 *
 * Promoters forget to sign in and fix it later, so the missing days are the
 * point of this screen — they are listed explicitly rather than left as gaps to
 * notice. A registered work day offers a way into its session, which is how
 * sales get logged against a past day.
 */

import {
  businessDayOfMonth,
  businessMonth,
  weekdayIndex,
  type BusinessDate,
} from '../../lib/businessDay';
import { ATTENDANCE_STATUS_LABEL_WITH_ICON, SHIFT_LABEL, WEEKDAY_LABEL } from '../../domain/labels';
import { shortOutletName } from '../../domain/text';
import type { Session } from '../../data/attendance';

export interface MyDaysTabProps {
  readonly sessions: readonly Session[];
  readonly busy: boolean;
  readonly onOpenSession: (session: Session) => void;
  readonly onRegisterDay: (date: BusinessDate) => void;
  readonly onRemoveDay: (session: Session) => void;
}

export function MyDaysTab({
  sessions,
  busy,
  onOpenSession,
  onRegisterDay,
  onRemoveDay,
}: MyDaysTabProps) {
  const month = businessMonth();
  const today = businessDayOfMonth();

  const byDate = new Map<BusinessDate, Session[]>();
  for (const session of sessions) {
    const existing = byDate.get(session.workDate);
    if (existing === undefined) byDate.set(session.workDate, [session]);
    else existing.push(session);
  }

  // Newest first: the days most likely to need fixing are the recent ones.
  const days: BusinessDate[] = [];
  for (let day = today; day >= 1; day -= 1) {
    days.push(`${month}-${String(day).padStart(2, '0')}`);
  }

  const missing = days.filter((date) => !byDate.has(date)).length;

  return (
    <section className="space-y-3">
      <div className="rounded-card border border-line bg-surface p-4">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-md font-bold text-ink">سجل أيامي هذا الشهر</h2>
          <p
            className={`tabular text-xs ${missing === 0 ? 'text-achieved' : 'text-behind'}`}
            dir="ltr"
          >
            {days.length - missing}/{days.length}
          </p>
        </div>

        {missing > 0 && (
          <p className="mt-1 text-xs text-behind">
            {missing} {missing === 1 ? 'يوم غير مسجل' : 'أيام غير مسجلة'}
          </p>
        )}

        <ul className="mt-3 space-y-2">
          {days.map((date) => {
            const rows = byDate.get(date);
            const dayNumber = Number(date.slice(8, 10));
            const weekday = WEEKDAY_LABEL[weekdayIndex(date)] ?? '';

            if (rows === undefined) {
              return (
                <li
                  key={date}
                  className="flex items-center justify-between gap-3 rounded-control border border-dashed border-line-soft px-3 py-2"
                >
                  <div>
                    <p className="text-sm text-ink">
                      <span className="tabular font-bold">{dayNumber}</span>
                      <span className="mx-1 text-faint">—</span>
                      {weekday}
                    </p>
                    <p className="text-xs text-behind">غير مسجل</p>
                  </div>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => onRegisterDay(date)}
                    className="min-h-tap shrink-0 rounded-control border border-gold px-3 text-xs font-bold text-gold disabled:opacity-40"
                  >
                    تسجيل
                  </button>
                </li>
              );
            }

            return rows.map((session) => (
              <li
                key={session.id}
                className="flex items-center justify-between gap-3 rounded-control border border-line-soft bg-surface-raised px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="text-sm text-ink">
                    <span className="tabular font-bold">{dayNumber}</span>
                    <span className="mx-1 text-faint">—</span>
                    {weekday}
                  </p>
                  <p className="truncate text-xs text-muted">
                    {session.status === 'work' && session.workingShift !== null ? (
                      <>
                        {shortOutletName(session.outlet?.name ?? '')}
                        <span className="mx-1 text-faint">·</span>
                        {SHIFT_LABEL[session.workingShift]}
                        <span className="mx-1 text-faint">·</span>
                        <span className="tabular" dir="ltr">
                          GT {session.guidedTrials}
                        </span>
                      </>
                    ) : (
                      ATTENDANCE_STATUS_LABEL_WITH_ICON[session.status]
                    )}
                  </p>
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  {session.status === 'work' && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => onOpenSession(session)}
                      className="min-h-tap rounded-control border border-line px-3 text-xs text-gold disabled:opacity-40"
                    >
                      مبيعاته
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => onRemoveDay(session)}
                    aria-label={`حذف سجل يوم ${dayNumber}`}
                    className="min-h-tap w-11 rounded-control border border-line-soft text-behind disabled:opacity-40"
                  >
                    ✕
                  </button>
                </div>
              </li>
            ));
          })}
        </ul>
      </div>
    </section>
  );
}
