// frozen-shell.test — OWNER FREEZE (Kevin, Nov 13 2026; booking200 addendum §03, acceptance P-01): the shared POS top bar
// and the employee sidebar are frozen. This fails if ANY frozen source changes — the shell components, the sidebar's
// nav/route data and gating, the top-bar widgets, or a CSS rule in styles.css whose selector targets the shell — unless
// the owner approved it through apps/pos-web/scripts/frozen-shell.mjs --approve (see that file's header for the update
// procedure). It also fails if Booking-scoped code adds broad selectors (html / body / header / nav / aside / button /
// .topbar / .sidebar) that would restyle the shared widgets.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
// @ts-expect-error — plain .mjs helper shared with the CLI (no type declarations)
import { computeFrozenShell, diffAgainstLock, readLock, fingerprintDigest, FROZEN_FILES, cssRules, shellCssRules, POS_ROOT } from '../../scripts/frozen-shell.mjs';

describe('frozen top bar + sidebar (P-01)', () => {
  it('every frozen source matches the owner-approved fingerprint', () => {
    const changed: string[] = diffAgainstLock();
    expect(changed, `Frozen top-bar / sidebar sources changed without owner approval: ${changed.join(', ')}. ` +
      'Revert them, or (only with the owner\'s explicit approval) follow the update procedure in apps/pos-web/scripts/frozen-shell.mjs.').toEqual([]);
  });
  it('the lock lists exactly the frozen files, each present, and its fingerprint is the one the LAST approval recorded', () => {
    const lock = readLock();
    expect(Object.keys(lock.files).sort()).toEqual([...FROZEN_FILES].sort());
    for (const f of FROZEN_FILES) expect(lock.files[f], f).toMatch(/^[0-9a-f]{64}$/);
    expect(lock.approvals.length).toBeGreaterThan(0);
    for (const a of lock.approvals) { expect(a.approvedBy).toBeTruthy(); expect(a.reason).toBeTruthy(); expect(a.at).toBeTruthy(); }
    // a hand-edited hash without a new approval entry fails here
    expect(lock.approvals.at(-1).fingerprint).toBe(fingerprintDigest(lock));
  });
  it('the guard is not vacuous: a one-character change to a frozen file or to a shell CSS rule is detected', () => {
    const cur = computeFrozenShell();
    const lock = readLock();
    expect(diffAgainstLock({ ...cur, files: { ...cur.files, 'src/shell/POSLayout.tsx': 'x'.repeat(64) } }, lock)).toEqual(['src/shell/POSLayout.tsx']);
    expect(diffAgainstLock({ ...cur, shellCss: { ...cur.shellCss, sha256: '0'.repeat(64) } }, lock)).toEqual(['src/styles.css (shell rules)']);
    // the CSS extractor sees shell rules inside @media and ignores look-alikes such as .nav-tabs
    const rules = shellCssRules('.nav-tabs{color:red}@media (max-width:800px){.sidebar .brand{gap:2px}}.topbar,.x{a:b}.navbar{c:d}');
    expect(rules.map((r: { sel: string }) => r.sel)).toEqual(['@media (max-width:800px) .sidebar .brand', '.topbar,.x']);
    expect(cssRules('@import "tailwindcss";\n:root{--a:1}').map((r: { sel: string }) => r.sel)).toEqual([':root']);
    // the real stylesheet has shell rules to protect
    expect(cur.shellCss.rules).toBeGreaterThan(20);
  });
});

/** Booking-scoped sources: the Booking screen, its components, and the schedule-board package when it is present. */
function bookingSources(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    if (!existsSync(dir)) return;
    for (const e of readdirSync(dir)) {
      if (e === 'node_modules' || e === 'dist' || e === 'screenshots') continue;
      const p = join(dir, e);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(tsx?|css)$/.test(e) && !/\.test\.tsx?$/.test(e)) out.push(p);
    }
  };
  out.push(join(POS_ROOT, 'src/screens/POSBookingScreen.tsx'));
  walk(join(POS_ROOT, 'src/screens/booking'));
  walk(join(POS_ROOT, '../../packages/booking-schedule-board/src'));
  return out;
}
/** a .css file, or the text of each JSX <style>{`…`}</style> block */
const styleBlocks = (src: string, isCss: boolean) => (isCss ? [src] : [...src.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1].replace(/^\s*\{\s*`/, '').replace(/`\s*\}\s*$/, '')));
/** a selector part that STARTS at a shared element (html / body / header / nav / aside / main / button / *) or names a
 *  shell class anywhere — a Booking rule must start from a Booking-owned class */
const isBroad = (sel: string) => sel.replace(/^(@[^)]*\)\s*)+/, '').split(',').map((p) => p.trim()).some((p) =>
  /^(html|body|header|nav|aside|main|button|\*)(?![\w-])/.test(p) || /\.(topbar|sidebar|sidefoot|nav|navlink|shell)(?![\w-])/.test(p));

describe('Booking styles stay Booking-scoped (booking200 §03: no broad selectors)', () => {
  it('no Booking stylesheet / <style> block targets html, body, header, nav, aside, main, button or the shell classes', () => {
    const offenders: string[] = [];
    for (const f of bookingSources()) {
      const src = readFileSync(f, 'utf8');
      for (const block of styleBlocks(src, f.endsWith('.css'))) for (const r of cssRules(block)) if (isBroad(r.sel)) offenders.push(`${f.replace(POS_ROOT, 'apps/pos-web')}: ${r.sel}`);
    }
    expect(offenders).toEqual([]);
  });
  it('the scan finds the Booking sources (not vacuous) and the matcher flags a broad rule', () => {
    expect(bookingSources().some((f) => f.endsWith('BookingKpiStrip.tsx'))).toBe(true);
    expect(styleBlocks('<div/><style>{`header{color:red} .bk .x{a:b}`}</style>', false).flatMap((b) => cssRules(b).map((r: { sel: string }) => r.sel))).toEqual(['header', '.bk .x']);
    expect(isBroad('header')).toBe(true);
    expect(isBroad('.bsb-root, button:hover')).toBe(true);
    expect(isBroad('.bsb-root .sidebar')).toBe(true);
    expect(isBroad('@media (max-width:800px) body')).toBe(true);
    expect(isBroad('.bkpi-strip button')).toBe(false);
    expect(isBroad('.bkpi-strip .card')).toBe(false);
  });
});
