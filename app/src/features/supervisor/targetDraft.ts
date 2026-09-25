/**
 * The targets form: what the supervisor has typed, laid over what is saved.
 *
 * Only edits are held in state. Every other field is read from the saved table
 * on each render, so the form is right whenever that table arrives.
 *
 * The first version copied the saved table into state once, when the form
 * mounted — and the form mounts before the Admin tab's data has loaded. The
 * copy was empty, so every saved target showed blank the first time the tab
 * opened. Saving from there was worse than it looked: a row whose sales figure
 * was typed went out with the blank GT field read as 0, overwriting the real
 * guided-trials target the promoters' end-of-shift report prints.
 */

import { shiftsFor } from '../../domain/rules';
import type { ShiftMode } from '../../domain/values';
import { targetKey, type TargetEntry, type TargetTable } from '../../data/targets';

/** One row's typed values. A field that is absent has not been touched. */
export interface TargetEdit {
  readonly sales?: string;
  readonly gt?: string;
}

export type TargetEdits = Readonly<Record<string, TargetEdit>>;

export interface TargetFields {
  readonly sales: string;
  readonly gt: string;
}

/** What one row's inputs show: the typed value, or else the saved one. */
export function targetFields(key: string, targets: TargetTable, edits: TargetEdits): TargetFields {
  const saved = targets.get(key);
  const edit = edits[key];
  return {
    sales: edit?.sales ?? (saved !== undefined ? String(saved.dailyTarget) : ''),
    gt: edit?.gt ?? (saved !== undefined ? String(saved.gtTarget) : ''),
  };
}

/**
 * The rows to write. A row with no sales target is skipped rather than saved
 * as zero, which is how an outlet the supervisor has not got to yet stays
 * visibly unset on the status strip.
 */
export function targetEntries(
  outlets: readonly { id: number; shiftMode: ShiftMode }[],
  targets: TargetTable,
  edits: TargetEdits,
): TargetEntry[] {
  const entries: TargetEntry[] = [];
  for (const outlet of outlets) {
    for (const shift of shiftsFor(outlet.shiftMode)) {
      const fields = targetFields(targetKey(outlet.id, shift), targets, edits);
      if (fields.sales.trim() === '') continue;
      const dailyTarget = Number(fields.sales);
      if (!Number.isFinite(dailyTarget)) continue;
      const gt = Number(fields.gt);
      entries.push({
        touchPointId: outlet.id,
        shift,
        dailyTarget,
        gtTarget: Number.isFinite(gt) ? gt : 0,
      });
    }
  }
  return entries;
}
