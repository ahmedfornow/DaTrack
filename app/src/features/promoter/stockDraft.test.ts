import { describe, it, expect } from 'vitest';
import { quantitiesOf, stockDraft } from './stockDraft';

/**
 * The stock tab once copied saved counts into state on mount, before they had
 * loaded, so the first visit showed every box blank and a generated message
 * left out anything not retyped.
 */

const saved = new Map([
  [1, 4],
  [2, 7],
]);

describe('what each box shows', () => {
  it('is the saved count when nothing has been typed', () => {
    expect([...stockDraft(saved, new Map())]).toEqual([
      [1, '4'],
      [2, '7'],
    ]);
  });

  it('is the typed value over the saved one', () => {
    expect(stockDraft(saved, new Map([[1, '9']])).get(1)).toBe('9');
  });

  it('stays empty when a saved box is cleared, rather than refilling', () => {
    expect(stockDraft(saved, new Map([[2, '']])).get(2)).toBe('');
  });

  it('includes an item counted for the first time', () => {
    expect(stockDraft(saved, new Map([[3, '12']])).get(3)).toBe('12');
  });
});

describe('the counts to save', () => {
  it('carries saved counts nobody retyped', () => {
    // The message and the save both read these — this is the part that went missing.
    const quantities = quantitiesOf(stockDraft(saved, new Map([[3, '12']])));
    expect([...quantities]).toEqual([
      [1, 4],
      [2, 7],
      [3, 12],
    ]);
  });

  it('leaves out a cleared box', () => {
    expect(quantitiesOf(stockDraft(saved, new Map([[2, '']]))).has(2)).toBe(false);
  });

  it('keeps a real zero', () => {
    expect(quantitiesOf(new Map([[5, '0']])).get(5)).toBe(0);
  });
});
