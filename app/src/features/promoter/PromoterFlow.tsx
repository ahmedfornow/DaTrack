/**
 * The promoter surface: resolve the day, then log against it.
 *
 * Opening the app lands straight on the work screen when the day is already
 * registered — the sign-in screen is never shown twice for the same day. That
 * is what makes the two-tap goal reachable: by the time a promoter looks at the
 * screen, they are already logging.
 *
 * Per-tab data loads lazily, so opening the app does not wait on the stock
 * catalog or a month of attendance before the first sale can be logged.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  addDays,
  businessToday,
  isBusinessToday,
  type BusinessDate,
} from '../../lib/businessDay';
import { ATTENDANCE_STATUS_LABEL, SHIFT_LABEL } from '../../domain/labels';
import type { AttendanceStatus, Shift } from '../../domain/values';
import type { Profile } from '../auth/profile';
import { signOut } from '../auth/session';
import * as attendance from '../../data/attendance';
import * as checklistData from '../../data/checklist';
import * as outletsData from '../../data/outlets';
import * as salesData from '../../data/sales';
import * as stockData from '../../data/stock';
import * as targetsData from '../../data/targets';
import type { Outlet } from '../../data/outlets';
import type { Sale } from '../../data/sales';
import { SignInScreen } from './SignInScreen';
import { WorkScreen, type PromoterTab } from './WorkScreen';

export interface PromoterFlowProps {
  readonly profile: Profile;
  readonly onSignedOut: () => void;
}

type Phase =
  | { kind: 'loading' }
  | { kind: 'sign-in' }
  | { kind: 'working'; session: attendance.Session };

export function PromoterFlow({ profile, onSignedOut }: PromoterFlowProps) {
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const [tab, setTab] = useState<PromoterTab>('sales');
  const [outlets, setOutlets] = useState<readonly Outlet[]>([]);
  const [date, setDate] = useState<BusinessDate>(businessToday());
  const [daySessions, setDaySessions] = useState<readonly attendance.Session[]>([]);
  const [monthSessions, setMonthSessions] = useState<readonly attendance.Session[]>([]);
  const [sales, setSales] = useState<readonly Sale[]>([]);
  const [shortcuts, setShortcuts] = useState<readonly salesData.Combination[]>([]);
  const [dailyTarget, setDailyTarget] = useState<number | null>(null);
  const [gtTarget, setGtTarget] = useState<number | null>(null);
  const [stockCatalog, setStockCatalog] = useState<readonly stockData.StockItem[]>([]);
  const [savedStock, setSavedStock] = useState<ReadonlyMap<number, number>>(new Map());
  const [checklistItems, setChecklistItems] = useState<readonly checklistData.ChecklistItem[]>([]);
  const [checkedItems, setCheckedItems] = useState<ReadonlySet<number>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const flash = (message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice(null), 2500);
  };

  // --- initial load -------------------------------------------------------
  useEffect(() => {
    let live = true;
    void (async () => {
      const [outletResult, todayResult] = await Promise.all([
        outletsData.listActive(profile.city),
        attendance.sessionsOn(profile.id, businessToday()),
      ]);
      if (!live) return;

      if (outletResult.ok) setOutlets(outletResult.data);
      else setError(outletResult.error.message);

      const rows = todayResult.ok ? todayResult.data : [];
      setDaySessions(rows);
      const working = rows.find((s) => s.status === 'work');
      if (working !== undefined) {
        setPhase({ kind: 'working', session: working });
        setTab('sales');
      } else if (rows.length > 0) {
        // A leave day: nothing to log, so land on the days list.
        const first = rows[0];
        if (first !== undefined) {
          setPhase({ kind: 'working', session: first });
          setTab('days');
        }
      } else {
        setPhase({ kind: 'sign-in' });
      }
    })();
    return () => {
      live = false;
    };
  }, [profile.id, profile.city]);

  // --- what is already recorded for the date being considered -------------
  useEffect(() => {
    if (phase.kind !== 'sign-in') return;
    let live = true;
    void attendance.sessionsOn(profile.id, date).then((result) => {
      if (!live) return;
      setDaySessions(result.ok ? result.data : []);
    });
    return () => {
      live = false;
    };
  }, [phase.kind, profile.id, date]);

  const loadSession = useCallback(async (session: attendance.Session) => {
    const [saleResult, targetResult, recentResult] = await Promise.all([
      salesData.listForSession(session.id),
      session.touchPointId !== null && session.workingShift !== null
        ? targetsData.forSession(
            session.touchPointId,
            session.workingShift,
            session.workDate.slice(0, 7),
          )
        : Promise.resolve({ ok: true as const, data: null }),
      salesData.listRecentForPromoter(session.promoterId, addDays(businessToday(), -14)),
    ]);

    if (saleResult.ok) setSales(saleResult.data);
    else setError(saleResult.error.message);

    const target = targetResult.ok ? targetResult.data : null;
    setDailyTarget(target?.dailyTarget ?? null);
    setGtTarget(target?.gtTarget ?? null);

    // Seed the shortcuts from recent history so they are useful on the first
    // sale of a shift, not only after the long path has been walked once.
    if (recentResult.ok) {
      setShortcuts(
        salesData.rankCombinations(
          [...(saleResult.ok ? saleResult.data : []), ...recentResult.data],
          4,
        ),
      );
    }
  }, []);

  useEffect(() => {
    if (phase.kind !== 'working' || phase.session.status !== 'work') return;
    void loadSession(phase.session);
  }, [phase, loadSession]);

  // --- lazy per-tab loads -------------------------------------------------
  useEffect(() => {
    if (phase.kind !== 'working' || tab !== 'stock') return;
    const session = phase.session;
    let live = true;
    void (async () => {
      const [catalogResult, countsResult] = await Promise.all([
        stockCatalog.length > 0
          ? Promise.resolve({ ok: true as const, data: [...stockCatalog] })
          : stockData.listCatalog(),
        stockData.countsForSession(session.id),
      ]);
      if (!live) return;
      if (catalogResult.ok) setStockCatalog(catalogResult.data);
      else setError(catalogResult.error.message);
      if (countsResult.ok) setSavedStock(stockData.indexCounts(countsResult.data));
    })();
    return () => {
      live = false;
    };
  }, [phase, tab, stockCatalog]);

  useEffect(() => {
    if (phase.kind !== 'working' || tab !== 'check') return;
    const session = phase.session;
    let live = true;
    void (async () => {
      const [itemResult, checkedResult] = await Promise.all([
        checklistData.listItems(),
        checklistData.checkedOn(profile.id, session.workDate),
      ]);
      if (!live) return;
      if (itemResult.ok) setChecklistItems(itemResult.data);
      else setError(itemResult.error.message);
      if (checkedResult.ok) setCheckedItems(checkedResult.data);
    })();
    return () => {
      live = false;
    };
  }, [phase, tab, profile.id]);

  const refreshMonth = useCallback(async () => {
    const result = await attendance.sessionsThisMonth(profile.id);
    if (result.ok) setMonthSessions(result.data);
    else setError(result.error.message);
  }, [profile.id]);

  useEffect(() => {
    if (phase.kind !== 'working' || tab !== 'days') return;
    void refreshMonth();
  }, [phase.kind, tab, refreshMonth]);

  // --- actions ------------------------------------------------------------

  const handleSignIn = async (request: {
    status: AttendanceStatus;
    touchPointId: number | null;
    shift: Shift | null;
  }) => {
    setBusy(true);
    setError(null);
    const result = await attendance.signIn({
      promoterId: profile.id,
      date,
      status: request.status,
      touchPointId: request.touchPointId,
      shift: request.shift,
    });
    setBusy(false);

    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    setPhase({ kind: 'working', session: result.data });
    setTab(result.data.status === 'work' ? 'sales' : 'days');
  };

  const handleLogSale = async (
    draft: Omit<salesData.NewSale, 'attendanceId' | 'promoterId' | 'workDate'>,
  ) => {
    if (phase.kind !== 'working') return;
    const { session } = phase;

    // Optimistic: the count moves now. A slow network must never look like a
    // failed tap, because the response to that is tapping again.
    const optimistic: Sale = {
      id: -Date.now(),
      attendanceId: session.id,
      promoterId: profile.id,
      workDate: session.workDate,
      deviceType: draft.deviceType,
      color: draft.color,
      saleType: draft.saleType,
      customerType: draft.customerType,
      quantity: 1,
      // Not yet created, so it has no creation time. Inventing one here would
      // be a device-local timestamp masquerading as a server fact.
      createdAt: null,
    };
    setSales((current) => [optimistic, ...current]);
    setError(null);

    const result = await salesData.create({
      attendanceId: session.id,
      promoterId: profile.id,
      workDate: session.workDate,
      ...draft,
    });

    if (!result.ok) {
      // Reconcile by removing exactly the row we added, not the newest one.
      setSales((current) => current.filter((s) => s.id !== optimistic.id));
      setError(result.error.message);
      return;
    }
    const saved = result.data;
    setSales((current) => current.map((s) => (s.id === optimistic.id ? saved : s)));
  };

  const handleRemoveSale = async (saleId: number) => {
    const previous = sales;
    setSales((current) => current.filter((s) => s.id !== saleId));
    const result = await salesData.removeOne(saleId, profile.id);
    if (!result.ok) {
      setSales(previous);
      setError(result.error.message);
    }
  };

  const handleSaveGuidedTrials = async (count: number) => {
    if (phase.kind !== 'working') return;
    const result = await attendance.setGuidedTrials(phase.session.id, count);
    if (!result.ok) setError(result.error.message);
  };

  const handleSaveStock = async (
    entries: readonly { itemId: number; quantity: number }[],
  ) => {
    if (phase.kind !== 'working') return;
    setBusy(true);
    const result = await stockData.saveCounts(phase.session.id, profile.id, entries);
    setBusy(false);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    setSavedStock(new Map(entries.map((entry) => [entry.itemId, entry.quantity])));
    flash(`تم حفظ ${result.data} صنف`);
  };

  const handleToggleCheck = async (itemId: number, next: boolean) => {
    if (phase.kind !== 'working') return;
    const previous = checkedItems;
    // Optimistic: a checkbox that waits on the network reads as broken.
    setCheckedItems((current) => {
      const updated = new Set(current);
      if (next) updated.add(itemId);
      else updated.delete(itemId);
      return updated;
    });
    const result = await checklistData.setChecked(
      itemId,
      profile.id,
      phase.session.workDate,
      next,
    );
    if (!result.ok) {
      setCheckedItems(previous);
      setError(result.error.message);
    }
  };

  const handleRemoveDay = async (session: attendance.Session) => {
    setBusy(true);
    const result = await attendance.removeSession(session.id, profile.id);
    setBusy(false);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    await refreshMonth();
    // Deleting the day currently being worked leaves nothing to log against.
    if (phase.kind === 'working' && phase.session.id === session.id) {
      setPhase({ kind: 'sign-in' });
      setDate(businessToday());
    }
  };

  // --- render -------------------------------------------------------------

  const existingHint = useMemo(() => {
    if (daySessions.length === 0) return null;
    const labels = daySessions
      .map((s) =>
        s.status === 'work' && s.workingShift !== null
          ? SHIFT_LABEL[s.workingShift]
          : ATTENDANCE_STATUS_LABEL[s.status],
      )
      .join(' + ');
    return `مسجل مسبقاً: ${labels}`;
  }, [daySessions]);

  if (phase.kind === 'loading') {
    return (
      <main className="flex min-h-svh items-center justify-center">
        <p className="text-sm text-muted" aria-live="polite">
          جاري التحميل…
        </p>
      </main>
    );
  }

  if (phase.kind === 'sign-in') {
    const existing = daySessions[0];
    return (
      <SignInScreen
        promoterName={profile.fullName}
        outlets={outlets}
        date={date}
        onDateChange={setDate}
        existingHint={existingHint}
        onOpenExisting={
          existing !== undefined
            ? () => {
                setPhase({ kind: 'working', session: existing });
                setTab(existing.status === 'work' ? 'sales' : 'days');
              }
            : undefined
        }
        plannedNote={null}
        busy={busy}
        error={error}
        onSubmit={(request) => void handleSignIn(request)}
        onSignOut={() => void signOut().then(onSignedOut)}
        initialOutletId={null}
      />
    );
  }

  const { session } = phase;
  return (
    <WorkScreen
      promoterName={profile.fullName}
      session={session}
      tab={tab}
      onTabChange={setTab}
      sales={sales}
      shortcuts={shortcuts}
      dailyTarget={dailyTarget}
      gtTarget={gtTarget}
      isToday={isBusinessToday(session.workDate)}
      stockCatalog={stockCatalog}
      savedStock={savedStock}
      checklistItems={checklistItems}
      checkedItems={checkedItems}
      monthSessions={monthSessions}
      busy={busy}
      error={error}
      notice={notice}
      onLogSale={(draft) => void handleLogSale(draft)}
      onRemoveSale={(id) => void handleRemoveSale(id)}
      onSaveGuidedTrials={(count) => void handleSaveGuidedTrials(count)}
      onSaveStock={(entries) => void handleSaveStock(entries)}
      onToggleCheck={(itemId, next) => void handleToggleCheck(itemId, next)}
      onOpenSession={(next) => {
        setPhase({ kind: 'working', session: next });
        setTab(next.status === 'work' ? 'sales' : 'days');
      }}
      onRegisterDay={(next) => {
        setDate(next);
        setPhase({ kind: 'sign-in' });
      }}
      onRemoveDay={(next) => void handleRemoveDay(next)}
      onReturnToToday={() => {
        setDate(businessToday());
        setPhase({ kind: 'sign-in' });
      }}
      onSignOut={() => void signOut().then(onSignedOut)}
      onDismissError={() => setError(null)}
    />
  );
}
