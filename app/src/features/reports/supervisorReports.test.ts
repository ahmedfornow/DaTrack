import { describe, it, expect } from 'vitest';
import { buildPeriodSummary } from './periodSummary';
import { buildMonthCsv, buildMonthCsvBody, monthCsvFilename, type CsvRow } from './monthCsv';
import { buildRoutePlanMessage, type RouteAssignment, type RouteOutlet } from './routePlanMessage';
import { buildTeamLogins } from './teamLogins';

/**
 * The four supervisor reports, pinned against the legacy output. Every expected
 * string here was read out of the legacy generator rather than written from
 * memory.
 */

// ---------------------------------------------------------------------------
// #3 Period summary
// ---------------------------------------------------------------------------

describe('period summary', () => {
  const input = {
    city: 'Qassim',
    period: 'today' as const,
    start: '2026-08-25',
    end: '2026-08-25',
    byPromoter: [
      { name: 'Ahmed', las: 3, lau: 1, sk: 2, mgm: 1, ld: 1 },
      { name: 'Khalid', las: 5, lau: 0, sk: 5, mgm: 0, ld: 0 },
    ],
    byOutlet: [
      { name: 'QAS_Othaim Mall_HYP', las: 5, lau: 0 },
      { name: 'QAS_Nakheel Plaza_HYP', las: 3, lau: 1 },
    ],
    guidedTrials: 12,
    checkIns: 4,
  };

  it('matches the legacy layout', () => {
    expect(buildPeriodSummary(input)).toBe(
      [
        'DaTracker — Qassim · Daily Summary',
        '2026-08-25 - 2026-08-25',
        '',
        'LAS sales : 8',
        'Total activity : 9 (LAU included: 1)',
        'SK: 7 | MGM: 1 | LD: 1',
        'Guided trials : 12',
        'Check-ins : 4',
        '',
        'By promoter (LAS):',
        '1. Khalid — 5',
        '2. Ahmed — 3',
        '',
        'By outlet (LAS):',
        '1. Othaim Mall — 5',
        '2. Nakheel Plaza — 3',
      ].join('\n'),
    );
  });

  it('labels each period', () => {
    for (const [period, label] of [
      ['today', 'Daily'],
      ['week', 'Weekly'],
      ['month', 'Monthly'],
    ] as const) {
      expect(buildPeriodSummary({ ...input, period })).toContain(`· ${label} Summary`);
    }
  });

  it('ranks promoters and outlets by LAS, descending', () => {
    const report = buildPeriodSummary(input);
    expect(report.indexOf('1. Khalid')).toBeLessThan(report.indexOf('2. Ahmed'));
  });

  it('derives every headline from the rows that print', () => {
    // Totals a reader can add up themselves must reach the same number.
    const report = buildPeriodSummary(input);
    expect(report).toContain('LAS sales : 8'); // 5 + 3
    expect(report).toContain('Total activity : 9 (LAU included: 1)');
    expect(report).toContain('SK: 7 | MGM: 1 | LD: 1');
  });

  it('ends promoter lines with a Latin digit, keeping Arabic off the line end', () => {
    const arabic = buildPeriodSummary({
      ...input,
      byPromoter: [{ name: 'عبدالله المطيري', las: 4, lau: 0, sk: 4, mgm: 0, ld: 0 }],
    });
    const line = arabic.split('\n').find((l) => l.startsWith('1. '));
    expect(line).toBe('1. عبدالله المطيري — 4');
    expect(line?.endsWith('4')).toBe(true);
  });

  it('prints the human part of an outlet name', () => {
    expect(buildPeriodSummary(input)).toContain('1. Othaim Mall — 5');
    expect(buildPeriodSummary(input)).not.toContain('QAS_Othaim Mall_HYP');
  });

  it('survives an empty period', () => {
    const empty = buildPeriodSummary({ ...input, byPromoter: [], byOutlet: [], guidedTrials: 0, checkIns: 0 });
    expect(empty).toContain('LAS sales : 0');
    expect(empty).toContain('Total activity : 0 (LAU included: 0)');
  });

  it('carries no emoji', () => {
    expect(buildPeriodSummary({ ...input, city: 'Qassim 🌴' })).not.toMatch(
      /\p{Extended_Pictographic}/u,
    );
  });
});

// ---------------------------------------------------------------------------
// #4 Month CSV
// ---------------------------------------------------------------------------

describe('month CSV', () => {
  const row: CsvRow = {
    workDate: '2026-08-25',
    promoterName: 'Ahmed',
    outletName: 'QAS_Othaim Mall_HYP',
    shift: 'day',
    deviceType: 'ILUMA i Prime',
    color: 'Garnet Red',
    saleType: 'SK',
    customerType: 'LAS',
    createdAt: '2026-08-25T18:45:03Z',
  };

  it('writes the legacy header', () => {
    const [header] = buildMonthCsvBody([]).split('\n');
    expect(header).toBe(
      '"Date","Promoter","Outlet","Shift","Device","Color","Sale Type","Customer","Entered At"',
    );
  });

  it('quotes every cell', () => {
    const [, line] = buildMonthCsvBody([row]).split('\n');
    expect(line).toBe(
      '"2026-08-25","Ahmed","QAS_Othaim Mall_HYP","day","ILUMA i Prime","Garnet Red","SK","LAS","25/08/2026, 21:45:03"',
    );
  });

  it('renders the timestamp in KSA time, not the exporting device timezone', () => {
    // 18:45:03Z is 21:45:03 in Riyadh. On a laptop set to UTC the legacy export
    // would print 18:45:03 and nothing would say so.
    expect(buildMonthCsvBody([row])).toContain('25/08/2026, 21:45:03');
  });

  it('keeps a late-night sale on its own KSA clock time', () => {
    // 22:30Z is 01:30 KSA the next calendar day — the business date stays the
    // 24th, but the clock time shown is the real one.
    const late = buildMonthCsvBody([
      { ...row, workDate: '2026-08-24', createdAt: '2026-08-24T22:30:00Z' },
    ]);
    expect(late).toContain('"2026-08-24"');
    expect(late).toContain('25/08/2026, 01:30:00');
  });

  it('doubles embedded quotes so a name cannot break the row', () => {
    const line = buildMonthCsvBody([{ ...row, promoterName: 'Ahmed "Abu Ali"' }]).split('\n')[1];
    expect(line).toContain('"Ahmed ""Abu Ali"""');
  });

  it('contains a comma safely inside a quoted cell', () => {
    const body = buildMonthCsvBody([{ ...row, outletName: 'Mall, North Wing' }]);
    const line = body.split('\n')[1] ?? '';
    expect(line).toContain('"Mall, North Wing"');
    // 9 columns means 8 separating commas outside the quotes.
    expect(line.split('","')).toHaveLength(9);
  });

  it('collapses a newline in a field rather than splitting the row', () => {
    const body = buildMonthCsvBody([{ ...row, outletName: 'Mall\nNorth' }]);
    expect(body.split('\n')).toHaveLength(2);
  });

  it('leads the file with a UTF-8 BOM so Excel reads Arabic correctly', () => {
    expect(buildMonthCsv([])).toMatch(/^﻿/u);
    expect(buildMonthCsvBody([])).not.toMatch(/^﻿/u);
  });

  it('handles a missing timestamp without printing Invalid Date', () => {
    const line = buildMonthCsvBody([{ ...row, createdAt: null }]).split('\n')[1] ?? '';
    expect(line).toContain(',""');
    expect(line).not.toContain('Invalid');
    expect(line).not.toContain('NaN');
  });

  it('builds a safe filename', () => {
    expect(monthCsvFilename('Qassim', '2026-08')).toBe('DaTracker_Qassim_2026-08.csv');
    expect(monthCsvFilename('Al Qassim / North', '2026-08')).toBe(
      'DaTracker_Al_Qassim_North_2026-08.csv',
    );
  });
});

// ---------------------------------------------------------------------------
// #5 Route plan message
// ---------------------------------------------------------------------------

describe('route plan message', () => {
  const outlets: RouteOutlet[] = [
    {
      id: 1,
      name: 'QAS_Othaim Mall_HYP',
      unicode: '12345',
      mapsUrl: 'https://maps.app.goo.gl/abc',
      shiftMode: 'dual',
      isDs: false,
    },
    { id: 2, name: 'QAS_Nakheel_HYP', unicode: null, mapsUrl: null, shiftMode: 'night', isDs: false },
    { id: 3, name: 'QAS_DS Team_DS', unicode: '999', mapsUrl: null, shiftMode: 'day', isDs: true },
  ];

  const promoters = [
    { id: 'p1', fullName: 'Ahmed' },
    { id: 'p2', fullName: 'Khalid' },
    { id: 'p3', fullName: 'Sami' },
    { id: 'p4', fullName: 'Faisal' },
  ];

  const assignments = new Map<string, RouteAssignment>([
    ['p1', { kind: 'outlet', touchPointId: 1, shift: 'day' }],
    ['p2', { kind: 'outlet', touchPointId: 1, shift: 'night' }],
    ['p3', { kind: 'outlet', touchPointId: 3, shift: 'day' }],
    ['p4', { kind: 'status', status: 'annual' }],
  ]);

  const base = { city: 'Qassim', planDate: '2026-08-26', outlets, promoters, assignments };

  it('matches the legacy structure exactly', () => {
    const result = buildRoutePlanMessage(base);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.message).toBe(
      [
        'Qassim RP',
        '26/08/2026',
        '',
        '',
        '12345',
        'QAS_Othaim Mall_HYP',
        'https://maps.app.goo.gl/abc',
        '',
        'Day : Ahmed',
        'Night : Khalid',
        '',
        '',
        '====DS====',
        '',
        '999',
        'QAS_DS Team_DS',
        '',
        'Day : Sami',
        '',
        '==========',
        '',
        'Total active : 3',
        'Inactive : 1',
        'Faisal ::: Annual leave',
      ].join('\n'),
    );
  });

  it('refuses to generate when nobody is assigned to an outlet', () => {
    const result = buildRoutePlanMessage({ ...base, assignments: new Map() });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('عيّن مندوباً');
  });

  it('omits an unstaffed outlet entirely', () => {
    const result = buildRoutePlanMessage(base);
    if (!result.ok) throw new Error('expected a message');
    expect(result.message).not.toContain('Nakheel');
  });

  it('counts only names that actually printed', () => {
    const result = buildRoutePlanMessage(base);
    if (!result.ok) throw new Error('expected a message');
    const printed = result.message
      .split('\n')
      .filter((l) => l.startsWith('Day : ') || l.startsWith('Night : '))
      .flatMap((l) => l.slice(l.indexOf(':') + 1).split('/'))
      .map((n) => n.trim())
      .filter((n) => n !== '');
    expect(printed).toHaveLength(3);
    expect(result.message).toContain('Total active : 3');
  });

  it('prints an empty shift line for a shift the outlet runs but nobody covers', () => {
    const single = new Map<string, RouteAssignment>([
      ['p1', { kind: 'outlet', touchPointId: 1, shift: 'day' }],
    ]);
    const result = buildRoutePlanMessage({ ...base, assignments: single });
    if (!result.ok) throw new Error('expected a message');
    // A dual outlet with nobody on nights must show the gap, not hide it.
    expect(result.message).toContain('Night : ');
  });

  it('shows a shift the outlet is not configured for when someone is on it', () => {
    // Nakheel is night-only; a day assignment must still appear rather than
    // vanishing and leaving a promoter apparently unassigned.
    const odd = new Map<string, RouteAssignment>([
      ['p1', { kind: 'outlet', touchPointId: 2, shift: 'day' }],
    ]);
    const result = buildRoutePlanMessage({ ...base, assignments: odd });
    if (!result.ok) throw new Error('expected a message');
    expect(result.message).toContain('Day : Ahmed');
    expect(result.message).toContain('Night : ');
  });

  it('joins two promoters on one shift with a slash', () => {
    const shared = new Map<string, RouteAssignment>([
      ['p1', { kind: 'outlet', touchPointId: 1, shift: 'day' }],
      ['p2', { kind: 'outlet', touchPointId: 1, shift: 'day' }],
    ]);
    const result = buildRoutePlanMessage({ ...base, assignments: shared });
    if (!result.ok) throw new Error('expected a message');
    expect(result.message).toContain('Day : Ahmed / Khalid');
  });

  it('lists an unassigned promoter as Off', () => {
    const partial = new Map<string, RouteAssignment>([
      ['p1', { kind: 'outlet', touchPointId: 1, shift: 'day' }],
    ]);
    const result = buildRoutePlanMessage({ ...base, assignments: partial });
    if (!result.ok) throw new Error('expected a message');
    expect(result.message).toContain('Inactive : 3');
    expect(result.message).toContain('Khalid ::: Off');
  });

  it('translates every leave status to English', () => {
    for (const [status, label] of [
      ['off', 'Off'],
      ['sick', 'Sick leave'],
      ['annual', 'Annual leave'],
      ['absent', 'Absent'],
    ] as const) {
      const map = new Map<string, RouteAssignment>([
        ['p1', { kind: 'outlet', touchPointId: 1, shift: 'day' }],
        ['p2', { kind: 'status', status }],
      ]);
      const result = buildRoutePlanMessage({ ...base, assignments: map });
      if (!result.ok) throw new Error('expected a message');
      expect(result.message).toContain(`Khalid ::: ${label}`);
    }
  });

  it('omits the DS section when no DS outlet is staffed', () => {
    const noDs = new Map<string, RouteAssignment>([
      ['p1', { kind: 'outlet', touchPointId: 1, shift: 'day' }],
    ]);
    const result = buildRoutePlanMessage({ ...base, assignments: noDs });
    if (!result.ok) throw new Error('expected a message');
    expect(result.message).not.toContain('====DS====');
  });

  describe('sanitising — this is the message that once carried pasted page text', () => {
    it('rejects prose in the map field', () => {
      const dirty = outlets.map((o) =>
        o.id === 1 ? { ...o, mapsUrl: 'Skip to main content Sign in Directions' } : o,
      );
      const result = buildRoutePlanMessage({ ...base, outlets: dirty });
      if (!result.ok) throw new Error('expected a message');
      expect(result.message).not.toContain('Skip to main content');
    });

    it('collapses a multi-line outlet name', () => {
      const dirty = outlets.map((o) =>
        o.id === 1 ? { ...o, name: 'QAS_Othaim\nMall\nHYP' } : o,
      );
      const result = buildRoutePlanMessage({ ...base, outlets: dirty });
      if (!result.ok) throw new Error('expected a message');
      expect(result.message).toContain('QAS_Othaim Mall HYP');
    });

    it('truncates an overlong POS code', () => {
      const dirty = outlets.map((o) => (o.id === 1 ? { ...o, unicode: '9'.repeat(60) } : o));
      const result = buildRoutePlanMessage({ ...base, outlets: dirty });
      if (!result.ok) throw new Error('expected a message');
      expect(result.message).toContain('9'.repeat(24));
      expect(result.message).not.toContain('9'.repeat(25));
    });

    it('strips emoji from a promoter name', () => {
      const result = buildRoutePlanMessage({
        ...base,
        promoters: [{ id: 'p1', fullName: 'Ahmed 🎉' }, ...promoters.slice(1)],
      });
      if (!result.ok) throw new Error('expected a message');
      expect(result.message).not.toMatch(/\p{Extended_Pictographic}/u);
    });
  });
});

// ---------------------------------------------------------------------------
// #6 Team logins
// ---------------------------------------------------------------------------

describe('team logins', () => {
  const members = [
    { fullName: 'Ahmed', role: 'promoter' as const, loginNumber: '1699', active: true },
    { fullName: 'Khalid', role: 'promoter' as const, loginNumber: '1700', active: true },
    { fullName: 'Sami', role: 'supervisor' as const, loginNumber: '1001', active: true },
  ];

  it('matches the legacy layout', () => {
    expect(buildTeamLogins({ city: 'Qassim', members, today: '2026-08-25' })).toBe(
      [
        'Qassim - TEAM LOGINS',
        '25/08/2026',
        '==========',
        '',
        'مندوب',
        '• Ahmed — 1699',
        '• Khalid — 1700',
        '',
        'مشرف',
        '• Sami — 1001',
        '',
        '==========',
        'Passwords are not listed here.',
      ].join('\n'),
    );
  });

  it('never contains anything password-shaped', () => {
    const report = buildTeamLogins({ city: 'Qassim', members, today: '2026-08-25' });
    expect(report).toContain('Passwords are not listed here.');
    expect(report.toLowerCase()).not.toContain('password:');
  });

  it('omits deactivated people', () => {
    const report = buildTeamLogins({
      city: 'Qassim',
      members: [...members, { fullName: 'Gone', role: 'promoter' as const, loginNumber: '1800', active: false }],
      today: '2026-08-25',
    });
    expect(report).not.toContain('Gone');
  });

  it('omits a role heading when nobody holds it', () => {
    const report = buildTeamLogins({ city: 'Qassim', members, today: '2026-08-25' });
    expect(report).not.toContain('مدير');
  });

  it('shows a dash for a missing login number', () => {
    const report = buildTeamLogins({
      city: 'Qassim',
      members: [{ fullName: 'Ahmed', role: 'promoter', loginNumber: null, active: true }],
      today: '2026-08-25',
    });
    expect(report).toContain('• Ahmed — —');
  });

  it('orders promoters before supervisors before managers', () => {
    const report = buildTeamLogins({
      city: 'Qassim',
      members: [
        { fullName: 'Boss', role: 'manager', loginNumber: '1', active: true },
        { fullName: 'Sami', role: 'supervisor', loginNumber: '2', active: true },
        { fullName: 'Ahmed', role: 'promoter', loginNumber: '3', active: true },
      ],
      today: '2026-08-25',
    });
    expect(report.indexOf('مندوب')).toBeLessThan(report.indexOf('مشرف'));
    expect(report.indexOf('مشرف')).toBeLessThan(report.indexOf('مدير'));
  });

  it('ends each person line with a Latin login number', () => {
    const report = buildTeamLogins({
      city: 'Qassim',
      members: [{ fullName: 'عبدالله المطيري', role: 'promoter', loginNumber: '1699', active: true }],
      today: '2026-08-25',
    });
    const line = report.split('\n').find((l) => l.startsWith('• '));
    expect(line).toBe('• عبدالله المطيري — 1699');
  });

  it('does not end with trailing blank lines', () => {
    const report = buildTeamLogins({ city: 'Qassim', members, today: '2026-08-25' });
    expect(report).toBe(report.trimEnd());
  });
});
