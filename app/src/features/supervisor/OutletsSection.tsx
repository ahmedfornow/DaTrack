/**
 * Adding and editing outlets.
 *
 * This existed in the legacy app and was missed in the rebuild — `createOutlet`
 * and `updateOutlet` sat in `data/outlets.ts` with no caller for months, so the
 * supervisor could deactivate an outlet but never add one or fix a typo. The
 * parity checklist recorded it as done, which is how it stayed invisible.
 *
 * One form serves both. The alternative — a separate "add" form and an "edit"
 * form — drifts: a field added to one gets forgotten in the other, and the
 * sanitiser then sees two differently-shaped drafts.
 *
 * Validation lives in `prepareOutlet`, not here. It collapses whitespace, caps
 * every length, and rejects anything in the map field that is not a URL — that
 * last rule exists because a page of pasted text once reached the field and
 * printed inside the team's route message for weeks. Re-checking any of it here
 * would create a second answer to the same question; the form only refuses to
 * submit an empty name, which is about the button, not the data.
 */

import { useState, type ReactNode } from 'react';
import { SHIFT_LABEL, SHIFT_MODE_LABEL } from '../../domain/labels';
import { shiftsFor } from '../../domain/rules';
import type { ShiftMode } from '../../domain/values';
import type { Outlet, OutletDraft } from '../../data/outlets';

export interface OutletsSectionProps {
  readonly outlets: readonly Outlet[];
  readonly busy: boolean;
  readonly onToggle: (id: number, active: boolean) => void;
  readonly onCreate: (draft: OutletDraft) => void;
  readonly onSave: (id: number, draft: OutletDraft) => void;
}

export function OutletsSection({
  outlets,
  busy,
  onToggle,
  onCreate,
  onSave,
}: OutletsSectionProps) {
  // `'new'` is a third state beside "closed" and "editing id N", so adding and
  // editing cannot both be open and fight over the same form.
  const [open, setOpen] = useState<number | 'new' | null>(null);

  return (
    <div>
      {open === 'new' ? (
        <div className="mb-3 rounded-control border border-gold/30 bg-surface-raised p-3">
          <h3 className="mb-2 text-sm font-bold text-ink">موقع جديد</h3>
          <OutletForm
            busy={busy}
            onSubmit={(draft) => {
              onCreate(draft);
              setOpen(null);
            }}
            onCancel={() => setOpen(null)}
          />
        </div>
      ) : (
        <button
          type="button"
          disabled={busy}
          onClick={() => setOpen('new')}
          className="mb-3 min-h-tap w-full rounded-control border border-dashed border-line text-sm text-muted disabled:opacity-40"
        >
          إضافة موقع
        </button>
      )}

      {outlets.length === 0 ? (
        <p className="py-4 text-center text-sm text-faint">لا مواقع</p>
      ) : (
        <ul className="space-y-2">
          {outlets.map((outlet) => (
            <li
              key={outlet.id}
              className={`rounded-control border border-line-soft bg-surface-raised px-3 py-2 ${
                outlet.active ? '' : 'opacity-50'
              }`}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm text-ink">{outlet.shortName}</p>
                  <p className="truncate text-xs text-muted">
                    {outlet.unicode !== null && (
                      <span className="tabular" dir="ltr">
                        {outlet.unicode} ·{' '}
                      </span>
                    )}
                    {shiftsFor(outlet.shiftMode)
                      .map((shift) => SHIFT_LABEL[shift])
                      .join(' + ')}
                    {outlet.isDs && ' · DS'}
                    {outlet.mapsUrl !== null && ' · 📍'}
                    {outlet.area !== null && ` · ${outlet.area}`}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setOpen(open === outlet.id ? null : outlet.id)}
                    aria-expanded={open === outlet.id}
                    className="min-h-tap rounded-control border border-line px-3 text-xs text-muted disabled:opacity-40"
                  >
                    تعديل
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => onToggle(outlet.id, !outlet.active)}
                    className="min-h-tap rounded-control border border-line px-3 text-xs text-muted disabled:opacity-40"
                  >
                    {outlet.active ? 'إيقاف' : 'تفعيل'}
                  </button>
                </div>
              </div>

              {open === outlet.id && (
                <div className="mt-2 border-t border-line-soft pt-2">
                  <OutletForm
                    initial={outlet}
                    busy={busy}
                    onSubmit={(draft) => {
                      onSave(outlet.id, draft);
                      setOpen(null);
                    }}
                    onCancel={() => setOpen(null)}
                  />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const FIELD =
  'min-h-tap w-full rounded-control border border-line-soft bg-surface px-3 text-sm text-ink';

function OutletForm({
  initial,
  busy,
  onSubmit,
  onCancel,
}: {
  initial?: Outlet;
  busy: boolean;
  onSubmit: (draft: OutletDraft) => void;
  onCancel: () => void;
}) {
  /*
   * The name field carries the FULL stored name, `QAS_Outlet Name_TYPE_MN_BR`,
   * not the shortened display form. It is the unique key and the route message
   * prints it whole, so an editor showing only the middle segment would quietly
   * rewrite the rest on save.
   */
  const [name, setName] = useState(initial?.name ?? '');
  const [unicode, setUnicode] = useState(initial?.unicode ?? '');
  const [mapsUrl, setMapsUrl] = useState(initial?.mapsUrl ?? '');
  const [shiftMode, setShiftMode] = useState<ShiftMode>(initial?.shiftMode ?? 'day');
  const [isDs, setIsDs] = useState(initial?.isDs ?? false);
  const [area, setArea] = useState(initial?.area ?? '');

  return (
    <div className="space-y-2">
      <Field label="الاسم الكامل" hint="QAS_Name_TYPE_MN_BR">
        <input
          type="text"
          value={name}
          maxLength={70}
          onChange={(event) => setName(event.target.value)}
          className={FIELD}
          dir="ltr"
        />
      </Field>

      <div className="grid grid-cols-2 gap-2">
        <Field label="كود POS">
          <input
            type="text"
            value={unicode}
            maxLength={24}
            onChange={(event) => setUnicode(event.target.value)}
            className={`${FIELD} tabular`}
            dir="ltr"
          />
        </Field>
        <Field label="المنطقة">
          <input
            type="text"
            value={area}
            maxLength={60}
            onChange={(event) => setArea(event.target.value)}
            placeholder="بريدة"
            className={FIELD}
          />
        </Field>
      </div>

      <Field label="رابط الخريطة" hint="https:// only">
        <input
          type="url"
          value={mapsUrl}
          onChange={(event) => setMapsUrl(event.target.value)}
          placeholder="https://maps.app.goo.gl/"
          className={FIELD}
          dir="ltr"
        />
      </Field>

      <Field label="الفترات">
        <div className="grid grid-cols-3 gap-2">
          {(['day', 'night', 'dual'] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              disabled={busy}
              aria-pressed={shiftMode === mode}
              onClick={() => setShiftMode(mode)}
              className={`min-h-tap rounded-control border text-xs disabled:opacity-40 ${
                shiftMode === mode ? 'border-gold bg-gold/15 text-gold' : 'border-line text-muted'
              }`}
            >
              {SHIFT_MODE_LABEL[mode]}
            </button>
          ))}
        </div>
      </Field>

      <button
        type="button"
        disabled={busy}
        aria-pressed={isDs}
        onClick={() => setIsDs(!isDs)}
        className={`min-h-tap w-full rounded-control border text-xs disabled:opacity-40 ${
          isDs ? 'border-gold bg-gold/15 text-gold' : 'border-line text-muted'
        }`}
      >
        {isDs ? 'Direct Sales — مفعّل' : 'Direct Sales'}
      </button>

      <div className="grid grid-cols-2 gap-2 pt-1">
        <button
          type="button"
          disabled={busy || name.trim() === ''}
          onClick={() => onSubmit({ name, unicode, mapsUrl, shiftMode, isDs, area })}
          className="min-h-tap rounded-control bg-gradient-to-br from-gold-hi via-gold to-gold-lo text-sm font-bold text-on-gold disabled:opacity-40"
        >
          حفظ
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onCancel}
          className="min-h-tap rounded-control border border-line text-sm text-muted disabled:opacity-40"
        >
          إلغاء
        </button>
      </div>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 flex items-baseline justify-between gap-2">
        <span className="text-xs text-muted">{label}</span>
        {hint !== undefined && (
          <span className="text-xs text-faint" dir="ltr">
            {hint}
          </span>
        )}
      </span>
      {children}
    </label>
  );
}
