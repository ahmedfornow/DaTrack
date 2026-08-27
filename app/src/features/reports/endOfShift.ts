/**
 * The end-of-shift report — report #1.
 *
 * This is what a promoter copies into WhatsApp at the end of every shift, so
 * the whole team sees it. A regression here is visible to everyone, which is
 * why this is a pure function with the output pinned character-for-character in
 * tests rather than logic buried in a component.
 *
 * Format rules, all of which have a reason:
 *
 *  - Pure English body, LTR. An Arabic word at the end of a line inside an
 *    otherwise-Latin message makes WhatsApp flip the punctuation.
 *  - No emoji. They render inconsistently across phones and add noise to
 *    something that gets forwarded.
 *  - Totals are derived from the printed list, never counted separately, so the
 *    number always matches the lines above it.
 *  - Every field pulled from the database is sanitised before printing. The
 *    legacy version prints `touch_points.name` raw; a multi-line outlet name
 *    would break the message, and outlet text has carried pasted page content
 *    before.
 */

import { formatReportDate, type BusinessDate } from '../../lib/businessDay';
import { shortNameOf } from '../../domain/devices';
import { SHIFT_LABEL_EN } from '../../domain/labels';
import { forReport } from '../../domain/text';
import type { Shift } from '../../domain/values';
import type { Sale } from '../../data/sales';

/** Matches the legacy separator exactly: 22 underscores. */
const SEPARATOR = '_'.repeat(22);

export interface EndOfShiftInput {
  /** The full stored outlet name, as the legacy report prints it. */
  readonly outletName: string;
  readonly workDate: BusinessDate;
  readonly shift: Shift;
  /** Chronological — the order they were logged, which is the order printed. */
  readonly sales: readonly Sale[];
  readonly guidedTrials: number;
}

/**
 * Builds the report body.
 *
 * Sales print in the order given; callers pass them oldest-first so the
 * numbering matches the sequence the promoter logged them in.
 */
export function buildEndOfShiftReport(input: EndOfShiftInput): string {
  const { outletName, workDate, shift, sales, guidedTrials } = input;

  const lines: string[] = [
    forReport(outletName, 70),
    `Date : ${formatReportDate(workDate)}`,
    `Shift : ${SHIFT_LABEL_EN[shift]}`,
    '',
    '',
  ];

  if (sales.length === 0) {
    lines.push('No sales');
  } else {
    sales.forEach((sale, index) => {
      const device = forReport(shortNameOf(sale.deviceType), 30);
      const color = forReport(sale.color, 30);
      lines.push(`${index + 1}. ${device} - ${color} | ${sale.customerType} | ${sale.saleType}`);
    });
  }

  lines.push(SEPARATOR);
  // Derived from what actually printed, so the total cannot disagree with the list.
  lines.push(`Total sales : ${sales.length}`);
  lines.push(`Guided trials : ${guidedTrials}`);

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// The pre-send check
// ---------------------------------------------------------------------------

export type ReportWarning =
  | { readonly kind: 'no-sales' }
  | { readonly kind: 'below-target'; readonly percent: number };

export interface ReportReview {
  readonly outletName: string;
  readonly shiftLabel: string;
  readonly totalSales: number;
  readonly lasCount: number;
  readonly guidedTrials: number;
  readonly target: number | null;
  readonly percent: number | null;
  readonly warnings: readonly ReportWarning[];
}

/**
 * What to show before the report is generated.
 *
 * The legacy app puts this in a `confirm()` dialog: a nudge to check the
 * numbers before broadcasting them, warning on zero sales or achievement under
 * 70%. Keeping it as data rather than a dialog means the UI can present it
 * properly and the thresholds stay testable.
 */
export function reviewBeforeSending(input: {
  readonly outletName: string;
  readonly shiftLabel: string;
  readonly sales: readonly Sale[];
  readonly guidedTrials: number;
  readonly target: number | null;
}): ReportReview {
  const { outletName, shiftLabel, sales, guidedTrials, target } = input;
  const lasCount = sales.filter((sale) => sale.customerType === 'LAS').length;

  const percent =
    target !== null && Number.isFinite(target) && target > 0
      ? Math.round((lasCount / target) * 100)
      : null;

  const warnings: ReportWarning[] = [];
  if (sales.length === 0) warnings.push({ kind: 'no-sales' });
  if (percent !== null && percent < 70) warnings.push({ kind: 'below-target', percent });

  return {
    outletName,
    shiftLabel,
    totalSales: sales.length,
    lasCount,
    guidedTrials,
    target,
    percent,
    warnings,
  };
}

/** Arabic wording for a warning. Interface text, so emoji are fine here. */
export function warningMessage(warning: ReportWarning): string {
  switch (warning.kind) {
    case 'no-sales':
      return 'لم تسجّل أي مبيعة اليوم. إذا عندك مبيعات، ارجع وسجّلها قبل الإرسال.';
    case 'below-target':
      return `تحقيقك ${warning.percent}% — أقل من الهدف. متأكد إنك سجّلت كل مبيعاتك؟`;
  }
}
