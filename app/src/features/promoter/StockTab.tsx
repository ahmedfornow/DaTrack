/**
 * The stock count.
 *
 * Saved quantities are loaded with the catalog and shown in the inputs, so a
 * promoter re-opening this tab can see what they already counted. The legacy
 * screen renders blank every time, which makes a saved count indistinguishable
 * from an unsaved one — and makes the copied message come out empty.
 *
 * The message is built from the values held here, never from the input
 * elements, so a reload cannot silently empty it.
 */

import { useState } from 'react';
import type { BusinessDate } from '../../lib/businessDay';
import type { StockItem } from '../../data/stock';
import { buildStockMessage, countedSummary } from '../reports/stockCount';
import { stockItemLabel } from '../../domain/labels';
import { quantitiesOf, stockDraft } from './stockDraft';

export interface StockTabProps {
  readonly catalog: readonly StockItem[];
  /** Item id to quantity, as loaded from the database. */
  readonly saved: ReadonlyMap<number, number>;
  readonly outletName: string;
  readonly workDate: BusinessDate;
  readonly busy: boolean;
  readonly onSave: (entries: readonly { itemId: number; quantity: number }[]) => void;
}

const HEADING: Record<string, string> = {
  device: 'الأجهزة',
  terea: 'TEREA',
  other: 'أخرى',
};

export function StockTab({
  catalog,
  saved,
  outletName,
  workDate,
  busy,
  onSave,
}: StockTabProps) {
  // Only what has been typed. Saved counts are laid underneath on every
  // render — see stockDraft.ts for why copying them in once went wrong.
  const [edits, setEdits] = useState<ReadonlyMap<number, string>>(new Map());
  const [message, setMessage] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const draft = stockDraft(saved, edits);
  const quantities = quantitiesOf(draft);

  const progress = countedSummary(catalog, quantities);

  const setValue = (id: number, raw: string) => {
    const cleaned = raw.replace(/\D/gu, '');
    setEdits((current) => new Map(current).set(id, cleaned));
  };

  const generate = () => {
    setMessage(buildStockMessage({ outletName, workDate, catalog, quantities }));
    setCopied(false);
  };

  const copy = () => {
    if (message === null) return;
    void navigator.clipboard.writeText(message).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    });
  };

  let lastCategory = '';

  return (
    <section className="space-y-3">
      <div className="rounded-card border border-line bg-surface p-4">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-md font-bold text-ink">جرد المخزون</h2>
          <p className="tabular text-xs text-muted" dir="ltr">
            {progress.counted}/{progress.total}
          </p>
        </div>

        {saved.size > 0 && (
          <p className="mt-2 text-xs text-muted">
            محفوظ مسبقاً: {saved.size} صنف — عدّل ما تحتاجه واحفظ مرة أخرى
          </p>
        )}

        <div className="mt-3">
          {catalog.map((item) => {
            const heading = item.category !== lastCategory ? item.category : null;
            lastCategory = item.category;
            const label = stockItemLabel(item.itemName);
            return (
              <div key={item.id}>
                {heading !== null && (
                  <p className="mt-4 mb-1 text-xs font-bold tracking-wide text-gold">
                    {HEADING[heading] ?? heading}
                  </p>
                )}
                <div className="flex items-center justify-between gap-3 border-b border-line-soft py-2">
                  <label htmlFor={`stk-${item.id}`} className="min-w-0 flex-1 text-sm text-ink">
                    {label}
                  </label>
                  <input
                    id={`stk-${item.id}`}
                    type="text"
                    inputMode="numeric"
                    value={draft.get(item.id) ?? ''}
                    onChange={(event) => setValue(item.id, event.target.value)}
                    placeholder="—"
                    dir="ltr"
                    className="tabular h-11 w-20 shrink-0 rounded-control border border-line-soft bg-surface-raised text-center text-md text-ink"
                  />
                </div>
              </div>
            );
          })}
        </div>

        <button
          type="button"
          disabled={busy || quantities.size === 0}
          onClick={() =>
            onSave([...quantities].map(([itemId, quantity]) => ({ itemId, quantity })))
          }
          className="mt-4 min-h-tap w-full rounded-control bg-gradient-to-br from-gold-hi via-gold to-gold-lo font-bold text-on-gold disabled:opacity-40"
        >
          حفظ الجرد
        </button>

        <button
          type="button"
          onClick={generate}
          className="mt-2 min-h-tap w-full rounded-control border border-gold text-sm font-bold text-gold"
        >
          توليد رسالة الجرد
        </button>

        {message !== null && (
          <div className="mt-3">
            {!progress.complete && (
              <p className="mb-2 rounded-control border border-close/30 bg-close/10 px-3 py-2 text-sm text-close">
                عدّيت {progress.counted} من {progress.total} صنف — الباقي سيظهر فارغاً في الرسالة
              </p>
            )}
            <textarea
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              rows={14}
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
