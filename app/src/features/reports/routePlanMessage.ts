/**
 * The route-plan message — report #5.
 *
 * Sent the night before so every promoter knows where they are working. It is
 * the most structurally intricate of the six, and the details below are all
 * load-bearing:
 *
 *  - Outlet fields are sanitised. This is the message that once carried a
 *    pasted page of web text for weeks, because it came through `maps_url`.
 *  - A shift line prints for every shift the outlet runs, *plus* any shift that
 *    actually has someone on it. A promoter assigned to a shift the outlet is
 *    not configured for still appears, rather than vanishing silently.
 *  - `Total active` counts names that actually printed, so the number can never
 *    disagree with the list above it.
 *  - Anyone without an assignment is listed as inactive, defaulting to `Off`.
 *    Being absent from the plan and being marked off read the same to the team,
 *    and both need chasing.
 */

import { formatReportDate, type BusinessDate } from '../../lib/businessDay';
import { PLAN_STATUS_LABEL_EN } from '../../domain/labels';
import { firstUrl, forReport, oneLine } from '../../domain/text';
import { shiftsFor } from '../../domain/rules';
import type { PlanStatus, Shift, ShiftMode } from '../../domain/values';

const BREAK = '='.repeat(10);
const DS_HEADER = '====DS====';

export interface RouteOutlet {
  readonly id: number;
  readonly name: string;
  readonly unicode: string | null;
  readonly mapsUrl: string | null;
  readonly shiftMode: ShiftMode;
  readonly isDs: boolean;
}

export interface RoutePromoter {
  readonly id: string;
  readonly fullName: string;
}

export type RouteAssignment =
  | { readonly kind: 'outlet'; readonly touchPointId: number; readonly shift: Shift }
  | { readonly kind: 'status'; readonly status: PlanStatus };

export interface RoutePlanMessageInput {
  readonly city: string;
  readonly planDate: BusinessDate;
  /** In display order; the message follows this order. */
  readonly outlets: readonly RouteOutlet[];
  readonly promoters: readonly RoutePromoter[];
  /** Promoter id to assignment. A promoter absent from this map is inactive. */
  readonly assignments: ReadonlyMap<string, RouteAssignment>;
}

export type RoutePlanResult =
  | { readonly ok: true; readonly message: string }
  | { readonly ok: false; readonly reason: string };

export function buildRoutePlanMessage(input: RoutePlanMessageInput): RoutePlanResult {
  const { city, planDate, outlets, promoters, assignments } = input;

  const nameOf = new Map(promoters.map((p) => [p.id, p.fullName]));

  // Group assigned promoters by outlet and shift.
  const byOutlet = new Map<number, Record<Shift, string[]>>();
  for (const [promoterId, assignment] of assignments) {
    if (assignment.kind !== 'outlet') continue;
    const group = byOutlet.get(assignment.touchPointId) ?? { day: [], night: [] };
    group[assignment.shift].push(forReport(nameOf.get(promoterId) ?? '?', 40));
    byOutlet.set(assignment.touchPointId, group);
  }

  const staffed = outlets.filter((outlet) => {
    const group = byOutlet.get(outlet.id);
    return group !== undefined && (group.day.length > 0 || group.night.length > 0);
  });

  if (staffed.length === 0) {
    return { ok: false, reason: 'عيّن مندوباً واحداً على الأقل أولاً' };
  }

  const normal = staffed.filter((outlet) => !outlet.isDs);
  const directSales = staffed.filter((outlet) => outlet.isDs);

  // Counted from what prints, never from the assignment map.
  let active = 0;
  for (const outlet of staffed) {
    const group = byOutlet.get(outlet.id);
    if (group !== undefined) active += group.day.length + group.night.length;
  }

  const block = (outlet: RouteOutlet): string => {
    const group = byOutlet.get(outlet.id) ?? { day: [], night: [] };
    const runs = shiftsFor(outlet.shiftMode);
    const shown: Shift[] = (['day', 'night'] as const).filter(
      (shift) => runs.includes(shift) || group[shift].length > 0,
    );

    const parts: string[] = [];
    const code = oneLine(outlet.unicode, 24);
    const url = firstUrl(outlet.mapsUrl);
    if (code !== '') parts.push(code);
    parts.push(forReport(outlet.name, 70));
    if (url !== '') parts.push(url);
    parts.push('');
    for (const shift of shown) {
      const label = shift === 'day' ? 'Day' : 'Night';
      parts.push(`${label} : ${group[shift].join(' / ')}`);
    }
    return parts.join('\n');
  };

  const joinBlocks = (list: readonly RouteOutlet[]): string =>
    list.map(block).join(`\n\n${BREAK}\n\n`);

  const lines: string[] = [`${forReport(city, 40)} RP`, formatReportDate(planDate), '', ''];

  if (normal.length > 0) lines.push(joinBlocks(normal));

  if (directSales.length > 0) {
    if (normal.length > 0) {
      lines.push('');
      lines.push('');
    }
    lines.push(DS_HEADER);
    lines.push('');
    lines.push(joinBlocks(directSales));
  }

  const inactive = promoters
    .filter((promoter) => {
      const assignment = assignments.get(promoter.id);
      return assignment === undefined || assignment.kind === 'status';
    })
    .map((promoter) => {
      const assignment = assignments.get(promoter.id);
      const status =
        assignment !== undefined && assignment.kind === 'status'
          ? PLAN_STATUS_LABEL_EN[assignment.status]
          : 'Off';
      return { name: forReport(promoter.fullName, 40), status };
    });

  lines.push('');
  lines.push(BREAK);
  lines.push('');
  lines.push(`Total active : ${active}`);
  lines.push(`Inactive : ${inactive.length}`);
  for (const person of inactive) {
    lines.push(`${person.name} ::: ${person.status}`);
  }

  return { ok: true, message: lines.join('\n') };
}
