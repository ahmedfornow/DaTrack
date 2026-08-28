import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * The duplicate window, and proof that it is closed.
 *
 * A sale written while the connection is failing has three possible histories
 * and the client can only distinguish two of them:
 *
 *   1. It never reached the server.        → retry, correctly.
 *   2. The server refused it.              → park it, correctly.
 *   3. The server COMMITTED it and the response was lost.
 *
 * Case 3 is indistinguishable from case 1 at the moment of failure, and the
 * retry it triggers used to write a second sale. Every test below is about
 * making case 3 recognisable after the fact, by the operation id the retry
 * carries.
 *
 * The Supabase client is faked rather than mocked loosely: these tests assert
 * on how many INSERTs actually happened, which is the only number that matters.
 */

/** One `{ data, error }` as PostgREST returns it. */
interface FakeResponse {
  data: unknown;
  error: unknown;
}

class FakeDb {
  inserts: { table: string; row: Record<string, unknown> }[] = [];
  lookups: { table: string; filters: Record<string, unknown> }[] = [];

  /** Queued responses, consumed in order; the last one repeats. */
  insertResponses: FakeResponse[] = [{ data: { id: 1 }, error: null }];
  lookupResponses: FakeResponse[] = [{ data: null, error: null }];

  private next(queue: FakeResponse[]): FakeResponse {
    return (queue.length > 1 ? queue.shift() : queue[0]) as FakeResponse;
  }

  from(table: string) {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;
    return {
      insert(row: Record<string, unknown>) {
        self.inserts.push({ table, row });
        const response = self.next(self.insertResponses);
        return { select: () => ({ single: () => Promise.resolve(response) }) };
      },
      select() {
        const filters: Record<string, unknown> = {};
        const chain = {
          eq(column: string, value: unknown) {
            filters[column] = value;
            return chain;
          },
          limit() {
            return chain;
          },
          maybeSingle() {
            self.lookups.push({ table, filters });
            return Promise.resolve(self.next(self.lookupResponses));
          },
        };
        return chain;
      },
    };
  }
}

const fake = new FakeDb();

vi.mock('./supabase', () => ({ db: { from: (table: string) => fake.from(table) } }));

const { supabaseTransport, interpretDuplicate, isUniqueViolation } = await import('./offline');
const { MemoryQueueStore, WriteQueue } = await import('./queue');
const { resetIdempotencyProbe, idempotencyAvailable } = await import('../data/idempotency');

const OP = 'op-test-0000000000000001';

const salePayload = () => ({
  promoter_id: 'promoter-uuid',
  work_date: '2026-08-28',
  device_type: 'ILUMA i Prime',
  color: 'Garnet Red',
  sale_type: 'SK',
  customer_type: 'LAS',
  quantity: 1,
});

const duplicate = { code: '23505', message: 'duplicate key value violates unique constraint' };

const unknownColumn = {
  code: 'PGRST204',
  message: "Could not find the 'client_op_id' column of 'sell_operations'",
};

beforeEach(() => {
  fake.inserts = [];
  fake.lookups = [];
  fake.insertResponses = [{ data: { id: 1 }, error: null }];
  fake.lookupResponses = [{ data: null, error: null }];
  resetIdempotencyProbe();
});

describe('tagging writes', () => {
  it('sends the operation id with the sale', async () => {
    await supabaseTransport.sendSale(salePayload(), 42, OP);

    expect(fake.inserts).toHaveLength(1);
    expect(fake.inserts[0]?.row).toMatchObject({
      client_op_id: OP,
      attendance_id: 42,
      device_type: 'ILUMA i Prime',
    });
  });

  it('sends the operation id with the attendance row', async () => {
    await supabaseTransport.sendAttendance(
      { promoter_id: 'promoter-uuid', work_date: '2026-08-28', status: 'work' },
      OP,
    );

    expect(fake.inserts[0]?.row).toMatchObject({ client_op_id: OP });
  });

  it('does not look anything up when the write simply succeeds', async () => {
    const result = await supabaseTransport.sendSale(salePayload(), 42, OP);

    expect(result).toEqual({ outcome: 'ok', value: 1 });
    expect(fake.lookups).toHaveLength(0);
  });
});

describe('a retry after a lost response', () => {
  it('reports success instead of writing a second sale', async () => {
    // The row is already there from the attempt whose response never arrived.
    fake.insertResponses = [{ data: null, error: duplicate }];
    fake.lookupResponses = [{ data: { id: 77 }, error: null }];

    const result = await supabaseTransport.sendSale(salePayload(), 42, OP);

    expect(result).toEqual({ outcome: 'ok', value: 77 });
    expect(fake.inserts).toHaveLength(1);
  });

  it('scopes the lookup by promoter and operation id', async () => {
    fake.insertResponses = [{ data: null, error: duplicate }];
    fake.lookupResponses = [{ data: { id: 77 }, error: null }];

    await supabaseTransport.sendSale(salePayload(), 42, OP);

    expect(fake.lookups[0]).toEqual({
      table: 'sell_operations',
      filters: { promoter_id: 'promoter-uuid', client_op_id: OP },
    });
  });

  it('stays queued when the lookup itself cannot complete', async () => {
    // Nothing was learned, so neither answer is safe to assume.
    fake.insertResponses = [{ data: null, error: duplicate }];
    fake.lookupResponses = [{ data: null, error: { message: 'Failed to fetch' } }];

    const result = await supabaseTransport.sendSale(salePayload(), 42, OP);

    expect(result.outcome).toBe('retry');
  });
});

describe('a genuine conflict', () => {
  it('is still rejected when no row carries this operation id', async () => {
    fake.insertResponses = [{ data: null, error: duplicate }];
    fake.lookupResponses = [{ data: null, error: null }];

    const result = await supabaseTransport.sendSale(salePayload(), 42, OP);

    expect(result.outcome).toBe('reject');
  });

  it('distinguishes an attendance replay from a real double sign-in', async () => {
    // Both arrive as 23505. The one that is ours has a row with our id; the one
    // that is a genuine promoter/date/shift clash does not.
    fake.insertResponses = [{ data: null, error: duplicate }];
    fake.lookupResponses = [{ data: null, error: null }];

    const clash = await supabaseTransport.sendAttendance(
      { promoter_id: 'promoter-uuid', work_date: '2026-08-28', status: 'work' },
      OP,
    );
    expect(clash.outcome).toBe('reject');

    fake.insertResponses = [{ data: null, error: duplicate }];
    fake.lookupResponses = [{ data: { id: 500 }, error: null }];

    const ours = await supabaseTransport.sendAttendance(
      { promoter_id: 'promoter-uuid', work_date: '2026-08-28', status: 'work' },
      OP,
    );
    expect(ours).toEqual({ outcome: 'ok', value: 500 });
  });

  it('does not look up a conflict it cannot scope', async () => {
    fake.insertResponses = [{ data: null, error: duplicate }];

    const result = await supabaseTransport.sendSale({ work_date: '2026-08-28' }, 42, OP);

    expect(fake.lookups).toHaveLength(0);
    expect(result.outcome).toBe('reject');
  });

  it('leaves every other failure classified as before', async () => {
    fake.insertResponses = [{ data: null, error: { code: '23503', message: 'fk' } }];

    const result = await supabaseTransport.sendSale(salePayload(), 42, OP);

    expect(result.outcome).toBe('reject');
    expect(fake.lookups).toHaveLength(0);
  });
});

describe('the whole sequence, through the queue', () => {
  it('drains without duplicating when the first send is lost', async () => {
    const queue = new WriteQueue(new MemoryQueueStore(), supabaseTransport);
    const opId = await queue.enqueue({
      kind: 'sale',
      attendance: { type: 'server', id: 42 },
      payload: salePayload(),
    });

    // First replay: the connection drops with no response at all.
    fake.insertResponses = [{ data: null, error: { message: 'Failed to fetch' } }];
    const first = await queue.replay();
    expect(first.sent).toBe(0);
    expect(await queue.counts()).toEqual({ pending: 1, failed: 0 });

    // The row did in fact land. The second replay collides with itself.
    fake.insertResponses = [{ data: null, error: duplicate }];
    fake.lookupResponses = [{ data: { id: 77 }, error: null }];
    const second = await queue.replay();

    expect(second.sent).toBe(1);
    expect(await queue.counts()).toEqual({ pending: 0, failed: 0 });

    // Two attempts, one id, and never a second row.
    expect(fake.inserts).toHaveLength(2);
    expect(fake.inserts.map((i) => i.row['client_op_id'])).toEqual([opId, opId]);
  });

  it('carries one id across every attempt of the same operation', async () => {
    const queue = new WriteQueue(new MemoryQueueStore(), supabaseTransport);
    await queue.enqueue({
      kind: 'sale',
      attendance: { type: 'server', id: 42 },
      payload: salePayload(),
    });

    fake.insertResponses = [{ data: null, error: { message: 'Failed to fetch' } }];
    await queue.replay();
    await queue.replay();
    await queue.replay();

    const ids = new Set(fake.inserts.map((i) => i.row['client_op_id']));
    expect(fake.inserts).toHaveLength(3);
    expect(ids.size).toBe(1);
  });
});

/**
 * The migration is applied by hand; the app deploys itself on merge. So the
 * client will exist, at least briefly, against a database without the column —
 * and a client that hard-fails there would lose every sale in exchange for
 * preventing duplicates. These are the tests that say it degrades instead.
 */
describe('before the migration has been applied', () => {
  it('writes the sale anyway, without the id', async () => {
    fake.insertResponses = [
      { data: null, error: unknownColumn },
      { data: { id: 5 }, error: null },
    ];

    const result = await supabaseTransport.sendSale(salePayload(), 42, OP);

    expect(result).toEqual({ outcome: 'ok', value: 5 });
    expect(fake.inserts).toHaveLength(2);
    expect(fake.inserts[0]?.row).toHaveProperty('client_op_id');
    expect(fake.inserts[1]?.row).not.toHaveProperty('client_op_id');
  });

  it('keeps the sale intact on the retry', async () => {
    fake.insertResponses = [
      { data: null, error: unknownColumn },
      { data: { id: 5 }, error: null },
    ];

    await supabaseTransport.sendSale(salePayload(), 42, OP);

    expect(fake.inserts[1]?.row).toMatchObject({
      promoter_id: 'promoter-uuid',
      work_date: '2026-08-28',
      device_type: 'ILUMA i Prime',
      color: 'Garnet Red',
      attendance_id: 42,
    });
  });

  it('only probes once, not on every sale', async () => {
    fake.insertResponses = [
      { data: null, error: unknownColumn },
      { data: { id: 5 }, error: null },
    ];
    await supabaseTransport.sendSale(salePayload(), 42, OP);
    expect(idempotencyAvailable()).toBe(false);

    fake.inserts = [];
    fake.insertResponses = [{ data: { id: 6 }, error: null }];
    await supabaseTransport.sendSale(salePayload(), 42, 'op-second-00000000000001');

    expect(fake.inserts).toHaveLength(1);
    expect(fake.inserts[0]?.row).not.toHaveProperty('client_op_id');
  });

  it('does not look up an id the database cannot store', async () => {
    fake.insertResponses = [
      { data: null, error: unknownColumn },
      { data: { id: 5 }, error: null },
    ];
    await supabaseTransport.sendSale(salePayload(), 42, OP);

    // A 23505 now can only be a real conflict, and the lookup would query a
    // column that does not exist.
    fake.inserts = [];
    fake.insertResponses = [{ data: null, error: duplicate }];
    const result = await supabaseTransport.sendSale(salePayload(), 42, OP);

    expect(fake.lookups).toHaveLength(0);
    expect(result.outcome).toBe('reject');
  });

  it('starts using the column again in a new session', async () => {
    fake.insertResponses = [
      { data: null, error: unknownColumn },
      { data: { id: 5 }, error: null },
    ];
    await supabaseTransport.sendSale(salePayload(), 42, OP);
    expect(idempotencyAvailable()).toBe(false);

    // A reload is what happens after the migration is finally run — no redeploy
    // is needed for the app to pick the column back up.
    resetIdempotencyProbe();
    fake.inserts = [];
    fake.insertResponses = [{ data: { id: 6 }, error: null }];
    await supabaseTransport.sendSale(salePayload(), 42, OP);

    expect(fake.inserts[0]?.row).toHaveProperty('client_op_id', OP);
  });

  it('does not retry a failure that is not about the column', async () => {
    fake.insertResponses = [{ data: null, error: { code: '23514', message: 'check' } }];

    const result = await supabaseTransport.sendSale(salePayload(), 42, OP);

    expect(fake.inserts).toHaveLength(1);
    expect(result.outcome).toBe('reject');
    expect(idempotencyAvailable()).toBe(true);
  });
});

describe('interpretDuplicate', () => {
  const error = { code: '23505', message: 'duplicate' };

  it('treats a found row as the success it was', () => {
    expect(interpretDuplicate({ found: true, id: 9 }, error, 'x')).toEqual({
      outcome: 'ok',
      value: 9,
    });
  });

  it('retries when the lookup could not answer', () => {
    expect(interpretDuplicate({ found: 'unknown' }, error, 'x').outcome).toBe('retry');
  });

  it('rejects when the row is definitively absent', () => {
    expect(interpretDuplicate({ found: false }, error, 'x').outcome).toBe('reject');
  });
});

describe('isUniqueViolation', () => {
  it('recognises 23505 and nothing else', () => {
    expect(isUniqueViolation({ code: '23505' })).toBe(true);
    expect(isUniqueViolation({ code: '23503' })).toBe(false);
    expect(isUniqueViolation({ message: 'Failed to fetch' })).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
  });
});
