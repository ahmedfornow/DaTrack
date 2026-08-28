/**
 * The period summary — report #3.
 *
 * The supervisor's broadcast to the team: how the city did today, this week, or
 * this month. Totals here are the ones people quote back, so every figure is
 * derived from the same rows that print underneath it.
 *
 * One thing this report cannot avoid: promoter names are Arabic, so the body is
 * not pure Latin. The hazard the "English body" rule guards against is an
 * Arabic word at the *end* of a line, which flips the punctuation in WhatsApp.
 * Every line here ends with a Latin digit, which is why the legacy layout puts
 * the count last — that ordering is load-bearing, not cosmetic.
 */

import { businessToday, type BusinessDate } from '../../lib/businessDay';
import { forReport, shortOutletName } from '../../domain/text';

export type PeriodKind = 'today' | 'week' | 'month';

const PERIOD_LABEL: Readonly<Record<PeriodKind, string>> = {
  today: 'Daily',
  week: 'Weekly',
  month: 'Monthly',
};

export interface PromoterTotals {
  readonly name: string;
  readonly las: number;
  readonly lau: number;
  readonly sk: number;
  readonly mgm: number;
  readonly ld: number;
}

export interface OutletTotals {
  /** The full stored outlet name; the report prints the human part. */
  readonly name: string;
  readonly las: number;
  readonly lau: number;
}

export interface PeriodSummaryInput {
  readonly city: string;
  readonly period: PeriodKind;
  readonly start: BusinessDate;
  readonly end?: BusinessDate;
  readonly byPromoter: readonly PromoterTotals[];
  readonly byOutlet: readonly OutletTotals[];
  readonly guidedTrials: number;
  readonly checkIns: number;
}

export function buildPeriodSummary(input: PeriodSummaryInput): string {
  const { city, period, start, byPromoter, byOutlet, guidedTrials, checkIns } = input;
  const end = input.end ?? businessToday();

  // Derived from the same rows that print below, so a reader adding up the
  // list always reaches the headline number.
  const las = byPromoter.reduce((sum, p) => sum + p.las, 0);
  const lau = byPromoter.reduce((sum, p) => sum + p.lau, 0);
  const sk = byPromoter.reduce((sum, p) => sum + p.sk, 0);
  const mgm = byPromoter.reduce((sum, p) => sum + p.mgm, 0);
  const ld = byPromoter.reduce((sum, p) => sum + p.ld, 0);

  const lines: string[] = [
    `DaTracker — ${forReport(city, 40)} · ${PERIOD_LABEL[period]} Summary`,
    `${start} - ${end}`,
    '',
    `LAS sales : ${las}`,
    `Total activity : ${las + lau} (LAU included: ${lau})`,
    `SK: ${sk} | MGM: ${mgm} | LD: ${ld}`,
    `Guided trials : ${guidedTrials}`,
    `Check-ins : ${checkIns}`,
    '',
    'By promoter (LAS):',
  ];

  const promoters = [...byPromoter].sort((a, b) => b.las - a.las);
  promoters.forEach((promoter, index) => {
    lines.push(`${index + 1}. ${forReport(promoter.name, 40)} — ${promoter.las}`);
  });

  lines.push('');
  lines.push('By outlet (LAS):');

  const outlets = [...byOutlet].sort((a, b) => b.las - a.las);
  outlets.forEach((outlet, index) => {
    lines.push(`${index + 1}. ${forReport(shortOutletName(outlet.name), 40)} — ${outlet.las}`);
  });

  return lines.join('\n');
}
