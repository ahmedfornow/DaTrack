/**
 * The team panel: compliance first, then the breakdowns.
 *
 * Compliance leads because it is the actionable one — days logged and
 * achievement, least compliant first, so the person to call is at the top.
 * Everything below is reference material and stays collapsed.
 *
 * Device and colour breakdowns use the actual colour of the device sold, so the
 * chart language comes from the products rather than a library default.
 */

import { COLOR_SWATCH, shortNameOf, type DeviceColor } from '../../domain/devices';
import { shortOutletName } from '../../domain/text';
import type { ComplianceRow, CountedItem, NamedTotals } from './aggregate';

export interface TeamPanelProps {
  readonly compliance: readonly ComplianceRow[];
  readonly byPromoter: readonly NamedTotals[];
  readonly byOutlet: readonly NamedTotals[];
  readonly byDevice: readonly CountedItem[];
  readonly byColor: readonly CountedItem[];
  readonly totalSales: number;
}

function bandColor(percent: number | null): string {
  if (percent === null) return 'text-muted';
  if (percent >= 100) return 'text-achieved';
  if (percent >= 70) return 'text-close';
  return 'text-behind';
}

function bandBar(percent: number | null): string {
  if (percent === null) return 'bg-absent';
  if (percent >= 100) return 'bg-achieved';
  if (percent >= 70) return 'bg-close';
  return 'bg-behind';
}

export function TeamPanel({
  compliance,
  byPromoter,
  byOutlet,
  byDevice,
  byColor,
  totalSales,
}: TeamPanelProps) {
  return (
    <div className="space-y-2">
      <Accordion title="التسجيل وتحقيق الهدف" defaultOpen count={compliance.length}>
        {compliance.length === 0 ? (
          <Empty>لا مندوبين</Empty>
        ) : (
          <ul className="space-y-2">
            {compliance.map((row) => {
              const daysPercent =
                row.elapsedDays > 0
                  ? Math.min(100, Math.round((row.daysLogged / row.elapsedDays) * 100))
                  : 0;
              const daysColor = row.complete
                ? 'text-achieved'
                : daysPercent >= 70
                  ? 'text-close'
                  : 'text-behind';
              return (
                <li
                  key={row.promoterId}
                  className="rounded-control border border-line-soft bg-surface-raised px-3 py-2.5"
                >
                  <div className="flex items-center gap-2">
                    <span aria-hidden="true" className={row.complete ? 'text-achieved' : 'text-close'}>
                      {row.complete ? '✓' : '!'}
                    </span>
                    <b className="truncate text-sm text-ink">{row.fullName}</b>
                  </div>

                  <div className="mt-2 grid grid-cols-2 gap-3">
                    <Meter
                      label="أيام مسجلة"
                      value={`${row.daysLogged}/${row.elapsedDays}`}
                      percent={daysPercent}
                      color={daysColor}
                      bar={row.complete ? 'bg-achieved' : daysPercent >= 70 ? 'bg-close' : 'bg-behind'}
                    />
                    <Meter
                      label="هدف LAS"
                      value={
                        row.achievement === null
                          ? `${row.las}/—`
                          : `${row.las}/${row.target} · ${row.achievement}%`
                      }
                      percent={Math.min(100, row.achievement ?? 0)}
                      color={bandColor(row.achievement)}
                      bar={bandBar(row.achievement)}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Accordion>

      <Accordion title="مبيعات المندوبين" defaultOpen count={byPromoter.length}>
        {byPromoter.length === 0 ? (
          <Empty>لا مبيعات في الفترة</Empty>
        ) : (
          <ul className="space-y-2">
            {byPromoter.map((row) => (
              <Row
                key={row.name}
                title={row.name}
                meta={`SK ${row.sk} · MGM ${row.mgm} · LD ${row.ld}${row.lau > 0 ? ` · LAU ${row.lau}` : ''}`}
                value={row.las}
              />
            ))}
          </ul>
        )}
      </Accordion>

      <Accordion title="مبيعات المواقع" count={byOutlet.length}>
        {byOutlet.length === 0 ? (
          <Empty>لا مبيعات في الفترة</Empty>
        ) : (
          <ul className="space-y-2">
            {byOutlet.map((row) => (
              <Row
                key={row.name}
                title={shortOutletName(row.name)}
                meta={row.lau > 0 ? `LAU ${row.lau}` : ''}
                value={row.las}
              />
            ))}
          </ul>
        )}
      </Accordion>

      <Accordion title="المبيعات حسب الجهاز" count={byDevice.length}>
        {byDevice.length === 0 ? (
          <Empty>لا مبيعات في الفترة</Empty>
        ) : (
          <>
            {byDevice.map((item) => {
              const percent = totalSales > 0 ? Math.round((item.count / totalSales) * 100) : 0;
              return (
                <div key={item.label} className="mb-3">
                  <div className="mb-1 flex items-baseline justify-between gap-2">
                    <span className="text-sm font-bold text-ink">{shortNameOf(item.label)}</span>
                    <span className="tabular text-xs text-muted" dir="ltr">
                      {item.count} · {percent}%
                    </span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-white/6">
                    <div className="h-full rounded-full bg-gold" style={{ width: `${percent}%` }} />
                  </div>
                </div>
              );
            })}

            <p className="mt-4 mb-2 text-xs font-bold tracking-wide text-gold">أعلى الألوان</p>
            <ul className="space-y-1.5">
              {byColor.slice(0, 8).map((item) => {
                const colorName = item.label.split('—')[1]?.trim() ?? '';
                const swatch = COLOR_SWATCH[colorName as DeviceColor];
                return (
                  <li
                    key={item.label}
                    className="flex items-center justify-between gap-2 rounded-control border border-line-soft bg-surface-raised px-3 py-2"
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <span
                        aria-hidden="true"
                        className="h-3 w-3 shrink-0 rounded-full border border-line-soft"
                        style={swatch !== undefined ? { background: swatch } : undefined}
                      />
                      <span className="truncate text-xs text-ink" dir="ltr">
                        {item.label}
                      </span>
                    </span>
                    <span className="tabular shrink-0 text-xs font-bold text-gold" dir="ltr">
                      {item.count}
                    </span>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </Accordion>
    </div>
  );
}

function Accordion({
  title,
  count,
  defaultOpen = false,
  children,
}: {
  title: string;
  count?: number;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  return (
    <details open={defaultOpen} className="overflow-hidden rounded-card border border-line bg-surface">
      <summary className="flex min-h-tap cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-bold text-ink">
        <span>{title}</span>
        {count !== undefined && (
          <span className="tabular text-xs font-normal text-muted" dir="ltr">
            {count}
          </span>
        )}
      </summary>
      <div className="px-4 pb-4">{children}</div>
    </details>
  );
}

function Row({ title, meta, value }: { title: string; meta: string; value: number }) {
  return (
    <li className="flex items-center justify-between gap-3 rounded-control border border-line-soft bg-surface-raised px-3 py-2">
      <div className="min-w-0">
        <p className="truncate text-sm text-ink">{title}</p>
        {meta !== '' && (
          <p className="tabular truncate text-xs text-muted" dir="ltr">
            {meta}
          </p>
        )}
      </div>
      <span className="tabular shrink-0 text-lg font-bold text-gold" dir="ltr">
        {value}
        <span className="text-xs font-normal text-muted"> LAS</span>
      </span>
    </li>
  );
}

function Meter({
  label,
  value,
  percent,
  color,
  bar,
}: {
  label: string;
  value: string;
  percent: number;
  color: string;
  bar: string;
}) {
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between gap-1">
        <span className="text-xs text-muted">{label}</span>
        <span className={`tabular text-xs font-bold ${color}`} dir="ltr">
          {value}
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-white/6">
        <div className={`h-full rounded-full ${bar}`} style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="py-4 text-center text-sm text-faint">{children}</p>;
}
