/**
 * The text boundary.
 *
 * Two failures drove this file. A promoter once pasted a whole page of copied
 * text into an outlet's map-URL field; that text then printed inside the
 * route-plan message sent to the entire team, for weeks. And emoji in a copied
 * message render inconsistently across phones and add noise to something people
 * forward.
 *
 * The rule is sanitise on the way in *and* on the way out. Input sanitising can
 * be bypassed — by the Supabase dashboard, by a migration, by a row that
 * predates the guard — so nothing is trusted at print time either.
 */

/** Outlet text fields are single-line by definition. */
export const ONE_LINE_DEFAULT_MAX = 80;

/**
 * Collapses all whitespace — including newlines and tabs — to single spaces,
 * trims, and truncates. This is what makes a pasted page harmless.
 */
export function oneLine(value: unknown, max: number = ONE_LINE_DEFAULT_MAX): string {
  if (max <= 0) return '';
  return String(value ?? '')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, max);
}

/**
 * Extracts the first `http://` or `https://` token, or `''` when there is none.
 *
 * Deliberately permissive about what follows the scheme and strict about the
 * scheme itself: the goal is to reject prose, not to validate a URL.
 */
export function firstUrl(value: unknown): string {
  const match = String(value ?? '').match(/https?:\/\/[^\s]+/u);
  return match ? match[0] : '';
}

/** True when the value contains a usable URL. */
export function hasUrl(value: unknown): boolean {
  return firstUrl(value) !== '';
}

/**
 * Removes emoji and pictographs, along with the variation selectors and
 * zero-width joiners that bind them into sequences. Leaving a joiner behind
 * turns a removed emoji into a visible box on some phones.
 */
export function stripEmoji(value: unknown): string {
  return String(value ?? '')
    .replace(/\p{Extended_Pictographic}/gu, '')
    .replace(/[‍︎️]/gu, '')
    .replace(/[\u{1F3FB}-\u{1F3FF}]/gu, '') // skin-tone modifiers
    .replace(/\s+/gu, ' ')
    .trim();
}

/**
 * Prepares any database field for a generated report body.
 *
 * Reports are pure English and LTR: an Arabic word at the end of a line inside
 * an otherwise-Latin message makes WhatsApp flip the punctuation, and emoji are
 * removed from everything copied. Every field printed into a report goes
 * through here — the end-of-shift report, the stock message, the route plan,
 * the roster and the period summary.
 */
export function forReport(value: unknown, max: number = ONE_LINE_DEFAULT_MAX): string {
  return oneLine(stripEmoji(value), max);
}

/**
 * Outlet names follow `QAS_Outlet Name_TYPE_MN_BR`; the UI shows only the human
 * part. Falls back to the whole name when the convention is not followed, which
 * is better than showing an empty label.
 */
export function shortOutletName(name: unknown): string {
  const full = oneLine(name, 120);
  const parts = full.split('_');
  const human = parts.length > 1 ? parts[1] : undefined;
  return human !== undefined && human.trim() !== '' ? human.trim() : full;
}

/**
 * Formats a promoter's 4-digit login number into the synthetic email the auth
 * system actually uses. Promoters only ever type the digits.
 */
export function loginEmailFor(loginNumber: string): string {
  return `${loginNumber}@example.com`;
}
