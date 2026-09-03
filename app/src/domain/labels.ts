/**
 * Arabic labels for the closed value sets.
 *
 * Separate from `values.ts` so the vocabularies stay pure data and the wording
 * can change without touching validation. Two rules hold here:
 *
 *  - Emoji are fine in the interface and are removed from anything copied. Any
 *    label used in a generated report goes through `forReport` first.
 *  - Attendance `leave` (استئذان, a short absence) and plan `annual` (a booked
 *    holiday) are different concepts with deliberately different wording. They
 *    have been conflated before.
 */

import type {
  AttendanceStatus,
  PlanStatus,
  Role,
  Shift,
  ShiftMode,
  TaskKind,
} from './values';

export const SHIFT_LABEL: Readonly<Record<Shift, string>> = {
  day: 'نهاري',
  night: 'ليلي',
};

export const SHIFT_LABEL_WITH_ICON: Readonly<Record<Shift, string>> = {
  day: 'نهاري ☀️',
  night: 'ليلي 🌙',
};

/** English, for the generated report bodies. */
export const SHIFT_LABEL_EN: Readonly<Record<Shift, string>> = {
  day: 'Day',
  night: 'Night',
};

export const SHIFT_MODE_LABEL: Readonly<Record<ShiftMode, string>> = {
  day: 'نهاري فقط',
  night: 'ليلي فقط',
  dual: 'دوامين',
};

export const ATTENDANCE_STATUS_LABEL: Readonly<Record<AttendanceStatus, string>> = {
  work: 'دوام',
  off: 'أوف',
  sick: 'مرضية',
  leave: 'استئذان',
  absent: 'غياب',
};

export const ATTENDANCE_STATUS_LABEL_WITH_ICON: Readonly<Record<AttendanceStatus, string>> = {
  work: 'دوام 🏪',
  off: 'أوف 🌴',
  sick: 'مرضية 🤒',
  leave: 'استئذان 🕐',
  absent: 'غياب 🚫',
};

export const PLAN_STATUS_LABEL: Readonly<Record<PlanStatus, string>> = {
  off: 'أوف',
  sick: 'مرضية',
  annual: 'إجازة سنوية',
  absent: 'غياب',
};

export const PLAN_STATUS_LABEL_WITH_ICON: Readonly<Record<PlanStatus, string>> = {
  off: 'أوف 🌴',
  sick: 'مرضية 🤒',
  annual: 'إجازة سنوية 🏖️',
  absent: 'غياب 🚫',
};

/** English, for the route-plan message. */
export const PLAN_STATUS_LABEL_EN: Readonly<Record<PlanStatus, string>> = {
  off: 'Off',
  sick: 'Sick leave',
  annual: 'Annual leave',
  absent: 'Absent',
};

export const ROLE_LABEL: Readonly<Record<Role, string>> = {
  manager: 'مدير',
  supervisor: 'مشرف',
  promoter: 'مندوب',
};

export const TASK_KIND_LABEL: Readonly<Record<TaskKind, string>> = {
  daily: 'يومي',
  weekly: 'أسبوعي',
  once: 'مرة واحدة',
};

/** Sunday first, matching `Date#getDay` and `sup_tasks.weekday`. */
export const WEEKDAY_LABEL: readonly string[] = [
  'الأحد',
  'الإثنين',
  'الثلاثاء',
  'الأربعاء',
  'الخميس',
  'الجمعة',
  'السبت',
];

export const MONTH_LABEL: readonly string[] = [
  'يناير',
  'فبراير',
  'مارس',
  'أبريل',
  'مايو',
  'يونيو',
  'يوليو',
  'أغسطس',
  'سبتمبر',
  'أكتوبر',
  'نوفمبر',
  'ديسمبر',
];

/**
 * A stock item's display name, with the catalog's redundant prefixes removed.
 *
 * `stock_catalog.item_name` is fully qualified — "IQOS ILUMA i ONE — Leaf
 * Green" — which is right for the generated report, where the message stands
 * alone in WhatsApp, and wrong in a list where every row starts the same way
 * and the only part that differs is pushed off the end of a narrow screen.
 *
 * The base ILUMA i is the case worth knowing about. Its items are named
 * "IQOS ILUMA i — Breeze Blue", so stripping the shared prefix the way the
 * legacy screen does leaves "— Breeze Blue": a colour with no device attached.
 * That reads as a rendering fault, and in a flat list there is no group heading
 * to recover the device from, so the line name stays.
 *
 * The generated stock message does NOT use this — it matches on the full name
 * and prints its own qualified headings. Display only.
 */
export function stockItemLabel(itemName: string): string {
  const withoutBrand = itemName.replace(/^IQOS\s+/, '');
  if (withoutBrand.startsWith('ILUMA i —')) return withoutBrand;
  return withoutBrand.replace(/^ILUMA i\s+/, '');
}
