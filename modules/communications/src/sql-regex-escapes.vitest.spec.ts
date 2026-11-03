// sql-regex-escapes.vitest — Nov 3 audit: '\D' written inside a Kysely sql`` template reaches Postgres as plain 'D'
// (a template literal cooks an unknown escape to the bare letter), so regexp_replace(phone, '\D', '', 'g') stripped
// the letter D instead of non-digits and phone search only "worked" on numbers already stored as digits.
// This scans every module's product code for a single-backslash regex class inside a quoted SQL string.
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..', '..');
function* files(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist') continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* files(p);
    else if (p.endsWith('.ts') && !/\.(spec|test)\.ts$/.test(p)) yield p;
  }
}

describe('SQL regex escapes inside sql`` templates', () => {
  it('no regexp_replace / ~ pattern uses a single-backslash class like \\D, \\d, \\s, \\w', () => {
    const bad: string[] = [];
    for (const f of files(ROOT)) {
      readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
        if (/(regexp_replace|regexp_match|regexp_matches|~\*?)\s*\(?[^`]*'[^'\\]*(?<!\\)\\[dDsSwW][^']*'/.test(line) && line.includes('sql`')) bad.push(`${f.slice(ROOT.length + 1)}:${i + 1}`);
      });
    }
    expect(bad).toEqual([]);
  });
});
