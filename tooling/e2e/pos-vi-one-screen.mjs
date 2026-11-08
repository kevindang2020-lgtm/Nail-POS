#!/usr/bin/env node
// pos-vi-one-screen.mjs — English + Vietnamese POS mandate §66–§80 / §111 / §112 (Oct 27 2026): the one-screen
// certification of the nine primary POS modules, in a REAL Chromium, against the BUILT POS (apps/pos-web/dist) and the
// REAL API (apps/api/dist) on PostgreSQL, in English AND Vietnamese, with the body font the POS really ships
// ('Hanken Grotesk', Kevin's Oct 26 decision — the Google Fonts files are served to the page from a local cache so the
// run is deterministic and offline-safe; the check FAILS if the font did not load or lacks Vietnamese glyphs).
//
// Per module × language × viewport it measures (measureOneScreen):
//   • page: no horizontal or vertical scroll of the document;
//   • one screen (§66): the module's own scroll owner (the shell's .main or the screen's root) does not scroll vertically
//     at the primary viewport (1920 × 1080 screen, browser chrome + taskbar → a 1920 × 945 page) — the critical controls are visible without scrolling — and never horizontally at any viewport;
//   • no clipped / spilling text in buttons, pills, tabs and KPI labels (an ellipsis or a line-clamp is allowed, §76);
//   • no two primary controls overlap;
//   • touch targets (§78): the smallest button height in Vietnamese is not below the English one on the same screen;
//   • fonts (§43/§77): Hanken Grotesk loaded with Vietnamese glyphs; body font size unchanged between languages;
//   • a leftover-English scan of the Vietnamese screen (reported; salon data is English by nature).
// Screenshots: $SHOTS/<state>-<module>-<lang>-<w>x<h>.png. Results: $OUT (JSON) + stdout.
//
// CLI (the EMPTY / LIGHT state on a seeded database):
//   DATABASE_URL=postgres://…/<scratch with PILOT01> CHROMIUM_PATH=/opt/pw-browsers/chromium STATE=light \
//     SHOTS=docs/pilot-runs/2026-10-27-vietnamese/one-screen node tooling/e2e/pos-vi-one-screen.mjs
// The BUSY state (200 technicians, a full floor, an UNKNOWN card payment) runs inside the pilot day
// (apps/api/scripts/lib/pilot-vietnamese.mjs), which imports runOneScreenMatrix from this file.
import { spawn, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { createServer, request as httpRequest } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = new URL('../../', import.meta.url).pathname;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The nine primary modules (mandate §111) and the text that proves each screen rendered. */
export const MODULES = [
  { key: 'overview', path: '/overview', label: 'OVERVIEW' },
  { key: 'live-ops', path: '/live-operations', label: 'LIVE OPS' },
  { key: 'check-in', path: '/check-in', label: 'CHECK-IN' },
  { key: 'booking', path: '/booking', label: 'BOOKING' },
  { key: 'tech-queue', path: '/tech-queue', label: 'TECH QUEUE' },
  { key: 'queue', path: '/queue', label: 'CUSTOMER QUEUE' },
  { key: 'serving', path: '/serving', label: 'SERVING' },
  { key: 'service-done', path: '/service-done', label: 'SERVICE DONE' },
  { key: 'checkout', path: '/checkout', label: 'CHECKOUT' },
];
// The mandate's primary certification (§ Target Platform, §126 G): a 27-inch 1920 × 1080 screen at 100% zoom WITH the browser
// chrome and the Windows taskbar visible — the page itself gets 1920 × 945 (1080 − Chrome's tab strip + address bar ≈ 87 px −
// the Windows 11 taskbar 48 px). 1920 × 1080 (a kiosk / full-screen browser) and the smaller screens are report rows.
export const PRIMARY = [1920, 945];
// SUNMI FLEX 3 27″ (Nov 6 2026 mandates): Android 13 Chrome at DPR 1 gives ≈1920 × 952 (status + toolbar + navigation
// bars) and ≈1920 × 1032 as a kiosk / installed web app with the navigation bar; full screen is 1920 × 1080. These are
// CERTIFIED like the primary: no vertical page scroll, every registered module inside the viewport. The physical device
// itself stays NOT_TESTED until it is in front of us.
export const SUNMI = [[1920, 952], [1920, 1032]];
export const CERTIFIED = [PRIMARY, ...SUNMI, [1920, 1080]];
export const VIEWPORTS = [PRIMARY, ...SUNMI, [2560, 1440], [1920, 1080], [1600, 900], [1366, 768], [1280, 800]];
const isCertified = (w, h) => CERTIFIED.some(([cw, ch]) => cw === w && ch === h);
/** The module registry (apps/pos-web/src/shell/module-registry.json): page key → registered modules. */
export const REGISTRY = JSON.parse(readFileSync(new URL('../../apps/pos-web/src/shell/module-registry.json', import.meta.url), 'utf8'));
/** The finance and customer pages of the first SUNMI guides (MODULE_SET=extra; MODULE_SET=all adds them to the nine). */
export const EXTRA_MODULES = [
  { key: 'payroll', path: '/tenant/team/payroll', label: 'WEEKLY PAYCHECK' },
  { key: 'expenses', path: '/tenant/payments/expenses', label: 'EXPENSES' },
  { key: 'invoices', path: '/tenant/payments/invoices', label: 'INVOICES' },
  { key: 'settlements', path: '/tenant/payments/settlements', label: 'DEPOSITS & SETTLEMENTS' },
  { key: 'deposit-recon', path: '/tenant/payments/deposit-reconciliation', label: 'DEPOSIT RECONCILIATION' },
  { key: 'receipt-review', path: '/tenant/ai/ocr-receipt', label: 'RECEIPT REVIEW' },
  { key: 'receipt-scanner', path: '/tenant/ai/receipt-scanner', label: 'RECEIPT SCANNER' },
  { key: 'loyalty', path: '/tenant/customers/loyalty', label: 'LOYALTY' },
  { key: 'retention', path: '/tenant/customers/retention', label: 'RETENTION' },
  { key: 'memberships', path: '/tenant/customers/memberships', label: 'MEMBERSHIPS' },
  { key: 'customers', path: '/customers', label: 'CUSTOMERS' },
];
/** SUNMI batch 2 (Kevin's Nov 7 2026 PDFs): catalog, inventory and money pages (MODULE_SET=batch2; MODULE_SET=all adds them too). */
export const BATCH2_MODULES = [
  { key: 'services', path: '/services', label: 'SERVICES & PRODUCTS' },
  { key: 'svc-categories', path: '/tenant/services/categories', label: 'SERVICE CATEGORIES' },
  { key: 'svc-pricing', path: '/tenant/services/pricing', label: 'SERVICE PRICING' },
  { key: 'svc-addons', path: '/tenant/services/add-ons', label: 'ADD-ONS' },
  { key: 'discounts', path: '/tenant/services/discounts', label: 'DISCOUNTS' },
  { key: 'products', path: '/tenant/products', label: 'PRODUCTS' },
  { key: 'inventory', path: '/tenant/inventory', label: 'INVENTORY' },
  { key: 'suppliers', path: '/tenant/inventory/vendors', label: 'SUPPLIERS' },
  { key: 'stock-alerts', path: '/tenant/inventory/alerts', label: 'STOCK ALERTS' },
  { key: 'payments', path: '/tenant/payments/overview', label: 'PAYMENTS & MONEY' },
  { key: 'transactions', path: '/tenant/payments/transactions', label: 'TRANSACTIONS' },
  { key: 'cash-drawer', path: '/cash-drawer', label: 'CASH DRAWER' },
  { key: 'eod-cash', path: '/cash-handoffs', label: 'END-OF-DAY CASH' },
  { key: 'refunds', path: '/tenant/payments/refunds-voids', label: 'REFUNDS & VOIDS' },
  { key: 'split', path: '/tenant/payments/split-payments', label: 'SPLIT PAYMENTS' },
  { key: 'tips', path: '/tenant/payments/tips', label: 'TIPS & GRATUITY' },
  { key: 'gift-cards', path: '/tenant/customers/gift-cards', label: 'GIFT CARDS' },
  { key: 'terminals', path: '/tenant/devices/payment-terminals', label: 'PAYMENT TERMINALS' },
];
/** SUNMI batch 3 (Kevin's Nov 7 2026 evening PDFs): communications, follow-ups and team pages (MODULE_SET=batch3; =all adds them). */
export const BATCH3_MODULES = [
  { key: 'phone-verification', path: '/tenant/communications/phone-verification', label: 'BOOKING PHONE VERIFICATION' },
  { key: 'loyalty-network', path: '/tenant/customers/loyalty?view=network', label: 'GLOBAL LOYALTY & EARNING RULES' },
  { key: 'messaging-setup', path: '/tenant/communications/messaging-setup', label: 'TEXT MESSAGING SETUP' },
  { key: 'followup-settings', path: '/settings/follow-ups', label: 'END-OF-DAY FOLLOW-UPS' },
  { key: 'follow-ups', path: '/follow-ups', label: 'FOLLOW-UP QUEUE' },
  { key: 'reminders', path: '/tenant/communications/reminders', label: 'APPOINTMENT REMINDERS' },
  { key: 'email', path: '/tenant/communications/email', label: 'EMAIL CENTER' },
  { key: 'sms-inbox', path: '/tenant/communications/sms', label: 'SMS INBOX' },
  { key: 'phone', path: '/tenant/communications/phone', label: 'PHONE & MESSAGING' },
  { key: 'team', path: '/tenant/team/members', label: 'TEAM MANAGEMENT' },
  { key: 'technicians', path: '/technicians', label: 'TECHNICIANS CENTER' },
  { key: 'tech-appointments', path: '/tech-appointments', label: 'TECH APPOINTMENTS' },
  { key: 'tech-schedule', path: '/technicians/schedule', label: 'LIVE TECHNICIAN SCHEDULE' },
  { key: 'commission', path: '/tenant/reports/commission', label: 'COMMISSION REPORT' },
  { key: 'performance', path: '/tenant/team/performance', label: 'TEAM PERFORMANCE' },
  { key: 'ai-usage', path: '/tenant/ai/usage', label: 'AI USAGE & LIMITS' },
  { key: 'setup-health', path: '/tenant/management/setup-health', label: 'SETUP HEALTH' },
];
// SUNMI batch 4 (Nov 7 2026): AI, marketing, notifications, templates and phone-number pages
export const BATCH4_MODULES = [
  { key: 'command-center', path: '/tenant/ai/command-center', label: 'AI COMMAND CENTER' },
  { key: 'ai-receptionist', path: '/tenant/ai/receptionist', label: 'AI RECEPTIONIST' },
  { key: 'ai-front-desk', path: '/tenant/ai/receptionist/front-desk', label: 'AI FRONT DESK' },
  { key: 'copilot', path: '/tenant/ai/copilot', label: 'RECEPTION COPILOT' },
  { key: 'reviews', path: '/tenant/marketing/reviews', label: 'REVIEWS & REPUTATION' },
  { key: 'referrals', path: '/tenant/marketing/referrals', label: 'REFERRAL PROGRAM' },
  { key: 'win-back', path: '/tenant/marketing/win-back', label: 'RETENTION & WIN-BACK' },
  { key: 'birthdays', path: '/tenant/marketing/birthdays', label: 'BIRTHDAY CAMPAIGNS' },
  { key: 'segments', path: '/tenant/marketing/segments', label: 'CUSTOMER SEGMENTS' },
  { key: 'coupons', path: '/tenant/marketing/coupons', label: 'COUPONS & PROMOTIONS' },
  { key: 'deals', path: '/tenant/marketing/deals', label: 'DEALS & OFFERS' },
  { key: 'promotions', path: '/tenant/marketing/promotions', label: 'PROMOTIONS MANAGEMENT' },
  { key: 'campaigns', path: '/tenant/marketing/campaigns', label: 'CAMPAIGN CENTER' },
  { key: 'marketing', path: '/tenant/marketing', label: 'MARKETING & GROWTH' },
  { key: 'templates', path: '/tenant/communications/templates', label: 'MESSAGE TEMPLATES' },
  { key: 'notifications', path: '/tenant/communications/notifications', label: 'CUSTOMER NOTIFICATIONS' },
  { key: 'phone-management', path: '/tenant/customers/phone-management', label: 'PHONE NUMBER MANAGEMENT' },
];
// SUNMI batch 5 (Nov 8 2026): AI money protection, marketing, business intelligence, scheduling, queue, booking, receptionist
export const BATCH5_MODULES = [
  { key: 'money-protection', path: '/tenant/ai/money-protection', label: 'AI MONEY PROTECTION' },
  { key: 'ai-marketing', path: '/tenant/ai/marketing', label: 'AI MARKETING ASSISTANT' },
  { key: 'campaign-builder', path: '/tenant/ai/marketing/builder', label: 'CAMPAIGN BUILDER' },
  { key: 'campaign-results', path: '/tenant/ai/marketing/results', label: 'CAMPAIGN RESULTS' },
  { key: 'ai-business', path: '/tenant/ai/business', label: 'AI BUSINESS ASSISTANT' },
  { key: 'ai-reports', path: '/tenant/ai/business/reports', label: 'AI BUSINESS REPORTS' },
  { key: 'ai-alerts', path: '/tenant/ai/business/alerts', label: 'AI BUSINESS ALERTS' },
  { key: 'ai-branches', path: '/tenant/ai/business/branches', label: 'AI BRANCH COMPARISON' },
  { key: 'scheduling-optimizer', path: '/tenant/ai/scheduling-optimizer', label: 'AI SCHEDULING OPTIMIZER' },
  { key: 'ai-queue', path: '/tenant/ai/queue', label: 'AI QUEUE ASSIGNMENT' },
  { key: 'ai-booking', path: '/tenant/ai/booking', label: 'AI BOOKING ASSISTANT' },
  { key: 'ai-rcp-settings', path: '/tenant/ai/receptionist/settings', label: 'AI RECEPTIONIST SETTINGS' },
  { key: 'ai-calls', path: '/tenant/ai/receptionist/calls', label: 'AI CALLS & VOICE' },
  { key: 'ai-calendar', path: '/tenant/ai/receptionist/calendar', label: 'AI CALENDAR' },
  { key: 'ai-business-setup', path: '/tenant/ai/receptionist/business-setup', label: 'AI BUSINESS SETUP' },
  { key: 'ai-follow-ups', path: '/tenant/ai/receptionist/follow-ups', label: 'AI FOLLOW-UPS & HANDOFF' },
  { key: 'reception-copilot', path: '/tenant/ai/reception-copilot', label: 'RECEPTION COPILOT (AI CENTER)' },
  { key: 'account-security', path: '/tenant/account/security', label: 'ACCOUNT SECURITY' },
  { key: 'access-governance', path: '/tenant/security/access', label: 'ACCESS GOVERNANCE' },
  { key: 'devices', path: '/tenant/devices/overview', label: 'DEVICES (TAP TO PAY / PAIRING)' },
];
/** Every registered module of a page: present, visible, fully inside the content viewport at scroll 0, child count. */
export const measureRegistry = (page, key) => {
  const reg = REGISTRY.pages.find((p) => p.key === key)?.modules ?? [];
  return page.evaluate((mods) => {
    const main = document.querySelector('.main'); const top = document.querySelector('.main > .topbar');
    if (!main) return mods.map((m) => ({ id: m.id, present: false }));
    const mr = main.getBoundingClientRect();
    const box = { l: mr.left, t: top ? top.getBoundingClientRect().bottom : mr.top, r: mr.right, b: Math.min(mr.bottom, innerHeight) };
    const vis = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'; };
    return mods.map((m) => {
      const el = main.querySelector(`[data-module-id="${m.id}"]`) || main.querySelector(`[data-testid="${m.id}"]`);
      if (!el) return { id: m.id, label: m.label, present: false, inView: false };
      const r = el.getBoundingClientRect();
      return { id: m.id, label: m.label, present: true, visible: vis(el), inView: vis(el) && r.left >= box.l - 1 && r.right <= box.r + 1 && r.top >= box.t - 1 && r.bottom <= box.b + 1,
        children: (m.items ? [...el.querySelectorAll(m.items)] : [...el.children]).filter(vis).length, minChildren: m.minItems ?? null, rect: [r.left, r.top, r.width, r.height].map(Math.round) };
    });
  }, reg);
};
// VIEWPORTS=primary → the primary only; VIEWPORTS=1920x945,1366x768 → exactly those
const parseViewports = (v) => (v === 'primary' ? [PRIMARY] : v.split(',').map((x) => x.trim().split('x').map(Number)).filter(([w, h]) => w > 0 && h > 0));

// ── fonts: the Google Fonts CSS + files the POS index.html asks for, cached locally (fetched once with curl through the
//    agent proxy when the cache is empty) and served to the page by request interception ────────────────────────────
const FONT_CSS_URL = (() => { const m = /href="(https:\/\/fonts\.googleapis\.com\/css2\?[^"]+)"/.exec(readFileSync(ROOT + 'apps/pos-web/index.html', 'utf8')); return m ? m[1].replace(/&amp;/g, '&') : null; })();
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
export function fontCache(dir = process.env.FONT_CACHE || join(tmpdir(), 'aps-font-cache')) {
  mkdirSync(dir, { recursive: true });
  const cssFile = join(dir, 'fonts.css');
  if (!existsSync(cssFile) && FONT_CSS_URL) execFileSync('curl', ['-sS', '-m', '30', '-A', UA, FONT_CSS_URL, '-o', cssFile]);
  const css = existsSync(cssFile) ? readFileSync(cssFile, 'utf8') : '';
  const files = new Map();
  for (const m of css.matchAll(/url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\)/g)) {
    const url = m[1]; const local = join(dir, url.replace(/[^a-zA-Z0-9.]+/g, '_'));
    if (!existsSync(local)) execFileSync('curl', ['-sS', '-m', '30', url, '-o', local]);
    files.set(url, local);
  }
  return { css, cssUrl: FONT_CSS_URL, files };
}
export async function routeFonts(context, cache) {
  await context.route(/^https:\/\/fonts\.googleapis\.com\//, (r) => r.fulfill({ status: 200, contentType: 'text/css; charset=utf-8', body: cache.css, headers: { 'access-control-allow-origin': '*' } }));
  await context.route(/^https:\/\/fonts\.gstatic\.com\//, (r) => { const f = cache.files.get(r.request().url()); return f ? r.fulfill({ status: 200, contentType: 'font/woff2', body: readFileSync(f), headers: { 'access-control-allow-origin': '*' } }) : r.fulfill({ status: 404, body: '' }); });
}

/** Everything the one-screen rule looks at, measured in the page. */
export const measureOneScreen = (page) => page.evaluate(async () => {
  await document.fonts.ready;
  // measured WITHOUT the §78 hit areas: their transparent pseudo-elements reach past a control's box and would count as
  // "spilling text" (scrollWidth includes them). measureHitAreas proves the layout is identical with and without them.
  document.documentElement.setAttribute('data-hitslop', 'off');
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  try {
  // make the browser fetch the Vietnamese subset too (an English screen has no Vietnamese text to trigger it), then ask
  // whether the family renders BOTH alphabets — a fallback font answers false
  let viLoaded = 0; try { viLoaded = (await document.fonts.load('600 16px "Hanken Grotesk"', 'Nguyễn Thị Hương ệ ặ ữ ỹ')).length; } catch { viLoaded = 0; }
  const vis = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0.05; };
  const se = document.scrollingElement;
  const main = document.querySelector('.main');
  // the SCREEN's root: the tallest child of .main that is not the top bar / alert slot. (Until Nov 7 2026 this read
  // main.firstElementChild — the top bar — so a screen that scrolls inside its own root, e.g. Tech Queue's 761 px, was never
  // measured: a false PASS found by the SUNMI module inventory.)
  const root = [...(main?.children ?? [])].filter((c) => !c.classList.contains('topbar') && !c.classList.contains('community-alert-slot') && c.getBoundingClientRect().height > 0)
    .sort((a, b) => b.getBoundingClientRect().height - a.getBoundingClientRect().height)[0] ?? null;
  // the module's scroll owner: the shell's .main, or a screen root that scrolls itself (h-full overflow-auto)
  const owners = [main, root, ...(root ? [...root.children].filter((c) => c.clientHeight >= (main?.clientHeight ?? 0) * 0.9) : [])].filter(Boolean);
  const scrollOf = (el) => { const cs = getComputedStyle(el); const canY = /auto|scroll/.test(cs.overflowY) || el === main; const canX = /auto|scroll/.test(cs.overflowX) || el === main; return { y: canY ? Math.max(0, el.scrollHeight - el.clientHeight) : 0, x: canX ? Math.max(0, el.scrollWidth - el.clientWidth) : 0 }; };
  let vScroll = 0, hScroll = 0;
  for (const o of owners) { const s = scrollOf(o); vScroll = Math.max(vScroll, s.y); hScroll = Math.max(hScroll, s.x); }
  // clipped / spilling text in the controls a cashier reads at a glance
  const CTRL = 'button, [role="tab"], .pill, .kpi .l, .kpi .v, .chip, a.btn, .btn, label';
  const clipped = [];
  for (const el of document.querySelectorAll(CTRL)) {
    if (!vis(el) || !main?.contains(el)) continue;
    const cs = getComputedStyle(el);
    const ell = cs.textOverflow === 'ellipsis' || (cs.webkitLineClamp && cs.webkitLineClamp !== 'none');
    const childEll = [...el.querySelectorAll('*')].some((c) => getComputedStyle(c).textOverflow === 'ellipsis');
    const overX = el.scrollWidth - el.clientWidth, overY = el.scrollHeight - el.clientHeight;
    if ((overX > 2 || overY > 3) && !ell && !childEll && (el.textContent || '').trim().length > 1) {
      // the text itself is wider / taller than the box: clipped (overflow hidden) or spilling onto a neighbour (visible)
      clipped.push({ tag: el.tagName.toLowerCase(), cls: String(el.className).slice(0, 40), text: (el.textContent || '').trim().slice(0, 50), overX, overY, overflow: cs.overflow });
    }
  }
  // the part of a box the user can see: its rect intersected with every ancestor that clips (overflow ≠ visible) — a row
  // scrolled out of a list's scroll box is not "on top of" the section below it. A fixed / sticky-free popover escapes.
  const visibleRect = (el) => {
    const r = el.getBoundingClientRect(); let L = r.left, T = r.top, R = r.right, B = r.bottom, hL = r.left, hR = r.right, reach = false;
    if (getComputedStyle(el).position === 'fixed') return { left: L, top: T, right: R, bottom: B, width: R - L, height: B - T, hCut: 0 };
    for (let p = el.parentElement; p && p !== document.documentElement; p = p.parentElement) {
      const cs = getComputedStyle(p); const cx = cs.overflowX !== 'visible', cy = cs.overflowY !== 'visible';
      // a region DESIGNED to scroll sideways (the booking / schedule technician lanes — 200 columns paged 12 at a time —
      // or anything marked data-hscroll) is reachable by design: what it hides is not "cut off"
      const hBar = /auto|scroll/.test(cs.overflowX) && p.scrollWidth > p.clientWidth + 1 && (p.hasAttribute('data-hscroll') || !!p.querySelector('[data-technician-column]'));
      if (cx || cy) { const pr = p.getBoundingClientRect(); if (cx) { L = Math.max(L, pr.left); R = Math.min(R, pr.right); if (!hBar && !reach) { hL = Math.max(hL, pr.left); hR = Math.min(hR, pr.right); } } if (cy) { T = Math.max(T, pr.top); B = Math.min(B, pr.bottom); } }
      if (hBar) reach = true;
      if (cs.position === 'fixed') break;
    }
    return { left: L, top: T, right: R, bottom: B, width: Math.max(0, R - L), height: Math.max(0, B - T), hCut: Math.max(0, r.width - Math.max(0, Math.min(r.right, hR) - Math.max(r.left, hL))) };
  };
  // controls and status pills CUT OFF sideways by a card / panel (§79: "cards clip a status pill"): part of the box lies
  // outside a clipping ancestor horizontally. Vertical clipping is a list that scrolls — allowed.
  const cutOff = [];
  for (const el of main?.querySelectorAll('button, [role="tab"], a.btn, .pill') ?? []) {
    if (!vis(el)) continue; const v = visibleRect(el);
    if (v.hCut > 2) cutOff.push({ text: (el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 30), cut: Math.round(v.hCut) });
  }
  // overlapping primary controls (buttons that are not nested in each other), compared on the parts the user can see
  const btns = [...main?.querySelectorAll('button, [role="tab"], a.btn') ?? []].filter(vis).map((el) => ({ el, r: el.getBoundingClientRect(), v: visibleRect(el) }));
  const overlaps = [];
  for (let i = 0; i < btns.length; i++) for (let k = i + 1; k < btns.length; k++) {
    const a = btns[i], b = btns[k];
    if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
    if (a.v.width <= 0 || a.v.height <= 0 || b.v.width <= 0 || b.v.height <= 0) continue;   // scrolled / clipped out of sight
    const ix = Math.min(a.v.right, b.v.right) - Math.max(a.v.left, b.v.left), iy = Math.min(a.v.bottom, b.v.bottom) - Math.max(a.v.top, b.v.top);
    // the booking grid's free-time zones ("+ 55 min open", data-gap-slot) are a background drop target the appointment
    // cards sit on by design — not an overlap of two controls
    if (a.el.closest('[data-gap-slot]') || b.el.closest('[data-gap-slot]')) continue;
    if (ix > 2 && iy > 2) {
      // a control under an open popover / modal is not an overlap of the layout
      const ta = a.el.closest('[role="dialog"], [role="menu"], [role="listbox"]'), tb = b.el.closest('[role="dialog"], [role="menu"], [role="listbox"]');
      if (ta !== tb) continue;
      overlaps.push({ a: (a.el.textContent || a.el.getAttribute('aria-label') || '').trim().slice(0, 30), b: (b.el.textContent || b.el.getAttribute('aria-label') || '').trim().slice(0, 30), ix: Math.round(ix), iy: Math.round(iy), ra: [a.r.left, a.r.top, a.r.width, a.r.height].map(Math.round), rb: [b.r.left, b.r.top, b.r.width, b.r.height].map(Math.round) });
    }
  }
  const heights = btns.map((b) => Math.round(b.r.height)).filter((h) => h > 0).sort((x, y) => x - y);
  const bodyFont = getComputedStyle(document.body);
  return {
    vw: innerWidth, vh: innerHeight,
    docScrollY: Math.max(0, se.scrollHeight - innerHeight), docScrollX: Math.max(0, se.scrollWidth - innerWidth),
    vScroll, hScroll, mainHeight: main?.clientHeight ?? 0,
    clipped: clipped.slice(0, 12), clippedCount: clipped.length, cutOff: cutOff.slice(0, 8), cutOffCount: cutOff.length, overlaps: overlaps.slice(0, 8), overlapCount: overlaps.length,
    buttons: btns.length, minButton: heights[0] ?? null, p10Button: heights[Math.floor(heights.length * 0.1)] ?? null,
    font: { family: bodyFont.fontFamily, size: bodyFont.fontSize, viFaces: viLoaded,
      hanken: viLoaded > 0 && document.fonts.check('16px "Hanken Grotesk"', 'Gel Manicure Ag') && document.fonts.check('16px "Hanken Grotesk"', 'Nguyễn Thị Hương ệ ặ ữ ỹ'),
      faces: [...document.fonts].filter((f) => f.family.replace(/"/g, '') === 'Hanken Grotesk' && f.status === 'loaded').length, lang: document.documentElement.lang },
    textLength: (main?.innerText || '').length,
  };
  } finally { document.documentElement.removeAttribute('data-hitslop'); }
});

/**
 * §78 hit areas (Oct 27 2026 — Kevin: keep the one-screen fit; compact controls get a ≥ 44 × 44 px HIT AREA, not a bigger
 * box). For every compact control (< 44 px wide or tall) fully visible in the module, walk outwards from its edges with
 * document.elementFromPoint, 1 px at a time, up to the 44 px box, and then probe the four corners of the box reached:
 *   • full      — the whole 44 × 44 px box (or the control, where it is larger) hits the control itself;
 *   • neighbour — the walk stopped at another control (two controls closer than 44 px share the gap: each gets the largest
 *                 area that does not overlap the other — listed with the size reached);
 *   • edge      — the walk stopped at the viewport, at a panel's clipping edge, at the scroll extent of a scrolling panel
 *                 (growing further would add a scrollbar) or under a list's pinned (sticky) header — listed;
 *   • short     — the walk stopped on plain content before 44 px: a FAILURE.
 * And: the layout with the hit areas (normal) and without (<html data-hitslop="off">) is identical — every control's box and
 * every scroll size — so the hit areas change no visual size or position.
 */
export const measureHitAreas = (page) => page.evaluate(async () => {
  const MIN = 44;
  const main = document.querySelector('.main'); if (!main) return null;
  const CTRL = 'button, [role="tab"], [role="button"], a[href], input, select, textarea';
  const GROW = 'button, [role="tab"], [role="button"], a[href]';
  const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  // layout fingerprint with and without the hit areas
  const finger = () => [...main.querySelectorAll(CTRL)].map((e) => { const r = e.getBoundingClientRect(); return `${(e.textContent || e.getAttribute('aria-label') || '').trim().slice(0, 16)}@${Math.round(r.left * 10)},${Math.round(r.top * 10)},${Math.round(r.width * 10)},${Math.round(r.height * 10)}`; })
    .concat([`main ${main.scrollWidth}x${main.scrollHeight}`, `doc ${document.scrollingElement.scrollWidth}x${document.scrollingElement.scrollHeight}`]);
  // on → off → on: a live board can re-render between two snapshots (an SSE update) — only a difference that comes and
  // goes WITH the switch counts; retried a few times while the data itself is moving
  let layoutSame = false, layoutDiff = null;
  for (let attempt = 0; attempt < 4 && !layoutSame; attempt++) {
    const on = finger();
    document.documentElement.setAttribute('data-hitslop', 'off'); await frame();
    const off = finger();
    document.documentElement.removeAttribute('data-hitslop'); await frame();
    const on2 = finger();
    if (on.join('|') !== on2.join('|')) { await new Promise((r) => setTimeout(r, 400)); continue; }   // the data moved: again
    layoutSame = on.join('|') === off.join('|');
    if (!layoutSame) { const i = on.findIndex((x, k) => x !== off[k]); layoutDiff = { on: on[i] ?? null, off: off[i] ?? null, onCount: on.length, offCount: off.length }; }
  }
  if (!layoutSame && !layoutDiff) layoutDiff = { note: 'the board kept re-rendering' };
  const vis = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0.05; };
  // where a hit area may not reach: the viewport, outside a clipping ancestor, beyond a scroller's content
  const limits = (el) => {
    let L = 0, T = 0, R = innerWidth, B = innerHeight; let vL = 0, vT = 0, vR = innerWidth, vB = innerHeight;
    for (let p = el.parentElement; p && p !== document.documentElement; p = p.parentElement) {
      const cs = getComputedStyle(p); if (cs.overflowX === 'visible' && cs.overflowY === 'visible') { if (cs.position === 'fixed') break; continue; }
      const r = p.getBoundingClientRect(); const left = r.left + p.clientLeft - p.scrollLeft, top = r.top + p.clientTop - p.scrollTop;
      if (cs.overflowX !== 'visible') { L = Math.max(L, left); R = Math.min(R, left + Math.max(p.scrollWidth, p.clientWidth)); vL = Math.max(vL, r.left + p.clientLeft); vR = Math.min(vR, r.left + p.clientLeft + p.clientWidth); }
      if (cs.overflowY !== 'visible') { T = Math.max(T, top); B = Math.min(B, top + Math.max(p.scrollHeight, p.clientHeight)); vT = Math.max(vT, r.top + p.clientTop); vB = Math.min(vB, r.top + p.clientTop + p.clientHeight); }
      if (cs.position === 'fixed') break;
    }
    // a point must lie inside both the content extent and the visible clip to be tappable
    return { L: Math.max(L, vL), T: Math.max(T, vT), R: Math.min(R, vR), B: Math.min(B, vB) };
  };
  const label = (el) => (el.textContent || el.getAttribute('aria-label') || el.getAttribute('title') || el.tagName).trim().replace(/\s+/g, ' ').slice(0, 28);
  const out = { compact: 0, full: 0, neighbour: 0, edge: 0, short: 0, largerThan44: 0, layoutSame, layoutDiff, neighbours: [], edges: [], shorts: [] };
  const all = [...main.querySelectorAll(GROW)].filter(vis);
  // every control's hit box as painted: its border box, grown by its hit-area pseudo-element when it has one
  const hitBox = (e) => {
    const r = e.getBoundingClientRect(); const m = e.getAttribute('data-hs');
    if (!m) return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
    const p = getComputedStyle(e, m === 'a' ? '::after' : '::before'); const cs = getComputedStyle(e);
    const n = (v, bw) => Math.max(0, -parseFloat(v) - parseFloat(bw));
    return { left: r.left - n(p.left, cs.borderLeftWidth), top: r.top - n(p.top, cs.borderTopWidth), right: r.right + n(p.right, cs.borderRightWidth), bottom: r.bottom + n(p.bottom, cs.borderBottomWidth) };
  };
  const boxes = [...main.querySelectorAll(CTRL)].filter(vis).map((e) => ({ e, b: hitBox(e) }));
  // is the band the 44 px box would need on that side taken by another control (or its hit area)? → "neighbour"
  const bandTaken = (el, band) => boxes.some(({ e, b }) => e !== el && !e.contains(el) && !el.contains(e)
    && Math.min(b.right, band.right) - Math.max(b.left, band.left) > 0.5 && Math.min(b.bottom, band.bottom) - Math.max(b.top, band.top) > 0.5);
  for (const el of all) {
    const r = el.getBoundingClientRect();
    if (r.width >= MIN && r.height >= MIN) { out.largerThan44++; continue; }
    const lim = limits(el);
    // only controls the user can see whole (a row scrolled half out of its list is measured when it is scrolled in)
    if (r.left < lim.L - 0.5 || r.right > lim.R + 0.5 || r.top < lim.T - 0.5 || r.bottom > lim.B + 0.5) continue;
    out.compact++;
    const cx = (r.left + r.right) / 2, cy = (r.top + r.bottom) / 2;
    const needX = Math.max(0, (MIN - r.width) / 2), needY = Math.max(0, (MIN - r.height) / 2);
    const own = (x, y) => { const h = document.elementFromPoint(x, y); return h && (h === el || el.contains(h)); };
    const why = (x, y, band) => {
      if (x < lim.L || x > lim.R || y < lim.T || y > lim.B) return 'edge';
      const h = document.elementFromPoint(x, y); const c = h?.closest?.(CTRL);
      if (c && c !== el && !el.contains(c)) return 'neighbour';
      // a list's pinned (sticky) header painted over the first row is the top edge of the list
      for (let e = h; e && e !== main; e = e.parentElement) if (getComputedStyle(e).position === 'sticky' && !e.contains(el)) return 'edge';
      // a wide control whose hit area stops for a small neighbour further along the same side (a rectangle cannot go round it)
      if (band && bandTaken(el, band)) return 'neighbour';
      return 'short';
    };
    const full = { left: r.left - needX, right: r.right + needX, top: r.top - needY, bottom: r.bottom + needY };
    const bands = { up: { ...full, bottom: r.top }, dn: { ...full, top: r.bottom }, lf: { ...full, right: r.left }, rt: { ...full, left: r.right } };
    const walk = (dx, dy, need, ex, ey, band) => {   // from the edge point (ex, ey) outwards, probing the middle of each 1 px step
      for (let k = 0; k + 0.5 < need; k++) { const x = ex + dx * (k + 0.5), y = ey + dy * (k + 0.5); if (!own(x, y)) return { reach: k, stop: why(x, y, band) }; }
      return { reach: need, stop: null };
    };
    const up = walk(0, -1, needY, cx, r.top, bands.up), dn = walk(0, 1, needY, cx, r.bottom, bands.dn), lf = walk(-1, 0, needX, r.left, cy, bands.lf), rt = walk(1, 0, needX, r.right, cy, bands.rt);
    const hitW = r.width + lf.reach + rt.reach, hitH = r.height + up.reach + dn.reach;
    // the corners of the box reached (only where it grew on both adjoining sides: the control's own corners are rounded)
    const bx0 = r.left - lf.reach + 0.5, bx1 = r.right + rt.reach - 0.5, by0 = r.top - up.reach + 0.5, by1 = r.bottom + dn.reach - 0.5;
    const corners = [[bx0, by0, lf, up], [bx1, by0, rt, up], [bx0, by1, lf, dn], [bx1, by1, rt, dn]].map(([x, y, a, b]) => (a.reach < 1 || b.reach < 1 || own(x, y)) ? null : why(x, y, full));
    const stops = [up.stop, dn.stop, lf.stop, rt.stop, ...corners].filter(Boolean);
    const rec = { text: label(el), w: Math.round(r.width), h: Math.round(r.height), hitW: Math.round(hitW), hitH: Math.round(hitH) };
    if (stops.includes('short')) { out.short++; out.shorts.push({ ...rec, stops: [up.stop, dn.stop, lf.stop, rt.stop, ...corners].map((x) => x ?? '-').join(' ') }); }
    else if (stops.includes('neighbour')) { out.neighbour++; out.neighbours.push(rec); }
    else if (stops.includes('edge')) { out.edge++; out.edges.push(rec); }
    else out.full++;
  }
  out.neighbours = out.neighbours.slice(0, 40); out.edges = out.edges.slice(0, 20); out.shorts = out.shorts.slice(0, 20);
  return out;
});

/** ASCII words that occur inside real Vietnamese catalogue strings ("Xem", "Doanh thu", "Check-in") — never English
 *  leftovers (the same rule as apps/pos-web/src/screens/viScan.testkit.ts) */
export function vietnameseAsciiWords() {
  const dir = ROOT + 'apps/pos-web/src/i18n/';
  const files = [dir + 'catalog.vi.ts', ...['nav', 'ops', 'people', 'growth', 'admin', 'glossary', 'status', 'errors', 'payment', 'search', 'comms', 'srv'].map((n) => `${dir}ns/${n}.vi.ts`)].filter(existsSync);
  const out = new Set();
  for (const f of files) for (const m of readFileSync(f, 'utf8').matchAll(/:\s*'((?:[^'\\]|\\.)*)'/g)) { const v = m[1]; if (![...v].some((c) => c.charCodeAt(0) > 127)) continue; for (const w of v.match(/[A-Za-z]{2,}/g) ?? []) out.add(w); }
  return [...out];
}
/** Leftover-English words on a Vietnamese screen: ASCII-only text nodes with words not in any Vietnamese catalogue
 *  string. Reported (salon data — service names, customer names — is English by nature, so this is a lead, not a gate). */
export const englishLeftovers = (page, allow = []) => page.evaluate((allow) => {
  const main = document.querySelector('.main'); if (!main) return [];
  const out = new Set(); const w = document.createTreeWalker(main, NodeFilter.SHOW_TEXT);
  const ok = new Set(['AI', 'POS', 'VIP', 'SMS', 'ID', 'OK', 'PM', 'AM', 'Tip', 'tip', 'DV', 'Email', 'Wi', 'Fi', 'USD', 'thg', ...allow]);
  for (let n = w.nextNode(); n; n = w.nextNode()) {
    const t = (n.textContent || '').trim(); if (!t || [...t].some((c) => c.charCodeAt(0) > 127)) continue;
    const words = (t.match(/[A-Za-z]{3,}/g) || []).filter((x) => !ok.has(x));
    if (words.length) out.add(t.slice(0, 40));
  }
  return [...out].slice(0, 30);
}, allow);

/**
 * Run the matrix. `open(lang)` → a Playwright page already signed in with the POS language set to `lang` (the caller
 * decides how: the CLI sets it through PUT /pos/me/language). Returns rows + a PASS/FAIL per module × language.
 */
let VI_WORDS_CACHE = null;
const VI_WORDS_PROXY = () => (VI_WORDS_CACHE ??= vietnameseAsciiWords());
export async function runOneScreenMatrix({ newPage, setLanguage, base, shots, state, modules = MODULES, viewports = VIEWPORTS, settleMs = 1600, allow = [], log = () => {} }) {
  mkdirSync(shots, { recursive: true });
  const VI_WORDS = VI_WORDS_PROXY();
  const rows = [];
  for (const lang of ['en', 'vi']) {
    await setLanguage(lang);
    const page = await newPage();
    const errors = []; page.on('pageerror', (e) => errors.push(String(e.message || e)));
    for (const m of modules) {
      for (const [w, h] of viewports) {
        await page.setViewportSize({ width: w, height: h });
        await page.goto(base + m.path, { waitUntil: 'domcontentloaded' });
        await page.locator('.main').first().waitFor({ timeout: 30000 }).catch(() => undefined);
        // wait for the screen to finish loading (no "Loading…" / "Đang tải" text left), then settle
        for (let i = 0; i < 40; i++) { const tx = await page.locator('.main').first().innerText().catch(() => ''); if (tx.length > 80 && !/^\s*(Loading|Đang tải)/m.test(tx.slice(0, 200))) break; await sleep(250); }
        await sleep(settleMs);
        const meas = await measureOneScreen(page);
        const registry = await measureRegistry(page, m.key);
        const t0 = Date.now(); const hit = await measureHitAreas(page); if (hit) hit.ms = Date.now() - t0;
        const leftovers = lang === 'vi' ? await englishLeftovers(page, [...allow, ...VI_WORDS]) : [];
        // a panel that failed to load (StateBlock / FitKit error box) — a layout pass must not hide a broken screen (Nov 7 2026:
        // the Supplier Directory showed "newest is not a sort order here" while every layout check passed)
        const panelErrors = await page.evaluate(() => [...document.querySelectorAll('.main .fk-error')].map((e) => (e.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 90)));
        const file = `${state}-${m.key}-${lang}-${w}x${h}.png`;
        await page.screenshot({ path: join(shots, file) });
        rows.push({ state, module: m.key, label: m.label, lang, w, h, ...meas, registry, hit, leftovers, panelErrors, file, pageErrors: errors.splice(0) });
        log(`${state} ${m.label} ${lang} ${w}x${h} v${meas.vScroll} h${meas.hScroll} doc${meas.docScrollY}/${meas.docScrollX} clip${meas.clippedCount} cut${meas.cutOffCount} ovl${meas.overlapCount} minBtn${meas.minButton} hit:${hit ? `${hit.full}f/${hit.neighbour}n/${hit.edge}e/${hit.short}s ${hit.ms}ms${hit.layoutSame ? '' : ' LAYOUT-CHANGED'}` : '-'} font:${meas.font.hanken ? 'Hanken' : 'FALLBACK'}`);
      }
    }
    await page.close();
  }
  return judge(rows);
}

/** PASS / FAIL per module × language at the primary viewport, plus the responsive report rows. */
export function judge(rows) {
  const verdicts = [];
  const key = (r) => `${r.module}|${r.lang}|${r.w}x${r.h}`;
  const by = new Map(rows.map((r) => [key(r), r]));
  for (const r of rows) {
    const primary = r.w === PRIMARY[0] && r.h === PRIMARY[1];
    const certified = isCertified(r.w, r.h);
    const en = by.get(`${r.module}|en|${r.w}x${r.h}`);
    const reasons = [];
    if (r.docScrollX > 1 || r.hScroll > 1) reasons.push(`horizontal scroll ${Math.max(r.docScrollX, r.hScroll)}px`);
    const pageScroll = REGISTRY.pages.find((p) => p.key === r.module)?.scroll === 'page';   // registered long pages scroll vertically by design
    if (certified && !pageScroll && (r.vScroll > 1 || r.docScrollY > 1)) reasons.push(`vertical scroll ${Math.max(r.vScroll, r.docScrollY)}px at ${r.w}×${r.h}`);
    // the SUNMI module registry: every registered module present (any viewport) and inside the viewport (certified sizes)
    const reg = r.registry || [];
    const missing = reg.filter((x) => !x.present), outside = reg.filter((x) => x.present && !x.inView), few = reg.filter((x) => x.present && x.minChildren != null && x.children < x.minChildren);
    if (missing.length) reasons.push(`${missing.length} registered module(s) missing: ${missing.slice(0, 4).map((x) => x.id).join(', ')}`);
    if (certified && !pageScroll && outside.length) reasons.push(`${outside.length} registered module(s) outside the viewport: ${outside.slice(0, 4).map((x) => x.id).join(', ')}`);
    if (few.length) reasons.push(`incomplete set(s): ${few.map((x) => `${x.id} ${x.children}/${x.minChildren}`).join(', ')}`);
    if (r.panelErrors?.length) reasons.push(`${r.panelErrors.length} panel(s) failed to load: ${r.panelErrors.slice(0, 3).join(' | ')}`);
    if (r.clippedCount) reasons.push(`${r.clippedCount} clipped / spilling control text (${r.clipped.slice(0, 2).map((c) => JSON.stringify(c.text)).join(', ')})`);
    if (r.cutOffCount) reasons.push(`${r.cutOffCount} controls / status pills cut off sideways by their card (${r.cutOff.slice(0, 2).map((c) => JSON.stringify(c.text)).join(', ')})`);
    if (r.overlapCount) reasons.push(`${r.overlapCount} overlapping controls (${r.overlaps.slice(0, 2).map((o) => `${o.a}×${o.b}`).join(', ')})`);
    if (!r.font.hanken) reasons.push('Hanken Grotesk with Vietnamese glyphs not loaded');
    if (r.lang === 'vi' && en && r.minButton != null && en.minButton != null && r.minButton < en.minButton - 1) reasons.push(`smallest button ${r.minButton}px < English ${en.minButton}px`);
    if (r.lang === 'vi' && en && r.font.size !== en.font.size) reasons.push(`body font ${r.font.size} ≠ English ${en.font.size}`);
    // §78: every compact control's hit area reaches 44 × 44 px, or the largest area its neighbours / panel edge allow;
    // and the hit areas change nothing in the layout
    if (r.hit && r.hit.short) reasons.push(`${r.hit.short} compact controls with a hit area short of 44 px (${r.hit.shorts.slice(0, 2).map((x) => `${JSON.stringify(x.text)} ${x.hitW}×${x.hitH}`).join(', ')})`);
    if (r.hit && !r.hit.layoutSame) reasons.push(`the hit areas changed the layout (${JSON.stringify(r.hit.layoutDiff)})`);
    if (r.pageErrors.length) reasons.push(`page errors: ${r.pageErrors.slice(0, 2).join(' | ').slice(0, 160)}`);
    verdicts.push({ ...r, primary, pass: reasons.length === 0, reasons });
  }
  return verdicts;
}

// ── CLI ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const apiReq = createRequire(ROOT + 'apps/api/package.json');
  const { chromium } = createRequire(ROOT + 'package.json')('playwright');
  const DB = process.env.DATABASE_URL; if (!DB) { console.error('DATABASE_URL is required'); process.exit(2); }
  if (!/localhost|127\.0\.0\.1/.test(DB)) { console.error('refusing a non-local database'); process.exit(2); }
  const API_PORT = Number(process.env.API_PORT || 3194), WEB_PORT = Number(process.env.WEB_PORT || 3294);
  const API = `http://127.0.0.1:${API_PORT}`, WEB = `http://127.0.0.1:${WEB_PORT}`;
  const DIST = join(ROOT, 'apps/pos-web/dist');
  const STATE = process.env.STATE || 'light';
  const SHOTS = process.env.SHOTS || mkdtempSync(join(tmpdir(), 'pos-vi-one-screen-'));
  const OUT = process.env.OUT || join(SHOTS, `one-screen-${STATE}.json`);
  const SALON = process.env.SALON_CODE || 'PILOT01';
  const ONLY = process.env.ONLY ? process.env.ONLY.split(',') : null;
  const VPS = process.env.VIEWPORTS ? parseViewports(process.env.VIEWPORTS) : VIEWPORTS;
  if (!existsSync(join(DIST, 'index.html'))) { console.error('build the POS first: (cd apps/pos-web && npx vite build)'); process.exit(2); }
  const pg = apiReq('pg');
  const pool = new pg.Pool({ connectionString: DB, max: 2 });
  const T = (await pool.query(`select id from tenants where tenant_code = $1`, [SALON])).rows[0]?.id;
  if (!T) { console.error(`salon ${SALON} not found — seed it first (apps/api/scripts/seed.ts)`); process.exit(2); }
  const B = (await pool.query(`select id from branches where tenant_id = $1 and deleted_at is null order by created_at limit 1`, [T])).rows[0].id;
  const env = { ...process.env, REPO_DRIVER: 'postgres', PORT: String(API_PORT), AUTH_SESSION_SECRET: 'live-proof-session-secret-0123456789abcdef', NODE_ENV: 'development',
    PRIVATE_FILES_ROOT: mkdtempSync(join(tmpdir(), 'vi1-priv-')), MEDIA_ROOT: mkdtempSync(join(tmpdir(), 'vi1-media-')), AI_QUEUE_OPS_JOBS: 'off', AI_SCHEDULING_JOBS: 'off', COMMUNITY_JOBS: 'off', EVENT_PUBLISHER_ENABLED: 'on' };
  for (const k of ['CAPTCHA_SECRET_KEY', 'CAPTCHA_SITE_KEY', 'PROCESS_ROLE']) delete env[k];
  let apiLog = '';
  const apiProc = spawn('node', ['dist/main.js'], { cwd: ROOT + 'apps/api', env, stdio: ['ignore', 'pipe', 'pipe'] });
  apiProc.stdout.on('data', (c) => { apiLog += c; }); apiProc.stderr.on('data', (c) => { apiLog += c; });
  const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json' };
  const web = createServer((req, res) => {
    const u = new URL(req.url, WEB);
    const file = normalize(join(DIST, decodeURIComponent(u.pathname)));
    const isFile = u.pathname !== '/' && file.startsWith(DIST) && existsSync(file) && statSync(file).isFile();
    const wantsHtml = req.method === 'GET' && (req.headers.accept || '').includes('text/html');
    if (isFile || wantsHtml) { const f = isFile ? file : join(DIST, 'index.html'); res.writeHead(200, { 'content-type': TYPES[extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' }); res.end(readFileSync(f)); return; }
    const up = httpRequest({ host: '127.0.0.1', port: API_PORT, method: req.method, path: req.url, headers: { ...req.headers, host: `127.0.0.1:${API_PORT}` } }, (r) => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
    up.on('error', () => { try { res.writeHead(502); res.end(); } catch { /* the page went away */ } });
    req.pipe(up);
  });
  await new Promise((r) => web.listen(WEB_PORT, '127.0.0.1', r));
  let browser; let code = 1;
  try {
    let up = false; for (let i = 0; i < 300 && !up; i++) { try { up = (await fetch(API + '/health/ready')).ok; } catch { /* booting */ } if (!up) await sleep(500); }
    if (!up) throw new Error('API did not boot: ' + apiLog.split('\n').slice(-8).join(' | '));
    const fonts = fontCache();
    browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
    const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, serviceWorkers: 'block' });
    await routeFonts(ctx, fonts);
    const login = await ctx.request.post(WEB + '/auth/login', { data: { portal: 'tenant', salonCode: SALON, identifier: process.env.OWNER_EMAIL || 'owner@pilotsalon.com', password: process.env.OWNER_PASSWORD || 'ChangeMe!Owner1' } });
    const lj = await login.json().catch(() => ({}));
    if (lj?.outcome === 'BRANCH_SELECTION_REQUIRED') await ctx.request.post(WEB + '/auth/select-branch', { data: { branchId: B } });
    if (!login.ok()) throw new Error(`owner login ${login.status()}`);
    const setLanguage = async (lang) => { const r = await ctx.request.put(WEB + '/pos/me/language', { data: { language: lang } }); if (!r.ok()) throw new Error(`PUT /pos/me/language ${r.status()}`); };
    const SET = process.env.MODULE_SET === 'all' ? [...MODULES, ...EXTRA_MODULES, ...BATCH2_MODULES, ...BATCH3_MODULES, ...BATCH4_MODULES, ...BATCH5_MODULES] : process.env.MODULE_SET === 'extra' ? EXTRA_MODULES : process.env.MODULE_SET === 'batch2' ? BATCH2_MODULES : process.env.MODULE_SET === 'batch3' ? BATCH3_MODULES : process.env.MODULE_SET === 'batch4' ? BATCH4_MODULES : process.env.MODULE_SET === 'batch5' ? BATCH5_MODULES : MODULES;
    const mods = ONLY ? SET.filter((m) => ONLY.includes(m.key)) : SET;
    const verdicts = await runOneScreenMatrix({ newPage: () => ctx.newPage(), setLanguage, base: WEB, shots: SHOTS, state: STATE, modules: mods, viewports: VPS, log: (s) => console.log(s) });
    await setLanguage('en');
    writeFileSync(OUT, JSON.stringify(verdicts, null, 1));
    const prim = verdicts.filter((v) => v.primary);
    console.log('\n' + prim.map((v) => `${v.pass ? 'PASS' : 'FAIL'}  ${v.label} ${v.lang.toUpperCase()} (${STATE}, ${PRIMARY[0]}×${PRIMARY[1]} page = 1920×1080 screen with browser chrome + taskbar)${v.reasons.length ? ' — ' + v.reasons.join('; ') : ''}`).join('\n'));
    const cert = verdicts.filter((v) => isCertified(v.w, v.h));
    const certFail = cert.filter((v) => !v.primary && !v.pass);
    if (certFail.length) console.log('\ncertified SUNMI / full-HD rows that FAIL:\n' + certFail.map((v) => `  ${v.label} ${v.lang} ${v.w}x${v.h}: ${v.reasons.join('; ')}`).join('\n'));
    const resp = verdicts.filter((v) => !isCertified(v.w, v.h) && !v.pass);
    if (resp.length) console.log('\nresponsive (report) issues:\n' + resp.map((v) => `  ${v.label} ${v.lang} ${v.w}x${v.h}: ${v.reasons.join('; ')}`).join('\n'));
    console.log(`\n${cert.filter((v) => v.pass).length}/${cert.length} certified checks passed (primary ${prim.filter((v) => v.pass).length}/${prim.length}) · ${verdicts.filter((v) => v.pass).length}/${verdicts.length} incl. responsive · ${SHOTS}`);
    code = cert.every((v) => v.pass) ? 0 : 1;
  } catch (e) { console.error(String(e?.stack || e)); code = 1; }
  finally { await browser?.close().catch(() => undefined); apiProc.kill('SIGTERM'); web.close(); await pool.end().catch(() => undefined); }
  process.exit(code);
}
