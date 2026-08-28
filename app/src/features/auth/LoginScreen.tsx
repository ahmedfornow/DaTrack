import { useId, useRef, useState, type FormEvent } from 'react';
import { signIn } from './session';
import type { Profile } from './profile';

interface LoginScreenProps {
  onSignedIn: (profile: Profile) => void;
}

/**
 * One primary action, nothing else on the screen. Both fields are numeric-first
 * because every login number is digits and most passwords are too, and the
 * keyboard that opens is the one the promoter needs.
 */
export function LoginScreen({ onSignedIn }: LoginScreenProps) {
  const [loginNumber, setLoginNumber] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const numberId = useId();
  const passwordId = useId();
  const errorId = useId();
  const passwordRef = useRef<HTMLInputElement>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;

    setBusy(true);
    setError(null);
    const outcome = await signIn(loginNumber, password);
    setBusy(false);

    if (outcome.ok) {
      onSignedIn(outcome.profile);
      return;
    }

    setError(outcome.message);
    // Never clear the login number — retyping it on every failed attempt is a
    // tax on the person least likely to have got it wrong.
    setPassword('');
    passwordRef.current?.focus();
  }

  const field =
    'w-full rounded-control border border-line-soft bg-surface-raised px-4 ' +
    'py-3 text-center text-md text-ink tabular tracking-[0.25em] ' +
    'transition-colors placeholder:tracking-normal placeholder:text-faint ' +
    'focus:border-gold focus:outline-none';

  return (
    <main className="mx-auto flex min-h-svh w-full max-w-app flex-col justify-center px-4 py-6">
      <header className="mb-7 text-center">
        <h1 className="text-2xl font-light tracking-wide">
          Da
          <b className="bg-gradient-to-l from-gold-lo to-gold-hi bg-clip-text font-bold text-transparent">
            Tracker
          </b>
        </h1>
        <p className="mt-1 text-xs uppercase tracking-[0.2em] text-muted">
          Your Report Assistant
        </p>
        <div className="mx-auto mt-4 h-px w-14 bg-gradient-to-l from-transparent via-gold to-transparent" />
      </header>

      <form
        onSubmit={handleSubmit}
        noValidate
        className="rounded-card border border-line bg-surface p-6 shadow-[0_12px_32px_rgba(0,0,0,0.35)]"
      >
        <h2 className="mb-4 text-lg font-medium">تسجيل الدخول</h2>

        <label htmlFor={numberId} className="mb-1.5 block text-sm text-muted">
          رقم المستخدم
        </label>
        <input
          id={numberId}
          value={loginNumber}
          onChange={(event) => setLoginNumber(event.target.value)}
          type="text"
          inputMode="numeric"
          autoComplete="username"
          maxLength={4}
          placeholder="• • • •"
          disabled={busy}
          aria-invalid={error !== null}
          aria-describedby={error ? errorId : undefined}
          className={field}
        />

        <label htmlFor={passwordId} className="mb-1.5 mt-4 block text-sm text-muted">
          كلمة المرور
        </label>
        <input
          id={passwordId}
          ref={passwordRef}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          type="password"
          inputMode="numeric"
          autoComplete="current-password"
          placeholder="• • • • • • •"
          disabled={busy}
          aria-invalid={error !== null}
          aria-describedby={error ? errorId : undefined}
          className={field}
        />

        <button
          type="submit"
          disabled={busy}
          className="mt-5 min-h-tap w-full rounded-control bg-gradient-to-bl from-gold-hi via-gold to-gold-lo px-4 text-md font-bold text-on-gold shadow-[0_6px_18px_rgba(216,189,132,0.18)] transition-transform active:translate-y-px disabled:cursor-wait disabled:opacity-45"
        >
          {busy ? 'جاري الدخول…' : 'دخول'}
        </button>

        {/*
          aria-live so the message reaches a screen reader, and role="alert" so
          it interrupts — a blocked account needs to know immediately.
        */}
        <p
          id={errorId}
          role="alert"
          aria-live="assertive"
          className={
            error
              ? 'mt-3 rounded-control border border-behind/30 bg-behind/10 p-3 text-center text-sm text-behind'
              : 'sr-only'
          }
        >
          {error ?? ''}
        </p>
      </form>
    </main>
  );
}
