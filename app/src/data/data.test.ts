import { describe, it, expect } from 'vitest';
import { toDataError, fail, ok, invalid, type Result } from './errors';
import {
  conflictMessage,
  findSignInConflict,
  parseSession,
  storedShiftFor,
  type Session,
} from './attendance';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function session(overrides: Partial<Session> = {}): Session {
  const base: Session = {
    id: 1,
    promoterId: 'p1',
    workDate: '2026-08-25',
    status: 'work',
    touchPointId: 10,
    storedShift: 'day',
    workingShift: 'day',
    guidedTrials: 0,
    checkedInAt: null,
    outlet: null,
  };
  return { ...base, ...overrides };
}

/** A leave row as the database actually stores it: shift defaults to 'day'. */
function leaveSession(status: Session['status'], id = 2): Session {
  return session({
    id,
    status,
    touchPointId: null,
    storedShift: 'day',
    workingShift: null,
  });
}

describe('error mapping', () => {
  it('never shows a Postgres code to the user', () => {
    const mapped = toDataError({ code: '23505', message: 'duplicate key value' });
    expect(mapped.message).not.toMatch(/23505/);
    expect(mapped.message).not.toMatch(/duplicate/i);
    expect(mapped.code).toBe('23505');
    expect(mapped.detail).toBe('duplicate key value');
  });

  it('lets the caller name the specific conflict', () => {
    const mapped = toDataError(
      { code: '23503', message: 'violates foreign key' },
      { overrides: { '23503': 'لا يمكن حذف يوم عليه مبيعات — احذف مبيعاته أولاً' } },
    );
    expect(mapped.message).toBe('لا يمكن حذف يوم عليه مبيعات — احذف مبيعاته أولاً');
  });

  it('falls back to the action when the code is unknown', () => {
    const mapped = toDataError({ code: 'XX999', message: 'boom' }, { action: 'تسجيل البيع' });
    expect(mapped.message).toContain('تسجيل البيع');
  });

  it('recognises an offline failure and marks it retryable', () => {
    const mapped = toDataError({ message: 'TypeError: Failed to fetch' });
    expect(mapped.message).toContain('الإنترنت');
    expect(mapped.retryable).toBe(true);
  });

  it('treats an RLS refusal as something to escalate, not retry', () => {
    const mapped = toDataError({ code: '42501', message: 'row-level security' });
    expect(mapped.message).toContain('صلاحية');
    expect(mapped.retryable).toBe(false);
  });

  it('handles a null error without throwing', () => {
    const mapped = toDataError(null);
    expect(mapped.message).toBeTruthy();
    expect(mapped.code).toBeNull();
  });

  it('builds ok and failed results', () => {
    const good: Result<number> = ok(42);
    expect(good).toEqual({ ok: true, data: 42 });

    const bad = fail('nope');
    expect(bad.ok).toBe(false);

    const clientSide = invalid('اختر الفترة أولاً');
    expect(clientSide.ok).toBe(false);
    if (!clientSide.ok) expect(clientSide.error.code).toBe('CLIENT_VALIDATION');
  });
});

describe('parseSession', () => {
  it('parses a work row', () => {
    const parsed = parseSession({
      id: 7,
      promoter_id: 'p1',
      work_date: '2026-08-25',
      touch_point_id: 3,
      shift: 'night',
      status: 'work',
      guided_trials: 4,
      checked_in_at: '2026-08-25T18:00:00Z',
    });
    expect(parsed).not.toBeNull();
    expect(parsed?.workingShift).toBe('night');
    expect(parsed?.guidedTrials).toBe(4);
  });

  it('reports no working shift for a leave row, despite the stored default', () => {
    const parsed = parseSession({
      id: 8,
      promoter_id: 'p1',
      work_date: '2026-08-25',
      touch_point_id: null,
      shift: 'day', // the column default, not a real shift
      status: 'off',
      guided_trials: 0,
      checked_in_at: null,
    });
    expect(parsed?.storedShift).toBe('day');
    expect(parsed?.workingShift).toBeNull();
  });

  it('rejects a row whose status is not a known value', () => {
    expect(
      parseSession({
        id: 9,
        promoter_id: 'p1',
        work_date: '2026-08-25',
        shift: 'day',
        status: 'holiday',
      }),
    ).toBeNull();
  });

  it('rejects a row missing a column the code reads', () => {
    // The exact failure that made every LAS count read zero: a column that was
    // never selected arrives as undefined and reads as a plausible value.
    expect(parseSession({ id: 9, promoter_id: 'p1', work_date: '2026-08-25' })).toBeNull();
  });

  it('rejects non-objects', () => {
    for (const value of [null, undefined, 'row', 42, []]) {
      expect(parseSession(value)).toBeNull();
    }
  });

  it('accepts an embedded outlet as an object or a single-element array', () => {
    const row = {
      id: 1,
      promoter_id: 'p1',
      work_date: '2026-08-25',
      shift: 'day',
      status: 'work',
      touch_point_id: 3,
      guided_trials: 0,
      checked_in_at: null,
    };
    const asObject = parseSession({
      ...row,
      touch_points: { id: 3, name: 'QAS_Mall_X', shift_mode: 'dual', city: 'Qassim' },
    });
    const asArray = parseSession({
      ...row,
      touch_points: [{ id: 3, name: 'QAS_Mall_X', shift_mode: 'dual', city: 'Qassim' }],
    });
    expect(asObject?.outlet?.name).toBe('QAS_Mall_X');
    expect(asArray?.outlet?.name).toBe('QAS_Mall_X');
  });
});

describe('storedShiftFor', () => {
  it('uses the chosen shift for a work day', () => {
    expect(storedShiftFor({ status: 'work', shift: 'night' })).toBe('night');
  });

  it('reproduces the column default for every leave status', () => {
    for (const status of ['off', 'sick', 'leave', 'absent'] as const) {
      expect(storedShiftFor({ status, shift: null })).toBe('day');
      // Even if a shift is somehow supplied, a leave row stores the default.
      expect(storedShiftFor({ status, shift: 'night' })).toBe('day');
    }
  });
});

describe('sign-in conflicts', () => {
  it('allows the first record of a day', () => {
    expect(findSignInConflict([], { status: 'work', shift: 'day' })).toBeNull();
    expect(findSignInConflict([], { status: 'off', shift: null })).toBeNull();
  });

  it('allows the second shift at a dual outlet', () => {
    const existing = [session({ storedShift: 'day', workingShift: 'day' })];
    expect(findSignInConflict(existing, { status: 'work', shift: 'night' })).toBeNull();
  });

  it('blocks re-registering the same working shift', () => {
    const existing = [session({ storedShift: 'night', workingShift: 'night' })];
    const conflict = findSignInConflict(existing, { status: 'work', shift: 'night' });
    expect(conflict?.kind).toBe('same-shift');
    expect(conflictMessage(conflict!)).toContain('افتح الجلسة');
  });

  describe('a day marked as leave', () => {
    it('blocks a day shift, which the unique constraint would also block', () => {
      const conflict = findSignInConflict([leaveSession('off')], {
        status: 'work',
        shift: 'day',
      });
      expect(conflict?.kind).toBe('day-marked-leave');
    });

    it('blocks a NIGHT shift, which the unique constraint would NOT block', () => {
      // This is the hole the database leaves open: the leave row stores
      // shift='day', so a night row has a different key and inserts cleanly,
      // leaving a promoter both off and working on the same date.
      const conflict = findSignInConflict([leaveSession('off')], {
        status: 'work',
        shift: 'night',
      });
      expect(conflict?.kind).toBe('day-marked-leave');
    });

    it('names the status rather than translating a Postgres code', () => {
      const conflict = findSignInConflict([leaveSession('sick')], {
        status: 'work',
        shift: 'night',
      });
      const message = conflictMessage(conflict!);
      expect(message).toContain('مرضية');
      expect(message).toContain('احذف السجل أولاً');
      expect(message).not.toMatch(/23505/);
    });

    it('blocks every work shift for every leave status', () => {
      for (const status of ['off', 'sick', 'leave', 'absent'] as const) {
        for (const shift of ['day', 'night'] as const) {
          const conflict = findSignInConflict([leaveSession(status)], {
            status: 'work',
            shift,
          });
          expect(conflict?.kind).toBe('day-marked-leave');
        }
      }
    });
  });

  describe('adding a leave status', () => {
    it('blocks it when the day already has a work session', () => {
      const conflict = findSignInConflict([session()], { status: 'off', shift: null });
      expect(conflict?.kind).toBe('day-already-recorded');
    });

    it('blocks a second leave status on the same day', () => {
      const conflict = findSignInConflict([leaveSession('off')], {
        status: 'sick',
        shift: null,
      });
      expect(conflict?.kind).toBe('day-already-recorded');
      expect(conflictMessage(conflict!)).toContain('أوف');
    });

    it('blocks it even when only a night session exists', () => {
      // The leave row would store shift='day' and insert cleanly, so only this
      // check prevents a promoter being both off and working that night.
      const night = session({ storedShift: 'night', workingShift: 'night' });
      const conflict = findSignInConflict([night], { status: 'absent', shift: null });
      expect(conflict?.kind).toBe('day-already-recorded');
    });
  });

  it('produces a non-empty Arabic message for every conflict kind', () => {
    const cases = [
      findSignInConflict([session()], { status: 'work', shift: 'day' }),
      findSignInConflict([leaveSession('off')], { status: 'work', shift: 'night' }),
      findSignInConflict([session()], { status: 'off', shift: null }),
    ];
    for (const conflict of cases) {
      expect(conflict).not.toBeNull();
      const message = conflictMessage(conflict!);
      expect(message.length).toBeGreaterThan(10);
      expect(message).toMatch(/[؀-ۿ]/); // contains Arabic
    }
  });
});
