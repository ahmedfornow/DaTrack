/**
 * The session ribbon — outlet, shift, business date, LAS against target.
 *
 * This is not decoration. A promoter can open a past day to backfill sales, and
 * once they scroll, nothing keeps that context in view. Logging a sale against
 * the wrong day is silent: the tap succeeds, the number lands somewhere else,
 * and nobody notices until the totals are wrong. The ribbon makes "what am I
 * logging against" unmissable, and it stays stuck to the top while logging.
 *
 * It shifts tone between day and night shift so the mode is legible at a
 * glance, and takes on a distinctly different treatment when the session is not
 * today — that difference is the whole point.
 */

import { formatReportDate, type BusinessDate } from '../../lib/businessDay';
import { SHIFT_LABEL_WITH_ICON } from '../../domain/labels';
import { achievementBand, achievementPercent } from '../../domain/rules';
import type { Shift } from '../../domain/values';

export interface SessionRibbonProps {
  readonly outletName: string;
  readonly shift: Shift | null;
  readonly workDate: BusinessDate;
  /** True when the session is the current business day. */
  readonly isToday: boolean;
  readonly lasCount: number;
  readonly dailyTarget: number | null;
  /** Shown when logging against a past day, to get back. */
  readonly onReturnToToday?: (() => void) | undefined;
}

const BAND_BAR: Record<ReturnType<typeof achievementBand>, string> = {
  achieved: 'bg-achieved',
  close: 'bg-close',
  behind: 'bg-behind',
  untargeted: 'bg-absent',
};

const BAND_TEXT: Record<ReturnType<typeof achievementBand>, string> = {
  achieved: 'text-achieved',
  close: 'text-close',
  behind: 'text-behind',
  untargeted: 'text-muted',
};

export function SessionRibbon({
  outletName,
  shift,
  workDate,
  isToday,
  lasCount,
  dailyTarget,
  onReturnToToday,
}: SessionRibbonProps) {
  const band = achievementBand(lasCount, dailyTarget);
  const percent = achievementPercent(lasCount, dailyTarget);

  // Night shift gets a cooler cast, day a warmer one. Backfill overrides both:
  // a past day must never be mistaken for the live one.
  const tone = !isToday
    ? 'from-behind/15 to-surface border-behind/35'
    : shift === 'night'
      ? 'from-digital-violet/25 to-surface border-line'
      : 'from-gold/12 to-surface border-line';

  return (
    <div
      className={`sticky top-0 z-20 -mx-4 mb-3 border-b bg-gradient-to-b px-4 py-3 backdrop-blur ${tone}`}
      // Announced on change so a screen reader user hears which day they are on.
      aria-live="polite"
    >
      <div className="flex items-baseline justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-md font-bold text-ink">{outletName}</p>
          <p className="mt-0.5 text-xs text-muted">
            {shift !== null ? SHIFT_LABEL_WITH_ICON[shift] : 'بدون فترة'}
            <span className="mx-1.5 text-faint">·</span>
            <span className="tabular" dir="ltr">
              {formatReportDate(workDate)}
            </span>
          </p>
        </div>

        <div className="shrink-0 text-left" dir="ltr">
          <p className={`tabular text-xl font-bold leading-none ${BAND_TEXT[band]}`}>
            {lasCount}
            {dailyTarget !== null && (
              <span className="text-sm font-normal text-muted">/{dailyTarget}</span>
            )}
          </p>
          <p className="mt-0.5 text-xs text-muted">LAS</p>
        </div>
      </div>

      {dailyTarget !== null && (
        <div className="mt-2 flex items-center gap-2">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/6">
            <div
              className={`h-full rounded-full transition-[width] duration-500 ${BAND_BAR[band]}`}
              style={{ width: `${Math.min(100, percent ?? 0)}%` }}
            />
          </div>
          <span className={`tabular text-xs font-bold ${BAND_TEXT[band]}`} dir="ltr">
            {percent}%
          </span>
        </div>
      )}

      {!isToday && (
        <p className="mt-2 flex flex-wrap items-center gap-x-2 text-xs text-behind">
          <span>تسجّل على يوم سابق</span>
          {onReturnToToday !== undefined && (
            <button
              type="button"
              onClick={onReturnToToday}
              className="underline underline-offset-2"
            >
              العودة لليوم الحالي
            </button>
          )}
        </p>
      )}
    </div>
  );
}
