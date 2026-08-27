/**
 * Registering the day.
 *
 * The legacy screen grew three controls where one would do. Here the default
 * path is a single tap: the status defaults to `work`, the outlet is
 * preselected from the supervisor's route plan when one exists, and the shift
 * is chosen automatically from the shifts that outlet actually runs. Backfill
 * and leave statuses are real but secondary, so they sit behind a link rather
 * than in the default view.
 */

import { useState } from 'react';
import {
  businessMonthStart,
  businessToday,
  businessYesterday,
  type BusinessDate,
} from '../../lib/businessDay';
import { ATTENDANCE_STATUS_LABEL_WITH_ICON, SHIFT_LABEL_WITH_ICON } from '../../domain/labels';
import { defaultShiftFor } from '../../domain/rules';
import { AttendanceStatus, type Shift } from '../../domain/values';
import type { Outlet } from '../../data/outlets';

export interface SignInScreenProps {
  readonly promoterName: string;
  readonly outlets: readonly Outlet[];
  readonly date: BusinessDate;
  readonly onDateChange: (date: BusinessDate) => void;
  /** What is already recorded for the chosen date, for the hint line. */
  readonly existingHint: string | null;
  readonly onOpenExisting: (() => void) | undefined;
  readonly plannedNote: string | null;
  readonly busy: boolean;
  readonly error: string | null;
  readonly onSubmit: (request: {
    status: AttendanceStatus;
    touchPointId: number | null;
    shift: Shift | null;
  }) => void;
  readonly onSignOut: () => void;
  readonly initialOutletId: number | null;
}

export function SignInScreen({
  promoterName,
  outlets,
  date,
  onDateChange,
  existingHint,
  onOpenExisting,
  plannedNote,
  busy,
  error,
  onSubmit,
  onSignOut,
  initialOutletId,
}: SignInScreenProps) {
  const [status, setStatus] = useState<AttendanceStatus>('work');
  const [outletId, setOutletId] = useState<number | null>(
    initialOutletId ?? outlets[0]?.id ?? null,
  );
  const outlet = outlets.find((o) => o.id === outletId) ?? null;
  const [shift, setShift] = useState<Shift | null>(
    outlet !== null ? defaultShiftFor(outlet.shiftMode) : null,
  );
  const [showMore, setShowMore] = useState(false);

  const chooseOutlet = (id: number) => {
    setOutletId(id);
    const next = outlets.find((o) => o.id === id);
    // Land on a shift the outlet actually runs — a night-only outlet must
    // never be submitted with a day shift.
    setShift(next !== undefined ? defaultShiftFor(next.shiftMode) : null);
  };

  const working = status === 'work';
  const shifts = outlet?.shifts ?? [];

  return (
    <main className="mx-auto w-full max-w-[440px] px-4 py-6">
      <div className="rounded-card border border-line bg-surface p-5">
        <p className="text-sm text-muted">حياك الله</p>
        <p className="mt-0.5 text-lg font-bold text-gold">{promoterName}</p>

        {plannedNote !== null && (
          <p className="mt-3 rounded-control border border-line bg-gold/8 px-3 py-2 text-sm text-gold">
            {plannedNote}
          </p>
        )}

        {existingHint !== null && (
          <p className="mt-3 rounded-control border border-line bg-surface-raised px-3 py-2 text-sm text-muted">
            {existingHint}
            {onOpenExisting !== undefined && (
              <button
                type="button"
                onClick={onOpenExisting}
                className="ms-2 text-gold underline underline-offset-2"
              >
                افتح الجلسة
              </button>
            )}
          </p>
        )}

        {working && (
          <>
            <p className="mt-4 mb-1.5 text-xs text-muted">موقع اليوم</p>
            <select
              value={outletId ?? ''}
              onChange={(event) => chooseOutlet(Number(event.target.value))}
              className="min-h-tap w-full rounded-control border border-line-soft bg-surface-raised px-3 text-md text-ink"
            >
              {outlets.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.shortName}
                </option>
              ))}
            </select>

            {shifts.length > 1 && (
              <>
                <p className="mt-4 mb-1.5 text-xs text-muted">الفترة</p>
                <div className="grid grid-cols-2 gap-2">
                  {shifts.map((option) => (
                    <button
                      key={option}
                      type="button"
                      aria-pressed={shift === option}
                      onClick={() => setShift(option)}
                      className={`min-h-tap rounded-control border text-sm transition-colors ${
                        shift === option
                          ? 'border-gold bg-gold/10 font-bold text-gold'
                          : 'border-line-soft bg-surface-raised text-ink'
                      }`}
                    >
                      {SHIFT_LABEL_WITH_ICON[option]}
                    </button>
                  ))}
                </div>
              </>
            )}
          </>
        )}

        {error !== null && (
          <p className="mt-4 rounded-control border border-behind/30 bg-behind/10 px-3 py-2 text-sm text-behind">
            {error}
          </p>
        )}

        <button
          type="button"
          disabled={busy || (working && (outletId === null || shift === null))}
          onClick={() =>
            onSubmit({
              status,
              touchPointId: working ? outletId : null,
              shift: working ? shift : null,
            })
          }
          className="mt-5 min-h-tap w-full rounded-control bg-gradient-to-br from-gold-hi via-gold to-gold-lo font-bold text-[#12100a] disabled:opacity-40"
        >
          {working ? 'تسجيل الدوام' : `تسجيل ${ATTENDANCE_STATUS_LABEL_WITH_ICON[status]}`}
        </button>

        <button
          type="button"
          onClick={() => setShowMore((open) => !open)}
          aria-expanded={showMore}
          className="mt-3 w-full text-center text-sm text-gold underline underline-offset-2"
        >
          {showMore ? 'إخفاء' : 'يوم آخر أو حالة مختلفة؟'}
        </button>

        {showMore && (
          <div className="mt-3 space-y-3 border-t border-line-soft pt-3">
            <div>
              <p className="mb-1.5 text-xs text-muted">حالة اليوم</p>
              <div className="grid grid-cols-3 gap-2">
                {AttendanceStatus.values.map((option) => (
                  <button
                    key={option}
                    type="button"
                    aria-pressed={status === option}
                    onClick={() => setStatus(option)}
                    className={`min-h-tap rounded-control border px-1 text-xs transition-colors ${
                      status === option
                        ? 'border-gold bg-gold/10 font-bold text-gold'
                        : 'border-line-soft bg-surface-raised text-ink'
                    }`}
                  >
                    {ATTENDANCE_STATUS_LABEL_WITH_ICON[option]}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <p className="mb-1.5 text-xs text-muted">يوم الجلسة</p>
              <div className="mb-2 grid grid-cols-2 gap-2">
                <QuickDay
                  label="اليوم"
                  active={date === businessToday()}
                  onClick={() => onDateChange(businessToday())}
                />
                <QuickDay
                  label="أمس"
                  active={date === businessYesterday()}
                  onClick={() => onDateChange(businessYesterday())}
                />
              </div>
              <input
                type="date"
                value={date}
                min={businessMonthStart()}
                max={businessToday()}
                onChange={(event) => {
                  if (event.target.value !== '') onDateChange(event.target.value);
                }}
                className="tabular min-h-tap w-full rounded-control border border-line-soft bg-surface-raised px-3 text-center text-md text-ink"
                dir="ltr"
              />
              <p className="mt-1.5 text-xs text-faint">
                يمكن تسجيل أيام الشهر الحالي فقط
              </p>
            </div>
          </div>
        )}
      </div>

      <button
        type="button"
        onClick={onSignOut}
        className="mt-4 min-h-tap w-full rounded-control border border-line-soft text-sm text-muted"
      >
        تسجيل خروج
      </button>
    </main>
  );
}

function QuickDay({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`min-h-tap rounded-control border text-sm transition-colors ${
        active
          ? 'border-gold bg-gold/10 font-bold text-gold'
          : 'border-line-soft bg-surface-raised text-ink'
      }`}
    >
      {label}
    </button>
  );
}
