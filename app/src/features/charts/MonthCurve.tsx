/**
 * The month curve, in plain SVG.
 *
 * Actual is a filled gold line; target is a dashed grey one. Where gold sits
 * above grey the month is ahead — that comparison is the entire point, and it
 * is why both lines share one vertical scale even though a dual axis would make
 * each look more dramatic.
 *
 * No chart library. Two polylines and a fill do not justify 200KB, and a
 * hand-drawn chart inherits the app's tokens for free, so it is correct in both
 * themes without a second palette to maintain.
 *
 * The SVG scales to its container via viewBox rather than measuring the DOM,
 * so it is correct on a 375px phone and a laptop without a resize observer.
 */

import type { MonthPoint } from './monthSeries';
import { summarize } from './monthSeries';

export interface MonthCurveProps {
  readonly points: readonly MonthPoint[];
  readonly title: string;
  /** Shown when there is nothing to draw yet. */
  readonly empty?: string;
}

const W = 320;
const H = 120;
const PAD_X = 4;
const PAD_Y = 8;

function path(points: readonly MonthPoint[], value: (point: MonthPoint) => number, max: number): string {
  if (points.length === 0) return '';
  const stepX = points.length > 1 ? (W - PAD_X * 2) / (points.length - 1) : 0;
  const scaleY = max > 0 ? (H - PAD_Y * 2) / max : 0;

  return points
    .map((point, index) => {
      const x = PAD_X + index * stepX;
      const y = H - PAD_Y - value(point) * scaleY;
      return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
}

export function MonthCurve({ points, title, empty = 'لا بيانات بعد' }: MonthCurveProps) {
  const totals = summarize(points);

  // One scale for both lines. A dual axis would flatter whichever line is
  // smaller and hide exactly the gap this chart exists to show.
  const peak = Math.max(
    1,
    ...points.map((point) => Math.max(point.cumulativeLas, point.cumulativeTarget)),
  );

  // Headroom, so the top line never sits flush against the top edge.
  // Cumulative series are flat wherever selling stopped, and a flat line hard
  // against the ceiling reads as a maxed-out month rather than a stalled one —
  // worst in the no-target case, where a single sale filled the whole frame.
  const max = peak * 1.15;

  const actual = path(points, (point) => point.cumulativeLas, max);
  const target = path(points, (point) => point.cumulativeTarget, max);
  const area = actual === '' ? '' : `${actual} L${W - PAD_X},${H - PAD_Y} L${PAD_X},${H - PAD_Y} Z`;

  const tone =
    totals.percent === null
      ? 'text-muted'
      : totals.percent >= 100
        ? 'text-achieved'
        : totals.percent >= 70
          ? 'text-close'
          : 'text-behind';

  return (
    <section className="rounded-card border border-line bg-surface p-4">
      <h2 className="mb-3 text-md font-bold text-ink">{title}</h2>

      {points.length === 0 ? (
        <p className="py-8 text-center text-sm text-faint">{empty}</p>
      ) : (
        <>
          <div className="mb-3 grid grid-cols-3 gap-2">
            <Stat label="LAS الشهر" value={String(totals.las)} tone="text-ink" />
            <Stat label="الهدف حتى اليوم" value={totals.target.toFixed(2)} tone="text-muted" />
            <Stat
              label="نسبة التحقيق"
              value={totals.percent === null ? '—' : `${totals.percent}%`}
              tone={tone}
            />
          </div>

          <svg
            viewBox={`0 0 ${W} ${H}`}
            className="block h-auto w-full"
            role="img"
            aria-label={`${title}: ${totals.las} مقابل هدف ${totals.target.toFixed(0)}`}
            preserveAspectRatio="none"
          >
            {/* A faint baseline, so a flat month still reads as a chart and not
                a rendering failure. */}
            <line
              x1={PAD_X}
              y1={H - PAD_Y}
              x2={W - PAD_X}
              y2={H - PAD_Y}
              stroke="var(--color-line)"
              strokeWidth="1"
            />

            {area !== '' && <path d={area} fill="var(--color-gold)" opacity="0.12" />}

            <path
              d={target}
              fill="none"
              stroke="var(--color-muted)"
              strokeWidth="1.5"
              strokeDasharray="4 3"
              vectorEffect="non-scaling-stroke"
            />
            <path
              d={actual}
              fill="none"
              stroke="var(--color-gold)"
              strokeWidth="2"
              strokeLinejoin="round"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
          </svg>

          <div className="mt-2 flex items-center justify-between gap-3 text-xs">
            <span className="flex items-center gap-1.5 text-muted">
              <span className="inline-block h-0.5 w-4 bg-gold" aria-hidden="true" />
              المحقق
            </span>
            <span className="flex items-center gap-1.5 text-muted">
              <span
                className="inline-block h-0 w-4 border-t border-dashed border-muted"
                aria-hidden="true"
              />
              الهدف
            </span>
            <span className="tabular text-faint" dir="ltr">
              {points.length > 0 ? `1 – ${points[points.length - 1]?.day}` : ''}
            </span>
          </div>
        </>
      )}
    </section>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div className="rounded-control border border-line-soft bg-surface-raised px-2 py-1.5 text-center">
      <span className={`tabular block text-lg font-bold ${tone}`} dir="ltr">
        {value}
      </span>
      <span className="block text-xs text-muted">{label}</span>
    </div>
  );
}
