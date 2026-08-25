/**
 * Login credentials.
 *
 * Promoters type a 4-digit number and a password. The real credential is an
 * email address that the app synthesises: 1699 becomes 1699@example.com. The
 * number is never the identity — changing `users.login_no` does not change what
 * a person types to log in, because the email lives in `auth.users`.
 */

/** The synthetic domain every login number is appended to. */
export const LOGIN_EMAIL_DOMAIN = 'example.com';

export const LOGIN_NUMBER_LENGTH = 4;

/** Supabase's own floor. Rejecting early gives a better message than the API does. */
export const MIN_PASSWORD_LENGTH = 6;

const DIGITS_ONLY = /^\d+$/;

export type CredentialProblem =
  | 'login-number-required'
  | 'login-number-length'
  | 'login-number-digits'
  | 'password-required'
  | 'password-length';

/**
 * Arabic, in the interface's voice, and each one says what to do. A promoter
 * standing in a shop with a customer waiting should never see a Postgres code.
 */
const PROBLEM_MESSAGES: Record<CredentialProblem, string> = {
  'login-number-required': 'اكتب رقم المستخدم',
  'login-number-length': `رقم المستخدم ${LOGIN_NUMBER_LENGTH} أرقام`,
  'login-number-digits': 'رقم المستخدم أرقام فقط',
  'password-required': 'اكتب كلمة المرور',
  'password-length': `كلمة المرور ${MIN_PASSWORD_LENGTH} خانات على الأقل`,
};

export function credentialMessage(problem: CredentialProblem): string {
  return PROBLEM_MESSAGES[problem];
}

export type CredentialCheck =
  | { ok: true; email: string; password: string }
  | { ok: false; problem: CredentialProblem; message: string };

/** Turns a login number into the address Supabase actually authenticates. */
export function loginNumberToEmail(loginNumber: string): string {
  return `${loginNumber.trim()}@${LOGIN_EMAIL_DOMAIN}`;
}

/**
 * Validates before touching the network, and names the specific problem.
 * Whitespace is trimmed because phone keyboards insert it and a promoter
 * cannot see a trailing space.
 */
export function checkCredentials(
  rawLoginNumber: string,
  rawPassword: string,
): CredentialCheck {
  const loginNumber = rawLoginNumber.trim();
  const password = rawPassword;

  const fail = (problem: CredentialProblem): CredentialCheck => ({
    ok: false,
    problem,
    message: credentialMessage(problem),
  });

  if (loginNumber.length === 0) return fail('login-number-required');
  if (!DIGITS_ONLY.test(loginNumber)) return fail('login-number-digits');
  if (loginNumber.length !== LOGIN_NUMBER_LENGTH) return fail('login-number-length');
  if (password.length === 0) return fail('password-required');
  if (password.length < MIN_PASSWORD_LENGTH) return fail('password-length');

  return { ok: true, email: loginNumberToEmail(loginNumber), password };
}
