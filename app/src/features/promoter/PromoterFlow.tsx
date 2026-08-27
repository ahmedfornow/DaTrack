/**
 * The promoter surface: resolve the day, then log against it.
 *
 * Opening the app lands straight on the work screen when the day is already
 * registered — the sign-in screen is never shown twice for the same day. That
 * is what makes the two-tap goal reachable: by the time a promoter looks at the
 * screen, they are already logging.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  addDays,
  businessMonth,
  businessToday,
  isBusinessToday,
  type BusinessDate,
} from '../../lib/businessDay';
import { ATTENDANCE_STATUS_LABEL, SHIFT_LABEL } from '../../domain/labels';
import type { AttendanceStatus, Shift } from '../../domain/values';
import type { Profile } from '../auth/profile';
import { signOut } from '../auth/session';
import * as attendance from '../../data/attendance';
import * as outletsData from '../../data/outlets';
import * as salesData from '../../data/sales';
import * as targetsData from '../../data/targets';
import type { Outlet } from '../../data/outlets';
import type { Sale } from '../../data/sales';
import { SignInScreen } from './SignInScreen';
import { WorkScreen } from './WorkScreen';

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
  const [outlets, setOutlets] = useState<readonly Outlet[]>([]);
  const [date, setDate] = useState<BusinessDate>(businessToday());
  const [daySessions, setDaySessions] = useState<readonly attendance.Session[]>([]);
  const [sales, setSales] = useState<readonly Sale[]>([]);
  const [shortcuts, setShortcuts] = useState<readonly salesData.Combination[]>([]);
  const [dailyTarget, setDailyTarget] = useState<number | null>(null);
  const [gtTarget, setGtTarget] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // --- initial load: outlets, then today's session if there is one ---------
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

      if (todayResult.ok && todayResult.data.length > 0) {
        const working = todayResult.data.find((s) => s.status === 'work');
        const session = working ?? todayResult.data[0];
        if (session !== undefined) {
          setDaySessions(todayResult.data);
          setPhase(
            session.status === 'work'
              ? { kind: 'working', session }
              : { kind: 'sign-in' },
          );
          if (session.status !== 'work') setDaySessions(todayResult.data);
          return;
        }
      }
      setPhase({ kind: 'sign-in' });
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
      const seeded = salesData.rankCombinations(
        [...(saleResult.ok ? saleResult.data : []), ...recentResult.data],
        4,
      );
      setShortcuts(seeded);
    }
  }, []);

  useEffect(() => {
    if (phase.kind !== 'working') return;
    void loadSession(phase.session);
  }, [phase, loadSession]);

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
    if (result.data.status === 'work') setPhase({ kind: 'working', session: result.data });
    else setDaySessions([result.data]);
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
      // be a device-local timestamp masquerading as a server fact — and the
      // row's position in the list comes from being prepended, not from this.
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

  const handleSaveGuidedTrials = async (count: number) => {
    if (phase.kind !== 'working') return;
    // Persisted when the report is generated, matching the legacy behaviour.
    const result = await attendance.setGuidedTrials(phase.session.id, count);
    if (!result.ok) setError(result.error.message);
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
    const workSession = daySessions.find((s) => s.status === 'work');
    return (
      <SignInScreen
        promoterName={profile.fullName}
        outlets={outlets}
        date={date}
        onDateChange={setDate}
        existingHint={existingHint}
        onOpenExisting={
          workSession !== undefined
            ? () => setPhase({ kind: 'working', session: workSession })
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
      sales={sales}
      shortcuts={shortcuts}
      dailyTarget={dailyTarget}
      gtTarget={gtTarget}
      isToday={isBusinessToday(session.workDate)}
      busy={busy}
      error={error}
      monthLabel={businessMonth()}
      onLogSale={(draft) => void handleLogSale(draft)}
      onRemoveSale={(id) => void handleRemoveSale(id)}
      onSaveGuidedTrials={(count) => void handleSaveGuidedTrials(count)}
      onReturnToToday={() => {
        setDate(businessToday());
        setPhase({ kind: 'sign-in' });
      }}
      onSignOut={() => void signOut().then(onSignedOut)}
      onDismissError={() => setError(null)}
    />
  );
}
