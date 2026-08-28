import { describe, it, expect } from 'vitest';
import { decodePick, encodePick, findDoubleBooking, parseAssignment } from './routePlans';
import type { RouteAssignment } from '../features/reports/routePlanMessage';

const outlets = [
  { id: 1, name: 'QAS_Othaim Mall_HYP' },
  { id: 2, name: 'QAS_Nakheel_HYP' },
];

describe('parseAssignment', () => {
  it('reads an outlet assignment', () => {
    expect(
      parseAssignment({ promoter_id: 'p1', touch_point_id: 1, shift: 'day', status: null }),
    ).toEqual({ promoterId: 'p1', assignment: { kind: 'outlet', touchPointId: 1, shift: 'day' } });
  });

  it('reads a leave status', () => {
    expect(
      parseAssignment({ promoter_id: 'p1', touch_point_id: null, shift: null, status: 'annual' }),
    ).toEqual({ promoterId: 'p1', assignment: { kind: 'status', status: 'annual' } });
  });

  it('prefers the status when a row somehow carries both', () => {
    // The shape check constraint forbids this, but a parser that silently
    // picked the outlet would hide a real data problem.
    const parsed = parseAssignment({
      promoter_id: 'p1',
      touch_point_id: 1,
      shift: 'day',
      status: 'sick',
    });
    expect(parsed?.assignment).toEqual({ kind: 'status', status: 'sick' });
  });

  it('rejects an unknown status or shift', () => {
    expect(
      parseAssignment({ promoter_id: 'p1', touch_point_id: null, shift: null, status: 'holiday' }),
    ).toBeNull();
    expect(
      parseAssignment({ promoter_id: 'p1', touch_point_id: 1, shift: 'evening', status: null }),
    ).toBeNull();
  });

  it('rejects a row with neither an outlet nor a status', () => {
    expect(
      parseAssignment({ promoter_id: 'p1', touch_point_id: null, shift: null, status: null }),
    ).toBeNull();
  });
});

describe('findDoubleBooking', () => {
  const assign = (touchPointId: number, shift: 'day' | 'night'): RouteAssignment => ({
    kind: 'outlet',
    touchPointId,
    shift,
  });

  it('passes a clean plan', () => {
    const picks = new Map<string, RouteAssignment>([
      ['p1', assign(1, 'day')],
      ['p2', assign(1, 'night')],
      ['p3', assign(2, 'day')],
    ]);
    expect(findDoubleBooking(picks, outlets)).toBeNull();
  });

  it('names the outlet and shift in conflict', () => {
    const picks = new Map<string, RouteAssignment>([
      ['p1', assign(1, 'day')],
      ['p2', assign(1, 'day')],
    ]);
    const problem = findDoubleBooking(picks, outlets);
    expect(problem).toContain('Othaim Mall');
    expect(problem).toContain('نهاري');
  });

  it('allows the same outlet on different shifts', () => {
    const picks = new Map<string, RouteAssignment>([
      ['p1', assign(1, 'day')],
      ['p2', assign(1, 'night')],
    ]);
    expect(findDoubleBooking(picks, outlets)).toBeNull();
  });

  it('does not treat two leave statuses as a conflict', () => {
    // Leave rows carry NULL outlet and shift, so the database allows any
    // number of them on one date.
    const picks = new Map<string, RouteAssignment>([
      ['p1', { kind: 'status', status: 'off' }],
      ['p2', { kind: 'status', status: 'off' }],
    ]);
    expect(findDoubleBooking(picks, outlets)).toBeNull();
  });

  it('falls back gracefully when the outlet is unknown', () => {
    const picks = new Map<string, RouteAssignment>([
      ['p1', assign(99, 'day')],
      ['p2', assign(99, 'day')],
    ]);
    expect(findDoubleBooking(picks, outlets)).toContain('أكثر من مندوب');
  });

  it('passes an empty plan', () => {
    expect(findDoubleBooking(new Map(), outlets)).toBeNull();
  });
});

describe('pick encoding', () => {
  it('round-trips an outlet assignment', () => {
    const assignment: RouteAssignment = { kind: 'outlet', touchPointId: 12, shift: 'night' };
    expect(encodePick(assignment)).toBe('tp:12:night');
    expect(decodePick('tp:12:night')).toEqual(assignment);
  });

  it('round-trips a leave status', () => {
    const assignment: RouteAssignment = { kind: 'status', status: 'annual' };
    expect(encodePick(assignment)).toBe('st:annual');
    expect(decodePick('st:annual')).toEqual(assignment);
  });

  it('encodes an absent pick as the empty option', () => {
    expect(encodePick(undefined)).toBe('');
    expect(decodePick('')).toBeNull();
  });

  it('rejects a malformed value rather than guessing', () => {
    for (const value of ['tp:', 'tp:abc:day', 'tp:1:evening', 'st:holiday', 'nonsense']) {
      expect(decodePick(value)).toBeNull();
    }
  });
});
