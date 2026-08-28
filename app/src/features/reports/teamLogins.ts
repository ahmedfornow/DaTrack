/**
 * The team logins roster — report #6.
 *
 * Name and login number only. Passwords are bcrypt hashes in `auth.users` and
 * cannot be displayed — not by this app, not by the supervisor, not by a query.
 * The closing line says so explicitly, because "send me everyone's password" is
 * a request that recurs and the answer is a reset flow, not a list.
 *
 * The body carries Arabic role headings and Arabic names, which the legacy
 * version also does. Each person's line ends with a Latin login number, keeping
 * the punctuation-flip hazard off the line ends.
 */

import { businessToday, formatReportDate } from '../../lib/businessDay';
import { ROLE_LABEL } from '../../domain/labels';
import { forReport } from '../../domain/text';
import type { Role } from '../../domain/values';

const BREAK = '='.repeat(10);

/** Promoters first — the group the supervisor is usually chasing. */
const ROLE_ORDER: readonly Role[] = ['promoter', 'supervisor', 'manager'];

export interface RosterMember {
  readonly fullName: string;
  readonly role: Role;
  readonly loginNumber: string | null;
  readonly active: boolean;
}

export interface TeamLoginsInput {
  readonly city: string;
  readonly members: readonly RosterMember[];
  readonly today?: string;
}

export function buildTeamLogins(input: TeamLoginsInput): string {
  const { city, members } = input;
  const date = input.today ?? businessToday();

  const lines: string[] = [
    `${forReport(city, 40)} - TEAM LOGINS`,
    formatReportDate(date),
    BREAK,
    '',
  ];

  for (const role of ROLE_ORDER) {
    // Deactivated people keep their history but must not appear on a roster
    // the team uses to work out who to contact.
    const group = members.filter((member) => member.role === role && member.active);
    if (group.length === 0) continue;

    lines.push(ROLE_LABEL[role]);
    for (const member of group) {
      const login = member.loginNumber !== null && member.loginNumber !== '' ? member.loginNumber : '—';
      lines.push(`• ${forReport(member.fullName, 40)} — ${login}`);
    }
    lines.push('');
  }

  lines.push(BREAK);
  lines.push('Passwords are not listed here.');

  return lines.join('\n').trim();
}
