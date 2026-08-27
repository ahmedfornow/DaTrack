import { useEffect, useState } from 'react';
import { LoginScreen } from './features/auth/LoginScreen';
import { PromoterFlow } from './features/promoter/PromoterFlow';
import { restoreSession, signOut } from './features/auth/session';
import type { Profile } from './features/auth/profile';
import { businessToday } from './lib/businessDay';

type Stage =
  | { kind: 'restoring' }
  | { kind: 'signed-out' }
  | { kind: 'signed-in'; profile: Profile };

export function App() {
  const [stage, setStage] = useState<Stage>({ kind: 'restoring' });

  useEffect(() => {
    let live = true;
    void restoreSession().then((outcome) => {
      if (!live) return;
      // A session that no longer authorises — deactivated since the last
      // visit — is torn down by restoreSession and lands back on login.
      setStage(
        outcome?.ok ? { kind: 'signed-in', profile: outcome.profile } : { kind: 'signed-out' },
      );
    });
    return () => {
      live = false;
    };
  }, []);

  if (stage.kind === 'restoring') {
    return (
      <main className="flex min-h-svh items-center justify-center">
        <p className="text-sm text-muted" aria-live="polite">
          جاري التحميل…
        </p>
      </main>
    );
  }

  if (stage.kind === 'signed-out') {
    return <LoginScreen onSignedIn={(profile) => setStage({ kind: 'signed-in', profile })} />;
  }

  const { profile } = stage;

  if (profile.role === 'promoter') {
    return (
      <PromoterFlow profile={profile} onSignedOut={() => setStage({ kind: 'signed-out' })} />
    );
  }

  // Supervisor and manager surfaces are Phase 3.
  return (
    <main className="mx-auto w-full max-w-[440px] px-4 py-6">
      <div className="rounded-card border border-line bg-surface p-6">
        <p className="text-sm text-muted">حياك الله</p>
        <p className="mt-1 text-xl font-bold text-gold">{profile.fullName}</p>
        <dl className="mt-4 space-y-1 text-sm text-muted">
          <div className="flex justify-between gap-4">
            <dt>الصلاحية</dt>
            <dd className="text-ink">{profile.role}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt>المدينة</dt>
            <dd className="text-ink">{profile.city}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt>يوم العمل</dt>
            <dd className="tabular text-ink" dir="ltr">
              {businessToday()}
            </dd>
          </div>
        </dl>

        <p className="mt-5 border-t border-line-soft pt-4 text-xs leading-relaxed text-muted">
          المرحلة الأولى: تسجيل الدخول فقط. شاشات المبيعات والمشرف تأتي في المرحلة التالية.
        </p>

        <button
          type="button"
          onClick={() => {
            void signOut().then(() => setStage({ kind: 'signed-out' }));
          }}
          className="mt-4 min-h-tap w-full rounded-control border border-line-soft bg-transparent text-sm text-muted transition-colors hover:border-line"
        >
          تسجيل خروج
        </button>
      </div>
    </main>
  );
}
