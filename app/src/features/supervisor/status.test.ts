import { describe, it, expect } from 'vitest';
import { deriveStatus, slotKey, type StatusInput } from './status';

/**
 * Every case here is an absence. Absences are what the supervisor needs to see
 * first, what a live database makes hard to spot, and what the legacy screens
 * are worst at showing.
 */

const base: StatusInput = {
  date: '2026-08-27',
  month: '2026-08',
  promoters: [
    { id: 'p1', fullName: 'Ahmed' },
    { id: 'p2', fullName: 'Khalid' },
    { id: 'p3', fullName: 'Sami' },
  ],
  outlets: [
    { id: 1, name: 'QAS_Othaim Mall_HYP', shiftMode: 'dual' },
    { id: 2, name: 'QAS_Nakheel_HYP', shiftMode: 'night' },
  ],
  attendance: [
    { promoterId: 'p1', touchPointId: 1, shift: 'day', isWork: true },
    { promoterId: 'p2', touchPointId: 1, shift: 'night', isWork: true },
    { promoterId: 'p3', touchPointId: 2, shift: 'night', isWork: true },
  ],
  targetedPairs: new Set([slotKey(1, 'day'), slotKey(1, 'night'), slotKey(2, 'night')]),
  checklistItemCount: 3,
  checklistDone: new Map([
    ['p1', 3],
    ['p2', 3],
    ['p3', 3],
  ]),
};

describe('deriveStatus', () => {
  it('reports all clear when nothing needs attention', () => {
    const status = deriveStatus(base);
    expect(status.allClear).toBe(true);
    expect(status.notReported).toEqual([]);
    expect(status.unstaffed).toEqual([]);
    expect(status.missingTargets).toEqual([]);
    expect(status.checklistGaps).toEqual([]);
  });

  describe('who has not reported', () => {
    it('names a promoter with no attendance row', () => {
      const status = deriveStatus({ ...base, attendance: base.attendance.slice(1) });
      expect(status.notReported.map((p) => p.fullName)).toEqual(['Ahmed']);
      expect(status.allClear).toBe(false);
    });

    it('counts a leave day as having reported', () => {
      // Marked off is not the same as silent. One needs no chasing.
      const status = deriveStatus({
        ...base,
        attendance: [
          { promoterId: 'p1', touchPointId: null, shift: null, isWork: false },
          ...base.attendance.slice(1),
        ],
      });
      expect(status.notReported).toEqual([]);
    });

    it('lists everyone when nobody has reported', () => {
      const status = deriveStatus({ ...base, attendance: [] });
      expect(status.notReported).toHaveLength(3);
    });
  });

  describe('unstaffed outlets', () => {
    it('flags a shift nobody is covering', () => {
      const status = deriveStatus({
        ...base,
        attendance: base.attendance.filter((a) => a.promoterId !== 'p3'),
      });
      expect(status.unstaffed).toEqual([
        { outletId: 2, outletName: 'Nakheel', shift: 'night' },
      ]);
    });

    it('expands a dual outlet into both shifts', () => {
      const status = deriveStatus({ ...base, attendance: [] });
      expect(status.unstaffed.map((s) => `${s.outletName} ${s.shift}`)).toEqual([
        'Othaim Mall day',
        'Othaim Mall night',
        'Nakheel night',
      ]);
    });

    it('never expects a day shift at a night-only outlet', () => {
      const status = deriveStatus({ ...base, attendance: [] });
      expect(status.unstaffed.some((s) => s.outletId === 2 && s.shift === 'day')).toBe(false);
    });

    it('does not count a promoter on leave as staffing anything', () => {
      // A leave row has no outlet, so the slot it would have covered is open.
      const status = deriveStatus({
        ...base,
        attendance: [
          { promoterId: 'p3', touchPointId: null, shift: null, isWork: false },
          ...base.attendance.slice(0, 2),
        ],
      });
      expect(status.unstaffed).toEqual([
        { outletId: 2, outletName: 'Nakheel', shift: 'night' },
      ]);
    });

    it('shows the human part of the outlet name', () => {
      const status = deriveStatus({ ...base, attendance: [] });
      expect(status.unstaffed[0]?.outletName).toBe('Othaim Mall');
    });
  });

  describe('missing targets', () => {
    it('flags an outlet+shift with no target this month', () => {
      const status = deriveStatus({
        ...base,
        targetedPairs: new Set([slotKey(1, 'day')]),
      });
      expect(status.missingTargets.map((s) => `${s.outletName} ${s.shift}`)).toEqual([
        'Othaim Mall night',
        'Nakheel night',
      ]);
    });

    it('is independent of whether anyone is working there', () => {
      // A target can be missing at a fully staffed outlet; both matter and
      // neither implies the other.
      const status = deriveStatus({ ...base, targetedPairs: new Set() });
      expect(status.unstaffed).toEqual([]);
      expect(status.missingTargets).toHaveLength(3);
    });
  });

  describe('checklist gaps', () => {
    it('includes a promoter who has ticked nothing at all', () => {
      // The legacy view renders only promoters who have responses, so someone
      // who ticked nothing simply does not appear on the screen meant to catch
      // exactly that.
      const status = deriveStatus({
        ...base,
        checklistDone: new Map([
          ['p1', 3],
          ['p2', 3],
        ]),
      });
      expect(status.checklistGaps).toEqual([
        { promoterId: 'p3', fullName: 'Sami', done: 0, total: 3 },
      ]);
    });

    it('includes a partial completion', () => {
      const status = deriveStatus({
        ...base,
        checklistDone: new Map([
          ['p1', 1],
          ['p2', 3],
          ['p3', 3],
        ]),
      });
      expect(status.checklistGaps.map((g) => g.fullName)).toEqual(['Ahmed']);
    });

    it('orders by how little is done', () => {
      const status = deriveStatus({
        ...base,
        checklistDone: new Map([
          ['p1', 2],
          ['p2', 0],
          ['p3', 1],
        ]),
      });
      expect(status.checklistGaps.map((g) => g.fullName)).toEqual(['Khalid', 'Sami', 'Ahmed']);
    });

    it('does not chase someone who is not working today', () => {
      const status = deriveStatus({
        ...base,
        attendance: [
          { promoterId: 'p1', touchPointId: 1, shift: 'day', isWork: true },
          { promoterId: 'p2', touchPointId: null, shift: null, isWork: false },
        ],
        checklistDone: new Map([['p1', 3]]),
      });
      expect(status.checklistGaps).toEqual([]);
    });

    it('reports nothing when no checklist items are configured', () => {
      const status = deriveStatus({
        ...base,
        checklistItemCount: 0,
        checklistDone: new Map(),
      });
      expect(status.checklistGaps).toEqual([]);
      expect(status.allClear).toBe(true);
    });

    it('counts a promoter working both shifts once', () => {
      const status = deriveStatus({
        ...base,
        attendance: [
          { promoterId: 'p1', touchPointId: 1, shift: 'day', isWork: true },
          { promoterId: 'p1', touchPointId: 1, shift: 'night', isWork: true },
          ...base.attendance.slice(2),
        ],
        checklistDone: new Map([['p3', 3]]),
      });
      expect(status.checklistGaps.filter((g) => g.promoterId === 'p1')).toHaveLength(1);
    });
  });

  it('handles a city with no promoters or outlets', () => {
    const status = deriveStatus({
      ...base,
      promoters: [],
      outlets: [],
      attendance: [],
      targetedPairs: new Set(),
      checklistDone: new Map(),
    });
    expect(status.allClear).toBe(true);
  });
});
