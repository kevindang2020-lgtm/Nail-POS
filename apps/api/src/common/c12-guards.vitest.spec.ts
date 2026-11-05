// c12-guards.vitest.spec — Constitution 12 §205, §209: the security guards run on EVERY push, with a least-privilege token.
//
// Reads scripts/security-audit.mjs as TEXT: importing it would execute the whole audit (it is a script, not a module).
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const API = process.cwd();
const audit = readFileSync(join(API, 'scripts/security-audit.mjs'), 'utf8');
const listed = [...(audit.slice(audit.indexOf('export const C12_GUARDS = ['), audit.indexOf('];', audit.indexOf('export const C12_GUARDS = ['))).matchAll(/'(src\/[^']+\.spec\.ts)'/g))].map((m) => m[1]);

describe('§205 the Constitution 12 guards are in the every-push lane', () => {
  it('the list is non-empty and every file it names exists — a renamed guard cannot silently drop out', () => {
    expect(listed.length).toBeGreaterThanOrEqual(16);
    for (const f of listed) expect(existsSync(join(API, f)), f).toBe(true);
  });
  it('the lane runs in FAST mode (every push), not only in the nightly full battery', () => {
    const call = audit.match(/if \(!SKIP\.has\('quick'\)\) vitest\('Constitution 12 security guards \(every push\)', C12_GUARDS, \d+\);/);
    expect(call).toBeTruthy();
    const before = audit.slice(0, audit.indexOf(call![0]));
    expect(before.lastIndexOf("if (MODE === 'full') {")).toBeLessThan(before.lastIndexOf('export const C12_GUARDS'));   // not nested inside the full-only block
  });
  it('the guards that close the High findings are all there', () => {
    for (const g of ['authz-declared', 'sessionless-routes', 'client-ip', 'key-ring', 'audit-append-only', 'otp-race', 'security-headers']) expect(listed.some((f) => f.includes(g)), g).toBe(true);
    // mfa-bypass-regression (H4) moved with identity into modules/identity; the lane runs it from the module
    const line = audit.split('\n').find((l) => l.includes('mfa-bypass-regression.vitest.spec.ts')) ?? '';
    expect(line).toMatch(/^if \(!SKIP\.has\('quick'\)\) packageTests\(/);   // in the every-push lane, run from modules/identity
    expect(line).toContain("'identity', 'modules'");
  });
});

describe('§209 the workflow token is least-privilege', () => {
  it('permissions: contents: read at the top level of the security workflow', () => {
    const wf = readFileSync(join(API, '../../.github/workflows/security.yml'), 'utf8');
    expect(wf).toMatch(/^permissions:\n {2}contents: read\n/m);
    expect(wf).not.toMatch(/contents: write|write-all/);
  });
});
