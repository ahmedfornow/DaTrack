import { describe, it, expect } from 'vitest';
import { prepareOutlet, type OutletDraft } from './outlets';

/**
 * `prepareOutlet` guards the fields that end up inside the team's WhatsApp
 * route message. It went untested until the supervisor's outlet editor was
 * finally wired up — before that nothing in the app called it.
 *
 * The map field is the one with history. A promoter once pasted a page of
 * copied text into it, and that text printed inside the route message for
 * weeks. These pin the behaviour that stops it happening again.
 */

const draft = (overrides: Partial<OutletDraft> = {}): OutletDraft => ({
  name: 'QAS_Test Outlet_DS_MN_BR',
  unicode: '10861',
  mapsUrl: '',
  shiftMode: 'day',
  isDs: false,
  area: '',
  ...overrides,
});

const ok = (result: ReturnType<typeof prepareOutlet>) => {
  if (!result.ok) throw new Error(`expected ok, got: ${result.reason}`);
  return result.values;
};

describe('the name', () => {
  it('is required', () => {
    const result = prepareOutlet(draft({ name: '   ' }));
    expect(result).toEqual({ ok: false, reason: 'اسم الموقع مطلوب' });
  });

  it('collapses whitespace rather than storing a multi-line name', () => {
    expect(ok(prepareOutlet(draft({ name: ' QAS_A  B \n C ' }))).name).toBe('QAS_A B C');
  });

  it('is capped at 70 characters', () => {
    expect(ok(prepareOutlet(draft({ name: 'x'.repeat(200) }))).name).toHaveLength(70);
  });
});

describe('the map field', () => {
  it('accepts a real https URL', () => {
    const url = 'https://maps.app.goo.gl/abc123';
    expect(ok(prepareOutlet(draft({ mapsUrl: url }))).mapsUrl).toBe(url);
  });

  it('refuses prose, naming the rule', () => {
    const result = prepareOutlet(draft({ mapsUrl: 'behind the big mosque, ask for Ahmed' }));
    expect(result).toEqual({
      ok: false,
      reason: 'رابط الخريطة غير صالح — يجب أن يبدأ بـ https://',
    });
  });

  it('keeps only the URL when one is buried in pasted text', () => {
    // This is the incident: a page of text pasted in, of which only the link
    // is wanted. Extracting beats refusing — the supervisor gets the outlet
    // saved and the message stays clean.
    const values = ok(
      prepareOutlet(draft({ mapsUrl: 'Our branch https://maps.app.goo.gl/xy open daily 9-11' })),
    );
    expect(values.mapsUrl).toBe('https://maps.app.goo.gl/xy');
  });

  it('allows the field to be left empty', () => {
    expect(ok(prepareOutlet(draft({ mapsUrl: '   ' }))).mapsUrl).toBe('');
  });

  it('does not treat a bare domain as a URL', () => {
    expect(prepareOutlet(draft({ mapsUrl: 'maps.google.com/place' })).ok).toBe(false);
  });
});

describe('the POS code and area', () => {
  it('caps the POS code at 24 characters', () => {
    expect(ok(prepareOutlet(draft({ unicode: '9'.repeat(50) }))).unicode).toHaveLength(24);
  });

  it('caps the area at 60 and collapses it to one line', () => {
    expect(ok(prepareOutlet(draft({ area: '  Buraydah \n North  ' }))).area).toBe(
      'Buraydah North',
    );
    expect(ok(prepareOutlet(draft({ area: 'ب'.repeat(90) }))).area).toHaveLength(60);
  });

  it('leaves an untagged area empty rather than inventing one', () => {
    expect(ok(prepareOutlet(draft({ area: '' }))).area).toBe('');
  });
});

describe('the flags', () => {
  it('carries shift mode and DS through untouched', () => {
    const values = ok(prepareOutlet(draft({ shiftMode: 'dual', isDs: true })));
    expect(values.shiftMode).toBe('dual');
    expect(values.isDs).toBe(true);
  });
});
