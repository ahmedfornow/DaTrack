import { useEffect, useState } from 'react';
import { LoginScreen } from './features/auth/LoginScreen';
import { PromoterFlow } from './features/promoter/PromoterFlow';
import { SupervisorFlow } from './features/supervisor/SupervisorFlow';
import { restoreSession } from './features/auth/session';
import type { Profile } from './features/auth/profile';

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

  return (
    <SupervisorFlow profile={profile} onSignedOut={() => setStage({ kind: 'signed-out' })} />
  );
}
