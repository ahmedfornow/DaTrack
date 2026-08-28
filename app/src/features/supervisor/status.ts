/**
 * "What is wrong right now" — the supervisor's first question every morning.
 *
 * The legacy dashboard leads with totals, which answer a different question and
 * answer it slowly: you read the numbers, then work backwards to who is
 * missing. This derives the gaps directly.
 *
 * Kept as a pure function because the interesting cases are all absences, and
 * absences are exactly what is hard to see in a live database and easy to
 * assert in a test. The legacy checklist view, for instance, only renders
 * promoters who *have* responses — so a promoter who ticked nothing at all is
 * invisible on the one screen meant to show who has not done it.
 */

import type { BusinessDate, BusinessMonth } from '../../lib/businessDay';
import { shiftsFor } from '../../domain/rules';
import { shortOutletName } from '../../domain/text';
import type { Shift, ShiftMode } from '../../domain/values';

export interface StatusPromoter {
  readonly id: string;
  readonly fullName: string;
}

export interface StatusOutlet {
  readonly id: number;
  readonly name: string;
  readonly shiftMode: ShiftMode;
}

export interface StatusAttendance {
  readonly promoterId: string;
  readonly touchPointId: number | null;
  readonly shift: Shift | null;
  readonly isWork: boolean;
}

export interface StatusInput {
  readonly date: BusinessDate;
  readonly month: BusinessMonth;
  /** Active promoters in the supervisor's city only. */
  readonly promoters: readonly StatusPromoter[];
  /** Active outlets in the supervisor's city only. */
  readonly outlets: readonly StatusOutlet[];
  /** Today's attendance for those promoters. */
  readonly attendance: readonly StatusAttendance[];
  /** Keys of outlet+shift pairs that have a target this month. */
  readonly targetedPairs: ReadonlySet<string>;
  readonly checklistItemCount: number;
  /** Promoter id to how many items they have ticked today. */
  readonly checklistDone: ReadonlyMap<string, number>;
}

export interface UnstaffedSlot {
  readonly outletId: number;
  readonly outletName: string;
  readonly shift: Shift;
}

export interface ChecklistGap {
  readonly promoterId: string;
  readonly fullName: string;
  readonly done: number;
  readonly total: number;
}

export interface StatusReport {
  /** Active promoters with no attendance row at all today. */
  readonly notReported: readonly StatusPromoter[];
  /** Outlet and shift combinations nobody is working today. */
  readonly unstaffed: readonly UnstaffedSlot[];
  /** Outlet and shift combinations with no target set this month. */
  readonly missingTargets: readonly UnstaffedSlot[];
  /** Promoters working today who have not finished the checklist. */
  readonly checklistGaps: readonly ChecklistGap[];
  /** True when nothing needs attention. */
  readonly allClear: boolean;
}

export const slotKey = (outletId: number, shift: Shift): string => `${outletId}-${shift}`;

export function deriveStatus(input: StatusInput): StatusReport {
  const {
    promoters,
    outlets,
    attendance,
    targetedPairs,
    checklistItemCount,
    checklistDone,
  } = input;

  const reported = new Set(attendance.map((row) => row.promoterId));
  const notReported = promoters.filter((promoter) => !reported.has(promoter.id));

  // Only `work` rows staff an outlet. A promoter marked off has reported, but
  // has not covered anything.
  const staffed = new Set<string>();
  for (const row of attendance) {
    if (!row.isWork || row.touchPointId === null || row.shift === null) continue;
    staffed.add(slotKey(row.touchPointId, row.shift));
  }

  const unstaffed: UnstaffedSlot[] = [];
  const missingTargets: UnstaffedSlot[] = [];

  for (const outlet of outlets) {
    for (const shift of shiftsFor(outlet.shiftMode)) {
      const key = slotKey(outlet.id, shift);
      const slot = { outletId: outlet.id, outletName: shortOutletName(outlet.name), shift };
      if (!staffed.has(key)) unstaffed.push(slot);
      if (!targetedPairs.has(key)) missingTargets.push(slot);
    }
  }

  // Only people actually working today are expected to tick the list, and a
  // promoter with no responses at all must appear — that absence is the whole
  // point, and it is exactly what the legacy view drops.
  const workingToday = attendance.filter((row) => row.isWork).map((row) => row.promoterId);
  const nameOf = new Map(promoters.map((p) => [p.id, p.fullName]));

  const checklistGaps: ChecklistGap[] =
    checklistItemCount === 0
      ? []
      : [...new Set(workingToday)]
          .map((promoterId) => ({
            promoterId,
            fullName: nameOf.get(promoterId) ?? '',
            done: checklistDone.get(promoterId) ?? 0,
            total: checklistItemCount,
          }))
          .filter((gap) => gap.done < gap.total)
          .sort((a, b) => a.done - b.done);

  return {
    notReported,
    unstaffed,
    missingTargets,
    checklistGaps,
    allClear:
      notReported.length === 0 &&
      unstaffed.length === 0 &&
      missingTargets.length === 0 &&
      checklistGaps.length === 0,
  };
}
