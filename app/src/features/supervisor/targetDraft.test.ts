import { describe, it, expect } from 'vitest';
import { indexTargets, targetKey, type Target } from '../../data/targets';
import { targetEntries, targetFields } from './targetDraft';

/**
 * The targets form once copied the saved table into state on mount, before
 * that table had loaded. Every target showed blank on the first visit, and
 * typing one sales figure then saved that row's GT target as 0.
 */

const saved = indexTargets([
  { touchPointId: 1, shift: 'day', month: '2026-09', dailyTarget: 6, gtTarget: 4 },
  { touchPointId: 1, shift: 'night', month: '2026-09', dailyTarget: 4.5, gtTarget: 3 },
] as Target[]);

const DAY1 = targetKey(1, 'day');
const NIGHT1 = targetKey(1, 'night');
const DAY2 = targetKey(2, 'day');

const outlets = [
  { id: 1, shiftMode: 'dual' as const },
  { id: 2, shiftMode: 'day' as const },
];

describe('what the form shows', () => {
  it('is the saved target when nothing has been typed', () => {
    expect(targetFields(DAY1, saved, {})).toEqual({ sales: '6', gt: '4' });
  });

  it('keeps a fractional target as saved', () => {
    expect(targetFields(NIGHT1, saved, {}).sales).toBe('4.5');
  });

  it('is blank for a row with no target yet', () => {
    expect(targetFields(DAY2, saved, {})).toEqual({ sales: '', gt: '' });
  });

  it('is the typed value once one field is edited, and the saved one for the other', () => {
    expect(targetFields(DAY1, saved, { [DAY1]: { sales: '7' } })).toEqual({ sales: '7', gt: '4' });
  });
});

describe('what gets saved', () => {
  it('keeps the saved GT target when only the sales figure changed', () => {
    // The data-loss case: this row used to go out with gtTarget 0.
    const entries = targetEntries(outlets, saved, { [DAY1]: { sales: '7' } });
    expect(entries).toContainEqual({ touchPointId: 1, shift: 'day', dailyTarget: 7, gtTarget: 4 });
  });

  it('re-sends untouched saved rows unchanged', () => {
    const entries = targetEntries(outlets, saved, {});
    expect(entries).toEqual([
      { touchPointId: 1, shift: 'day', dailyTarget: 6, gtTarget: 4 },
      { touchPointId: 1, shift: 'night', dailyTarget: 4.5, gtTarget: 3 },
    ]);
  });

  it('skips a row with no sales target instead of saving zero', () => {
    const entries = targetEntries(outlets, saved, { [DAY2]: { gt: '2' } });
    expect(entries.some((entry) => entry.touchPointId === 2)).toBe(false);
  });

  it('writes 0 when the supervisor clears a GT field on purpose', () => {
    const entries = targetEntries(outlets, saved, { [DAY1]: { gt: '' } });
    expect(entries).toContainEqual({ touchPointId: 1, shift: 'day', dailyTarget: 6, gtTarget: 0 });
  });

  it('adds a new row typed from blank', () => {
    const entries = targetEntries(outlets, saved, { [DAY2]: { sales: '3', gt: '1' } });
    expect(entries).toContainEqual({ touchPointId: 2, shift: 'day', dailyTarget: 3, gtTarget: 1 });
  });
});
