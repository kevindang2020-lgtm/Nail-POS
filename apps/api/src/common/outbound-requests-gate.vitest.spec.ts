// outbound-requests-gate.vitest.spec.ts — Platform Architecture Audit §192: the egress gate finds raw network calls and
// fails on an unreviewed one; the committed tree passes.
import { describe, it, expect } from 'vitest';
// @ts-expect-error — plain ESM script without types
import { scan, verdict } from '../../scripts/check-outbound-requests.mjs';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const allow = JSON.parse(readFileSync(join(__dirname, '../../scripts/outbound-requests.allowlist.json'), 'utf8'));

describe('check:outbound-requests (§192)', () => {
  it('the committed tree: every raw network call in server code is reviewed, nothing stale', () => {
    expect(verdict(scan(), allow)).toEqual([]);
  });
  it('a new file with a raw fetch() fails as NEW; a reviewed file that grows fails as GREW; a shrink must be recorded', () => {
    const found = { ...scan(), 'modules/x/src/new-thing.ts': 1 };
    expect(verdict(found, allow).some((p: string) => p.startsWith('NEW') && p.includes('new-thing.ts'))).toBe(true);
    const f = Object.keys(allow)[0];
    expect(verdict({ ...scan(), [f]: allow[f].count + 1 }, allow).some((p: string) => p.startsWith('GREW'))).toBe(true);
    expect(verdict({ ...scan(), [f]: allow[f].count - 1 || 0 }, allow).some((p: string) => /SHRINK|STALE/.test(p))).toBe(true);
  });
  it('every reviewed entry carries a written reason', () => {
    for (const [f, a] of Object.entries(allow) as [string, { reason: string }][]) expect(a.reason.length, f).toBeGreaterThan(20);
  });
});
