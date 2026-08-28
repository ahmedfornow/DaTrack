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
 * The one genuinely ambiguous case is a response lost after the server
 * committed. That would replay as a duplicate sale, and there is no way to tell
 * from the client. Closing it properly needs a client-supplied idempotency key
 * with a unique index — see docs/migrations/. Until then this is at-least-once
 * for that narrow window, which is the right trade against losing sales
 * outright.
 */

import { db } from './supabase';
import {
  WriteQueue,
  createQueueStore,
  type QueueTransport,
  type SendResult,
} from './queue';
import { toDataError } from '../data/errors';

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

export const supabaseTransport: QueueTransport = {
  async sendAttendance(payload) {
    try {
      const { data, error } = await db
        .from('attendance')
        // The payload was built by data/attendance and is already validated.
        .insert(payload as never)
        .select('id')
        .single();

      if (error) return classify(error, 'تعذّر إرسال التسجيل');
      const id = (data as { id?: unknown } | null)?.id;
      if (typeof id !== 'number') {
        return { outcome: 'reject', reason: 'تعذّرت قراءة رقم الجلسة بعد الإرسال' };
      }
      return { outcome: 'ok', value: id };
    } catch (thrown) {
      return classify(thrown, 'لا يوجد اتصال');
    }
  },

  async sendSale(payload, attendanceId) {
    try {
      const { data, error } = await db
        .from('sell_operations')
        .insert({ ...payload, attendance_id: attendanceId } as never)
        .select('id')
        .single();

      if (error) return classify(error, 'تعذّر إرسال البيع');
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
