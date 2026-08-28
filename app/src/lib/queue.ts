/**
 * The offline write queue.
 *
 * Retail floors have dead spots. Today a sale logged without signal fails
 * silently: the promoter taps, nothing visible happens, and the sale is gone.
 * Nobody finds out until the totals are short at the end of the month, by which
 * point nobody can reconstruct what was lost.
 *
 * So writes are queued locally first and replayed when the connection returns.
 * Three problems make this harder than a list of retries:
 *
 * **Dependencies.** A sale belongs to an attendance row. If a promoter signs in
 * *and* logs sales while offline, the sale references an attendance row that
 * has no server id yet. Queued sales therefore reference the sign-in by its
 * local operation id, and replay resolves that to the real id once the
 * attendance row lands.
 *
 * **Ordering.** Operations replay oldest-first, and a sale whose attendance has
 * not yet been created stays queued rather than failing. Losing the parent
 * would orphan every sale behind it.
 *
 * **Retry safety.** A failure that will never succeed — an invalid device
 * colour, a rejected constraint — must not retry forever. Those are marked
 * failed and surfaced, rather than silently cycling.
 *
 * Storage is behind an interface so the logic is testable in memory and backed
 * by IndexedDB in the browser. IndexedDB rather than localStorage because a
 * shift's worth of sales must survive a crash, a reload, and the browser
 * evicting a background tab.
 */

export type OperationKind = 'attendance' | 'sale';

export type OperationStatus = 'pending' | 'failed';

/** How a sale points at the attendance row it belongs to. */
export type AttendanceRef =
  | { readonly type: 'server'; readonly id: number }
  | { readonly type: 'local'; readonly operationId: string };

export interface AttendanceOperation {
  readonly kind: 'attendance';
  readonly payload: Record<string, unknown>;
}

export interface SaleOperation {
  readonly kind: 'sale';
  readonly attendance: AttendanceRef;
  readonly payload: Record<string, unknown>;
}

export type OperationBody = AttendanceOperation | SaleOperation;

export interface QueuedOperation {
  readonly id: string;
  readonly createdAt: number;
  readonly attempts: number;
  readonly status: OperationStatus;
  readonly lastError: string | null;
  readonly body: OperationBody;
}

/** Persistence. Deliberately tiny, so IndexedDB and a Map both satisfy it. */
export interface QueueStore {
  list(): Promise<QueuedOperation[]>;
  put(operation: QueuedOperation): Promise<void>;
  remove(id: string): Promise<void>;
  clear(): Promise<void>;
}

/**
 * What the caller supplies to actually perform a write.
 *
 * `opId` is the operation's own id, passed to every attempt at that operation
 * and never regenerated. The transport sends it with the row so a retry that
 * follows a lost response collides with the row it already wrote instead of
 * duplicating it. Passing it here rather than burying it in the payload makes
 * that structural: no caller can forget to include it.
 */
export interface QueueTransport {
  /** Returns the new attendance row's server id. */
  sendAttendance(payload: Record<string, unknown>, opId: string): Promise<SendResult<number>>;
  sendSale(
    payload: Record<string, unknown>,
    attendanceId: number,
    opId: string,
  ): Promise<SendResult<number>>;
}

/**
 * The distinction that makes retrying safe.
 *
 * `retry` means the write did not happen and trying again is correct — offline,
 * a timeout, a 5xx. `reject` means the server understood and refused; retrying
 * reproduces the refusal forever, so the operation is parked and surfaced.
 */
export type SendResult<T> =
  | { readonly outcome: 'ok'; readonly value: T }
  | { readonly outcome: 'retry'; readonly reason: string }
  | { readonly outcome: 'reject'; readonly reason: string };

export interface ReplaySummary {
  readonly sent: number;
  readonly stillPending: number;
  readonly failed: number;
  /** True when nothing could be sent because the connection is still down. */
  readonly offline: boolean;
}

/** Attempts before an operation is parked, so a broken write cannot cycle forever. */
export const MAX_ATTEMPTS = 8;

let counter = 0;

/**
 * A unique id for an operation, and now also its idempotency key on the server.
 *
 * `crypto.randomUUID` where available. The fallback adds randomness rather than
 * relying on the timestamp and counter alone: those are unique within one
 * device's queue, which was enough when the id never left the device, but it is
 * now written to a uniquely-indexed column that a second device could collide
 * with. Sixteen random hex characters make that vanishingly unlikely without
 * needing a UUID implementation.
 */
export function newOperationId(): string {
  const globalCrypto = globalThis.crypto as
    | { randomUUID?: () => string; getRandomValues?: (array: Uint8Array) => Uint8Array }
    | undefined;

  if (typeof globalCrypto?.randomUUID === 'function') return globalCrypto.randomUUID();

  counter += 1;
  return `op-${Date.now().toString(36)}-${counter.toString(36)}-${randomSuffix(globalCrypto)}`;
}

/** Sixteen hex characters, from the platform's CSPRNG when it has one. */
function randomSuffix(
  source: { getRandomValues?: (array: Uint8Array) => Uint8Array } | undefined,
): string {
  const bytes = new Uint8Array(8);
  if (typeof source?.getRandomValues === 'function') {
    source.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  }
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export class WriteQueue {
  private replaying = false;

  constructor(
    private readonly store: QueueStore,
    private readonly transport: QueueTransport,
    private readonly now: () => number = Date.now,
  ) {}

  /**
   * Adds an operation and returns its local id, for a sale to reference.
   *
   * `id` lets the caller supply an id generated *before* the first attempt.
   * That matters for the online path: a sale is written directly, and only
   * queued once that write fails ambiguously. Generating a fresh id at that
   * point would make the queued retry look like a different sale to the server,
   * reopening exactly the duplicate window this is here to close. So the caller
   * mints one id per logical sale and hands it in.
   *
   * Re-enqueuing with an id already in the store overwrites that entry rather
   * than adding a second one, which keeps one logical write to one queue slot.
   */
  async enqueue(body: OperationBody, id: string = newOperationId()): Promise<string> {
    const operation: QueuedOperation = {
      id,
      createdAt: this.now(),
      attempts: 0,
      status: 'pending',
      lastError: null,
      body,
    };
    await this.store.put(operation);
    return operation.id;
  }

  /** Everything still queued, oldest first. */
  async list(): Promise<QueuedOperation[]> {
    const all = await this.store.list();
    return [...all].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
  }

  /** The number to show the promoter. Parked failures are counted separately. */
  async counts(): Promise<{ pending: number; failed: number }> {
    const all = await this.list();
    return {
      pending: all.filter((operation) => operation.status === 'pending').length,
      failed: all.filter((operation) => operation.status === 'failed').length,
    };
  }

  /** Discards a parked operation the supervisor has decided to abandon. */
  async discard(id: string): Promise<void> {
    await this.store.remove(id);
  }

  /** Returns a parked operation to the queue, e.g. after fixing the cause. */
  async retry(id: string): Promise<void> {
    const all = await this.store.list();
    const operation = all.find((candidate) => candidate.id === id);
    if (operation === undefined) return;
    await this.store.put({ ...operation, status: 'pending', attempts: 0, lastError: null });
  }

  /**
   * Sends everything that can be sent, oldest first.
   *
   * Re-entrant calls are ignored: a replay triggered by "back online" while one
   * is already running would double-send every operation.
   */
  async replay(): Promise<ReplaySummary> {
    if (this.replaying) {
      const { pending, failed } = await this.counts();
      return { sent: 0, stillPending: pending, failed, offline: false };
    }
    this.replaying = true;

    try {
      const operations = await this.list();
      /** Local operation id to the server id it produced. */
      const resolved = new Map<string, number>();
      let sent = 0;
      let offline = false;

      for (const operation of operations) {
        if (operation.status === 'failed') continue;

        // Once the connection is clearly down, stop rather than burning an
        // attempt on every remaining operation and parking them all.
        if (offline) continue;

        const attendanceId = this.resolveAttendance(operation, resolved, operations);
        if (attendanceId === 'unresolved') {
          // The parent has not landed yet. Leave this queued untouched — it is
          // waiting, not failing, and must not accrue attempts.
          continue;
        }
        if (attendanceId === 'orphaned') {
          await this.store.put({
            ...operation,
            status: 'failed',
            lastError: 'تعذّر تسجيل يوم العملية — راجع السجل',
          });
          continue;
        }

        const result = await this.send(operation, attendanceId);

        if (result.outcome === 'ok') {
          if (operation.body.kind === 'attendance') resolved.set(operation.id, result.value);
          await this.store.remove(operation.id);
          sent += 1;
          continue;
        }

        const attempts = operation.attempts + 1;

        if (result.outcome === 'retry') {
          offline = true;
          await this.store.put({
            ...operation,
            attempts,
            status: attempts >= MAX_ATTEMPTS ? 'failed' : 'pending',
            lastError: result.reason,
          });
          continue;
        }

        // Rejected: the server understood and refused. Retrying reproduces it.
        await this.store.put({
          ...operation,
          attempts,
          status: 'failed',
          lastError: result.reason,
        });
      }

      const { pending, failed } = await this.counts();
      return { sent, stillPending: pending, failed, offline };
    } finally {
      this.replaying = false;
    }
  }

  /**
   * Where a sale's attendance row is, if anywhere.
   *
   * The distinction between `unresolved` and `orphaned` matters: a sale whose
   * parent has not been sent *yet* must wait, but a sale whose parent was
   * permanently rejected or discarded would otherwise wait forever for a row
   * that is never coming. Waiting silently is precisely the failure this queue
   * exists to prevent, so an orphan is surfaced instead.
   */
  private resolveAttendance(
    operation: QueuedOperation,
    resolved: ReadonlyMap<string, number>,
    operations: readonly QueuedOperation[],
  ): number | 'unresolved' | 'orphaned' | null {
    if (operation.body.kind !== 'sale') return null;

    const reference = operation.body.attendance;
    if (reference.type === 'server') return reference.id;

    const serverId = resolved.get(reference.operationId);
    if (serverId !== undefined) return serverId;

    const parent = operations.find((candidate) => candidate.id === reference.operationId);
    if (parent === undefined) return 'orphaned'; // discarded, or lost with the store
    if (parent.status === 'failed') return 'orphaned';
    return 'unresolved';
  }

  private async send(
    operation: QueuedOperation,
    attendanceId: number | 'unresolved' | 'orphaned' | null,
  ): Promise<SendResult<number>> {
    if (operation.body.kind === 'attendance') {
      return this.transport.sendAttendance(operation.body.payload, operation.id);
    }
    if (typeof attendanceId !== 'number') {
      return { outcome: 'reject', reason: 'مرجع الجلسة غير صالح' };
    }
    return this.transport.sendSale(operation.body.payload, attendanceId, operation.id);
  }
}

// ---------------------------------------------------------------------------
// Stores
// ---------------------------------------------------------------------------

/** In-memory store, for tests and for a browser without IndexedDB. */
export class MemoryQueueStore implements QueueStore {
  private readonly items = new Map<string, QueuedOperation>();

  list(): Promise<QueuedOperation[]> {
    return Promise.resolve([...this.items.values()]);
  }

  put(operation: QueuedOperation): Promise<void> {
    this.items.set(operation.id, operation);
    return Promise.resolve();
  }

  remove(id: string): Promise<void> {
    this.items.delete(id);
    return Promise.resolve();
  }

  clear(): Promise<void> {
    this.items.clear();
    return Promise.resolve();
  }
}

const DB_NAME = 'datracker';
const DB_VERSION = 1;
const STORE_NAME = 'write-queue';

/**
 * IndexedDB-backed store.
 *
 * A shift's worth of sales has to survive a reload, a crash, and the browser
 * evicting a backgrounded tab, which rules out in-memory state. localStorage
 * would technically work but is synchronous and small; this is the right shape
 * for the job even though the API is verbose.
 */
export class IndexedDbQueueStore implements QueueStore {
  private database: IDBDatabase | null = null;

  private open(): Promise<IDBDatabase> {
    if (this.database !== null) return Promise.resolve(this.database);

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(STORE_NAME)) {
          database.createObjectStore(STORE_NAME, { keyPath: 'id' });
        }
      };

      request.onsuccess = () => {
        this.database = request.result;
        resolve(request.result);
      };

      request.onerror = () => reject(request.error ?? new Error('indexedDB open failed'));
    });
  }

  private async transaction<T>(
    mode: IDBTransactionMode,
    run: (store: IDBObjectStore) => IDBRequest<T>,
  ): Promise<T> {
    const database = await this.open();
    return new Promise((resolve, reject) => {
      const tx = database.transaction(STORE_NAME, mode);
      const request = run(tx.objectStore(STORE_NAME));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('indexedDB request failed'));
    });
  }

  async list(): Promise<QueuedOperation[]> {
    const rows = await this.transaction<unknown[]>('readonly', (store) => store.getAll());
    return rows.filter(isQueuedOperation);
  }

  async put(operation: QueuedOperation): Promise<void> {
    await this.transaction('readwrite', (store) => store.put(operation));
  }

  async remove(id: string): Promise<void> {
    await this.transaction('readwrite', (store) => store.delete(id));
  }

  async clear(): Promise<void> {
    await this.transaction('readwrite', (store) => store.clear());
  }
}

/** Guards against a stored shape from an older version of the app. */
function isQueuedOperation(value: unknown): value is QueuedOperation {
  if (value === null || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  if (typeof record['id'] !== 'string') return false;
  if (typeof record['createdAt'] !== 'number') return false;
  const body = record['body'];
  if (body === null || typeof body !== 'object') return false;
  const kind = (body as Record<string, unknown>)['kind'];
  return kind === 'attendance' || kind === 'sale';
}

/** True when IndexedDB is usable; a private window can refuse it. */
export function hasIndexedDb(): boolean {
  try {
    return typeof indexedDB !== 'undefined';
  } catch {
    return false;
  }
}

export function createQueueStore(): QueueStore {
  return hasIndexedDb() ? new IndexedDbQueueStore() : new MemoryQueueStore();
}
