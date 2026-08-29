/**
 * Making a retried write land once.
 *
 * The write queue retries anything that produced no response, because a write
 * that never left the phone must not be lost. One case breaks that reasoning:
 * the server committed the row and the response was lost coming back. From the
 * client those two look identical, so the retry creates a second sale — and a
 * duplicate sale is worse than a visible error, because it is a plausible
 * number nobody will question.
 *
 * So every logical write carries an id, generated once on the first attempt and
 * reused by every retry. `(promoter_id, client_op_id)` is uniquely indexed, so
 * the second attempt collides instead of duplicating. A collision is then not a
 * failure but the answer to the question the client could not otherwise ask:
 * *did my earlier attempt land?* — see {@link findByOpId}.
 *
 * The migration that adds the column is `docs/migrations/001_client_op_id.sql`.
 */

import { db } from '../lib/supabase';

/** Tables the write queue inserts into, and the only ones carrying the column. */
export type IdempotentTable = 'attendance' | 'sell_operations';

/**
 * Whether the database has the column yet.
 *
 * The migration is applied by hand while the app deploys automatically, so the
 * two cannot be sequenced reliably. A client that sends `client_op_id` to a
 * database without it gets PGRST204 on *every* write — losing sales outright in
 * exchange for preventing duplicates, which is the wrong trade by a wide
 * margin.
 *
 * So the column is treated as present until the server says otherwise, and the
 * write is immediately retried without it. Deploying before the migration
 * costs one wasted round trip per session and nothing else; running the
 * migration later needs no redeploy, because this resets on the next load.
 */
let columnAvailable = true;

/** False once the server has said the column is not there. */
export function idempotencyAvailable(): boolean {
  return columnAvailable;
}

/** Test seam, and how a new session forgets a previous session's answer. */
export function resetIdempotencyProbe(): void {
  columnAvailable = true;
}

/** PostgREST's "no such column", plus the Postgres code behind it. */
export function isUnknownColumn(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return code === 'PGRST204' || code === '42703';
}

/**
 * Attaches the operation id to a row about to be inserted.
 *
 * The cast is deliberate and is the only one. `client_op_id` does not exist in
 * `types/database.ts` until the migration is applied and `npm run gen:types`
 * re-runs, so the compiler cannot see a column that is real in the database.
 * Confining that to one function means removing it later is a one-line change,
 * rather than unpicking a widened type from every insert.
 */
export function withOpId<T extends object>(row: T, opId: string | undefined): T {
  if (opId === undefined || !columnAvailable) return row;
  return { ...row, client_op_id: opId } as T;
}

/** What an insert returns, narrowed to what this file needs to look at. */
interface InsertOutcome<R> {
  data: R;
  error: { code?: string | null; message?: string | null } | null;
}

/**
 * Runs an insert with the operation id attached, and without it if the database
 * turns out not to have the column yet.
 *
 * The second attempt is safe: PGRST204 is refused by PostgREST before anything
 * reaches the table, so there is no partial write to reconcile.
 */
export async function insertIdempotently<T extends object, R>(
  row: T,
  opId: string | undefined,
  // PromiseLike, not Promise: a PostgREST builder is a thenable that only runs
  // when awaited, which is exactly what lets this call it twice.
  run: (row: T) => PromiseLike<InsertOutcome<R>>,
): Promise<InsertOutcome<R>> {
  const first = await run(withOpId(row, opId));

  if (first.error !== null && isUnknownColumn(first.error) && opId !== undefined) {
    columnAvailable = false;
    return run(row);
  }
  return first;
}

/**
 * The result of asking whether an earlier attempt landed.
 *
 * `unknown` is the important one. If the lookup itself fails — the connection
 * dropped again mid-recovery — we have learned nothing, and guessing either way
 * is wrong: assume it landed and a real sale is lost, assume it did not and the
 * duplicate we were preventing gets written anyway. So the caller retries later
 * and asks again.
 */
export type OpLookup =
  | { readonly found: true; readonly id: number }
  | { readonly found: false }
  | { readonly found: 'unknown' };

/**
 * Finds the row a previous attempt wrote, by its operation id.
 *
 * Scoped by promoter to match the unique index, so this cannot see another
 * promoter's row even before RLS is considered. Returns `found: false` only
 * when the server answered and had nothing — which means the unique violation
 * that prompted the lookup came from a *different* constraint, and is a genuine
 * conflict the caller must surface.
 */
export async function findByOpId(
  table: IdempotentTable,
  promoterId: string,
  opId: string,
): Promise<OpLookup> {
  try {
    // Filtering on a column the generated types cannot see yet — same reason as
    // the cast in `withOpId`, and it disappears with the same regeneration.
    const query = db.from(table).select('id') as unknown as FilterableQuery;

    const { data, error } = await query
      .eq('promoter_id', promoterId)
      .eq('client_op_id', opId)
      .limit(1)
      .maybeSingle();

    if (error) return { found: 'unknown' };

    const id = (data as { id?: unknown } | null)?.id;
    return typeof id === 'number' ? { found: true, id } : { found: false };
  } catch {
    // Thrown rather than returned means the fetch never completed.
    return { found: 'unknown' };
  }
}

/** The slice of the PostgREST builder used above, without column typing. */
interface FilterableQuery {
  eq(column: string, value: unknown): FilterableQuery;
  limit(count: number): FilterableQuery;
  maybeSingle(): Promise<{ data: unknown; error: unknown }>;
}

/** Reads the promoter id out of a queued payload, so a lookup can be scoped. */
export function promoterIdOf(payload: Record<string, unknown>): string | null {
  const value = payload['promoter_id'];
  return typeof value === 'string' && value !== '' ? value : null;
}
