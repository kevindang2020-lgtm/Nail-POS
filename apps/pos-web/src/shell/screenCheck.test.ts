// The read-only Screen Check rules (SUNMI FLEX 3 mandates): PASS / WARN / FAIL decided from measurements only.
import { describe, expect, it } from 'vitest';
import { analyzeScreen, overallVerdict, peerRows, registryPageFor, REGISTRY, type Collected } from './screenCheck';
import type { DisplayProfile } from './displayProfile';

const prof = (w = 1920, h = 945, extra: Partial<DisplayProfile> = {}): DisplayProfile => ({ innerW: w, innerH: h, vvW: w, vvH: h, vvTop: 0, dpr: 1, screenW: 1920, screenH: 1080, orientation: 'landscape', displayMode: 'browser', touch: true, keyboardOpen: false, contentW: w - 248, contentH: h - 64, headerH: 64, sidebarW: 248, density: w >= 1700 && h >= 900 ? 'compact' : 'tight', measuredAt: 0, ...extra });
const base = (over: Partial<Collected> = {}): Collected => ({
  route: '/overview', page: registryPageFor('/overview'), profile: prof(),
  scroll: { docY: 0, docX: 0, mainY: 0, mainX: 0, rootY: 0, rootX: 0 },
  modules: [
    { id: 'a', label: 'A', present: true, visible: true, inView: true, rect: { x: 0, y: 100, w: 400, h: 200 }, children: 3, minChildren: null },
    { id: 'b', label: 'B', present: true, visible: true, inView: true, rect: { x: 410, y: 100, w: 400, h: 210 }, children: 3, minChildren: null },
  ],
  smallTargets: [], clipped: [], realtime: { status: 'CONNECTED', lastSyncedAt: 1, lastErrorAt: null }, ...over,
});
const v = (c: Collected, id: string) => analyzeScreen(c).find((f) => f.id === id)?.verdict;

describe('analyzeScreen', () => {
  it('a fitting, complete, balanced screen passes', () => { expect(overallVerdict(analyzeScreen(base()))).toBe('PASS'); });
  it('page scroll at a certified density fails; at a tight density it warns', () => {
    expect(v(base({ scroll: { docY: 0, docX: 0, mainY: 0, mainX: 0, rootY: 120, rootX: 0 } }), 'fit')).toBe('FAIL');
    expect(v(base({ profile: prof(1366, 768), scroll: { docY: 0, docX: 0, mainY: 0, mainX: 0, rootY: 120, rootX: 0 } }), 'fit')).toBe('WARN');
  });
  it('sideways scroll always fails', () => { expect(v(base({ profile: prof(1366, 768), scroll: { docY: 0, docX: 0, mainY: 0, mainX: 30, rootY: 0, rootX: 0 } }), 'horizontal')).toBe('FAIL'); });
  it('a missing registered module fails and is named', () => {
    const c = base(); c.modules.push({ id: 'c', label: 'Quick Actions', present: false, visible: false, inView: false, rect: null, children: 0, minChildren: null });
    const f = analyzeScreen(c).find((x) => x.id === 'modules')!;
    expect(f.verdict).toBe('FAIL'); expect(f.modules).toEqual(['Quick Actions']);
  });
  it('a module below the fold fails at the certified density', () => {
    const c = base(); c.modules[1] = { ...c.modules[1], inView: false };
    expect(v(c, 'in-view')).toBe('FAIL');
  });
  it('an incomplete KPI set fails', () => {
    const c = base(); c.modules[0] = { ...c.modules[0], children: 7, minChildren: 9 };
    expect(v(c, 'counts')).toBe('FAIL');
  });
  it('overlap fails; nesting does not', () => {
    const c = base(); c.modules[1] = { ...c.modules[1], rect: { x: 300, y: 150, w: 400, h: 200 } };
    expect(v(c, 'overlap')).toBe('FAIL');
    const n = base(); n.modules[1] = { ...n.modules[1], rect: { x: 10, y: 110, w: 100, h: 50 } };
    expect(v(n, 'overlap')).toBe('PASS');
  });
  it('a lop-sided peer row warns', () => {
    const c = base(); c.modules[1] = { ...c.modules[1], rect: { x: 410, y: 100, w: 400, h: 400 } };
    expect(v(c, 'balance')).toBe('WARN');
  });
  it('the open soft keyboard makes the fit NOT_TESTED, never a FAIL', () => {
    expect(v(base({ profile: prof(1920, 1032, { keyboardOpen: true, vvH: 600 }), scroll: { docY: 0, docX: 0, mainY: 0, mainX: 0, rootY: 300, rootX: 0 } }), 'fit')).toBe('NOT_TESTED');
  });
  it('an unregistered screen is NOT_TESTED for modules', () => { expect(v(base({ page: null }), 'modules')).toBe('NOT_TESTED'); });
  it('interrupted live updates warn', () => { expect(v(base({ realtime: { status: 'RECONNECTING', lastSyncedAt: 1, lastErrorAt: null } }), 'realtime')).toBe('WARN'); });
});

describe('registry', () => {
  it('maps routes (incl. aliases) to their page', () => {
    expect(registryPageFor('/live-operations')?.key).toBe('live-ops');
    expect(registryPageFor('/dashboard')?.key).toBe('live-ops');
    expect(registryPageFor('/tenant/payments/expenses')?.key).toBe('expenses');
    expect(registryPageFor('/nowhere')).toBeNull();
  });
  it('module ids are unique per page and every page has a guide and a screen', () => {
    for (const p of REGISTRY.pages) {
      expect(new Set(p.modules.map((m) => m.id)).size).toBe(p.modules.length);
      expect(p.screens.length).toBeGreaterThan(0); expect(p.guide).toMatch(/^AI_PowerSalon/);
    }
  });
  it('peerRows groups modules whose tops line up', () => {
    const rows = peerRows([{ id: 'x', rect: { x: 0, y: 10, w: 1, h: 100 } }, { id: 'y', rect: { x: 5, y: 14, w: 1, h: 120 } }, { id: 'z', rect: { x: 0, y: 300, w: 1, h: 10 } }]);
    expect(rows).toEqual([{ ids: ['x', 'y'], minH: 100, maxH: 120 }]);
  });
});
