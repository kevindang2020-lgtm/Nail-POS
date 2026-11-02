// measure.mjs — Checkout one-screen certification (Checkout One-Screen + Payment Safety mandate §8–§12, §66, §77–§79).
// Loads the REAL POS bundle (build.mjs) against the fixture API (server.mjs) in Chromium and, per state × viewport, reports:
//   • document overflow (vertical / horizontal) and the Checkout page container's OWN overflow (an inner page scroll is a
//     page scroll too — §9 allows scrolling only inside fixed panels);
//   • every mandated module visible: present, inside the viewport, and actually painted at its centre (not clipped by an
//     ancestor's overflow) — KPI cards (9), Queue, Workspace, AI Checkout Insights, Transactions Needing Attention,
//     Available Front Desk / Ready Technicians, the 5 analytics cards, the 9 Quick Actions;
//   • touch targets: Quick Actions height (§66 54–62 px row), primary buttons ≥ 38 px;
//   • console errors; a screenshot.
// Primary target (repo standard, tooling/e2e/pos-vi-one-screen.mjs): a 1920×1080 screen with browser chrome + taskbar →
// a 1920×945 page. Usage: node measure.mjs [label] [states] [viewports]   (states: empty,normal,busy,unknown,split,tech200,big)
import { createRequire } from 'node:module';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const TOOLS = process.env.TOOLS || '/opt/npm-tools/node_modules';
const { chromium } = createRequire(join(TOOLS, 'x.js'))('playwright');
const LABEL = process.argv[2] || 'run';
const STATES = (process.argv[3] || 'empty,normal,busy,unknown,split,tech200,big').split(',');
const VIEWPORTS = (process.argv[4] || '1920x945,1920x1080,1600x900,2560x1440,1366x768').split(',').map((v) => v.split('x').map(Number));
// PAGE=service-done measures the Service Done board (Service Done mandate §118–§120) with the same method
const PAGES = {
  checkout: { url: '/checkout', ready: 'text=Checkout Workspace', container: '.checkout-page', shot: 'checkout',
    modules: ['Checkout Queue', 'Checkout Workspace', 'AI Checkout Insights', 'Transactions Needing Attention', 'Available Front Desk / Ready Technicians', 'Revenue Trend', 'Payment Mix', 'Checkout Conversion', 'Upsell Mix', 'Potential Revenue in Queue'],
    kpis: ['Guests Ready for Checkout', 'Completed Checkouts Today', 'Pending Payments', "Today's Revenue", 'Tips Captured', 'Avg Checkout Time', 'Gift Card / Loyalty Redemptions', 'Upsell at Checkout', 'Receipt Delivery Rate'],
    qa: ['New Checkout', 'Apply Discount', 'Split Payment', 'Take Payment', 'Send Receipt', 'View Signature', 'Rebook Guest', 'Open Customer', 'View Summary'] },
  'service-done': { url: '/service-done', ready: 'text=Service Done Board', container: '.service-done-page, .sd-page', shot: 'service-done',
    modules: ['Service Done', 'Completed Service Queue', 'Service Done Board', 'AI Service Done Insights', 'Technician Completion Performance', 'Guest Completion Details', 'Ready / Finishing Technicians', 'Completion Trend', 'Service Mix', 'Add-On Mix', 'Completion Funnel', 'Potential Revenue Ready for Checkout'],
    kpis: ['Completed Services Today', 'Ready for Checkout', 'Avg Service Duration', 'Avg Turnaround to Checkout', 'Add-On Revenue Today', 'Tips Captured', 'Rebooking Rate', 'Customer Satisfaction', 'Completion Accuracy'],
    qa: ['Move to Checkout', 'Open Guest', 'Add Upsell', 'Send Update', 'View Receipt', 'Open Customer', 'View Reports'] },
  // PAGE=serving — Serving mandate (Oct 28 2026) §9, §130–§132: every KPI, the six operational modules, the analytics row and
  // the Quick Actions visible at the primary viewport with zero main-page overflow
  serving: { url: '/serving', ready: 'text=Live Service Floor', container: '.serving-page', shot: 'serving',
    modules: ['Serving', 'Live Service Floor', 'Service Progress Board', 'AI Service Insights', 'Technician Service Performance', 'Guest Service Details', 'Available / Finishing Technicians', 'Service Time Trend', 'Service Mix', 'Add-On Mix', 'Completion Funnel', 'Potential Revenue in Progress'],
    kpis: ['Active Services', 'Ready to Finish', 'Avg Service Time', 'Technicians Busy', 'Add-On Conversion', 'Services Delayed', 'Upsell Revenue Today', 'Customer Satisfaction', 'On-Time Completion'],
    qa: ['Start Service', 'Move Stage', 'Add Upsell', 'Send Update', 'Mark Ready', 'Open Customer', 'View Reports'] },
  // PAGE=queue — Customer Queue mandate (Oct 28 2026) §8, §10, §84–§86: every queue KPI, the six operational modules, the
  // six analytics cards and the eight Quick Actions visible at the primary viewport with zero main-page overflow
  queue: { url: '/queue', ready: 'text=Live Customer Queue', container: '.customer-queue-page, .queue-page', shot: 'queue',
    modules: ['Customer Queue', 'Live Customer Queue', 'Queue Flow Board', 'AI Queue Insights', 'Waiting Guests by Priority', 'Customer Profile Preview', 'Available Technicians for Queue', 'Queue Trend Today', 'Customer Type Mix', 'Visit Source Mix', 'Top Waiting Services', 'Queue Conversion', 'Potential Revenue by Queue'],
    kpis: ['Guests Waiting', 'Walk-Ins', 'VIP Guests', 'Ready for Assignment', 'Avg Wait Time', 'Est. Queue Revenue', 'Ready for Service', 'No-Show Risk', 'Return Rate'],
    qa: ['New Walk-In', 'Add to Queue', 'Assign Tech', 'Send Wait Alert', 'Start Service', 'View Customer', 'Add Note', 'Open Queue Report'] },
  // PAGE=liveops — Live Operations 27-inch mandate (Oct 28 2026) §27–§28: the first and last KPI, all 11 modules and the
  // first and last Quick Action visible at zero scroll offset; no main-page overflow
  liveops: { url: '/live-operations', ready: "text=Today's Operations Snapshot", container: '.live-ops-page, .work', shot: 'live-ops',
    modules: ["Today's Operations Snapshot", 'Live Salon Activity', 'AI Insights', 'Revenue & Appointments Trend', 'Top Technicians Today', 'Top Services Today', 'Customer Retention', 'Payment Mix', 'Multi-Location Snapshot'],
    kpis: ["Today's Revenue", 'Monthly Card Volume', 'Check-ins Today', 'Appointments Today', 'Active Services', 'Average Ticket', 'Staff On Duty', 'AI Booking Conversion'],
    qa: ['New Check-In', 'New Booking', 'Walk-In', 'Assign Tech', 'Start Service', 'Take Payment', 'Send Message', 'Add Product', 'View Reports'] },
  // PAGE=checkin — Check-In 27-inch mandate (Oct 28 2026) §5, §100–§101: all 9 KPIs, the 10 modules and the 9 Quick Actions
  // visible at the primary viewport with zero main-page overflow
  checkin: { url: '/check-in', ready: 'text=Live Check-In Queue', container: '.check-in-page, .h-full.overflow-auto.p-5', shot: 'check-in',
    modules: ['Live Check-In Queue', 'Quick Check-In Panel', 'Front Desk Insights', "Today's Appointments Arriving", 'Waiting Lounge & Assignment', 'Available Technicians', 'Arrival Trend', 'Check-In Source Mix', 'Customer Type', 'Daily Front Desk Performance'],
    kpis: ['Check-Ins Today', 'Waiting Guests', 'Walk-Ins', 'Appt. Arriving Soon', 'Ready for Service', 'Average Wait Time', 'No-Shows', 'Techs Available', 'Customer Return Rate'],
    qa: ['New Check-In', 'New Booking', 'Walk-In', 'Assign Tech', 'Start Service', 'Take Payment', 'Send Message', 'Add Product', 'View Reports'] },
  // PAGE=overview — Overview 27-inch mandate (Oct 28 2026) §4, §34: all 8 KPIs, the 11 modules and the 9 Quick Actions
  // visible at the primary viewport with zero main-page overflow
  overview: { url: '/overview', ready: 'text=Live Tech Queue', container: '.overview-page, .work', shot: 'overview',
    modules: ['Arrivals & Check-In Queue', 'Live Tech Queue', 'Service Flow Overview', "Today's Appointments", 'Customer Communications', 'AI Insights', 'Revenue Trend', 'Technician Performance', 'Customer Retention', 'Payment Mix', 'Inventory Alerts'],
    kpis: ["Today's Check-ins", 'Waiting Guests', 'Walk-ins', 'Active Services', 'Ready for Checkout', "Today's Revenue", 'Average Ticket', 'Staff On Duty'],
    qa: ['New Check-In', 'New Booking', 'Walk-In', 'Assign Tech', 'Start Service', 'Take Payment', 'Add Product', 'Send Message', 'Open Cash Drawer'] },
};
const PAGE = PAGES[process.env.PAGE || 'checkout'];
const SERVER = process.env.SD_SERVER || 'new';
const OUTDIR = join(HERE, 'results', LABEL); mkdirSync(OUTDIR, { recursive: true });
const PORT = 4317; const BASE = `http://127.0.0.1:${PORT}`;

const srv = spawn(process.execPath, [join(HERE, 'server.mjs')], { env: { ...process.env, PORT: String(PORT) }, stdio: 'inherit' });
await new Promise((r) => setTimeout(r, 600));
const browser = await chromium.launch();
const rows = [];
try {
  for (const st of STATES) for (const [w, h] of VIEWPORTS) {
    await fetch(`${BASE}/__state?name=${st}&server=${SERVER}`);
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, hasTouch: true });
    const page = await ctx.newPage(); const errors = [];
    page.on('console', (m) => { if (m.type() === 'error' && !/404|Failed to load resource/.test(m.text())) errors.push(m.text().slice(0, 200)); });
    page.on('pageerror', (e) => errors.push('pageerror: ' + String(e.message).slice(0, 200)));
    await page.goto(`${BASE}${PAGE.url}`, { waitUntil: 'load' });
    await page.waitForSelector(PAGE.ready, { timeout: 15000 }).catch(() => errors.push('page heading never appeared'));
    await page.waitForLoadState('networkidle', { timeout: 4000 }).catch(() => undefined); await page.waitForTimeout(900);
    const m = await page.evaluate((PG) => {
      const se = document.scrollingElement; const vw = innerWidth, vh = innerHeight;
      const cp = document.querySelector(PG.container);
      const r = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height), bottom: Math.round(b.bottom), right: Math.round(b.right) }; };
      const painted = (el) => { const b = el.getBoundingClientRect(); if (b.width < 2 || b.height < 2) return false; if (b.top < 0 || b.left < 0 || b.bottom > vh + 0.5 || b.right > vw + 0.5) return false; const x = b.left + Math.min(b.width / 2, 20), y = b.top + Math.min(b.height / 2, 8); const at = document.elementFromPoint(x, y); return !!at && (el === at || el.contains(at) || at.contains(el)); };
      const byText = (t, sel = 'h1,h2,h3,button,span,div,th') => [...document.querySelectorAll(sel)].find((e) => e.textContent?.trim() === t || (e.children.length === 0 && e.textContent?.trim().startsWith(t)));
      const MODULES = PG.modules, KPIS = PG.kpis, QA = PG.qa;
      const vis = {}; for (const t of [...MODULES]) { const el = byText(t, 'h1,h2,h3'); vis[t] = el ? painted(el) : 'missing'; }
      const kpi = {}; for (const t of KPIS) { const el = byText(t, 'span,div'); kpi[t] = el ? painted(el) : 'missing'; }
      const qaPool = [...document.querySelectorAll('[data-testid$="quick-actions"] button, button.dqa, button.qa-btn')];
      const qaEls = QA.map((t) => qaPool.find((b) => b.textContent?.trim() === t));
      const qa = {}; QA.forEach((t, i) => { qa[t] = qaEls[i] ? painted(qaEls[i]) : 'missing'; });
      const qaH = qaEls.filter(Boolean).map((b) => Math.round(b.getBoundingClientRect().height));
      const header = document.querySelector('header, .topbar, [data-shell="topbar"]');
      return {
        vw, vh, docScrollY: Math.max(0, se.scrollHeight - vh), docScrollX: Math.max(0, se.scrollWidth - vw),
        pageScrollY: cp ? Math.max(0, cp.scrollHeight - cp.clientHeight) : null, pageScrollX: cp ? Math.max(0, cp.scrollWidth - cp.clientWidth) : null,
        pageBox: r(cp), contentHeight: cp ? cp.scrollHeight : null, header: r(header),
        modules: vis, kpis: kpi, quickActions: qa, quickActionHeights: qaH,
        banner: !!document.querySelector('[data-testid="payment-unknown-banner"]'),
        verifyButton: !!([...document.querySelectorAll('button')].find((b) => /Verify Payment/i.test(b.textContent || ''))),
        overflowHidden: cp ? getComputedStyle(cp).overflowY : null,
        scaleHacks: [...document.querySelectorAll('*')].some((e) => { const s = getComputedStyle(e); return (s.transform && /matrix\((?!1, 0, 0, 1)/.test(s.transform) && e.getBoundingClientRect().width > 600) || (s.zoom && s.zoom !== '1' && s.zoom !== 'normal'); }),
      };
    }, PAGE);
    const allVisible = (o) => Object.values(o).every((v) => v === true);
    const pass = m.docScrollY === 0 && m.docScrollX === 0 && (m.pageScrollY ?? 1) === 0 && (m.pageScrollX ?? 1) === 0 && allVisible(m.modules) && allVisible(m.kpis) && allVisible(m.quickActions) && !m.scaleHacks;
    const shot = join(OUTDIR, `${PAGE.shot}-${st}-${w}x${h}.png`);
    await page.screenshot({ path: shot });
    rows.push({ state: st, viewport: `${w}x${h}`, pass, ...m, errors });
    console.log(`${pass ? 'PASS' : 'FAIL'}  ${st.padEnd(8)} ${w}x${h}  doc ${m.docScrollY}/${m.docScrollX}  page ${m.pageScrollY}/${m.pageScrollX} (content ${m.contentHeight} in ${m.pageBox?.h})  hidden: ${[...Object.entries(m.modules), ...Object.entries(m.kpis), ...Object.entries(m.quickActions)].filter(([, v]) => v !== true).map(([k, v]) => k + (v === 'missing' ? '?' : '')).join(', ') || '—'}  QA h ${[...new Set(m.quickActionHeights)].join('/')}${errors.length ? '  errors ' + errors.length : ''}`);
    await ctx.close();
  }
} finally {
  await browser.close();
  const un = await fetch(`${BASE}/__unhandled`).then((r) => r.json()).catch(() => []);
  writeFileSync(join(OUTDIR, 'measurements.json'), JSON.stringify({ label: LABEL, at: new Date().toISOString(), rows, unhandledRoutes: un }, null, 1));
  srv.kill();
}
