/**
 * screenCheck.ts — the "One-Click Screen Fit & Module Health Checker" every SUNMI FLEX 3 guide asks for (Full-System §13,
 * Overview §9 P1, Live Ops rec. 1/2/7/8, Check-In §15, Checkout rec. 1/3/5, Service Done rec. 1/3/4, Serving rec. 1/3,
 * Tech Queue rec. 1, Customer Queue §07, Expenses / Invoices / Deposits / OCR / Loyalty / Retention / Membership /
 * Customer "Screen Fit Health Checker", Payroll §13).
 *
 * READ-ONLY. It measures the screen that is open right now — viewport, density, page overflow, every registered module
 * (present / visible / inside the content viewport), minimum item counts ("all nine KPIs"), overlapping modules, clipped
 * control text, small touch targets without a hit area, uneven peer rows, and the realtime connection — and answers
 * PASS / WARN / FAIL / NOT_TESTED with a specific remedy. It never changes money, queue or customer state and it records
 * no customer, payroll, receipt, card or phone data: the report holds module ids, rectangles and counts only.
 *
 * Split in two so the rules are unit-tested without a browser: collectScreen() reads the DOM, analyzeScreen() judges.
 */
import { densityFor, type DisplayProfile } from './displayProfile';
import registry from './module-registry.json';

export type Verdict = 'PASS' | 'WARN' | 'FAIL' | 'NOT_TESTED';
export interface Rect { x: number; y: number; w: number; h: number }
export interface RegistryModule { id: string; label: string; minItems?: number; items?: string }
export interface RegistryPage { key: string; title: string; routes: string[]; screens: string[]; guide: string; modules: RegistryModule[]; scroll?: 'page'; scrollReason?: string }
export interface CollectedModule { id: string; label: string; present: boolean; visible: boolean; inView: boolean; rect: Rect | null; children: number; minChildren: number | null }
export interface Collected {
  route: string;
  page: RegistryPage | null;
  profile: DisplayProfile;
  scroll: { docY: number; docX: number; mainY: number; mainX: number; rootY: number; rootX: number };
  modules: CollectedModule[];
  smallTargets: { text: string; w: number; h: number }[];
  clipped: { text: string }[];
  realtime: { status: string; lastSyncedAt: number | null; lastErrorAt: number | null };
}
export interface Finding { id: string; verdict: Verdict; title: string; detail: string; remedy?: string; modules?: string[] }

export const REGISTRY = registry as unknown as { pages: RegistryPage[] };

/** The registry page for a route (exact route, then the longest registered prefix). */
export function registryPageFor(pathname: string): RegistryPage | null {
  const p = pathname.replace(/\/+$/, '') || '/';
  for (const pg of REGISTRY.pages) if (pg.routes.includes(p)) return pg;
  let best: RegistryPage | null = null, len = 0;
  for (const pg of REGISTRY.pages) for (const r of pg.routes) if (p.startsWith(r + '/') && r.length > len) { best = pg; len = r.length; }
  return best;
}

const overlapArea = (a: Rect, b: Rect) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
const contains = (a: Rect, b: Rect) => a.x <= b.x + 1 && a.y <= b.y + 1 && a.x + a.w >= b.x + b.w - 1 && a.y + a.h >= b.y + b.h - 1;

/** Peer rows: modules whose tops line up (±6 px) and that sit side by side. Returns rows with ≥ 2 members. */
export function peerRows(mods: { id: string; rect: Rect }[]): { ids: string[]; minH: number; maxH: number }[] {
  const rows: { top: number; items: { id: string; rect: Rect }[] }[] = [];
  for (const m of [...mods].sort((a, b) => a.rect.y - b.rect.y)) {
    const row = rows.find((r) => Math.abs(r.top - m.rect.y) <= 6);
    if (row) row.items.push(m); else rows.push({ top: m.rect.y, items: [m] });
  }
  return rows.filter((r) => r.items.length >= 2).map((r) => ({ ids: r.items.map((i) => i.id), minH: Math.min(...r.items.map((i) => i.rect.h)), maxH: Math.max(...r.items.map((i) => i.rect.h)) }));
}

/** Judge a collected screen. Pure. `t` turns a key into the POS language (defaults to the key for tests). */
export function analyzeScreen(c: Collected, t: (k: string, v?: Record<string, string>) => string = (k) => k): Finding[] {
  const out: Finding[] = [];
  const density = c.profile.density ?? densityFor(c.profile.innerW, c.profile.innerH);
  const certified = density === 'compact' || density === 'comfortable';
  const kb = c.profile.keyboardOpen;

  // 1 — display profile
  out.push({ id: 'display', verdict: density === 'fallback' ? 'WARN' : 'PASS', title: t('sunmi.check.display'),
    detail: t('sunmi.check.displayDetail', { w: String(c.profile.innerW), h: String(c.profile.innerH), dpr: String(c.profile.dpr), density: t('sunmi.density.' + density), mode: t('sunmi.mode.' + c.profile.displayMode), cw: String(c.profile.contentW), ch: String(c.profile.contentH) }),
    remedy: density === 'fallback' ? t('sunmi.fix.fallback') : undefined });

  // 2 — page fit (no main-page scroll at a certified density; horizontal never)
  const v = Math.max(c.scroll.docY, c.scroll.mainY, c.scroll.rootY), h = Math.max(c.scroll.docX, c.scroll.mainX, c.scroll.rootX);
  const pageScroll = c.page?.scroll === 'page';   // a registered long page (Customer Directory, Booking): vertical scroll is by design
  if (pageScroll) out.push({ id: 'fit', verdict: 'PASS', title: t('sunmi.check.fit'), detail: t('sunmi.check.pageScroll', { px: String(v) }) });
  else if (kb) out.push({ id: 'fit', verdict: 'NOT_TESTED', title: t('sunmi.check.fit'), detail: t('sunmi.check.keyboardOpen') });
  else out.push({ id: 'fit', verdict: v > 1 ? (certified ? 'FAIL' : 'WARN') : 'PASS', title: t('sunmi.check.fit'),
    detail: v > 1 ? t('sunmi.check.scrollsBy', { px: String(v) }) : t('sunmi.check.noScroll'), remedy: v > 1 ? t('sunmi.fix.vertical') : undefined });
  out.push({ id: 'horizontal', verdict: h > 1 ? 'FAIL' : 'PASS', title: t('sunmi.check.horizontal'),
    detail: h > 1 ? t('sunmi.check.scrollsBy', { px: String(h) }) : t('sunmi.check.noScroll'), remedy: h > 1 ? t('sunmi.fix.horizontal') : undefined });

  // 3 — module preservation (registry)
  if (!c.page) out.push({ id: 'modules', verdict: 'NOT_TESTED', title: t('sunmi.check.modules'), detail: t('sunmi.check.unregistered') });
  else {
    const missing = c.modules.filter((m) => !m.present), hidden = c.modules.filter((m) => m.present && !m.visible);
    const outside = c.modules.filter((m) => m.present && m.visible && !m.inView);
    const few = c.modules.filter((m) => m.present && m.minChildren != null && m.children < m.minChildren);
    out.push({ id: 'modules', verdict: missing.length || hidden.length ? 'FAIL' : 'PASS', title: t('sunmi.check.modules'),
      detail: t('sunmi.check.modulesDetail', { ok: String(c.modules.length - missing.length - hidden.length), total: String(c.modules.length) }),
      remedy: missing.length || hidden.length ? t('sunmi.fix.restore') : undefined, modules: [...missing, ...hidden].map((m) => m.label) });
    if (!kb && !pageScroll) out.push({ id: 'in-view', verdict: outside.length ? (certified ? 'FAIL' : 'WARN') : 'PASS', title: t('sunmi.check.inView'),
      detail: outside.length ? t('sunmi.check.outside', { n: String(outside.length) }) : t('sunmi.check.allInView'),
      remedy: outside.length ? t('sunmi.fix.inView') : undefined, modules: outside.map((m) => m.label) });
    if (few.length) out.push({ id: 'counts', verdict: 'FAIL', title: t('sunmi.check.counts'), detail: few.map((m) => `${m.label}: ${m.children}/${m.minChildren}`).join(' · '), remedy: t('sunmi.fix.counts'), modules: few.map((m) => m.label) });
    // 4 — overlapping modules (one inside another is nesting, not overlap)
    const shown = c.modules.filter((m) => m.present && m.visible && m.rect) as (CollectedModule & { rect: Rect })[];
    const pairs: string[] = [];
    for (let i = 0; i < shown.length; i++) for (let j = i + 1; j < shown.length; j++) {
      const a = shown[i].rect, b = shown[j].rect;
      if (contains(a, b) || contains(b, a)) continue;
      if (overlapArea(a, b) > 16) pairs.push(`${shown[i].label} × ${shown[j].label}`);
    }
    out.push({ id: 'overlap', verdict: pairs.length ? 'FAIL' : 'PASS', title: t('sunmi.check.overlap'), detail: pairs.length ? pairs.slice(0, 4).join(' · ') : t('sunmi.check.noOverlap'), remedy: pairs.length ? t('sunmi.fix.overlap') : undefined });
    // 5 — balance: peers on one row with very different heights (more than 25 %) look accidental
    const rows = peerRows(shown.map((m) => ({ id: m.label, rect: m.rect }))).filter((r) => r.minH > 0 && r.maxH / r.minH > 1.25);
    out.push({ id: 'balance', verdict: rows.length ? 'WARN' : 'PASS', title: t('sunmi.check.balance'),
      detail: rows.length ? rows.map((r) => `${r.ids.join(' / ')} (${r.minH}–${r.maxH} px)`).slice(0, 3).join(' · ') : t('sunmi.check.balanced'),
      remedy: rows.length ? t('sunmi.fix.balance') : undefined });
  }

  // 6 — controls: clipped text and touch targets
  out.push({ id: 'clipped', verdict: c.clipped.length ? 'WARN' : 'PASS', title: t('sunmi.check.clipped'),
    detail: c.clipped.length ? c.clipped.slice(0, 4).map((x) => `“${x.text}”`).join(' · ') : t('sunmi.check.noClipped'), remedy: c.clipped.length ? t('sunmi.fix.clipped') : undefined });
  out.push({ id: 'touch', verdict: c.smallTargets.length ? 'WARN' : 'PASS', title: t('sunmi.check.touch'),
    detail: c.smallTargets.length ? t('sunmi.check.smallTargets', { n: String(c.smallTargets.length), list: c.smallTargets.slice(0, 3).map((x) => `“${x.text}” ${x.w}×${x.h}`).join(' · ') }) : t('sunmi.check.touchOk'),
    remedy: c.smallTargets.length ? t('sunmi.fix.touch') : undefined });

  // 7 — realtime connection and data freshness (the same signals as the status pill)
  const rt = c.realtime;
  const stale = rt.lastErrorAt != null && (rt.lastSyncedAt == null || rt.lastErrorAt > rt.lastSyncedAt);
  out.push({ id: 'realtime', verdict: rt.status !== 'CONNECTED' || stale ? 'WARN' : rt.lastSyncedAt == null ? 'NOT_TESTED' : 'PASS', title: t('sunmi.check.realtime'),
    detail: t('sunmi.check.realtimeDetail', { status: t('admin.realtime.' + rt.status) === 'admin.realtime.' + rt.status ? rt.status : t('admin.realtime.' + rt.status), at: rt.lastSyncedAt ? new Date(rt.lastSyncedAt).toLocaleTimeString() : '—' }),
    remedy: rt.status !== 'CONNECTED' || stale ? t('sunmi.fix.realtime') : undefined });
  return out;
}

/** The overall verdict: any FAIL → FAIL, else any WARN → WARN, else PASS. */
export function overallVerdict(f: Finding[]): Verdict {
  if (f.some((x) => x.verdict === 'FAIL')) return 'FAIL';
  if (f.some((x) => x.verdict === 'WARN')) return 'WARN';
  return 'PASS';
}

/** Read the open screen from the DOM (browser only). */
export function collectScreen(doc: Document, route: string, profile: DisplayProfile, realtime: Collected['realtime']): Collected {
  const page = registryPageFor(route);
  const main = doc.querySelector('.main') as HTMLElement | null;
  const top = doc.querySelector('.main > .topbar') as HTMLElement | null;
  const root = main ? ([...main.children].find((c) => !c.classList.contains('topbar') && !c.classList.contains('community-alert-slot') && c.getBoundingClientRect().height > 0) as HTMLElement | undefined) : undefined;
  const mr = main?.getBoundingClientRect();
  const win = doc.defaultView!;
  const content = { left: mr?.left ?? 0, top: top ? top.getBoundingClientRect().bottom : (mr?.top ?? 0), right: mr?.right ?? win.innerWidth, bottom: Math.min(mr?.bottom ?? win.innerHeight, win.innerHeight) };
  const vis = (el: Element) => { const r = el.getBoundingClientRect(); const cs = win.getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'; };
  const se = (doc.scrollingElement ?? doc.documentElement) as HTMLElement;   // old WebViews / jsdom have no scrollingElement
  const scroll = {
    docY: Math.max(0, se.scrollHeight - se.clientHeight), docX: Math.max(0, se.scrollWidth - se.clientWidth),
    mainY: main ? Math.max(0, main.scrollHeight - main.clientHeight) : 0, mainX: main ? Math.max(0, main.scrollWidth - main.clientWidth) : 0,
    rootY: root ? Math.max(0, root.scrollHeight - root.clientHeight) : 0, rootX: root ? Math.max(0, root.scrollWidth - root.clientWidth) : 0,
  };
  const find = (id: string) => main?.querySelector(`[data-module-id="${CSS.escape(id)}"]`) ?? main?.querySelector(`[data-testid="${CSS.escape(id)}"]`) ?? null;
  const modules: CollectedModule[] = (page?.modules ?? []).map((m) => {
    const el = find(m.id);
    if (!el) return { id: m.id, label: m.label, present: false, visible: false, inView: false, rect: null, children: 0, minChildren: m.minItems ?? null };
    const r = el.getBoundingClientRect();
    const isVis = vis(el);
    const inView = isVis && r.left >= content.left - 1 && r.right <= content.right + 1 && r.top >= content.top - 1 && r.bottom <= content.bottom + 1;
    return { id: m.id, label: m.label, present: true, visible: isVis, inView, rect: { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }, children: (m.items ? [...el.querySelectorAll(m.items)] : [...el.children]).filter(vis).length, minChildren: m.minItems ?? null };
  });
  const smallTargets: Collected['smallTargets'] = [], clipped: Collected['clipped'] = [];
  for (const el of (main?.querySelectorAll('button, [role="tab"], a.btn, .btn') ?? []) as NodeListOf<HTMLElement>) {
    if (!vis(el) || (root && !root.contains(el))) continue;
    const r = el.getBoundingClientRect(); const cs = win.getComputedStyle(el);
    const text = (el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 40);
    if (r.height < 44 || r.width < 44) {
      // a §78 hit area (transparent ::after / ::before reaching 44 px) makes a compact control a full target
      const pseudo = ['::after', '::before'].some((p) => { try { const ps = win.getComputedStyle(el, p); return ps.content !== 'none' && ps.content !== '' && ps.position === 'absolute'; } catch { return false; } });
      if (!pseudo && (r.height < 32 || r.width < 32)) smallTargets.push({ text, w: Math.round(r.width), h: Math.round(r.height) });
    }
    const ell = cs.textOverflow === 'ellipsis' || [...el.querySelectorAll('*')].some((c) => win.getComputedStyle(c).textOverflow === 'ellipsis');
    if (!ell && text.length > 1 && (el.scrollWidth - el.clientWidth > 2 || el.scrollHeight - el.clientHeight > 3)) clipped.push({ text });
  }
  return { route, page, profile, scroll, modules, smallTargets, clipped, realtime };
}
