// productionData.test.ts — 23-inch spec §115–§116, §130 ("No production mock data remains"): nothing the guest sees is
// made up. The reference picture's sample customer, services, technicians, totals and wait — and any mock / demo ad —
// must never appear in the code that ships: the display app, the standalone kiosk, the shared ad components, the POS's
// display screens and the server code that builds what the display shows. Comments are allowed to quote the picture;
// code is not. (Tests are not shipped and are not scanned.)
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(__dirname, '..', '..', '..');
const SHIPPED = [
  'apps/customer-display/src',
  'apps/go-check-in-kiosk/index.html',
  'apps/go-check-in-kiosk/www/index.html',
  'packages/ui/src/DisplayAdSlide.tsx',
  'apps/pos-web/src/screens/display-ads',
  'apps/pos-web/src/screens/CustomerDisplayCard.tsx',
  'apps/pos-web/src/screens/POSCustomerDisplaysScreen.tsx',
  'apps/api/src/customer-display',
  'modules/marketing/src/display-advertising',
  'modules/queue/src/go-check-in',
  'modules/checkout/src/checkout/customer-display-projection.ts',
  'modules/checkout/src/checkout/display-send-core.ts',
  'modules/checkout/src/checkout/checkout-display.dto.ts',
];
const isTest = (p: string) => /\.(test|spec)\.[tj]sx?$|vitest|pgtest|postgres-race|-core\.spec/.test(p);
const files = (p: string): string[] => {
  const abs = join(ROOT, p);
  let st; try { st = statSync(abs); } catch { return []; }
  if (st.isFile()) return [abs];
  return readdirSync(abs).flatMap((n) => files(join(p, n))).filter((f) => /\.(tsx?|html|css)$/.test(f) && !isTest(f));
};
/** The code without its comments (line, block, HTML) — a comment may quote the reference picture. */
const code = (src: string) => src.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');

// the reference picture's sample data (§115: "hard-coded Sophia, hard-coded services, hard-coded $379.15 … fake wait
// time"), the walk-in tiles it shows, and the words a made-up ad or customer would carry
const FORBIDDEN: [RegExp, string][] = [
  [/\bSophia\b/, 'the picture\'s customer'], [/\bOlivia\b|\bLisa\b/, 'the picture\'s technicians'],
  [/379\.15|37915\b/, 'the picture\'s total'], [/25\s*[–-]\s*35\s*min/, 'the picture\'s wait'],
  [/['"`](Gel Manicure|Spa Pedicure|Acrylic Fill|Builder Gel)['"`]/, 'a hard-coded service'],
  [/\b(mockAds?|MOCK_ADS?|demoAds?|DEMO_ADS?|sampleAds?|SAMPLE_ADS?|fakeAds?)\b/, 'a mock advertisement'],
  [/\b(mockCustomer|DEMO_CUSTOMER|sampleCustomer|fakeWait|FAKE_WAIT)\b/, 'a mock customer or wait'],
];

describe('§115 nothing the guest sees is made up', () => {
  const all = SHIPPED.flatMap(files);
  it('the shipped code is found (the scan is not vacuous)', () => {
    expect(all.length).toBeGreaterThan(40);
    expect(all.some((f) => f.endsWith('Display23.tsx'))).toBe(true);
    expect(all.some((f) => f.endsWith('go-check-in.service.ts'))).toBe(true);
    expect(all.some((f) => f.endsWith('DisplayAdSlide.tsx'))).toBe(true);
    expect(all.filter((f) => f.endsWith('index.html'))).toHaveLength(2);
  });
  it.each(FORBIDDEN.map(([re, what]) => [what, re] as const))('no %s in shipped code', (_what, re) => {
    const hits = all.flatMap((f) => code(readFileSync(f, 'utf8')).split('\n').map((l, i) => (re.test(l) ? `${relative(ROOT, f)}:${i + 1}  ${l.trim().slice(0, 100)}` : null)).filter(Boolean));
    expect(hits).toEqual([]);
  });
  it('the scan really catches a planted sample (so a pass means something)', () => {
    const planted = code(`const who = 'Sophia'; // the picture's Sophia is fine in a comment\nconst total = 379.15;`);
    expect(FORBIDDEN.filter(([re]) => re.test(planted)).map(([, w]) => w)).toEqual(['the picture\'s customer', 'the picture\'s total']);
    expect(FORBIDDEN.some(([re]) => re.test(code('// Sophia 379.15 — a comment quoting the picture')))).toBe(false);
  });
});
