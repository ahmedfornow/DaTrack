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
 *
 * Progress is a ring that fills toward the target and says how many are left.
 * It never turns red. The target covers the whole shift, so 3 of 6 at 7pm on a
 * night shift is on track — the bar this replaced compared it to the full day
 * and painted it red, which told every promoter they were failing for most of
 * every shift. The ring turns green once the target is met.
 */

import { formatReportDate, type BusinessDate } from '../../lib/businessDay';
import { SHIFT_LABEL_WITH_ICON } from '../../domain/labels';
import { achievementBand } from '../../domain/rules';
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

const RADIUS = 26;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

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
  const targeted = band !== 'untargeted' && dailyTarget !== null;
  const achieved = band === 'achieved';
  const filled = targeted ? Math.min(1, lasCount / dailyTarget) : 0;
  // Whole sales still needed. A target of 4.5 with 3 logged needs 2 more, not 1.5.
  const left = targeted ? Math.max(0, Math.ceil(dailyTarget - lasCount)) : 0;

  // Night shift gets a cooler cast, day a warmer one. Backfill overrides both:
  // a past day must never be mistaken for the live one.
  const tone = !isToday
    ? 'from-behind/15 to-surface border-behind/35'
    : shift === 'night'
      ? 'from-digital-violet/25 to-surface border-line'
      : 'from-gold/12 to-surface border-line';

  const shiftChip =
    shift === 'night'
      ? 'border-digital-violet bg-digital-violet/30 text-ink'
      : 'border-line-soft bg-surface-raised text-muted';

  return (
    <div
      className={`sticky top-0 z-20 -mx-4 mb-4 border-b bg-gradient-to-b px-4 py-3 backdrop-blur ${tone}`}
      // Announced on change so a screen reader user hears which day they are on.
      aria-live="polite"
    >
      <div className="flex items-center gap-3.5">
        <div
          className="relative h-16 w-16 shrink-0"
          role="img"
          aria-label={
            targeted ? `LAS ${lasCount} من ${dailyTarget}` : `LAS ${lasCount}`
          }
        >
          <svg viewBox="0 0 64 64" className="h-16 w-16 -rotate-90" aria-hidden="true">
            <circle
              cx="32"
              cy="32"
              r={RADIUS}
              fill="none"
              strokeWidth="6"
              className="stroke-white/8"
            />
            {targeted && (
              <circle
                cx="32"
                cy="32"
                r={RADIUS}
                fill="none"
                strokeWidth="6"
                strokeLinecap="round"
                strokeDasharray={CIRCUMFERENCE}
                strokeDashoffset={CIRCUMFERENCE * (1 - filled)}
                className={`transition-[stroke-dashoffset] duration-500 ${
                  achieved ? 'stroke-achieved' : 'stroke-gold'
                }`}
              />
            )}
          </svg>
          <div className="absolute inset-0 grid place-items-center text-center leading-none">
            <div>
              <span
                className={`tabular block text-xl font-bold ${achieved ? 'text-achieved' : 'text-ink'}`}
                dir="ltr"
              >
                {lasCount}
              </span>
              <span className="tabular mt-0.5 block text-xs text-muted">
                {targeted ? `من ${dailyTarget}` : 'LAS'}
              </span>
            </div>
          </div>
        </div>

        <div className="min-w-0 flex-1">
          <p className="truncate text-lg font-bold text-ink">{outletName}</p>
          <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
            <span className={`rounded-full border px-2 py-0.5 ${shiftChip}`}>
              {shift !== null ? SHIFT_LABEL_WITH_ICON[shift] : 'بدون فترة'}
            </span>
            <span
              className="tabular rounded-full border border-line-soft bg-surface-raised px-2 py-0.5 text-muted"
              dir="ltr"
            >
              {formatReportDate(workDate)}
            </span>
          </p>
          {targeted && (
            <p className={`mt-1.5 text-sm ${achieved ? 'text-achieved' : 'text-gold'}`}>
              {achieved ? (
                'تم تحقيق الهدف ✓'
              ) : (
                <>
                  باقي <span className="tabular font-bold">{left}</span> للهدف
                </>
              )}
            </p>
          )}
        </div>
      </div>

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
