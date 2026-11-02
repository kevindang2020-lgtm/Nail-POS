/**
 * hitSlop.ts — English + Vietnamese POS mandate §78 (touch targets ~44 px), Oct 27 2026.
 *
 * Kevin's decision: keep the one-screen fit. The compact controls (15–25 px tall at the 1920 one-screen density) keep their
 * visual size and their place in the layout; what grows is the area a finger can hit. Each compact control gets a
 * transparent ::after (or ::before, when the component already uses ::after) that reaches 44 × 44 px around it — but never
 * into another control's area: where two controls sit closer than 44 px the space between them is split, so each gets the
 * largest hit area that does not overlap its neighbour (a finger between two buttons still lands on exactly one).
 *
 * Nothing here changes layout: the pseudo-element is absolutely positioned and transparent; a static control becomes
 * position: relative (no offsets — same box), and a control whose own overflow would clip the pseudo-element, or whose
 * absolutely positioned child would move if the control became positioned, is left alone (listed by the browser check).
 * The hit area also stays inside the scroll extent of every scrolling ancestor, so it never adds a scrollbar.
 *
 * CSS: styles.css → "§78 hit areas". Browser check: tooling/e2e/pos-vi-one-screen.mjs → measureHitAreas.
 * Escape hatch for a measurement: <html data-hitslop="off"> switches the CSS off.
 */
export const HIT_MIN = 44;

export type Box = { left: number; top: number; right: number; bottom: number };
export type Slop = { t: number; r: number; b: number; l: number };

const overlaps1d = (a0: number, a1: number, b0: number, b1: number) => Math.min(a1, b1) - Math.max(a0, b0) > 0;

/**
 * Pure layout maths. `boxes[i]` is a control's border box; `grow[i]` says whether it should grow (false = an obstacle such
 * as a text field: never grows, but nothing may grow into it); `bounds[i]` is the box the hit area must stay inside.
 * Returns, per control, how many px the hit area extends beyond each side (≥ 0, fractional: boxes sit on sub-pixels).
 */
export function computeSlop(boxes: Box[], grow: boolean[], bounds: (Box | null)[], min = HIT_MIN): Slop[] {
  const n = boxes.length;
  const s: Slop[] = boxes.map((b, i) => {
    if (!grow[i]) return { t: 0, r: 0, b: 0, l: 0 };
    // fractional px on purpose: boxes sit on sub-pixel positions, and rounding would leave a 1 px gap short of 44
    const dx = Math.max(0, (min - (b.right - b.left)) / 2), dy = Math.max(0, (min - (b.bottom - b.top)) / 2);
    let t = dy, bo = dy, l = dx, r = dx;
    const B = bounds[i];
    if (B) { t = Math.min(t, Math.max(0, b.top - B.top)); bo = Math.min(bo, Math.max(0, B.bottom - b.bottom)); l = Math.min(l, Math.max(0, b.left - B.left)); r = Math.min(r, Math.max(0, B.right - b.right)); }
    return { t, r, b: bo, l };
  });
  // split a gap between two facing sides: each keeps what it wants if both fit; otherwise the smaller want is kept when it
  // is under half the gap and the other takes the rest; else both get half — the two areas meet, never overlap
  const split = (gap: number, a: number, b: number): [number, number] => {
    const g = Math.max(0, gap);
    if (a + b <= g) return [a, b];
    const h = g / 2;
    if (a <= h) return [a, g - a];
    if (b <= h) return [g - b, b];
    return [h, h];
  };
  const order = [...Array(n).keys()].sort((x, y) => boxes[x].top - boxes[y].top);
  const reach = min * 2;
  // pass 1: side-by-side neighbours (vertical projections overlap with the vertical growth) → split horizontal gaps
  // pass 2: stacked neighbours (horizontal projections overlap with the final horizontal growth) → split vertical gaps
  for (const pass of [1, 2] as const) {
    for (let oi = 0; oi < n; oi++) {
      const i = order[oi]; const a = boxes[i];
      for (let oj = oi + 1; oj < n; oj++) {
        const j = order[oj]; const b = boxes[j];
        if (b.top - a.bottom > reach) break;
        if (!grow[i] && !grow[j]) continue;
        // nested or already overlapping controls: nothing sensible to split
        if (overlaps1d(a.left, a.right, b.left, b.right) && overlaps1d(a.top, a.bottom, b.top, b.bottom)) continue;
        const sa = s[i], sb = s[j];
        if (pass === 1) {
          if (!overlaps1d(a.top - sa.t, a.bottom + sa.b, b.top - sb.t, b.bottom + sb.b)) continue;
          if (b.left >= a.right) { [sa.r, sb.l] = split(b.left - a.right, sa.r, sb.l); }
          else if (a.left >= b.right) { [sb.r, sa.l] = split(a.left - b.right, sb.r, sa.l); }
        } else {
          if (!overlaps1d(a.left - sa.l, a.right + sa.r, b.left - sb.l, b.right + sb.r)) continue;
          if (b.top >= a.bottom) { [sa.b, sb.t] = split(b.top - a.bottom, sa.b, sb.t); }
          else if (a.top >= b.bottom) { [sb.b, sa.t] = split(a.top - b.bottom, sb.b, sa.t); }
          else {
            // side by side but their vertical growth overlaps diagonally after pass 1 trimmed nothing: keep them apart
            // horizontally (pass 1 already split that gap) — nothing to do
          }
        }
      }
    }
  }
  return s;
}

// ── DOM ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
/** Controls that grow. Text fields / selects are obstacles: they keep their own (already ≥ 30 px) box. */
export const GROW_SELECTOR = ['button', '[role="tab"]', '[role="button"]', 'a[href]'].join(',');   // CSS selectors, not text
const OBSTACLE_SELECTOR = ['input', 'select', 'textarea'].join(',');

type Mode = 'a' | 'b' | null;   // ::after, ::before, or none (skipped)
const modeCache = new WeakMap<Element, { mode: Mode; why?: string; makeRel: boolean }>();

function inspect(el: HTMLElement): { mode: Mode; why?: string; makeRel: boolean } {
  const hit = modeCache.get(el); if (hit) return hit;
  const cs = getComputedStyle(el);
  let out: { mode: Mode; why?: string; makeRel: boolean };
  if (cs.display === 'contents' || cs.display === 'inline') out = { mode: null, why: 'inline', makeRel: false };
  else if (CLIPS.test(`${cs.overflow} ${cs.overflowX} ${cs.overflowY}`)) out = { mode: null, why: 'own-overflow', makeRel: false };
  else {
    const free = (p: string) => { const c = getComputedStyle(el, p).content; return !c || c === 'none' || c === 'normal'; };
    const mode: Mode = free('::after') ? 'a' : free('::before') ? 'b' : null;
    const makeRel = cs.position === 'static';
    // a static control with an absolutely positioned child: making it positioned would move the child — leave it
    const absChild = makeRel && [...el.querySelectorAll<HTMLElement>('*')].some((c) => { const p = getComputedStyle(c).position; return p === 'absolute' || p === 'fixed'; });
    out = mode == null ? { mode: null, why: 'pseudo-taken', makeRel: false } : absChild ? { mode: null, why: 'abs-child', makeRel: false } : { mode, makeRel };
  }
  modeCache.set(el, out);
  return out;
}

const CLIPS = /hidden|clip|auto|scroll/;

/** The box the hit area must stay inside: the viewport ∩ the scroll extent of every clipping ancestor. */
function boundsOf(el: HTMLElement): Box {
  let L = 0, T = 0, R = window.innerWidth, B = window.innerHeight;
  for (let p = el.parentElement; p && p !== document.documentElement; p = p.parentElement) {
    const cs = getComputedStyle(p);
    if (cs.position === 'fixed') { const r = p.getBoundingClientRect(); L = Math.max(L, r.left); T = Math.max(T, r.top); R = Math.min(R, r.right); B = Math.min(B, r.bottom); break; }
    const cx = CLIPS.test(cs.overflowX), cy = CLIPS.test(cs.overflowY);
    if (!cx && !cy) continue;
    const r = p.getBoundingClientRect();
    const left = r.left + p.clientLeft - p.scrollLeft, top = r.top + p.clientTop - p.scrollTop;
    if (cx) { L = Math.max(L, left); R = Math.min(R, left + Math.max(p.scrollWidth, p.clientWidth)); }
    if (cy) { T = Math.max(T, top); B = Math.min(B, top + Math.max(p.scrollHeight, p.clientHeight)); }
  }
  return { left: L, top: T, right: R, bottom: B };
}

const visible = (r: DOMRect) => r.width > 0 && r.height > 0;

/** One pass over the document: measure, compute, write the CSS variables. Returns what it did (for tests / the check). */
export function applyHitSlop(root: ParentNode = document): { grown: number; skipped: Record<string, number> } {
  const skipped: Record<string, number> = {};
  const growEls = [...root.querySelectorAll<HTMLElement>(GROW_SELECTOR)];
  const items: { el: HTMLElement; box: Box; grow: boolean; mode: Mode; makeRel: boolean }[] = [];
  for (const el of growEls) {
    const r = el.getBoundingClientRect();
    if (!visible(r)) { clear(el); continue; }
    const small = r.width < HIT_MIN || r.height < HIT_MIN;
    const info = small ? inspect(el) : { mode: null as Mode, makeRel: false };
    if (small && info.mode == null) { skipped[(info as { why?: string }).why ?? 'other'] = (skipped[(info as { why?: string }).why ?? 'other'] ?? 0) + 1; clear(el); }
    items.push({ el, box: { left: r.left, top: r.top, right: r.right, bottom: r.bottom }, grow: small && info.mode != null, mode: info.mode, makeRel: info.makeRel });
  }
  for (const el of root.querySelectorAll<HTMLElement>(OBSTACLE_SELECTOR)) {
    const r = el.getBoundingClientRect(); if (!visible(r)) continue;
    items.push({ el, box: { left: r.left, top: r.top, right: r.right, bottom: r.bottom }, grow: false, mode: null, makeRel: false });
  }
  const slop = computeSlop(items.map((x) => x.box), items.map((x) => x.grow), items.map((x) => (x.grow ? boundsOf(x.el) : null)));
  let grown = 0;
  items.forEach((x, i) => {
    if (!x.grow) { if (!x.el.matches(OBSTACLE_SELECTOR) && x.el.hasAttribute('data-hs')) clear(x.el); return; }
    const s = slop[i];
    if (!s.t && !s.r && !s.b && !s.l) { clear(x.el); return; }
    grown++;
    // the pseudo-element is placed from the padding box: add the border so the numbers mean "beyond the border edge"
    const cs = getComputedStyle(x.el);
    // (negative insets — the CSS is `inset: var(--hs)`)
    const px = (n: number, bw: string) => { const w = Number.parseFloat(bw) || 0; const v = Math.round((n + w) * 100) / 100; return `${-v}px`; };   // CSS lengths, not money
    const v = `${px(s.t, cs.borderTopWidth)} ${px(s.r, cs.borderRightWidth)} ${px(s.b, cs.borderBottomWidth)} ${px(s.l, cs.borderLeftWidth)}`;
    if (x.el.getAttribute('data-hs') !== x.mode) x.el.setAttribute('data-hs', x.mode!);
    if (x.makeRel && !x.el.hasAttribute('data-hs-rel')) x.el.setAttribute('data-hs-rel', '');
    if (x.el.style.getPropertyValue('--hs') !== v) x.el.style.setProperty('--hs', v);
  });
  return { grown, skipped };
}

function clear(el: HTMLElement) {
  if (!el.hasAttribute('data-hs')) return;
  el.removeAttribute('data-hs'); el.removeAttribute('data-hs-rel'); el.style.removeProperty('--hs');
}

/**
 * Keep the hit areas current: after DOM changes (live boards re-render), resizes and scrolls — coalesced to one pass per
 * ~150 ms. The observer ignores attribute changes, so writing the variables never re-triggers it.
 */
export function installHitSlop(win: Window & typeof globalThis = window): () => void {
  if (typeof win.MutationObserver === 'undefined' || typeof win.requestAnimationFrame === 'undefined') return () => undefined;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const schedule = () => { if (timer) return; timer = setTimeout(() => { win.requestAnimationFrame(() => { timer = null; try { applyHitSlop(win.document); } catch { /* never break the POS over a hit area */ } }); }, 150); };
  const mo = new win.MutationObserver(schedule);
  mo.observe(win.document.body, { childList: true, subtree: true, characterData: true });
  win.addEventListener('resize', schedule);
  win.document.addEventListener('scroll', schedule, { capture: true, passive: true });
  win.document.fonts?.ready?.then(schedule).catch(() => undefined);
  schedule();
  return () => { mo.disconnect(); win.removeEventListener('resize', schedule); win.document.removeEventListener('scroll', schedule, { capture: true } as EventListenerOptions); if (timer) clearTimeout(timer); };
}
