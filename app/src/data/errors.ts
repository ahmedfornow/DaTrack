/**
 * Turning database failures into Arabic a promoter can act on.
 *
 * Errors say what to do, in the interface's voice — never a Postgres code. A
 * promoter standing in a shop with a customer waiting cannot do anything with
 * "23505", and "خطأ في التسجيل" is barely better: it says something went wrong
 * without saying what, so the only available response is to tap again and
 * produce the same failure.
 *
 * Each mapping below names the specific conflict, because the caller knows the
 * context the code alone cannot carry.
 */

/** A failed operation, carrying a message that is safe to show as-is. */
export interface DataError {
  /** Arabic, user-facing, actionable. */
  readonly message: string;
  /** Postgres SQLSTATE or PostgREST code, for logging — never displayed. */
  readonly code: string | null;
  /** The raw message, for logging — never displayed. */
  readonly detail: string | null;
  /** True when retrying the identical request could plausibly succeed. */
  readonly retryable: boolean;
}

export type Result<T> = { ok: true; data: T } | { ok: false; error: DataError };

export const ok = <T>(data: T): Result<T> => ({ ok: true, data });

export const fail = (
  message: string,
  options: { code?: string | null; detail?: string | null; retryable?: boolean } = {},
): Result<never> => ({
  ok: false,
  error: {
    message,
    code: options.code ?? null,
    detail: options.detail ?? null,
    retryable: options.retryable ?? false,
  },
});

/** The shape supabase-js returns in `error`. Structural, so it needs no import. */
export interface PostgrestLikeError {
  code?: string | null;
  message?: string | null;
  details?: string | null;
  hint?: string | null;
}

/** Context lets a generic code become a specific sentence. */
export interface ErrorContext {
  /** What the user was trying to do, e.g. `'تسجيل البيع'`. */
  readonly action?: string;
  /** Overrides keyed by Postgres code, for conflicts only the caller understands. */
  readonly overrides?: Readonly<Record<string, string>>;
}

const GENERIC = 'تعذّر إتمام العملية — حاول مرة أخرى';

/**
 * Codes worth naming. Anything not listed falls through to a generic message
 * plus the action, which is still better than a bare code.
 */
const MESSAGES: Readonly<Record<string, string>> = {
  // Unique violation. Almost always needs an override — the caller knows which
  // uniqueness was violated and can say so.
  '23505': 'هذا السجل موجود مسبقاً',
  // Foreign key violation.
  '23503': 'لا يمكن الحذف — توجد سجلات مرتبطة. احذفها أولاً',
  // Check constraint violation — an invalid combination reached the database.
  '23514': 'القيم المدخلة غير مقبولة — راجع اختياراتك',
  // Not-null violation.
  '23502': 'بيانات ناقصة — أكمل كل الحقول المطلوبة',
  // RLS refused the row.
  '42501': 'لا تملك صلاحية لهذا الإجراء — كلّم المشرف',
  // ON CONFLICT with no matching unique index.
  '42P10': 'إعداد قاعدة البيانات ناقص — كلّم المشرف',
  // PostgREST could not find a column, usually a schema/code mismatch.
  PGRST204: 'إعداد قاعدة البيانات ناقص — كلّم المشرف',
  // PostgREST: no rows where exactly one was required.
  PGRST116: 'لم يتم العثور على السجل',
};

/** Codes where tapping again might genuinely work. */
const RETRYABLE = new Set(['08000', '08003', '08006', '53300', '57014', 'PGRST301']);

/** True for the offline/network failures supabase-js surfaces without a code. */
function looksLikeNetworkFailure(error: PostgrestLikeError): boolean {
  const message = (error.message ?? '').toLowerCase();
  return (
    message.includes('fetch') ||
    message.includes('network') ||
    message.includes('timeout') ||
    message.includes('failed to load')
  );
}

/**
 * Maps a Postgrest error onto a user-facing failure.
 *
 * Pass `overrides` for codes whose meaning depends on the call site — a `23505`
 * on attendance means something quite different from a `23505` on targets.
 */
export function toDataError(
  error: PostgrestLikeError | null | undefined,
  context: ErrorContext = {},
): DataError {
  if (!error) {
    return { message: GENERIC, code: null, detail: null, retryable: true };
  }

  const code = error.code ?? null;
  const detail = error.message ?? null;

  if (code === null && looksLikeNetworkFailure(error)) {
    return {
      message: 'لا يوجد اتصال — تحقق من الإنترنت وحاول مجدداً',
      code: null,
      detail,
      retryable: true,
    };
  }

  const override = code !== null ? context.overrides?.[code] : undefined;
  const known = code !== null ? MESSAGES[code] : undefined;
  const base = override ?? known;

  return {
    message: base ?? (context.action ? `تعذّر ${context.action} — حاول مرة أخرى` : GENERIC),
    code,
    detail,
    retryable: code !== null ? RETRYABLE.has(code) : true,
  };
}

/** Convenience: wrap a Postgrest error as a failed `Result`. */
export function failFrom(
  error: PostgrestLikeError | null | undefined,
  context: ErrorContext = {},
): Result<never> {
  const mapped = toDataError(error, context);
  return { ok: false, error: mapped };
}

/**
 * A validation failure raised before any database call.
 *
 * Validating first is the point: duplicate detection once ran *after* the
 * insert, so the constraint rejected the write and the user got a generic
 * error instead of being told which day was already registered.
 */
export function invalid(message: string): Result<never> {
  return fail(message, { code: 'CLIENT_VALIDATION' });
}
