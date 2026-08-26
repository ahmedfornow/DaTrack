import { db } from '../../lib/supabase';
import { checkCredentials } from './credentials';
import { PROFILE_COLUMNS, parseProfile, type Profile, type ProfileParse } from './profile';

/**
 * Signing in, and the three ways it is allowed to fail.
 *
 * A deactivated account must be blocked here. `users.active = false` was once
 * checked nowhere at login, so deactivated promoters kept working and kept
 * recording sales. The check belongs in RLS *and* here, because a person who
 * cannot see why they are blocked will phone the supervisor either way.
 */

export type AuthFailure =
  | 'bad-credentials'
  | 'no-profile'
  | 'deactivated'
  | 'schema-drift'
  | 'offline';

export type AuthOutcome =
  | { ok: true; profile: Profile }
  | { ok: false; failure: AuthFailure; message: string; detail?: string };

const FAILURE_MESSAGES: Record<AuthFailure, string> = {
  'bad-credentials': 'بيانات الدخول غير صحيحة',
  'no-profile': 'حسابك غير مسجل — كلّم المشرف',
  deactivated: 'حسابك موقوف — كلّم المشرف',
  // Deliberately not a Postgres code. If this shows, the build is out of step
  // with the database and the supervisor needs to escalate, not retry.
  'schema-drift': 'تعذّر قراءة بيانات حسابك — كلّم المشرف',
  offline: 'لا يوجد اتصال — تحقق من الإنترنت وحاول مجدداً',
};

export function authMessage(failure: AuthFailure): string {
  return FAILURE_MESSAGES[failure];
}

const fail = (failure: AuthFailure, detail?: string): AuthOutcome =>
  detail === undefined
    ? { ok: false, failure, message: authMessage(failure) }
    : { ok: false, failure, message: authMessage(failure), detail };

/**
 * The authorisation decision, separated from the network so it can be tested
 * exhaustively. Given a parsed profile row, may this person in?
 */
export function authorise(parse: ProfileParse): AuthOutcome {
  if (!parse.ok) {
    return parse.reason === 'missing'
      ? fail('no-profile', parse.detail)
      : fail('schema-drift', parse.detail);
  }
  if (!parse.profile.active) {
    return fail('deactivated');
  }
  return { ok: true, profile: parse.profile };
}

/** Reads the caller's own profile row. RLS restricts this to themselves. */
export async function loadProfile(userId: string): Promise<AuthOutcome> {
  const { data, error } = await db
    .from('users')
    .select(PROFILE_COLUMNS)
    .eq('id', userId)
    .maybeSingle();

  if (error) {
    return fail('schema-drift', error.message);
  }
  return authorise(parseProfile(data));
}

/**
 * Signs in with a 4-digit login number. On any failure the auth session is torn
 * down again, so a blocked account is never left half-signed-in.
 */
export async function signIn(loginNumber: string, password: string): Promise<AuthOutcome> {
  const credentials = checkCredentials(loginNumber, password);
  if (!credentials.ok) {
    return { ok: false, failure: 'bad-credentials', message: credentials.message };
  }

  const { data, error } = await db.auth.signInWithPassword({
    email: credentials.email,
    password: credentials.password,
  });

  if (error) {
    // Supabase does not distinguish "wrong password" from "no such user", and
    // neither should we — saying which one exists is an enumeration hint.
    const offline = /fetch|network|failed to fetch/i.test(error.message);
    return fail(offline ? 'offline' : 'bad-credentials', error.message);
  }

  const userId = data.user?.id;
  if (!userId) {
    return fail('bad-credentials', 'sign-in returned no user');
  }

  const outcome = await loadProfile(userId);
  if (!outcome.ok) {
    await db.auth.signOut();
  }
  return outcome;
}

/**
 * Restores a stored session on load, re-checking the profile every time. An
 * account deactivated since the last visit is blocked on the next open, not on
 * the next login.
 */
export async function restoreSession(): Promise<AuthOutcome | null> {
  const { data, error } = await db.auth.getSession();
  if (error || !data.session) return null;

  const outcome = await loadProfile(data.session.user.id);
  if (!outcome.ok) {
    await db.auth.signOut();
  }
  return outcome;
}

export async function signOut(): Promise<void> {
  await db.auth.signOut();
}
