/**
 * displayProfile.ts — the SUNMI FLEX 3 mandates (Nov 6 2026, every one of the 19 guides §"automatic fit" + the Full-System
 * addendum §06 / recommendation 1 "Automatic Device Profile").
 *
 * ONE shared, read-only measurement of the screen the POS is actually running on:
 *   • the real CSS viewport (innerWidth / innerHeight), the visual viewport (Android soft keyboard, pinch), devicePixelRatio,
 *     the physical screen, orientation, fullscreen / installed-app mode, touch;
 *   • the content box the screens really get (the shell's .main minus the top bar);
 *   • a DENSITY mode derived from the usable CSS size — never from a device name or user agent:
 *       comfortable  ≥ 2200 × 1200 CSS px            (2560 × 1440 desktops)
 *       compact      ≥ 1700 × 900                    (the SUNMI FLEX 3 27″ at DPR 1: 1920 × 1080 kiosk / ≈1920 × 952 in
 *                                                     Chrome with the Android bars; Windows 1920 × 1080 with browser chrome
 *                                                     + taskbar = 1920 × 945 — the primary certification)
 *       tight        ≥ 1280 × 560                    (1600 × 900, 1366 × 768, a DPR-1.5 Android 1280 × 720 panel)
 *       fallback     anything smaller               (readable responsive fallback; local scrolling allowed)
 *   • whether the soft keyboard is open (the visual viewport is much shorter than the layout viewport).
 *
 * It writes ATTRIBUTES and CSS VARIABLES on <html> (data-density, data-keyboard, data-display-mode, --pos-vvh,
 * --pos-kb-inset) — it never re-renders React and it never changes zoom, scale or the browser's resolution (the mandates
 * forbid transform:scale / CSS zoom / browser zoom). The existing page grids keep owning their layout through their
 * media queries; the density name is the same breakpoint family expressed once, for the Screen Check overlay, for new CSS
 * and for the e2e reports.
 *
 * Keyboard: Android Chrome resizes only the VISUAL viewport when the on-screen keyboard opens. When a field gets focus
 * under the keyboard, it is scrolled into the visible part of its own scroll container (block: 'nearest' — the page shell
 * never moves) and dialogs are capped at the visible height through --pos-vvh. Nothing about a transaction, a selection or
 * a form changes; when the keyboard closes the attributes go back and the layout is the original one.
 */
export type Density = 'comfortable' | 'compact' | 'tight' | 'fallback';

export interface DisplayProfile {
  innerW: number; innerH: number;
  vvW: number; vvH: number; vvTop: number;
  dpr: number;
  screenW: number; screenH: number;
  orientation: 'landscape' | 'portrait';
  displayMode: 'browser' | 'fullscreen' | 'standalone';
  touch: boolean;
  keyboardOpen: boolean;
  contentW: number; contentH: number;
  headerH: number; sidebarW: number;
  density: Density;
  measuredAt: number;
}

/** The density for a usable CSS size. Pure; the single definition (tests pin the SUNMI / Windows profiles). */
export function densityFor(w: number, h: number): Density {
  if (w >= 2200 && h >= 1200) return 'comfortable';
  if (w >= 1700 && h >= 900) return 'compact';
  if (w >= 1280 && h >= 560) return 'tight';
  return 'fallback';
}

/** The soft keyboard (or another inset) is open when the visual viewport is ≥ 150 px and ≥ 20 % shorter than the layout viewport. */
export function keyboardOpenFor(innerH: number, vvH: number): boolean {
  const lost = innerH - vvH;
  return lost >= 150 && lost >= innerH * 0.2;
}

/** The certified test profiles (the e2e matrix and the Screen Check "profile preview" read these). */
export const DISPLAY_PROFILES: { id: string; w: number; h: number; note: string }[] = [
  { id: 'windows-1080-browser', w: 1920, h: 945, note: 'Windows 1920×1080, Edge/Chrome tabs + address bar + taskbar visible (primary)' },
  { id: 'sunmi-flex3-chrome', w: 1920, h: 952, note: 'SUNMI FLEX 3 27″, Android 13 Chrome, status + toolbar + navigation bars (DPR 1)' },
  { id: 'sunmi-flex3-kiosk', w: 1920, h: 1032, note: 'SUNMI FLEX 3 27″, kiosk / installed web app, navigation bar visible (DPR 1)' },
  { id: 'sunmi-flex3-full', w: 1920, h: 1080, note: 'SUNMI FLEX 3 27″, immersive full screen (DPR 1)' },
  { id: 'desktop-1440p', w: 2560, h: 1440, note: '2560×1440 desktop (comfortable)' },
  { id: 'desktop-900p', w: 1600, h: 900, note: '1600×900 (tight)' },
  { id: 'laptop-768', w: 1366, h: 768, note: '1366×768 (tight fallback)' },
  { id: 'sunmi-flex3-dpr15-chrome', w: 1280, h: 592, note: 'SUNMI FLEX 3 if the panel runs at DPR 1.5: 1280×720 minus the Android bars (fallback report)' },
];

let current: DisplayProfile | null = null;
const listeners = new Set<(p: DisplayProfile) => void>();

/** The last measurement (null before the shell mounted). */
export function displayProfile(): DisplayProfile | null { return current; }
/** Subscribe to profile changes (the Screen Check overlay); returns the unsubscribe. */
export function onDisplayProfile(fn: (p: DisplayProfile) => void): () => void { listeners.add(fn); return () => listeners.delete(fn); }

/** Measure the document now. Exported for the Screen Check overlay and tests. */
export function measureDisplay(doc: Document = document, win: Window & typeof globalThis = window): DisplayProfile {
  const vv = win.visualViewport;
  const innerW = win.innerWidth, innerH = win.innerHeight;
  const vvW = vv ? Math.round(vv.width) : innerW, vvH = vv ? Math.round(vv.height) : innerH, vvTop = vv ? Math.round(vv.offsetTop) : 0;
  const main = doc.querySelector('.main') as HTMLElement | null;
  const header = doc.querySelector('.main > .topbar') as HTMLElement | null;
  const sidebar = doc.querySelector('.sidebar') as HTMLElement | null;
  const headerH = header ? Math.round(header.getBoundingClientRect().height) : 0;
  const mainR = main?.getBoundingClientRect();
  const contentW = mainR ? Math.round(mainR.width) : innerW;
  const contentH = mainR ? Math.round(mainR.height) - headerH : innerH - headerH;
  const sidebarW = sidebar ? Math.round(sidebar.getBoundingClientRect().width) : 0;
  const mm = (q: string) => { try { return win.matchMedia?.(q).matches ?? false; } catch { return false; } };
  const displayMode: DisplayProfile['displayMode'] = doc.fullscreenElement || mm('(display-mode: fullscreen)') ? 'fullscreen' : mm('(display-mode: standalone)') ? 'standalone' : 'browser';
  return {
    innerW, innerH, vvW, vvH, vvTop,
    dpr: Math.round((win.devicePixelRatio || 1) * 100) / 100,
    screenW: win.screen?.width ?? innerW, screenH: win.screen?.height ?? innerH,
    orientation: innerW >= innerH ? 'landscape' : 'portrait',
    displayMode,
    touch: mm('(pointer: coarse)') || (win.navigator?.maxTouchPoints ?? 0) > 0,
    keyboardOpen: keyboardOpenFor(innerH, vvH),
    contentW, contentH, headerH, sidebarW,
    density: densityFor(innerW, innerH),
    measuredAt: Date.now(),
  };
}

function apply(p: DisplayProfile, root: HTMLElement): void {
  const set = (k: string, v: string) => { if (root.getAttribute(k) !== v) root.setAttribute(k, v); };
  set('data-density', p.density);
  set('data-keyboard', p.keyboardOpen ? 'open' : 'closed');
  set('data-display-mode', p.displayMode);
  set('data-touch', p.touch ? 'on' : 'off');
  root.style.setProperty('--pos-vvh', `${p.vvH}px`);
  root.style.setProperty('--pos-kb-inset', `${Math.max(0, p.innerH - p.vvH - p.vvTop)}px`);
}

const same = (a: DisplayProfile | null, b: DisplayProfile) => !!a && a.innerW === b.innerW && a.innerH === b.innerH && a.vvW === b.vvW && a.vvH === b.vvH
  && a.vvTop === b.vvTop && a.dpr === b.dpr && a.contentW === b.contentW && a.contentH === b.contentH && a.displayMode === b.displayMode && a.headerH === b.headerH && a.sidebarW === b.sidebarW;

/**
 * Start measuring (the shell calls this once). One rAF-throttled measure per burst of events, attribute writes only when a
 * value changed, the ResizeObserver watches the shell boxes (not the page content — no observer loop). Returns the stop.
 */
export function startDisplayProfile(win: Window & typeof globalThis = window): () => void {
  const doc = win.document; const root = doc.documentElement;
  let raf = 0;
  const run = () => {
    raf = 0;
    const p = measureDisplay(doc, win);
    if (same(current, p)) return;
    const wasOpen = current?.keyboardOpen ?? false;
    current = p; apply(p, root);
    for (const l of listeners) { try { l(p); } catch { /* a listener never breaks measuring */ } }
    if (p.keyboardOpen && !wasOpen) keepFocusVisible(doc, p);
    if (!p.keyboardOpen && wasOpen) restoreAfterKeyboard();
  };
  const schedule = () => { if (!raf) raf = win.requestAnimationFrame ? win.requestAnimationFrame(run) : (setTimeout(run, 16) as unknown as number); };
  const onFocus = (e: FocusEvent) => { if (current?.keyboardOpen) keepFocusVisible(doc, current, e.target as Element); };
  run();
  win.addEventListener('resize', schedule);
  win.addEventListener('orientationchange', schedule);
  doc.addEventListener('fullscreenchange', schedule);
  doc.addEventListener('focusin', onFocus);
  win.visualViewport?.addEventListener('resize', schedule);
  win.visualViewport?.addEventListener('scroll', schedule);
  let ro: ResizeObserver | null = null;
  if (typeof ResizeObserver !== 'undefined') {
    ro = new ResizeObserver(schedule);
    for (const sel of ['.main', '.main > .topbar', '.sidebar']) { const el = doc.querySelector(sel); if (el) ro.observe(el); }
  }
  return () => {
    if (raf && win.cancelAnimationFrame) win.cancelAnimationFrame(raf);
    win.removeEventListener('resize', schedule);
    win.removeEventListener('orientationchange', schedule);
    doc.removeEventListener('fullscreenchange', schedule);
    doc.removeEventListener('focusin', onFocus);
    win.visualViewport?.removeEventListener('resize', schedule);
    win.visualViewport?.removeEventListener('scroll', schedule);
    ro?.disconnect();
  };
}

/**
 * A focused text field under the soft keyboard is brought into the visible part of its scroll container. scrollIntoView
 * also scrolls overflow:hidden ancestors (the one-screen shell), so their offsets are remembered first and put back when
 * the keyboard closes — the page returns to exactly its original geometry.
 */
const shifted = new Map<HTMLElement, { top: number; left: number }>();
function keepFocusVisible(doc: Document, p: DisplayProfile, target?: Element | null): void {
  const el = (target ?? doc.activeElement) as HTMLElement | null;
  if (!el || !el.matches?.('input, textarea, select, [contenteditable="true"]')) return;
  const r = el.getBoundingClientRect();
  const visibleBottom = p.vvTop + p.vvH;
  if (r.bottom > visibleBottom - 8 || r.top < p.vvTop) {
    for (let a = el.parentElement; a && a !== doc.documentElement; a = a.parentElement) {
      const cs = doc.defaultView?.getComputedStyle(a);
      if (cs && /hidden|clip/.test(cs.overflowY + cs.overflowX) && !shifted.has(a)) shifted.set(a, { top: a.scrollTop, left: a.scrollLeft });
    }
    try { el.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch { /* old engines */ }
  }
}
/** The keyboard closed: the shell containers that were scrolled for it go back to where they were. */
export function restoreAfterKeyboard(): void {
  for (const [a, s] of shifted) { a.scrollTop = s.top; a.scrollLeft = s.left; }
  shifted.clear();
}
