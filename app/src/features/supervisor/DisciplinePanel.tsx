/**
 * Warnings and pay deductions.
 *
 * Either the supervisor or the manager records one, and both see the whole
 * list — this is shared by design, so two people cannot hold different accounts
 * of what happened.
 *
 * The promoter concerned sees none of it. Nobody should learn their pay was cut
 * from a phone screen before a person has spoken to them; that is enforced in
 * RLS, not here, so it holds regardless of what this component does.
 *
 * The form disables Save and says why, rather than letting an incomplete record
 * be composed and then rejected by a constraint the user cannot interpret. A
 * deduction needs an amount; `other` needs an explanation.
 */

import { useState } from 'react';
import { businessToday, formatReportDate, type BusinessDate } from '../../lib/businessDay';
import {
  DISCIPLINE_AMOUNT_LABEL,
  DISCIPLINE_KIND_LABEL,
  DISCIPLINE_REASON_LABEL,
} from '../../domain/labels';
import {
  DisciplineAmount,
  DisciplineKind,
  DisciplineReason,
  type DisciplineAmount as AmountValue,
  type DisciplineKind as KindValue,
  type DisciplineReason as ReasonValue,
} from '../../domain/values';
import {
  MAX_NOTE_LENGTH,
  validateRecord,
  type DisciplineRecord,
  type NewRecord,
} from '../../data/discipline';

export interface DisciplinePanelProps {
  readonly records: readonly DisciplineRecord[];
  /** Active promoters, for the picker. */
  readonly promoters: readonly { id: string; fullName: string }[];
  /** Every user who could have recorded something, for the "by" line. */
  readonly names: ReadonlyMap<string, string>;
  readonly busy: boolean;
  readonly onCreate: (record: NewRecord) => void;
  readonly onRemove: (id: number) => void;
}

const EMPTY: NewRecord = {
  promoterId: '',
  workDate: businessToday(),
  kind: 'deduction',
  amount: 'half_day',
  reason: 'no_show',
  note: '',
};

export function DisciplinePanel({
  records,
  promoters,
  names,
  busy,
  onCreate,
  onRemove,
}: DisciplinePanelProps) {
  const [draft, setDraft] = useState<NewRecord>(EMPTY);
  const [adding, setAdding] = useState(false);
  const [confirming, setConfirming] = useState<number | null>(null);

  const problem = validateRecord(draft);

  const set = <K extends keyof NewRecord>(key: K, value: NewRecord[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  /** A warning carries no amount — the database rejects one that does. */
  const setKind = (kind: KindValue) =>
    setDraft((current) => ({
      ...current,
      kind,
      amount: kind === 'deduction' ? (current.amount ?? 'half_day') : null,
    }));

  const submit = () => {
    if (problem !== null) return;
    onCreate(draft);
    setDraft({ ...EMPTY, workDate: draft.workDate });
    setAdding(false);
  };

  return (
    <div className="space-y-3">
      {adding ? (
        <div className="rounded-control border border-line-soft bg-surface-raised p-3">
          <Field label="المندوب">
            <select
              value={draft.promoterId}
              onChange={(event) => set('promoterId', event.target.value)}
              className="min-h-tap w-full rounded-control border border-line-soft bg-surface px-3 text-sm text-ink"
            >
              <option value="">— اختر —</option>
              {promoters.map((promoter) => (
                <option key={promoter.id} value={promoter.id}>
                  {promoter.fullName}
                </option>
              ))}
            </select>
          </Field>

          <Field label="التاريخ">
            <input
              type="date"
              value={draft.workDate}
              max={businessToday()}
              onChange={(event) => set('workDate', event.target.value as BusinessDate)}
              className="min-h-tap w-full rounded-control border border-line-soft bg-surface px-3 text-sm text-ink"
              dir="ltr"
            />
          </Field>

          <Field label="النوع">
            <Choices
              values={DisciplineKind.values}
              value={draft.kind}
              label={(kind) => DISCIPLINE_KIND_LABEL[kind]}
              onPick={setKind}
            />
          </Field>

          {draft.kind === 'deduction' && (
            <Field label="مقدار الخصم">
              <Choices
                values={DisciplineAmount.values}
                value={draft.amount}
                label={(amount) => DISCIPLINE_AMOUNT_LABEL[amount]}
                onPick={(amount: AmountValue) => set('amount', amount)}
              />
            </Field>
          )}

          <Field label="السبب">
            <Choices
              values={DisciplineReason.values}
              value={draft.reason}
              label={(reason) => DISCIPLINE_REASON_LABEL[reason]}
              onPick={(reason: ReasonValue) => set('reason', reason)}
            />
          </Field>

          {draft.reason === 'other' && (
            <Field label="اكتب السبب">
              <input
                type="text"
                value={draft.note}
                maxLength={MAX_NOTE_LENGTH}
                onChange={(event) => set('note', event.target.value)}
                placeholder="مثال: ترك الموقع بدون إذن"
                className="min-h-tap w-full rounded-control border border-line-soft bg-surface px-3 text-sm text-ink"
              />
            </Field>
          )}

          {problem !== null && <p className="mb-2 text-xs text-behind">{problem}</p>}

          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              disabled={busy || problem !== null}
              onClick={submit}
              className="min-h-tap rounded-control bg-gradient-to-br from-gold-hi via-gold to-gold-lo text-sm font-bold text-on-gold disabled:opacity-40"
            >
              تسجيل
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setAdding(false);
                setDraft(EMPTY);
              }}
              className="min-h-tap rounded-control border border-line text-sm text-muted disabled:opacity-40"
            >
              إلغاء
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          disabled={busy}
          onClick={() => setAdding(true)}
          className="min-h-tap w-full rounded-control border border-line text-sm font-bold text-ink disabled:opacity-40"
        >
          تسجيل إنذار أو خصم
        </button>
      )}

      {records.length === 0 ? (
        <p className="py-4 text-center text-sm text-faint">لا سجلات</p>
      ) : (
        <ul className="space-y-2">
          {records.map((record) => (
            <li
              key={record.id}
              className="rounded-control border border-line-soft bg-surface-raised px-3 py-2"
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="truncate text-sm font-bold text-ink">
                  {names.get(record.promoterId) ?? '—'}
                </span>
                <span
                  className={`shrink-0 rounded-full border px-2 py-0.5 text-xs ${
                    record.kind === 'deduction'
                      ? 'border-behind/30 bg-behind/10 text-behind'
                      : 'border-close/30 bg-close/10 text-close'
                  }`}
                >
                  {record.kind === 'deduction' && record.amount !== null
                    ? `${DISCIPLINE_KIND_LABEL.deduction} ${DISCIPLINE_AMOUNT_LABEL[record.amount]}`
                    : DISCIPLINE_KIND_LABEL[record.kind]}
                </span>
              </div>

              <p className="mt-0.5 text-xs text-muted">
                {record.reason === 'other' && record.note !== null
                  ? record.note
                  : DISCIPLINE_REASON_LABEL[record.reason]}
              </p>

              <div className="mt-1 flex items-center justify-between gap-2">
                <span className="tabular text-xs text-faint" dir="ltr">
                  {formatReportDate(record.workDate)}
                  {' · '}
                  {names.get(record.createdBy) ?? '—'}
                </span>

                {confirming === record.id ? (
                  <span className="flex items-center gap-1">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        onRemove(record.id);
                        setConfirming(null);
                      }}
                      className="min-h-tap rounded-control px-2 text-xs font-bold text-behind disabled:opacity-40"
                    >
                      تأكيد
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirming(null)}
                      className="min-h-tap rounded-control px-2 text-xs text-muted"
                    >
                      إلغاء
                    </button>
                  </span>
                ) : (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setConfirming(record.id)}
                    aria-label="حذف السجل"
                    className="min-h-tap w-9 text-behind disabled:opacity-40"
                  >
                    ✕
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-2">
      <span className="mb-1 block text-xs text-muted">{label}</span>
      {children}
    </div>
  );
}

function Choices<T extends string>({
  values,
  value,
  label,
  onPick,
}: {
  values: readonly T[];
  value: T | null;
  label: (value: T) => string;
  onPick: (value: T) => void;
}) {
  return (
    <div className={`grid gap-2 ${values.length > 2 ? 'grid-cols-3' : 'grid-cols-2'}`}>
      {values.map((option) => (
        <button
          key={option}
          type="button"
          aria-pressed={value === option}
          onClick={() => onPick(option)}
          className={`min-h-tap rounded-control border text-xs transition-colors ${
            value === option
              ? 'border-gold bg-gold/10 font-bold text-gold'
              : 'border-line-soft bg-surface text-ink'
          }`}
        >
          {label(option)}
        </button>
      ))}
    </div>
  );
}
