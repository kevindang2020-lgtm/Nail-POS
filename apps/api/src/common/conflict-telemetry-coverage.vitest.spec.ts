// conflict-telemetry-coverage.vitest.spec.ts — Smooth Refresh spec §100 guard: every concurrency 409 (an HttpException
// with a stable `code` and HttpStatus.CONFLICT) in the POS modules is counted by recordConflict on the same line. A new
// conflict path added without telemetry would make the conflict-rate metric silently under-report.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..', '..', '..', '..', 'modules');
function controllers(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (f === 'node_modules' || f === 'dist') continue;
    if (statSync(p).isDirectory()) controllers(p, out);
    else if (f.endsWith('.controller.ts')) out.push(p);
  }
  return out;
}

describe('every concurrency 409 is counted (spec §100)', () => {
  it('HttpException({... code: e.code ...}, HttpStatus.CONFLICT) lines carry recordConflict', () => {
    const offenders: string[] = [];
    let seen = 0;
    for (const m of ['booking', 'customers', 'checkout', 'queue']) {
      for (const f of controllers(join(ROOT, m, 'src'))) {
        readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
          if (/HttpStatus\.CONFLICT/.test(line) && /code:\s*e\.code/.test(line)) {
            seen++;
            if (!/recordConflict\(/.test(line)) offenders.push(`${f.split('/modules/')[1]}:${i + 1}`);
          }
        });
      }
    }
    expect(seen).toBeGreaterThanOrEqual(5);   // non-vacuous: the five known sites were found
    expect(offenders).toEqual([]);
  });
});
