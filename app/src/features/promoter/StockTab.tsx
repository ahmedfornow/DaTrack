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
  // Seeded from what is stored, so the form starts as a true picture.
  const [draft, setDraft] = useState<ReadonlyMap<number, string>>(
    () => new Map([...saved].map(([id, quantity]) => [id, String(quantity)])),
  );
  const [message, setMessage] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const quantities = new Map<number, number>();
  for (const [id, raw] of draft) {
    if (raw.trim() === '') continue;
    const parsed = Number.parseInt(raw, 10);
    if (Number.isFinite(parsed) && parsed >= 0) quantities.set(id, parsed);
  }

  const progress = countedSummary(catalog, quantities);

  const setValue = (id: number, raw: string) => {
    const cleaned = raw.replace(/\D/gu, '');
    setDraft((current) => {
      const next = new Map(current);
      if (cleaned === '') next.delete(id);
      else next.set(id, cleaned);
      return next;
    });
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
            const label = item.itemName.replace('IQOS ILUMA i ', '').replace('IQOS ', '');
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
