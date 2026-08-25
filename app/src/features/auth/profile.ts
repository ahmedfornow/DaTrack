/**
 * The signed-in user's profile row from `public.users`.
 *
 * This parses at runtime rather than trusting the shape. PostgREST returns
 * `undefined` for any column you did not select, silently — a query that
 * selected `sale_type` while the code read `s.customer_type` made every LAS
 * count read zero for weeks, because zero is a plausible number.
 *
 * Generated types catch that at build time. This catches it at the boundary,
 * where the data actually arrives, and turns it into a message a person can act
 * on instead of a blank screen.
 */

export const ROLES = ['manager', 'supervisor', 'promoter'] as const;
export type Role = (typeof ROLES)[number];

export interface Profile {
  id: string;
  fullName: string;
  role: Role;
  city: string;
  /** `false` must block login. Deactivation preserves history; it never deletes. */
  active: boolean;
  /** Display only — the real credential is the email in `auth.users`. */
  loginNumber: string | null;
}

/** Every column this module reads, so the select can never drift from the parse. */
export const PROFILE_COLUMNS = 'id, full_name, role, city, active, login_no' as const;

export type ProfileParse =
  | { ok: true; profile: Profile }
  | { ok: false; reason: 'missing' | 'malformed'; detail: string };

function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}

/**
 * Parses a `users` row. `active` defaults to `true` only when the column is
 * absent from the response entirely; an explicit `false` always blocks.
 */
export function parseProfile(row: unknown): ProfileParse {
  if (row === null || row === undefined) {
    return { ok: false, reason: 'missing', detail: 'no profile row' };
  }
  if (typeof row !== 'object') {
    return { ok: false, reason: 'malformed', detail: `expected an object, got ${typeof row}` };
  }

  const record = row as Record<string, unknown>;
  const missing: string[] = [];

  const { id, full_name: fullName, role, city, active, login_no: loginNumber } = record;

  if (typeof id !== 'string' || id.length === 0) missing.push('id');
  if (typeof fullName !== 'string' || fullName.length === 0) missing.push('full_name');
  if (!isRole(role)) missing.push('role');
  if (typeof city !== 'string' || city.length === 0) missing.push('city');
  if (active !== undefined && active !== null && typeof active !== 'boolean') {
    missing.push('active');
  }

  if (missing.length > 0) {
    return {
      ok: false,
      reason: 'malformed',
      detail: `missing or invalid: ${missing.join(', ')}`,
    };
  }

  return {
    ok: true,
    profile: {
      id: id as string,
      fullName: fullName as string,
      role: role as Role,
      city: city as string,
      active: active === undefined || active === null ? true : (active as boolean),
      loginNumber: typeof loginNumber === 'string' && loginNumber.length > 0 ? loginNumber : null,
    },
  };
}

/** Where each role lands after signing in. */
export function landingFor(role: Role): 'promoter' | 'staff' {
  return role === 'promoter' ? 'promoter' : 'staff';
}
