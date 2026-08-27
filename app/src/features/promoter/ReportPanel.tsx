/**
 * Generating and copying the end-of-shift report.
 *
 * The legacy flow puts the pre-send check in a `confirm()` dialog. That works,
 * but it is the wrong shape: a native dialog cannot be styled, cannot be read
 * back, and disappears the moment it is dismissed. Here the same warnings are
 * rendered inline, so a promoter can see "you logged nothing today" while
 * looking at the button that would broadcast it.
 *
 * The textarea holding the report is forced LTR. Without that the English body
 * renders scrambled inside an RTL document and is unusable.
 */

import { useState } from 'react';
import { SHIFT_LABEL } from '../../domain/labels';
import type { Shift } from '../../domain/values';
import type { Sale } from '../../data/sales';
import {
  buildEndOfShiftReport,
  reviewBeforeSending,
  warningMessage,
} from '../reports/endOfShift';
import type { BusinessDate } from '../../lib/businessDay';

export interface ReportPanelProps {
  readonly outletName: string;
  readonly workDate: BusinessDate;
  readonly shift: Shift;
  /** Oldest first — the order the report numbers them in. */
  readonly sales: readonly Sale[];
  readonly target: number | null;
  readonly gtTarget: number | null;
  readonly onSaveGuidedTrials: (count: number) => void;
}

export function ReportPanel({
  outletName,
  workDate,
  shift,
  sales,
  target,
  gtTarget,
  onSaveGuidedTrials,
}: ReportPanelProps) {
  const [guidedTrials, setGuidedTrials] = useState('');
  const [report, setReport] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const gtCount = Number.parseInt(guidedTrials, 10);
  const gt = Number.isFinite(gtCount) && gtCount >= 0 ? gtCount : 0;

  const review = reviewBeforeSending({
    outletName,
    shiftLabel: SHIFT_LABEL[shift],
    sales,
    guidedTrials: gt,
    target,
  });

  const generate = () => {
    onSaveGuidedTrials(gt);
    setReport(buildEndOfShiftReport({ outletName, workDate, shift, sales, guidedTrials: gt }));
    setCopied(false);
  };

  const copy = () => {
    if (report === null) return;
    void navigator.clipboard.writeText(report).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <section className="rounded-card border border-line bg-surface p-4">
      <h2 className="text-md font-bold text-ink">تقرير نهاية الدوام</h2>

      <label htmlFor="gt" className="mt-3 mb-1.5 block text-xs text-muted">
        عدد الـ Guided Trials
        {gtTarget !== null && <span className="text-faint"> (الهدف: {gtTarget})</span>}
      </label>
      <input
        id="gt"
        type="text"
        inputMode="numeric"
        value={guidedTrials}
        onChange={(event) => setGuidedTrials(event.target.value.replace(/\D/gu, ''))}
        placeholder="0"
        dir="ltr"
        className="tabular min-h-tap w-full rounded-control border border-line-soft bg-surface-raised px-3 text-center text-md text-ink"
      />

      <dl className="mt-3 space-y-1 text-sm">
        <Row label="إجمالي المبيعات" value={String(review.totalSales)} />
        <Row label="منها LAS" value={String(review.lasCount)} />
        {review.percent !== null && (
          <Row
            label="تحقيق الهدف"
            value={`${review.lasCount}/${review.target} · ${review.percent}%`}
            tone={review.percent >= 100 ? 'achieved' : review.percent >= 70 ? 'close' : 'behind'}
          />
        )}
      </dl>

      {review.warnings.map((warning) => (
        <p
          key={warning.kind}
          role="alert"
          className="mt-3 rounded-control border border-close/30 bg-close/10 px-3 py-2 text-sm text-close"
        >
          {warningMessage(warning)}
        </p>
      ))}

      <button
        type="button"
        onClick={generate}
        className="mt-4 min-h-tap w-full rounded-control border border-gold text-sm font-bold text-gold"
      >
        توليد التقرير
      </button>

      {report !== null && (
        <div className="mt-3">
          <label htmlFor="report" className="mb-1.5 block text-xs text-muted">
            راجع وعدّل قبل النسخ
          </label>
          <textarea
            id="report"
            value={report}
            onChange={(event) => setReport(event.target.value)}
            rows={12}
            className="report-text w-full rounded-control border border-line-soft bg-surface-raised p-3 text-sm text-ink"
          />
          <button
            type="button"
            onClick={copy}
            className="mt-2 min-h-tap w-full rounded-control bg-gradient-to-br from-gold-hi via-gold to-gold-lo font-bold text-[#12100a]"
          >
            {copied ? 'تم النسخ' : 'نسخ للواتساب'}
          </button>
        </div>
      )}
    </section>
  );
}

function Row({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'achieved' | 'close' | 'behind';
}) {
  const color =
    tone === 'achieved'
      ? 'text-achieved'
      : tone === 'close'
        ? 'text-close'
        : tone === 'behind'
          ? 'text-behind'
          : 'text-ink';
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-muted">{label}</dt>
      <dd className={`tabular ${color}`} dir="ltr">
        {value}
      </dd>
    </div>
  );
}
