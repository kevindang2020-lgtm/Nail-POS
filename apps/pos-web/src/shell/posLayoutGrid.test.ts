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
    // header track: a px value or the shared --pos-header-height variable
    for (const r of rows) expect(r).toMatch(/^(?:\d+px|var\(--pos-header-height\))\s+auto\s+minmax\(0,\s*1fr\)$/);
  });
  it('the banner lives inside an always-rendered slot, directly before the screen outlet', () => {
    // Nov 6 2026: the "Turn on notifications" banner shares the slot (the grid's `auto` row), never a fourth grid child
    expect(layout).toMatch(/<div className="community-alert-slot"[^>]*><CommunityEmergencyBanner \/>(<PosPushPrompt \/>)?<\/div>\s*<Outlet \/>/);
  });
});
