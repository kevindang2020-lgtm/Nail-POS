// booking-no-print.test — OWNER DECISION (Kevin, Nov 13 2026; booking200 addendum §10, acceptance P-04 / P-05 / B-20): the
// Booking workspace has NO schedule printing — no Print-Schedule button,  (check:no-print: describes the ban) printer icon, print menu item, keyboard shortcut,
// print route, print stylesheet or schedule export. Source-level assertion over every Booking UI source (the Booking
// screen, its components, New Booking, Add Walk-In and the schedule-board package when present): no browser print call,
// no @media print, no Ctrl/Cmd+P handler, no print route, and no visible label (literal or translated, EN and VI) that
// offers printing. The render-level assertion lives in screens/POSBookingScreen.no-print.test.tsx. Receipt printing at
// checkout is a different, wanted feature and is not scanned here.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { t, setLanguage } from '@aipowersalon/mobile-sdk/i18n';

const POS = join(__dirname, '..', '..');   // apps/pos-web
function bookingUiSources(): string[] {
  const out = ['src/screens/POSBookingScreen.tsx', 'src/screens/POSNewBookingScreen.tsx', 'src/screens/POSWalkInScreen.tsx'].map((f) => join(POS, f));
  const walk = (dir: string) => {
    if (!existsSync(dir)) return;
    for (const e of readdirSync(dir)) {
      if (['node_modules', 'dist', 'screenshots', 'scripts'].includes(e)) continue;
      const p = join(dir, e);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(tsx?|css)$/.test(e) && !/\.(test|spec)\.tsx?$/.test(e)) out.push(p);
    }
  };
  walk(join(POS, 'src/screens/booking'));
  walk(join(POS, '../../packages/booking-schedule-board/src'));
  return out.filter((f) => existsSync(f));
}
/** the code with comments removed (a comment that SAYS "no print" is not a print control) */
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1').replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '');
const keysIn = (src: string) => [...src.matchAll(/\b(?:tx|t)\(\s*'([a-zA-Z0-9_.]+)'/g)].map((m) => m[1]);

describe('Booking UI has no schedule printing (P-04 / P-05 / B-20)', () => {
  const files = bookingUiSources();
  it('scans the Booking UI sources (not vacuous)', () => {
    expect(files.some((f) => f.endsWith('POSBookingScreen.tsx'))).toBe(true);
    expect(files.some((f) => f.endsWith('BookingKpiStrip.tsx'))).toBe(true);
  });
  it('no browser print call, no print stylesheet, no Ctrl/Cmd+P shortcut, no print route', () => {
    const bad: string[] = [];
    for (const f of files) {
      const c = code(readFileSync(f, 'utf8'));
      if (/\bwindow\s*\.\s*print\s*\(|(^|[^.\w])print\s*\(\s*\)|execCommand\s*\(\s*['"]print/i.test(c)) bad.push(f + ': print call');
      if (/@media\s+print|media\s*=\s*['"]print/i.test(c)) bad.push(f + ': print stylesheet');
      if (/(ctrlKey|metaKey)[^;\n]{0,80}['"]p['"]|['"]p['"][^;\n]{0,80}(ctrlKey|metaKey)/i.test(c)) bad.push(f + ': Ctrl/Cmd+P handler');
      if (/(path|to|href|nav(igate)?\()\s*[=:(]?\s*['"`][^'"`]*print/i.test(c)) bad.push(f + ': print route');
      if (/\b(FaPrint|MdPrint|PrinterIcon|PrintIcon|IoPrint|BsPrinter|LuPrinter)\b/.test(c)) bad.push(f + ': printer icon');
    }
    expect(bad).toEqual([]);
  });
  it('no visible label offers printing — literal JSX text / aria / title, or any translated key the Booking UI uses (EN and VI)', () => {
    const bad: string[] = [];
    const keys = new Set<string>();
    for (const f of files) {
      const src = readFileSync(f, 'utf8'); const c = code(src);
      if (/>[^<>{}]*\b(print|printer|in lịch|in danh sách)\b[^<>{}]*</i.test(c)) bad.push(f + ': JSX text');
      if (/(aria-label|title|label)\s*=\s*['"][^'"]*\bprint/i.test(c)) bad.push(f + ': attribute');
      for (const k of keysIn(src)) keys.add(k);
    }
    expect(keys.size).toBeGreaterThan(50);   // the Booking screen's labels really were resolved
    for (const lang of ['en', 'vi'] as const) {
      setLanguage(lang);
      for (const k of keys) { const v = t(k); if (/\bprint|\bprinter|\bin lịch\b|\bin danh sách\b|máy in/i.test(v)) bad.push(`${lang} ${k}: ${v}`); }
    }
    setLanguage('en');
    expect(bad).toEqual([]);
  });
  it('the scanners are not vacuous: each flags a planted print control', () => {
    expect(/\bwindow\s*\.\s*print\s*\(/.test(code('const a = 1; window.print();'))).toBe(true);   // check:no-print — planted fixture proving the scanner works
    expect(code('// window.print() is banned')).not.toMatch(/window\.print/);   // check:no-print — planted fixture proving the scanner works
    expect(/(ctrlKey|metaKey)[^;\n]{0,80}['"]p['"]/i.test("if (e.ctrlKey && e.key === 'p') go()")).toBe(true);
    expect(/>[^<>{}]*\b(print|printer)\b[^<>{}]*</i.test('<button>Print schedule</button>')).toBe(true);   // check:no-print — planted fixture proving the scanner works
    expect(keysIn("tx('pos.appointments') + t('bkpi.retry')")).toEqual(['pos.appointments', 'bkpi.retry']);
  });
});
