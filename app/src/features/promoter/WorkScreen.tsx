/**
 * The working screen: ribbon, then one tab at a time.
 *
 * Tab visibility follows the legacy rules, which encode real constraints rather
 * than preference. Stock and checklist belong to the day being worked *now*, so
 * they disappear when logging against a past day — backfilling yesterday's
 * sales must not offer to count yesterday's stock. A non-work day has nothing
 * to log at all and lands on the days list.
 */

import type { ReactNode } from 'react';
import { SessionRibbon } from './SessionRibbon';
import { SaleEntry } from './SaleEntry';
import { SessionList } from './SessionList';
import { ReportPanel } from './ReportPanel';
import { StockTab } from './StockTab';
import { ChecklistTab } from './ChecklistTab';
import { MyDaysTab } from './MyDaysTab';
import { PendingBadge } from './PendingBadge';
import type { BusinessDate } from '../../lib/businessDay';
import type { Session } from '../../data/attendance';
import type { Combination, NewSale, Sale } from '../../data/sales';
import type { StockItem } from '../../data/stock';
import type { ChecklistItem } from '../../data/checklist';

export type PromoterTab = 'sales' | 'stock' | 'check' | 'days';

export interface WorkScreenProps {
  readonly promoterName: string;
  readonly session: Session;
  readonly tab: PromoterTab;
  readonly onTabChange: (tab: PromoterTab) => void;

  readonly sales: readonly Sale[];
  readonly shortcuts: readonly Combination[];
  readonly dailyTarget: number | null;
  readonly gtTarget: number | null;
  readonly isToday: boolean;

  readonly stockCatalog: readonly StockItem[];
  readonly savedStock: ReadonlyMap<number, number>;
  readonly checklistItems: readonly ChecklistItem[];
  readonly checkedItems: ReadonlySet<number>;
  readonly monthSessions: readonly Session[];

  readonly busy: boolean;
  readonly error: string | null;
  readonly notice: string | null;
  readonly queuedPending: number;
  readonly queuedFailed: number;
  readonly online: boolean;
  readonly onRetryQueue: () => void;

  readonly onLogSale: (draft: Omit<NewSale, 'attendanceId' | 'promoterId' | 'workDate'>) => void;
  readonly onRemoveSale: (saleId: number) => void;
  readonly onSaveGuidedTrials: (count: number) => void;
  readonly onSaveStock: (entries: readonly { itemId: number; quantity: number }[]) => void;
  readonly onToggleCheck: (itemId: number, next: boolean) => void;
  readonly onOpenSession: (session: Session) => void;
  readonly onRegisterDay: (date: BusinessDate) => void;
  readonly onRemoveDay: (session: Session) => void;
  readonly onReturnToToday: () => void;
  readonly onSignOut: () => void;
  readonly onDismissError: () => void;
}

export function WorkScreen(props: WorkScreenProps) {
  const {
    promoterName,
    session,
    tab,
    onTabChange,
    sales,
    shortcuts,
    dailyTarget,
    gtTarget,
    isToday,
    stockCatalog,
    savedStock,
    checklistItems,
    checkedItems,
    monthSessions,
    busy,
    error,
    notice,
    queuedPending,
    queuedFailed,
    online,
    onRetryQueue,
    onLogSale,
    onRemoveSale,
    onSaveGuidedTrials,
    onSaveStock,
    onToggleCheck,
    onOpenSession,
    onRegisterDay,
    onRemoveDay,
    onReturnToToday,
    onSignOut,
    onDismissError,
  } = props;

  const working = session.status === 'work';
  const lasCount = sales.filter((sale) => sale.customerType === 'LAS').length;

  const tabs: { id: PromoterTab; label: string; visible: boolean }[] = [
    { id: 'sales', label: 'المبيعات', visible: working },
    { id: 'stock', label: 'المخزون', visible: working && isToday },
    { id: 'check', label: 'التشيك', visible: working && isToday },
    { id: 'days', label: 'أيامي', visible: true },
  ];
  const visible = tabs.filter((entry) => entry.visible);
  const active = visible.some((entry) => entry.id === tab) ? tab : 'days';

  return (
    <main className="mx-auto w-full max-w-app px-4 pb-10 pt-3">
      <SessionRibbon
        outletName={session.outlet?.name ?? 'موقعك'}
        shift={session.workingShift}
        workDate={session.workDate}
        isToday={isToday}
        lasCount={lasCount}
        dailyTarget={dailyTarget}
        onReturnToToday={isToday ? undefined : onReturnToToday}
      />

      {!working && (
        <p className="mb-3 rounded-control border border-achieved/25 bg-achieved/8 px-3 py-2 text-center text-sm text-achieved">
          يومك مسجل — لا مهام مطلوبة اليوم
        </p>
      )}

      {visible.length > 1 && (
        <div role="tablist" className="mb-3 flex gap-1.5">
          {visible.map((entry) => (
            <button
              key={entry.id}
              type="button"
              role="tab"
              aria-selected={active === entry.id}
              onClick={() => onTabChange(entry.id)}
              className={`min-h-tap flex-1 rounded-control border text-sm transition-colors ${
                active === entry.id
                  ? 'border-gold bg-gold/10 font-bold text-gold'
                  : 'border-line-soft bg-surface text-muted'
              }`}
            >
              {entry.label}
            </button>
          ))}
        </div>
      )}

      <PendingBadge
        pending={queuedPending}
        failed={queuedFailed}
        online={online}
        onRetry={onRetryQueue}
      />

      {error !== null && (
        <Banner tone="error" onDismiss={onDismissError}>
          {error}
        </Banner>
      )}
      {notice !== null && <Banner tone="ok">{notice}</Banner>}

      {active === 'sales' && (
        <>
          <SaleEntry shortcuts={shortcuts} busy={busy} onLog={onLogSale} />
          <div className="mt-5">
            <SessionList sales={sales} onRemoveOne={onRemoveSale} busy={busy} />
          </div>
          {session.workingShift !== null && (
            <div className="mt-5">
              <ReportPanel
                outletName={session.outlet?.name ?? ''}
                workDate={session.workDate}
                shift={session.workingShift}
                sales={[...sales].reverse()}
                target={dailyTarget}
                gtTarget={gtTarget}
                onSaveGuidedTrials={onSaveGuidedTrials}
              />
            </div>
          )}
        </>
      )}

      {active === 'stock' && (
        <StockTab
          catalog={stockCatalog}
          saved={savedStock}
          outletName={session.outlet?.name ?? ''}
          workDate={session.workDate}
          busy={busy}
          onSave={onSaveStock}
        />
      )}

      {active === 'check' && (
        <ChecklistTab
          items={checklistItems}
          checked={checkedItems}
          busy={busy}
          onToggle={onToggleCheck}
        />
      )}

      {active === 'days' && (
        <MyDaysTab
          sessions={monthSessions}
          busy={busy}
          onOpenSession={onOpenSession}
          onRegisterDay={onRegisterDay}
          onRemoveDay={onRemoveDay}
        />
      )}

      <footer className="mt-8 flex items-center justify-between gap-3 border-t border-line-soft pt-4">
        <p className="truncate text-xs text-faint">{promoterName}</p>
        <button
          type="button"
          onClick={onSignOut}
          className="min-h-tap shrink-0 rounded-control border border-line-soft px-4 text-xs text-muted"
        >
          تسجيل خروج
        </button>
      </footer>
    </main>
  );
}

function Banner({
  tone,
  children,
  onDismiss,
}: {
  tone: 'error' | 'ok';
  children: ReactNode;
  onDismiss?: () => void;
}) {
  const style =
    tone === 'error'
      ? 'border-behind/30 bg-behind/10 text-behind'
      : 'border-achieved/30 bg-achieved/10 text-achieved';
  return (
    <div role="alert" className={`mb-3 flex items-start justify-between gap-3 rounded-control border px-3 py-2 ${style}`}>
      <p className="text-sm">{children}</p>
      {onDismiss !== undefined && (
        <button type="button" onClick={onDismiss} aria-label="إخفاء التنبيه" className="shrink-0">
          ✕
        </button>
      )}
    </div>
  );
}
