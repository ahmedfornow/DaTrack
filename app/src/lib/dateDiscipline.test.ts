import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

/**
 * A structural guard, not a unit test.
 *
 * `businessDay.ts` is the only place allowed to compute a date of record. This
 * rule has been broken before — mixing `toISOString()` (UTC) with `getDate()`
 * (device-local) in one feature produced off-by-one days that appeared only
 * between midnight and 3am. Code review does not reliably catch it, so the
 * build does.
 *
 * If you need a date, import it from `lib/businessDay`. If the helper you want
 * does not exist yet, add it there.
 */

const SRC = join(import.meta.dirname, '..');

/** The date authority itself, and generated files nobody hand-edits. */
const EXEMPT = new Set(['lib/businessDay.ts', 'types/database.ts']);

/** Device-local date reads, plus the UTC formatter that hides the cutoff. */
const FORBIDDEN: ReadonlyArray<{ pattern: RegExp; why: string }> = [
  { pattern: /\.toISOString\s*\(/, why: 'ignores the 02:00 business-day cutoff' },
  { pattern: /\.getFullYear\s*\(/, why: 'reads the device timezone' },
  { pattern: /\.getMonth\s*\(/, why: 'reads the device timezone' },
  { pattern: /\.getDate\s*\(/, why: 'reads the device timezone' },
  { pattern: /\.getDay\s*\(/, why: 'reads the device timezone' },
  { pattern: /\.getHours\s*\(/, why: 'reads the device timezone' },
  { pattern: /\.getMinutes\s*\(/, why: 'reads the device timezone' },
  { pattern: /\.toLocaleDateString\s*\(/, why: 'reads the device timezone' },
];

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...sourceFiles(full));
    } else if (/\.(ts|tsx)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

describe('date discipline', () => {
  const files = sourceFiles(SRC)
    .map((file) => relative(SRC, file).split(sep).join('/'))
    .filter((file) => !EXEMPT.has(file));

  it('finds source files to check', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files)('%s computes no dates of its own', (file) => {
    const source = readFileSync(join(SRC, file), 'utf8');
    const offences = source
      .split('\n')
      .flatMap((line, index) => {
        // Skip comments — the rule is about code, and the prose explains it.
        const code = line.replace(/\/\/.*$/, '').replace(/^\s*\*.*$/, '');
        return FORBIDDEN.filter(({ pattern }) => pattern.test(code)).map(
          ({ pattern, why }) =>
            `  ${file}:${index + 1}  ${String(pattern)} — ${why}\n    ${line.trim()}`,
        );
      });

    expect(
      offences,
      `Use lib/businessDay instead:\n${offences.join('\n')}`,
    ).toEqual([]);
  });
});
