/**
 * Tomorrow's route plan.
 *
 * One control per promoter, because the plan is promoter-centric: every person
 * is either at an outlet on a shift, or on a leave status, and the screen
 * should make an unassigned promoter obvious rather than requiring the
 * supervisor to cross-check a list of outlets against a list of people.
 *
 * The date defaults to tomorrow — the plan is written the night before.
 */

import { useState } from 'react';
import { businessTomorrow, type BusinessDate } from '../../lib/businessDay';
import { PLAN_STATUS_LABEL_WITH_ICON, SHIFT_LABEL } from '../../domain/labels';
import { shortOutletName } from '../../domain/text';
import { PlanStatus } from '../../domain/values';
import { decodePick, encodePick, type PlanMap } from '../../data/routePlans';
import { buildRoutePlanMessage, type RouteOutlet } from '../reports/routePlanMessage';

export interface RoutePlanEditorProps {
  readonly city: string;
  readonly date: BusinessDate;
  readonly onDateChange: (date: BusinessDate) => void;
  readonly outlets: readonly RouteOutlet[];
  readonly promoters: readonly { id: string; fullName: string }[];
  readonly picks: PlanMap;
  readonly onPicksChange: (picks: PlanMap) => void;
  readonly busy: boolean;
  readonly notice: string | null;
  readonly onSave: () => void;
  readonly readOnly: boolean;
}

export function RoutePlanEditor({
  city,
  date,
  onDateChange,
  outlets,
  promoters,
  picks,
  onPicksChange,
  busy,
  notice,
  onSave,
  readOnly,
}: RoutePlanEditorProps) {
  const [message, setMessage] = useState<string | null>(null);
  const [messageError, setMessageError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const setPick = (promoterId: string, value: string) => {
    const assignment = decodePick(value);
    const next = new Map(picks);
    if (assignment === null) next.delete(promoterId);
    else next.set(promoterId, assignment);
    onPicksChange(next);
  };

  const generate = () => {
    const result = buildRoutePlanMessage({
      city,
      planDate: date,
      outlets,
      promoters,
      assignments: picks,
    });
    if (!result.ok) {
      setMessage(null);
      setMessageError(result.reason);
      return;
    }
    setMessageError(null);
    setMessage(result.message);
    setCopied(false);
  };

  const copy = () => {
    if (message === null) return;
    void navigator.clipboard.writeText(message).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    });
  };

  const assignedCount = [...picks.values()].filter((a) => a.kind === 'outlet').length;
  const unassigned = promoters.filter((promoter) => !picks.has(promoter.id));

  return (
    <section className="space-y-3">
      <div className="rounded-card border border-line bg-surface p-4">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-md font-bold text-ink">خطة اليوم</h2>
          <span className="tabular text-xs text-muted" dir="ltr">
            {assignedCount}/{promoters.length}
          </span>
        </div>

        <label htmlFor="plan-date" className="mt-3 mb-1.5 block text-xs text-muted">
          تاريخ الخطة
        </label>
        <input
          id="plan-date"
          type="date"
          value={date}
          onChange={(event) => {
            if (event.target.value !== '') onDateChange(event.target.value);
          }}
          dir="ltr"
          className="tabular min-h-tap w-full rounded-control border border-line-soft bg-surface-raised px-3 text-center text-md text-ink"
        />

        {unassigned.length > 0 && (
          <p className="mt-3 rounded-control border border-close/30 bg-close/8 px-3 py-2 text-xs text-close">
            {unassigned.length} بدون تعيين — سيظهرون في الرسالة كـ Off
          </p>
        )}

        <div className="mt-3 space-y-2">
          {promoters.length === 0 ? (
            <p className="py-4 text-center text-sm text-faint">لا مندوبين</p>
          ) : (
            promoters.map((promoter) => (
              <div
                key={promoter.id}
                className="flex items-center justify-between gap-3 border-b border-line-soft pb-2 last:border-0"
              >
                <label
                  htmlFor={`plan-${promoter.id}`}
                  className="min-w-0 flex-1 truncate text-sm text-ink"
                >
                  {promoter.fullName}
                </label>
                <select
                  id={`plan-${promoter.id}`}
                  value={encodePick(picks.get(promoter.id))}
                  disabled={readOnly || busy}
                  onChange={(event) => setPick(promoter.id, event.target.value)}
                  className="min-h-tap w-[11rem] shrink-0 rounded-control border border-line-soft bg-surface-raised px-2 text-sm text-ink disabled:opacity-50"
                >
                  <option value="">— بدون —</option>
                  <optgroup label="الحالة">
                    {PlanStatus.values.map((status) => (
                      <option key={status} value={`st:${status}`}>
                        {PLAN_STATUS_LABEL_WITH_ICON[status]}
                      </option>
                    ))}
                  </optgroup>
                  <optgroup label="المواقع">
                    {outlets.flatMap((outlet) =>
                      shiftOptions(outlet).map((shift) => (
                        <option
                          key={`${outlet.id}-${shift}`}
                          value={`tp:${outlet.id}:${shift}`}
                        >
                          {shortOutletName(outlet.name)} — {SHIFT_LABEL[shift]}
                        </option>
                      )),
                    )}
                  </optgroup>
                </select>
              </div>
            ))
          )}
        </div>

        {notice !== null && (
          <p className="mt-3 rounded-control border border-achieved/30 bg-achieved/10 px-3 py-2 text-sm text-achieved">
            {notice}
          </p>
        )}

        {!readOnly && (
          <button
            type="button"
            onClick={onSave}
            disabled={busy}
            className="mt-4 min-h-tap w-full rounded-control bg-gradient-to-br from-gold-hi via-gold to-gold-lo font-bold text-on-gold disabled:opacity-40"
          >
            حفظ الخطة
          </button>
        )}

        <button
          type="button"
          onClick={generate}
          className="mt-2 min-h-tap w-full rounded-control border border-gold text-sm font-bold text-gold"
        >
          توليد رسالة الخطة
        </button>

        {messageError !== null && (
          <p className="mt-3 rounded-control border border-behind/30 bg-behind/10 px-3 py-2 text-sm text-behind">
            {messageError}
          </p>
        )}

        {message !== null && (
          <div className="mt-3">
            <textarea
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              rows={18}
              className="report-text w-full rounded-control border border-line-soft bg-surface-raised p-3 text-sm text-ink"
            />
            <button
              type="button"
              onClick={copy}
              className="mt-2 min-h-tap w-full rounded-control bg-gradient-to-br from-gold-hi via-gold to-gold-lo font-bold text-on-gold"
            >
              {copied ? 'تم النسخ' : 'نسخ للواتساب'}
            </button>
          </div>
        )}
      </div>
    </section>
  );
}

/** Only the shifts an outlet actually runs are offered. */
function shiftOptions(outlet: RouteOutlet): readonly ('day' | 'night')[] {
  return outlet.shiftMode === 'dual' ? ['day', 'night'] : [outlet.shiftMode];
}

export { businessTomorrow };
