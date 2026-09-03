/**
 * The supervisor surface.
 *
 * Leads with the status strip, deliberately. The first question every morning
 * is "what is wrong right now", and the legacy dashboard answers a different
 * one — it opens on totals, and the gaps have to be inferred from them.
 *
 * A manager sees the same view read-only, with a city switcher. Their role is
 * read-only in RLS too, so nothing here needs to hide write controls for
 * safety; they are hidden because offering an action that will be refused is
 * worse than not offering it.
 */

import { useCallback, useEffect, useState } from 'react';
import { businessToday, businessTomorrow, type BusinessDate } from '../../lib/businessDay';
import type { Profile } from '../auth/profile';
import { signOut } from '../auth/session';
import * as outletsData from '../../data/outlets';
import * as supervisorData from '../../data/supervisor';
import { StatusStrip } from './StatusStrip';
import { Overview } from './Overview';
import { TeamPanel } from './TeamPanel';
import { RoutePlanEditor } from './RoutePlanEditor';
import * as routePlansData from '../../data/routePlans';
import type { PlanMap } from '../../data/routePlans';
import type { RouteOutlet } from '../reports/routePlanMessage';
import { AdminPanel } from './AdminPanel';
import * as targetsData from '../../data/targets';
import * as tasksData from '../../data/tasks';
import type { Outlet } from '../../data/outlets';
import type { TeamMember } from '../../data/supervisor';
import type { SupTask } from '../../data/tasks';
import type { PeriodKind } from '../reports/periodSummary';
import type { StatusReport } from './status';

type SupervisorTab = 'status' | 'overview' | 'team' | 'plan' | 'admin';

const TABS: { id: SupervisorTab; label: string }[] = [
  { id: 'status', label: 'الوضع' },
  { id: 'overview', label: 'الإجماليات' },
  { id: 'team', label: 'الفريق' },
  { id: 'plan', label: 'الخطة' },
  { id: 'admin', label: 'إدارة' },
];

export interface SupervisorFlowProps {
  readonly profile: Profile;
  readonly onSignedOut: () => void;
}

const EMPTY_STATUS: StatusReport = {
  notReported: [],
  unstaffed: [],
  missingTargets: [],
  checklistGaps: [],
  allClear: true,
};

export function SupervisorFlow({ profile, onSignedOut }: SupervisorFlowProps) {
  const isManager = profile.role === 'manager';

  const [city, setCity] = useState(profile.city);
  const [cities, setCities] = useState<readonly string[]>([profile.city]);
  const [status, setStatus] = useState<StatusReport>(EMPTY_STATUS);
  const [date, setDate] = useState<BusinessDate>(businessToday());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [tab, setTab] = useState<SupervisorTab>('status');
  const [period, setPeriod] = useState<PeriodKind>('today');
  const [dashboard, setDashboard] = useState<supervisorData.DashboardData | null>(null);
  const [dashboardLoading, setDashboardLoading] = useState(false);

  const [planDate, setPlanDate] = useState<BusinessDate>(businessTomorrow());
  const [picks, setPicks] = useState<PlanMap>(new Map());
  const [planOutlets, setPlanOutlets] = useState<readonly RouteOutlet[]>([]);
  const [planPromoters, setPlanPromoters] = useState<readonly { id: string; fullName: string }[]>([]);
  const [planNotice, setPlanNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // The plan needs its own outlet and promoter lists, and reloads whenever the
  // date changes — a different day has a different plan.
  useEffect(() => {
    if (tab !== 'plan') return;
    let live = true;
    void (async () => {
      const [outletResult, teamResult, planResult] = await Promise.all([
        outletsData.listActive(city),
        supervisorData.listTeam(city),
        routePlansData.loadPlan(planDate),
      ]);
      if (!live) return;

      if (outletResult.ok) {
        setPlanOutlets(
          outletResult.data.map((outlet) => ({
            id: outlet.id,
            name: outlet.name,
            unicode: outlet.unicode,
            mapsUrl: outlet.mapsUrl,
            shiftMode: outlet.shiftMode,
            isDs: outlet.isDs,
          })),
        );
      }
      if (teamResult.ok) {
        setPlanPromoters(
          teamResult.data
            .filter((member) => member.role === 'promoter' && member.active)
            .map((member) => ({ id: member.id, fullName: member.fullName })),
        );
      }
      if (planResult.ok) setPicks(planResult.data);
      else setError(planResult.error.message);
    })();
    return () => {
      live = false;
    };
  }, [tab, city, planDate]);

  const [adminOutlets, setAdminOutlets] = useState<readonly Outlet[]>([]);
  const [adminTargets, setAdminTargets] = useState<targetsData.TargetTable>(new Map());
  const [adminTeam, setAdminTeam] = useState<readonly TeamMember[]>([]);
  const [adminTasks, setAdminTasks] = useState<readonly SupTask[]>([]);
  const [adminNotice, setAdminNotice] = useState<string | null>(null);

  const loadAdmin = useCallback(async () => {
    const [outletResult, targetResult, teamResult, taskResult] = await Promise.all([
      outletsData.listAll(city),
      targetsData.tableForMonth(),
      supervisorData.listTeam(city),
      tasksData.listTasks(profile.id),
    ]);
    if (outletResult.ok) setAdminOutlets(outletResult.data);
    if (targetResult.ok) setAdminTargets(targetResult.data);
    if (teamResult.ok) setAdminTeam(teamResult.data);
    if (taskResult.ok) setAdminTasks(taskResult.data);
    else setError(taskResult.error.message);
  }, [city, profile.id]);

  useEffect(() => {
    if (tab !== 'admin') return;
    void loadAdmin();
  }, [tab, loadAdmin]);

  const flashAdmin = (message: string) => {
    setAdminNotice(message);
    window.setTimeout(() => setAdminNotice(null), 2500);
  };

  const runAdmin = async (
    action: () => Promise<{ ok: true; data: unknown } | { ok: false; error: { message: string } }>,
    success: string,
  ) => {
    setSaving(true);
    const result = await action();
    setSaving(false);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    setError(null);
    flashAdmin(success);
    await loadAdmin();
  };

  const savePlan = async () => {
    setSaving(true);
    setPlanNotice(null);
    const result = await routePlansData.savePlan({
      date: planDate,
      createdBy: profile.id,
      promoterIds: planPromoters.map((p) => p.id),
      picks,
      outlets: planOutlets.map((o) => ({ id: o.id, name: o.name })),
    });
    setSaving(false);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    setError(null);
    setPlanNotice(`حُفظت خطة ${planDate} (${result.data} تعيين)`);
  };

  // The dashboard is a heavier read than the status strip, so it loads only
  // when a tab that needs it is open.
  useEffect(() => {
    if (tab !== 'overview' && tab !== 'team') return;
    let live = true;
    setDashboardLoading(true);
    void supervisorData.loadDashboard(city, period).then((result) => {
      if (!live) return;
      setDashboardLoading(false);
      if (result.ok) setDashboard(result.data);
      else setError(result.error.message);
    });
    return () => {
      live = false;
    };
  }, [tab, city, period]);

  // Only a manager switches city; a supervisor is pinned to their own.
  useEffect(() => {
    if (!isManager) return;
    let live = true;
    void outletsData.listCities().then((result) => {
      if (!live) return;
      if (result.ok && result.data.length > 0) setCities(result.data);
    });
    return () => {
      live = false;
    };
  }, [isManager]);

  const refresh = useCallback(async (forCity: string) => {
    setLoading(true);
    const result = await supervisorData.loadStatus(forCity);
    setLoading(false);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    setError(null);
    setStatus(result.data.status);
    setDate(result.data.date);
  }, []);

  useEffect(() => {
    void refresh(city);
  }, [city, refresh]);

  return (
    <main className="mx-auto w-full max-w-app px-4 pb-10 pt-4">
      <header className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs text-muted">
            {isManager ? 'المدير — قراءة فقط' : 'المشرف'}
          </p>
          <p className="truncate text-lg font-bold text-gold">{profile.fullName}</p>
        </div>
        <button
          type="button"
          onClick={() => void signOut().then(onSignedOut)}
          className="min-h-tap shrink-0 rounded-control border border-line-soft px-4 text-xs text-muted"
        >
          خروج
        </button>
      </header>

      {isManager && cities.length > 1 && (
        <div className="mb-4">
          <label htmlFor="city" className="mb-1.5 block text-xs text-muted">
            المدينة
          </label>
          <select
            id="city"
            value={city}
            onChange={(event) => setCity(event.target.value)}
            className="min-h-tap w-full rounded-control border border-line-soft bg-surface-raised px-3 text-md text-ink"
          >
            {cities.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </div>
      )}

      {error !== null && (
        <div
          role="alert"
          className="mb-3 rounded-control border border-behind/30 bg-behind/10 px-3 py-2 text-sm text-behind"
        >
          {error}
        </div>
      )}

      <div role="tablist" className="mb-3 flex gap-1.5">
        {TABS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            role="tab"
            aria-selected={tab === entry.id}
            onClick={() => setTab(entry.id)}
            className={`min-h-tap flex-1 rounded-control border text-sm transition-colors ${
              tab === entry.id
                ? 'border-gold bg-gold/10 font-bold text-gold'
                : 'border-line-soft bg-surface text-muted'
            }`}
          >
            {entry.label}
          </button>
        ))}
      </div>

      {tab === 'status' && (
        <>
          <StatusStrip status={status} date={date} city={city} loading={loading} />
          <button
            type="button"
            onClick={() => void refresh(city)}
            disabled={loading}
            className="mt-3 min-h-tap w-full rounded-control border border-line text-sm text-gold disabled:opacity-40"
          >
            تحديث
          </button>
        </>
      )}

      {tab === 'overview' && (
        <Overview
          city={city}
          period={period}
          onPeriodChange={setPeriod}
          data={dashboard}
          loading={dashboardLoading}
          canExport={!isManager}
        />
      )}

      {tab === 'team' &&
        (dashboard === null ? (
          <p className="rounded-card border border-line bg-surface px-4 py-6 text-center text-sm text-muted">
            جاري التحميل…
          </p>
        ) : (
          <TeamPanel
            compliance={dashboard.compliance}
            byPromoter={dashboard.sales.byPromoter}
            byOutlet={dashboard.sales.byOutlet}
            byDevice={dashboard.sales.byDevice}
            byColor={dashboard.sales.byColor}
            totalSales={dashboard.sales.total}
            stock={dashboard.stock}
          />
        ))}

      {tab === 'plan' && (
        <RoutePlanEditor
          city={city}
          date={planDate}
          onDateChange={setPlanDate}
          outlets={planOutlets}
          promoters={planPromoters}
          picks={picks}
          onPicksChange={setPicks}
          busy={saving}
          notice={planNotice}
          onSave={() => void savePlan()}
          readOnly={isManager}
        />
      )}

      {tab === 'admin' &&
        (isManager ? (
          <p className="rounded-card border border-line bg-surface px-4 py-6 text-center text-sm text-muted">
            الإدارة متاحة للمشرف فقط
          </p>
        ) : (
          <AdminPanel
            city={city}
            outlets={adminOutlets}
            targets={adminTargets}
            team={adminTeam}
            tasks={adminTasks}
            busy={saving}
            notice={adminNotice}
            onSaveTargets={(entries) =>
              void runAdmin(() => targetsData.saveTargets(entries), 'حُفظت الأهداف')
            }
            onToggleOutlet={(id, active) =>
              void runAdmin(
                () => outletsData.setOutletActive(id, active),
                active ? 'تم تفعيل الموقع' : 'تم إيقاف الموقع',
              )
            }
            onSaveMember={(id, fullName, loginNumber) =>
              void runAdmin(
                () => supervisorData.updateMember(id, fullName, loginNumber),
                'تم الحفظ',
              )
            }
            onToggleMember={(id, active) =>
              void runAdmin(
                () => supervisorData.setMemberActive(id, active),
                active ? 'تم التفعيل' : 'تم الإيقاف',
              )
            }
            onAddTask={(title, kind, weekday) =>
              void runAdmin(
                () => tasksData.addTask(profile.id, { title, kind, weekday, dueDate: null }),
                'تمت الإضافة',
              )
            }
            onToggleTask={(id, done) =>
              void runAdmin(() => tasksData.setTaskDone(id, profile.id, done), 'تم التحديث')
            }
            onRemoveTask={(id) =>
              void runAdmin(() => tasksData.removeTask(id, profile.id), 'تم الحذف')
            }
            onResetTasks={() =>
              void runAdmin(() => tasksData.resetTasks(profile.id), 'تمت إعادة التعيين')
            }
          />
        ))}
    </main>
  );
}
