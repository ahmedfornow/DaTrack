/**
 * Wiring the write queue to Supabase and to the browser's online state.
 *
 * The classification below is the part that matters. Retrying a write the
 * server already refused reproduces the refusal forever; *not* retrying a write
 * that never left the device loses a sale. So failures are sorted by whether
 * the server had an opinion:
 *
 *  - No response at all — offline, DNS, timeout, aborted fetch — means the
 *    write did not happen. Retry.
 *  - A Postgres error code means the server received it, understood it, and
 *    refused. Park it and show the promoter why.
 *
 * The genuinely ambiguous case is a response lost *after* the server committed.
 * Nothing in the response tells the client that apart from a write that never
 * arrived, so both classify as retry — and the retry would have written a
 * second sale.
 *
 * That is what `client_op_id` closes. Every attempt at one logical write sends
 * the same id, uniquely indexed per promoter, so the retry hits 23505 instead
 * of inserting. A 23505 on replay is therefore not automatically a failure: it
 * is the question "did my earlier attempt land?", and looking the id up answers
 * it. Found means the write succeeded and the queue can drop it; genuinely
 * absent means the conflict came from a different constraint and is real.
 *
 * See docs/migrations/001_client_op_id.sql.
 */

import { db } from './supabase';
import {
  WriteQueue,
  createQueueStore,
  type QueueTransport,
  type SendResult,
} from './queue';
import { toDataError } from '../data/errors';
import {
  findByOpId,
  idempotencyAvailable,
  insertIdempotently,
  promoterIdOf,
  type IdempotentTable,
  type OpLookup,
} from '../data/idempotency';

/** Codes that mean the server refused. Retrying reproduces them. */
const PERMANENT = new Set([
  '23505', // unique violation
  '23503', // foreign key violation
  '23514', // check constraint
  '23502', // not null
  '42501', // RLS refused
  '42P10', // no matching unique index for ON CONFLICT
  'PGRST204', // unknown column
  '22P02', // invalid input syntax
]);

function classify(error: unknown, fallback: string): SendResult<never> {
  const mapped = toDataError(error as { code?: string | null; message?: string | null });

  if (mapped.code !== null && PERMANENT.has(mapped.code)) {
    return { outcome: 'reject', reason: mapped.message };
  }
  // No code, or a transient one: the write did not land.
  return { outcome: 'retry', reason: mapped.message !== '' ? mapped.message : fallback };
}

/**
 * Decides what a unique violation on replay actually means.
 *
 * Called only after a 23505. If the row carrying this operation id is already
 * there, the earlier attempt succeeded and its response was simply lost — the
 * write is done, and the queue should drop it rather than report a failure the
 * promoter would have to interpret. If it is definitively absent, some other
 * uniqueness was violated (for attendance, the promoter/date/shift constraint)
 * and that is a real conflict.
 *
 * When the lookup itself cannot complete, nothing has been learned. Guessing
 * either way is wrong — assume it landed and a sale is lost, assume it did not
 * and the duplicate gets written anyway — so it stays queued and asks again.
 */
async function resolveDuplicate(
  table: IdempotentTable,
  payload: Record<string, unknown>,
  opId: string,
  error: unknown,
  fallback: string,
): Promise<SendResult<number>> {
  // Without the column there is no id to look up, so a 23505 can only be a real
  // conflict — and asking would query a column that does not exist.
  if (!idempotencyAvailable()) return classify(error, fallback);

  const promoterId = promoterIdOf(payload);
  // No promoter to scope the lookup by means it cannot be asked safely, so the
  // conflict is reported as it stands rather than guessed at.
  if (promoterId === null) return classify(error, fallback);

  return interpretDuplicate(await findByOpId(table, promoterId, opId), error, fallback);
}

/** The decision itself, separated from the I/O so it can be tested directly. */
export function interpretDuplicate(
  lookup: OpLookup,
  error: unknown,
  fallback: string,
): SendResult<number> {
  if (lookup.found === true) return { outcome: 'ok', value: lookup.id };
  if (lookup.found === 'unknown') {
    return { outcome: 'retry', reason: 'تعذّر التحقق من الإرسال — سيعاد المحاولة' };
  }
  return classify(error, fallback);
}

/** True for the unique violation that a same-id retry produces. */
export function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === '23505';
}

export const supabaseTransport: QueueTransport = {
  async sendAttendance(payload, opId) {
    try {
      const { data, error } = await insertIdempotently(payload, opId, (row) =>
        db
          .from('attendance')
          // The payload was built by data/attendance and is already validated.
          .insert(row as never)
          .select('id')
          .single(),
      );

      if (error) {
        return isUniqueViolation(error)
          ? resolveDuplicate('attendance', payload, opId, error, 'تعذّر إرسال التسجيل')
          : classify(error, 'تعذّر إرسال التسجيل');
      }

      const id = (data as { id?: unknown } | null)?.id;
      if (typeof id !== 'number') {
        return { outcome: 'reject', reason: 'تعذّرت قراءة رقم الجلسة بعد الإرسال' };
      }
      return { outcome: 'ok', value: id };
    } catch (thrown) {
      return classify(thrown, 'لا يوجد اتصال');
    }
  },

  async sendSale(payload, attendanceId, opId) {
    try {
      const { data, error } = await insertIdempotently(
        { ...payload, attendance_id: attendanceId },
        opId,
        (row) => db.from('sell_operations').insert(row as never).select('id').single(),
      );

      if (error) {
        return isUniqueViolation(error)
          ? resolveDuplicate('sell_operations', payload, opId, error, 'تعذّر إرسال البيع')
          : classify(error, 'تعذّر إرسال البيع');
      }

      const id = (data as { id?: unknown } | null)?.id;
      return { outcome: 'ok', value: typeof id === 'number' ? id : 0 };
    } catch (thrown) {
      return classify(thrown, 'لا يوجد اتصال');
    }
  },
};

/** The one queue instance for the app. */
export const writeQueue = new WriteQueue(createQueueStore(), supabaseTransport);

/** True when the browser believes it has a connection. Optimistic by nature. */
export function isOnline(): boolean {
  return typeof navigator === 'undefined' || navigator.onLine !== false;
}

/**
 * Replays whenever the connection returns, and periodically as a backstop.
 *
 * `navigator.onLine` reports the network interface, not reachability — a phone
 * connected to shop wifi with no route out still reports online. The interval
 * covers that case, which is exactly the retail dead spot this is for.
 */
export function startReplayLoop(
  onChange: () => void,
  intervalMs = 30_000,
): () => void {
  let stopped = false;

  const attempt = () => {
    if (stopped) return;
    void writeQueue.replay().then((summary) => {
      if (summary.sent > 0 || summary.failed > 0) onChange();
    });
  };

  const handleOnline = () => attempt();
  window.addEventListener('online', handleOnline);
  const timer = window.setInterval(attempt, intervalMs);

  // One pass on start, so a queue left over from last session drains without
  // waiting for the first interval.
  attempt();

  return () => {
    stopped = true;
    window.removeEventListener('online', handleOnline);
    window.clearInterval(timer);
  };
}
