// literal-escapes.test — Nov 3 audit: 54 English strings held a doubled backslash escape ('Booking rules \\u2192'), so English
// users saw the six characters "→" instead of "→" (Vietnamese was right). No catalog string may contain a literal \uXXXX.
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('i18n catalogs', () => {
  it('no string shows a literal \\uXXXX escape', () => {
    const files = ['catalog.en.ts', 'catalog.vi.ts', ...readdirSync(join(__dirname, 'ns')).map((f) => join('ns', f))];
    const bad = files.flatMap((f) => readFileSync(join(__dirname, f), 'utf8').split('\n').map((l, i) => (/\\\\u[0-9a-fA-F]{4}/.test(l) ? `${f}:${i + 1}` : null)).filter(Boolean));
    expect(bad).toEqual([]);
  });
});
