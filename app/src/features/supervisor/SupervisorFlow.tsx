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
import { businessToday, type BusinessDate } from '../../lib/businessDay';
import type { Profile } from '../auth/profile';
import { signOut } from '../auth/session';
import * as outletsData from '../../data/outlets';
import * as supervisorData from '../../data/supervisor';
import { StatusStrip } from './StatusStrip';
import type { StatusReport } from './status';

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
    <main className="mx-auto w-full max-w-[440px] px-4 pb-10 pt-4">
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

      <StatusStrip status={status} date={date} city={city} loading={loading} />

      <button
        type="button"
        onClick={() => void refresh(city)}
        disabled={loading}
        className="mt-3 min-h-tap w-full rounded-control border border-line text-sm text-gold disabled:opacity-40"
      >
        تحديث
      </button>

      <p className="mt-6 border-t border-line-soft pt-4 text-xs leading-relaxed text-faint">
        الإجماليات، الفريق، الخطة والإدارة تأتي في التحديث القادم.
      </p>
    </main>
  );
}
