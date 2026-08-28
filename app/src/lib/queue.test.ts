import { describe, it, expect, beforeEach } from 'vitest';
import {
  MAX_ATTEMPTS,
  MemoryQueueStore,
  WriteQueue,
  type QueueTransport,
  type SendResult,
} from './queue';

/**
 * The queue exists because a sale logged without signal currently vanishes
 * silently. Every test here is a way that could still happen: a lost parent, a
 * double replay, a permanent failure cycling forever.
 */

class FakeTransport implements QueueTransport {
  attendanceCalls: Record<string, unknown>[] = [];
  saleCalls: { payload: Record<string, unknown>; attendanceId: number }[] = [];

  attendanceResult: SendResult<number> = { outcome: 'ok', value: 100 };
  saleResult: SendResult<number> = { outcome: 'ok', value: 200 };

  private nextAttendanceId = 100;

  sendAttendance(payload: Record<string, unknown>): Promise<SendResult<number>> {
    this.attendanceCalls.push(payload);
    if (this.attendanceResult.outcome === 'ok') {
      const value = this.nextAttendanceId;
      this.nextAttendanceId += 1;
      return Promise.resolve({ outcome: 'ok', value });
    }
    return Promise.resolve(this.attendanceResult);
  }

  sendSale(
    payload: Record<string, unknown>,
    attendanceId: number,
  ): Promise<SendResult<number>> {
    this.saleCalls.push({ payload, attendanceId });
    return Promise.resolve(this.saleResult);
  }
}

let store: MemoryQueueStore;
let transport: FakeTransport;
let clock: number;
let queue: WriteQueue;

beforeEach(() => {
  store = new MemoryQueueStore();
  transport = new FakeTransport();
  clock = 1000;
  queue = new WriteQueue(store, transport, () => (clock += 1));
});

const sale = (color = 'Garnet Red') => ({
  device_type: 'ILUMA i Prime',
  color,
  sale_type: 'SK',
  customer_type: 'LAS',
});

describe('queueing', () => {
  it('reports what is waiting', async () => {
    await queue.enqueue({ kind: 'sale', attendance: { type: 'server', id: 5 }, payload: sale() });
    await queue.enqueue({ kind: 'sale', attendance: { type: 'server', id: 5 }, payload: sale() });
    expect(await queue.counts()).toEqual({ pending: 2, failed: 0 });
  });

  it('keeps operations in the order they were made', async () => {
    await queue.enqueue({ kind: 'sale', attendance: { type: 'server', id: 5 }, payload: sale('A') });
    await queue.enqueue({ kind: 'sale', attendance: { type: 'server', id: 5 }, payload: sale('B') });
    const listed = await queue.list();
    expect(listed.map((o) => (o.body.payload as { color: string }).color)).toEqual(['A', 'B']);
  });
});

describe('replay', () => {
  it('sends a queued sale and clears it', async () => {
    await queue.enqueue({ kind: 'sale', attendance: { type: 'server', id: 5 }, payload: sale() });

    const summary = await queue.replay();

    expect(summary.sent).toBe(1);
    expect(transport.saleCalls).toHaveLength(1);
    expect(transport.saleCalls[0]?.attendanceId).toBe(5);
    expect(await queue.counts()).toEqual({ pending: 0, failed: 0 });
  });

  it('sends nothing when the queue is empty', async () => {
    expect(await queue.replay()).toMatchObject({ sent: 0, stillPending: 0, failed: 0 });
  });

  describe('a sale whose attendance was also offline', () => {
    it('resolves the local reference to the real id', async () => {
      // The whole reason the queue is not a simple retry list: this sale has no
      // server-side parent yet.
      const attendanceId = await queue.enqueue({
        kind: 'attendance',
        payload: { work_date: '2026-08-28', status: 'work' },
      });
      await queue.enqueue({
        kind: 'sale',
        attendance: { type: 'local', operationId: attendanceId },
        payload: sale(),
      });

      const summary = await queue.replay();

      expect(summary.sent).toBe(2);
      expect(transport.saleCalls[0]?.attendanceId).toBe(100);
      expect(await queue.counts()).toEqual({ pending: 0, failed: 0 });
    });

    it('sends the attendance before the sale regardless of enqueue order', async () => {
      const attendanceId = await queue.enqueue({
        kind: 'attendance',
        payload: { work_date: '2026-08-28' },
      });
      await queue.enqueue({
        kind: 'sale',
        attendance: { type: 'local', operationId: attendanceId },
        payload: sale(),
      });

      await queue.replay();

      expect(transport.attendanceCalls).toHaveLength(1);
      expect(transport.saleCalls).toHaveLength(1);
    });

    it('keeps the sale queued when the attendance could not be sent', async () => {
      // Losing the parent must not orphan the sale — it waits.
      transport.attendanceResult = { outcome: 'retry', reason: 'offline' };
      const attendanceId = await queue.enqueue({
        kind: 'attendance',
        payload: { work_date: '2026-08-28' },
      });
      await queue.enqueue({
        kind: 'sale',
        attendance: { type: 'local', operationId: attendanceId },
        payload: sale(),
      });

      const summary = await queue.replay();

      expect(summary.sent).toBe(0);
      expect(transport.saleCalls).toHaveLength(0);
      expect(await queue.counts()).toEqual({ pending: 2, failed: 0 });
    });

    it('does not charge the waiting sale an attempt', async () => {
      transport.attendanceResult = { outcome: 'retry', reason: 'offline' };
      const attendanceId = await queue.enqueue({ kind: 'attendance', payload: {} });
      const saleId = await queue.enqueue({
        kind: 'sale',
        attendance: { type: 'local', operationId: attendanceId },
        payload: sale(),
      });

      await queue.replay();
      await queue.replay();
      await queue.replay();

      const waiting = (await queue.list()).find((o) => o.id === saleId);
      // Waiting is not failing. Accruing attempts here would eventually park a
      // perfectly good sale.
      expect(waiting?.attempts).toBe(0);
      expect(waiting?.status).toBe('pending');
    });

    it('sends the sale once the attendance finally succeeds', async () => {
      transport.attendanceResult = { outcome: 'retry', reason: 'offline' };
      const attendanceId = await queue.enqueue({ kind: 'attendance', payload: {} });
      await queue.enqueue({
        kind: 'sale',
        attendance: { type: 'local', operationId: attendanceId },
        payload: sale(),
      });

      await queue.replay();
      transport.attendanceResult = { outcome: 'ok', value: 0 };
      const summary = await queue.replay();

      expect(summary.sent).toBe(2);
      expect(transport.saleCalls[0]?.attendanceId).toBe(100);
    });

    it('parks a sale whose attendance was permanently rejected', async () => {
      transport.attendanceResult = { outcome: 'reject', reason: 'duplicate day' };
      const attendanceId = await queue.enqueue({ kind: 'attendance', payload: {} });
      await queue.enqueue({
        kind: 'sale',
        attendance: { type: 'local', operationId: attendanceId },
        payload: sale(),
      });

      await queue.replay();
      // The parent is parked, so on the next pass the sale is orphaned rather
      // than waiting forever for something that will never arrive.
      const summary = await queue.replay();

      expect(summary.failed).toBe(2);
      expect(transport.saleCalls).toHaveLength(0);
    });
  });

  describe('failure handling', () => {
    it('keeps an offline operation pending', async () => {
      transport.saleResult = { outcome: 'retry', reason: 'network' };
      await queue.enqueue({ kind: 'sale', attendance: { type: 'server', id: 5 }, payload: sale() });

      const summary = await queue.replay();

      expect(summary.sent).toBe(0);
      expect(summary.offline).toBe(true);
      expect(await queue.counts()).toEqual({ pending: 1, failed: 0 });
    });

    it('stops trying once the connection is clearly down', async () => {
      // Otherwise every queued operation burns an attempt on one bad pass and
      // a long queue parks itself wholesale.
      transport.saleResult = { outcome: 'retry', reason: 'network' };
      for (let i = 0; i < 5; i += 1) {
        await queue.enqueue({ kind: 'sale', attendance: { type: 'server', id: 5 }, payload: sale() });
      }

      await queue.replay();

      expect(transport.saleCalls).toHaveLength(1);
      expect(await queue.counts()).toEqual({ pending: 5, failed: 0 });
    });

    it('parks a rejected operation immediately', async () => {
      // The server understood and refused; retrying reproduces the refusal.
      transport.saleResult = { outcome: 'reject', reason: 'invalid colour' };
      await queue.enqueue({ kind: 'sale', attendance: { type: 'server', id: 5 }, payload: sale() });

      const summary = await queue.replay();

      expect(summary.failed).toBe(1);
      expect(summary.offline).toBe(false);
      const parked = (await queue.list())[0];
      expect(parked?.status).toBe('failed');
      expect(parked?.lastError).toBe('invalid colour');
    });

    it('does not retry a parked operation', async () => {
      transport.saleResult = { outcome: 'reject', reason: 'invalid' };
      await queue.enqueue({ kind: 'sale', attendance: { type: 'server', id: 5 }, payload: sale() });
      await queue.replay();

      transport.saleCalls = [];
      await queue.replay();

      expect(transport.saleCalls).toHaveLength(0);
    });

    it('parks an operation that has failed too many times', async () => {
      transport.saleResult = { outcome: 'retry', reason: 'network' };
      await queue.enqueue({ kind: 'sale', attendance: { type: 'server', id: 5 }, payload: sale() });

      for (let i = 0; i < MAX_ATTEMPTS; i += 1) await queue.replay();

      expect(await queue.counts()).toEqual({ pending: 0, failed: 1 });
    });

    it('can retry a parked operation after the cause is fixed', async () => {
      transport.saleResult = { outcome: 'reject', reason: 'invalid' };
      await queue.enqueue({ kind: 'sale', attendance: { type: 'server', id: 5 }, payload: sale() });
      await queue.replay();

      const parked = (await queue.list())[0];
      await queue.retry(parked!.id);
      transport.saleResult = { outcome: 'ok', value: 1 };
      const summary = await queue.replay();

      expect(summary.sent).toBe(1);
      expect(await queue.counts()).toEqual({ pending: 0, failed: 0 });
    });

    it('can discard a parked operation', async () => {
      transport.saleResult = { outcome: 'reject', reason: 'invalid' };
      await queue.enqueue({ kind: 'sale', attendance: { type: 'server', id: 5 }, payload: sale() });
      await queue.replay();

      const parked = (await queue.list())[0];
      await queue.discard(parked!.id);

      expect(await queue.counts()).toEqual({ pending: 0, failed: 0 });
    });
  });

  describe('re-entrancy', () => {
    it('does not double-send when replay is called twice at once', async () => {
      // "Back online" and a periodic retry can fire together; without a guard
      // every queued sale is written twice.
      await queue.enqueue({ kind: 'sale', attendance: { type: 'server', id: 5 }, payload: sale() });

      const [first, second] = await Promise.all([queue.replay(), queue.replay()]);

      expect(transport.saleCalls).toHaveLength(1);
      expect(first.sent + second.sent).toBe(1);
    });

    it('allows a later replay after one finishes', async () => {
      await queue.enqueue({ kind: 'sale', attendance: { type: 'server', id: 5 }, payload: sale() });
      await queue.replay();
      await queue.enqueue({ kind: 'sale', attendance: { type: 'server', id: 5 }, payload: sale() });
      const summary = await queue.replay();
      expect(summary.sent).toBe(1);
    });
  });

  it('survives a reload — the store is the source of truth', async () => {
    await queue.enqueue({ kind: 'sale', attendance: { type: 'server', id: 5 }, payload: sale() });

    // A fresh queue over the same store is exactly what a page reload produces.
    const reopened = new WriteQueue(store, transport, () => clock);
    expect(await reopened.counts()).toEqual({ pending: 1, failed: 0 });

    const summary = await reopened.replay();
    expect(summary.sent).toBe(1);
  });
});
