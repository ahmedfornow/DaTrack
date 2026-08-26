import { describe, it, expect } from 'vitest';
import {
  LOGIN_NUMBER_LENGTH,
  MIN_PASSWORD_LENGTH,
  checkCredentials,
  loginNumberToEmail,
} from './credentials';
import { PROFILE_COLUMNS, landingFor, parseProfile } from './profile';
import { authorise } from './session';

const validRow = {
  id: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
  full_name: 'أحمد',
  role: 'promoter',
  city: 'Qassim',
  active: true,
  login_no: '1699',
};

describe('login number to email', () => {
  it('appends the synthetic domain', () => {
    expect(loginNumberToEmail('1699')).toBe('1699@example.com');
  });

  it('ignores whitespace a phone keyboard inserted', () => {
    expect(loginNumberToEmail('  1699 ')).toBe('1699@example.com');
  });
});

describe('credential validation', () => {
  it('accepts a well-formed pair', () => {
    const result = checkCredentials('1699', 'secret1');
    expect(result).toEqual({ ok: true, email: '1699@example.com', password: 'secret1' });
  });

  it('trims the login number but never the password', () => {
    const result = checkCredentials(' 1699 ', ' pad ded ');
    expect(result.ok && result.email).toBe('1699@example.com');
    // A leading or trailing space is a legitimate password character.
    expect(result.ok && result.password).toBe(' pad ded ');
  });

  it.each([
    ['', 'login-number-required'],
    ['   ', 'login-number-required'],
    ['169', 'login-number-length'],
    ['16999', 'login-number-length'],
    ['16a9', 'login-number-digits'],
    ['١٦٩٩', 'login-number-digits'],
  ])('rejects login number %o as %s', (loginNumber, problem) => {
    const result = checkCredentials(loginNumber, 'secret1');
    expect(result.ok).toBe(false);
    expect(!result.ok && result.problem).toBe(problem);
  });

  it.each([
    ['', 'password-required'],
    ['short', 'password-length'],
  ])('rejects password %o as %s', (password, problem) => {
    const result = checkCredentials('1699', password);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.problem).toBe(problem);
  });

  it('accepts a password exactly at the minimum', () => {
    expect(checkCredentials('1699', 'a'.repeat(MIN_PASSWORD_LENGTH)).ok).toBe(true);
  });

  it('reports the login number problem before the password one', () => {
    const result = checkCredentials('', '');
    expect(!result.ok && result.problem).toBe('login-number-required');
  });

  it('gives every failure an Arabic message with no Latin diagnostics', () => {
    const result = checkCredentials('12', 'x');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toMatch(/[؀-ۿ]/);
      expect(result.message).not.toMatch(/[a-z]{4,}/i);
    }
  });

  it('states the expected length in the message', () => {
    const result = checkCredentials('12', 'secret1');
    expect(!result.ok && result.message).toContain(String(LOGIN_NUMBER_LENGTH));
  });
});

describe('profile parsing', () => {
  it('reads a well-formed row', () => {
    const parse = parseProfile(validRow);
    expect(parse).toEqual({
      ok: true,
      profile: {
        id: validRow.id,
        fullName: 'أحمد',
        role: 'promoter',
        city: 'Qassim',
        active: true,
        loginNumber: '1699',
      },
    });
  });

  it.each([null, undefined])('treats %s as a missing profile', (row) => {
    const parse = parseProfile(row);
    expect(parse.ok).toBe(false);
    expect(!parse.ok && parse.reason).toBe('missing');
  });

  it.each(['id', 'full_name', 'role', 'city'])(
    'reports %s when the column was not selected',
    (column) => {
      const row: Record<string, unknown> = { ...validRow };
      delete row[column];
      const parse = parseProfile(row);
      expect(parse.ok).toBe(false);
      expect(!parse.ok && parse.reason).toBe('malformed');
      expect(!parse.ok && parse.detail).toContain(column);
    },
  );

  it('rejects a role that is not in the enum', () => {
    const parse = parseProfile({ ...validRow, role: 'admin' });
    expect(parse.ok).toBe(false);
    expect(!parse.ok && parse.detail).toContain('role');
  });

  it('defaults active to true only when the column is absent', () => {
    const { active: _omitted, ...withoutActive } = validRow;
    const parse = parseProfile(withoutActive);
    expect(parse.ok && parse.profile.active).toBe(true);
  });

  it('never coerces a falsy active into true', () => {
    expect(parseProfile({ ...validRow, active: false }).ok).toBe(true);
    const parse = parseProfile({ ...validRow, active: false });
    expect(parse.ok && parse.profile.active).toBe(false);
  });

  it('rejects a non-boolean active rather than guessing', () => {
    const parse = parseProfile({ ...validRow, active: 'false' });
    expect(parse.ok).toBe(false);
    expect(!parse.ok && parse.detail).toContain('active');
  });

  it('normalises a blank login number to null', () => {
    expect(parseProfile({ ...validRow, login_no: '' }).ok).toBe(true);
    const parse = parseProfile({ ...validRow, login_no: '' });
    expect(parse.ok && parse.profile.loginNumber).toBeNull();
  });

  it('selects every column it goes on to read', () => {
    for (const column of ['id', 'full_name', 'role', 'city', 'active', 'login_no']) {
      expect(PROFILE_COLUMNS).toContain(column);
    }
  });
});

describe('authorisation', () => {
  it('lets an active promoter in', () => {
    const outcome = authorise(parseProfile(validRow));
    expect(outcome.ok).toBe(true);
  });

  it('blocks a deactivated account', () => {
    const outcome = authorise(parseProfile({ ...validRow, active: false }));
    expect(outcome.ok).toBe(false);
    expect(!outcome.ok && outcome.failure).toBe('deactivated');
    expect(!outcome.ok && outcome.message).toBe('حسابك موقوف — كلّم المشرف');
  });

  it('blocks a deactivated supervisor and manager too', () => {
    for (const role of ['supervisor', 'manager']) {
      const outcome = authorise(parseProfile({ ...validRow, role, active: false }));
      expect(!outcome.ok && outcome.failure).toBe('deactivated');
    }
  });

  it('reports a missing profile row distinctly', () => {
    const outcome = authorise(parseProfile(null));
    expect(!outcome.ok && outcome.failure).toBe('no-profile');
  });

  it('reports schema drift without leaking a Postgres code', () => {
    const outcome = authorise(parseProfile({ id: 'x' }));
    expect(!outcome.ok && outcome.failure).toBe('schema-drift');
    expect(!outcome.ok && outcome.message).not.toMatch(/\d{5}|PGRST/);
  });

  it('checks activity before anything else about the person', () => {
    // A deactivated account must not be distinguishable by role or city.
    const outcome = authorise(parseProfile({ ...validRow, city: 'Riyadh', active: false }));
    expect(!outcome.ok && outcome.failure).toBe('deactivated');
  });
});

describe('landing screen', () => {
  it('sends promoters to the promoter flow', () => {
    expect(landingFor('promoter')).toBe('promoter');
  });

  it('sends supervisors and managers to the staff dashboard', () => {
    expect(landingFor('supervisor')).toBe('staff');
    expect(landingFor('manager')).toBe('staff');
  });
});
