/**
 * Sale entry.
 *
 * The legacy flow is five taps every time: device, colour, sale type, customer,
 * submit. That is the cost paid on every single sale, standing in a shop with a
 * customer waiting.
 *
 * Here the common case is one tap. A promoter's most frequent combinations —
 * seeded from the last two weeks, not just this session, so they are useful on
 * the first sale of a shift — are offered as tiles that log immediately. The
 * four-grid picker is still there underneath for anything new, but it is no
 * longer the default path.
 *
 * Writes are optimistic: the count moves on tap and reconciles after. A slow
 * network must never look like a failed tap, because the promoter's response to
 * that is to tap again and log a duplicate.
 */

import { useState } from 'react';
import {
  CATALOG,
  colorsFor,
  shortNameOf,
  type DeviceColor,
  type DeviceType,
} from '../../domain/devices';
import { saleTypeAfterCustomerChange } from '../../domain/rules';
import { CustomerType, SaleType } from '../../domain/values';
import type { Combination, NewSale } from '../../data/sales';
import { validateSale } from '../../data/sales';

export interface SaleEntryProps {
  readonly shortcuts: readonly Combination[];
  readonly busy: boolean;
  readonly onLog: (sale: Omit<NewSale, 'attendanceId' | 'promoterId' | 'workDate'>) => void;
}

const DEVICES = Object.keys(CATALOG) as DeviceType[];

export function SaleEntry({ shortcuts, busy, onLog }: SaleEntryProps) {
  const [expanded, setExpanded] = useState(false);
  const [device, setDevice] = useState<DeviceType | null>(null);
  const [color, setColor] = useState<DeviceColor | null>(null);
  const [saleType, setSaleType] = useState<SaleType | null>(null);
  const [customerType, setCustomerType] = useState<CustomerType | null>(null);
  const [blocked, setBlocked] = useState<string | null>(null);

  const reset = () => {
    setDevice(null);
    setColor(null);
    setSaleType(null);
    setCustomerType(null);
    setBlocked(null);
  };

  const complete =
    device !== null && color !== null && saleType !== null && customerType !== null;

  const submitCustom = () => {
    if (!complete) return;
    const problem = validateSale({
      attendanceId: 0,
      promoterId: '',
      workDate: '2000-01-01',
      deviceType: device,
      color,
      saleType,
      customerType,
    });
    if (problem !== null) {
      setBlocked(problem);
      return;
    }
    onLog({ deviceType: device, color, saleType, customerType });
    reset();
  };

  return (
    <section className="space-y-3">
      {shortcuts.length > 0 && (
        <div>
          <h2 className="mb-2 text-xs tracking-wide text-muted">الأكثر تسجيلاً — اضغط للتسجيل</h2>
          <div className="grid grid-cols-2 gap-2">
            {shortcuts.map((combo) => (
              <button
                key={`${combo.deviceType}|${combo.color}|${combo.saleType}|${combo.customerType}`}
                type="button"
                disabled={busy}
                onClick={() =>
                  onLog({
                    deviceType: combo.deviceType,
                    color: combo.color,
                    saleType: combo.saleType,
                    customerType: combo.customerType,
                  })
                }
                className="min-h-tap rounded-control border border-line bg-surface-raised px-3 py-2 text-right transition-colors active:bg-gold/10 disabled:opacity-50"
              >
                <span className="block text-sm font-bold text-ink">
                  {shortNameOf(combo.deviceType)}
                </span>
                <span className="mt-0.5 block truncate text-xs text-muted" dir="ltr">
                  {combo.color}
                </span>
                <span className="mt-1 block text-xs text-gold" dir="ltr">
                  {combo.saleType} · {combo.customerType}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={() => setExpanded((open) => !open)}
        className="min-h-tap w-full rounded-control border border-dashed border-line text-sm text-gold"
        aria-expanded={expanded}
      >
        {expanded ? 'إخفاء' : shortcuts.length > 0 ? 'تسجيل عملية مختلفة' : 'تسجيل بيع'}
      </button>

      {expanded && (
        <div className="space-y-3 rounded-card border border-line bg-surface p-4">
          <Field label="الجهاز">
            <div className="grid grid-cols-3 gap-2">
              {DEVICES.map((option) => (
                <Choice
                  key={option}
                  active={device === option}
                  onClick={() => {
                    setDevice(option);
                    setColor(null);
                    setBlocked(null);
                  }}
                >
                  {shortNameOf(option)}
                </Choice>
              ))}
            </div>
          </Field>

          <Field label="اللون">
            {device === null ? (
              <p className="text-xs text-faint">اختر الجهاز أولاً</p>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                {colorsFor(device).map((option) => (
                  <Choice key={option} active={color === option} onClick={() => setColor(option)}>
                    <span dir="ltr">{option}</span>
                  </Choice>
                ))}
              </div>
            )}
          </Field>

          <Field label="نوع البيع">
            <div className="grid grid-cols-2 gap-2">
              {SaleType.values.map((option) => {
                // Blocking the tap and saying why beats letting an invalid pair
                // be composed and rejected on submit.
                const forbidden =
                  customerType === 'LAU' && (option === 'MGM' || option === 'SK+MGM');
                return (
                  <Choice
                    key={option}
                    active={saleType === option}
                    disabled={forbidden}
                    onClick={() => {
                      if (forbidden) {
                        setBlocked('عروض MGM لعملاء LAS فقط');
                        return;
                      }
                      setSaleType(option);
                      setBlocked(null);
                    }}
                  >
                    <span dir="ltr">{option}</span>
                  </Choice>
                );
              })}
            </div>
          </Field>

          <Field label="العميل">
            <div className="grid grid-cols-2 gap-2">
              {CustomerType.values.map((option) => (
                <Choice
                  key={option}
                  active={customerType === option}
                  onClick={() => {
                    setCustomerType(option);
                    // Switching to LAU clears an MGM selection rather than
                    // silently keeping an invalid pair.
                    const kept = saleTypeAfterCustomerChange(saleType, option);
                    if (kept !== saleType) {
                      setSaleType(kept);
                      setBlocked('عروض MGM لعملاء LAS فقط — أعد اختيار نوع البيع');
                    } else {
                      setBlocked(null);
                    }
                  }}
                >
                  <span dir="ltr">{option}</span>
                </Choice>
              ))}
            </div>
          </Field>

          {blocked !== null && (
            <p className="rounded-control border border-behind/30 bg-behind/10 px-3 py-2 text-sm text-behind">
              {blocked}
            </p>
          )}

          <button
            type="button"
            disabled={!complete || busy}
            onClick={submitCustom}
            className="min-h-tap w-full rounded-control bg-gradient-to-br from-gold-hi via-gold to-gold-lo font-bold text-on-gold disabled:opacity-40"
          >
            تسجيل البيع
          </button>
        </div>
      )}
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1.5 text-xs text-muted">{label}</p>
      {children}
    </div>
  );
}

function Choice({
  active,
  disabled = false,
  onClick,
  children,
}: {
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`min-h-tap rounded-control border px-2 text-sm transition-colors ${
        active
          ? 'border-gold bg-gold/10 font-bold text-gold'
          : 'border-line-soft bg-surface-raised text-ink'
      } ${disabled ? 'opacity-35' : ''}`}
    >
      {children}
    </button>
  );
}
