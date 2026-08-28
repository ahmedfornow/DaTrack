/**
 * Period totals, and the two reports built from them.
 *
 * Both reports are generated from the same aggregate the counters render, so
 * what the supervisor broadcasts always matches what they were looking at when
 * they pressed the button. The legacy summary reads a cached blob that the
 * dashboard happened to leave behind, which is the kind of coupling that
 * silently goes stale.
 */

import { useState } from 'react';
import { businessMonth } from '../../lib/businessDay';
import { buildPeriodSummary, type PeriodKind } from '../reports/periodSummary';
import { buildMonthCsv, monthCsvFilename } from '../reports/monthCsv';
import type { DashboardData } from '../../data/supervisor';

export interface OverviewProps {
  readonly city: string;
  readonly period: PeriodKind;
  readonly onPeriodChange: (period: PeriodKind) => void;
  readonly data: DashboardData | null;
  readonly loading: boolean;
  readonly canExport: boolean;
}

const PERIOD_TABS: { id: PeriodKind; label: string }[] = [
  { id: 'today', label: 'اليوم' },
  { id: 'week', label: 'آخر ٧ أيام' },
  { id: 'month', label: 'الشهر' },
];

export function Overview({
  city,
  period,
  onPeriodChange,
  data,
  loading,
  canExport,
}: OverviewProps) {
  const [summary, setSummary] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const generate = () => {
    if (data === null) return;
    setSummary(
      buildPeriodSummary({
        city,
        period: data.period,
        start: data.start,
        byPromoter: data.sales.byPromoter,
        byOutlet: data.sales.byOutlet,
        guidedTrials: data.guidedTrials,
        checkIns: data.checkIns,
      }),
    );
    setCopied(false);
  };

  const copy = () => {
    if (summary === null) return;
    void navigator.clipboard.writeText(summary).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    });
  };

  const exportCsv = () => {
    if (data === null) return;
    const month = businessMonth();
    const blob = new Blob([buildMonthCsv(data.csvRows)], {
      type: 'text/csv;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = monthCsvFilename(city, month);
    link.click();
    // Revoking immediately can cancel the download in some browsers.
    window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
  };

  return (
    <section className="space-y-3">
      <div role="tablist" className="flex gap-1.5">
        {PERIOD_TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={period === tab.id}
            onClick={() => onPeriodChange(tab.id)}
            className={`min-h-tap flex-1 rounded-control border text-sm transition-colors ${
              period === tab.id
                ? 'border-gold bg-gold/10 font-bold text-gold'
                : 'border-line-soft bg-surface text-muted'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {loading || data === null ? (
        <p className="rounded-card border border-line bg-surface px-4 py-6 text-center text-sm text-muted">
          جاري التحميل…
        </p>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-2">
            <Stat label="مبيعات LAS" value={data.sales.las} emphasis />
            <Stat label="Guided Trials" value={data.guidedTrials} />
            <Stat label="تسجيلات" value={data.checkIns} />
          </div>

          <div className="rounded-card border border-line-soft bg-surface-raised px-4 py-3">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-xs text-muted">إجمالي النشاط (LAU مشمول)</span>
              <span className="tabular text-lg font-bold text-muted" dir="ltr">
                {data.sales.total}
              </span>
            </div>
            <p className="mt-1 tabular text-xs text-faint" dir="ltr">
              SK {data.sales.byPromoter.reduce((n, p) => n + p.sk, 0)} · MGM{' '}
              {data.sales.byPromoter.reduce((n, p) => n + p.mgm, 0)} · LD{' '}
              {data.sales.byPromoter.reduce((n, p) => n + p.ld, 0)} · LAU {data.sales.lau}
            </p>
          </div>

          <div className="rounded-card border border-line bg-surface p-4">
            <h2 className="text-md font-bold text-ink">تقارير ومشاركة</h2>

            <button
              type="button"
              onClick={generate}
              className="mt-3 min-h-tap w-full rounded-control bg-gradient-to-br from-gold-hi via-gold to-gold-lo font-bold text-[#12100a]"
            >
              توليد ملخص الفترة
            </button>

            {summary !== null && (
              <div className="mt-3">
                <textarea
                  value={summary}
                  onChange={(event) => setSummary(event.target.value)}
                  rows={14}
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

            {canExport && (
              <button
                type="button"
                onClick={exportCsv}
                className="mt-2 min-h-tap w-full rounded-control border border-gold text-sm font-bold text-gold"
              >
                تصدير سجل الشهر (CSV)
              </button>
            )}
          </div>
        </>
      )}
    </section>
  );
}

function Stat({
  label,
  value,
  emphasis = false,
}: {
  label: string;
  value: number;
  emphasis?: boolean;
}) {
  return (
    <div className="rounded-card border border-line-soft bg-surface-raised px-3 py-3 text-center">
      <p
        className={`tabular text-xl font-bold leading-none ${emphasis ? 'text-gold' : 'text-ink'}`}
        dir="ltr"
      >
        {value}
      </p>
      <p className="mt-1 text-xs text-muted">{label}</p>
    </div>
  );
}
