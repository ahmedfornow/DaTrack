/**
 * The working screen: ribbon, entry, list.
 *
 * One primary action — logging a sale. Everything else is quieter or hidden.
 * The ribbon stays pinned so the day and outlet being logged against never
 * scroll out of view.
 */

import { SessionRibbon } from './SessionRibbon';
import { SaleEntry } from './SaleEntry';
import { SessionList } from './SessionList';
import { ReportPanel } from './ReportPanel';
import type { Session } from '../../data/attendance';
import type { Combination, NewSale, Sale } from '../../data/sales';

export interface WorkScreenProps {
  readonly promoterName: string;
  readonly session: Session;
  readonly sales: readonly Sale[];
  readonly shortcuts: readonly Combination[];
  readonly dailyTarget: number | null;
  readonly gtTarget: number | null;
  readonly isToday: boolean;
  readonly busy: boolean;
  readonly error: string | null;
  readonly monthLabel: string;
  readonly onLogSale: (
    draft: Omit<NewSale, 'attendanceId' | 'promoterId' | 'workDate'>,
  ) => void;
  readonly onRemoveSale: (saleId: number) => void;
  readonly onSaveGuidedTrials: (count: number) => void;
  readonly onReturnToToday: () => void;
  readonly onSignOut: () => void;
  readonly onDismissError: () => void;
}

export function WorkScreen({
  promoterName,
  session,
  sales,
  shortcuts,
  dailyTarget,
  gtTarget,
  isToday,
  busy,
  error,
  onLogSale,
  onRemoveSale,
  onSaveGuidedTrials,
  onReturnToToday,
  onSignOut,
  onDismissError,
}: WorkScreenProps) {
  const lasCount = sales.filter((sale) => sale.customerType === 'LAS').length;

  return (
    <main className="mx-auto w-full max-w-[440px] px-4 pb-10 pt-3">
      <SessionRibbon
        outletName={session.outlet?.name ?? 'موقعك'}
        shift={session.workingShift}
        workDate={session.workDate}
        isToday={isToday}
        lasCount={lasCount}
        dailyTarget={dailyTarget}
        onReturnToToday={isToday ? undefined : onReturnToToday}
      />

      {error !== null && (
        <div
          role="alert"
          className="mb-3 flex items-start justify-between gap-3 rounded-control border border-behind/30 bg-behind/10 px-3 py-2"
        >
          <p className="text-sm text-behind">{error}</p>
          <button
            type="button"
            onClick={onDismissError}
            aria-label="إخفاء التنبيه"
            className="shrink-0 text-behind"
          >
            ✕
          </button>
        </div>
      )}

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
