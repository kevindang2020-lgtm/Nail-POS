// posLayoutGrid.test.ts — BUILD_PLAN Phase 8 (found by the real-browser proof): .main is a grid of header · alert slot ·
// screen. The Safety Community banner sat directly in .main, so whenever an alert was up it took the screen's 1fr row
// and the screen fell into an implicit auto row (a 300px band of banner, the page squashed below it). Pin both halves.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

const css = readFileSync(join(__dirname, '..', 'styles.css'), 'utf8');
const layout = readFileSync(join(__dirname, 'POSLayout.tsx'), 'utf8');
describe('POS main grid', () => {
  it('every .main grid-template-rows has three tracks: header, the alert slot (auto), the screen', () => {
    const rows = [...css.matchAll(/\.main\s*\{[^}]*grid-template-rows:\s*([^;}]+)/g)].map((m) => m[1].trim());
    expect(rows.length).toBeGreaterThanOrEqual(2);
    // the header track is a px value or the --pos-header-height token (which must itself be a px value)
    for (const r of rows) expect(r).toMatch(/^(\d+px|var\(--pos-header-height\))\s+auto\s+minmax\(0,\s*1fr\)$/);
    if (rows.some((r) => r.startsWith('var('))) expect(css).toMatch(/--pos-header-height:\s*\d+px/);
  });
  it('the banner lives inside an always-rendered slot, directly before the screen outlet', () => {
    expect(layout).toMatch(/<div className="community-alert-slot"[^>]*><CommunityEmergencyBanner \/><\/div>\s*<Outlet \/>/);
  });
});
