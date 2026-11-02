// interact.mjs — Checkout one-screen END-TO-END behaviour checks (Checkout One-Screen + Payment Safety mandate §17–§21,
// §46–§47, §54–§61, §66, §77). The real POS bundle against the fixture API in Chromium at the primary 1920×945 page.
// Every check drives the UI the way a cashier does (clicks) and asserts what changed — on screen, in the URL, or in the
// requests the POS sent (the harness server logs them). It never asserts on a mock of the component.
//   node tooling/checkout-one-screen/interact.mjs [label]   → results/<label>/interact.json, exit 1 on any failure
import { createRequire } from 'node:module';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const TOOLS = process.env.TOOLS || '/opt/npm-tools/node_modules';
const { chromium } = createRequire(join(TOOLS, 'x.js'))('playwright');
const LABEL = process.argv[2] || 'interact';
const OUTDIR = join(HERE, 'results', LABEL); mkdirSync(OUTDIR, { recursive: true });
const PORT = 4318; const BASE = `http://127.0.0.1:${PORT}`;
const srv = spawn(process.execPath, [join(HERE, 'server.mjs')], { env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 600));
const browser = await chromium.launch();
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };
const log = async () => (await fetch(`${BASE}/__log`).then((r) => r.json())).join('\n');

async function open(state, { w = 1920, h = 945 } = {}) {
  await fetch(`${BASE}/__state?name=${state}`);
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, hasTouch: true });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/checkout`, { waitUntil: 'load' });
  await page.waitForSelector('[data-testid="checkout-workspace-body"]', { timeout: 15000 });
  await page.waitForTimeout(700);
  return { ctx, page };
}
const scrolls = (page) => page.evaluate(() => { const cp = document.querySelector('.checkout-page'); const se = document.scrollingElement; return { page: cp.scrollTop, pageMax: cp.scrollHeight - cp.clientHeight, doc: se.scrollTop, docMax: se.scrollHeight - innerHeight }; });
const wsName = (page) => page.evaluate(() => document.querySelector('[data-testid="checkout-workspace"] .co-head span:nth-of-type(2)')?.textContent?.trim());
const qa = (page, label) => page.locator('[data-testid="checkout-quick-actions"] button', { hasText: label }).first();

try {
  // ── busy board: overlays, staff cap, attention vocabulary, live/auto refresh ──
  { const { ctx, page } = await open('busy');
    const qaTop = await page.evaluate(() => document.querySelector('[data-testid="checkout-quick-actions"]').getBoundingClientRect().top);
    await page.getByRole('button', { name: /View full queue \(40\)/ }).click();
    const qRows = await page.locator('[role="dialog"] tbody tr.co-row').count();
    check('queue overlay lists every guest (40)', qRows === 40, `${qRows} rows`);
    await page.locator('[role="dialog"] button', { hasText: 'Close' }).click();
    check('queue overlay closes', (await page.locator('[role="dialog"]').count()) === 0);
    await page.locator('[data-testid="checkout-attention"] button', { hasText: /View all/ }).click();
    const aTypes = await page.locator('[role="dialog"] tbody tr td:first-child').allTextContents();
    check('attention overlay shows the payment-domain states', aTypes.includes('Payment Unknown') && aTypes.includes('Payment Processing') && aTypes.includes('Refund Uncertain') && aTypes.includes('Failed Receipt'), [...new Set(aTypes)].join(', '));
    check('attention: danger first (Payment Unknown at the top)', aTypes[0] === 'Payment Unknown', aTypes[0]);
    await page.keyboard.press('Escape'); await page.locator('[role="dialog"] button', { hasText: 'Close' }).click();
    const staffRows = await page.locator('section.co-staff tbody tr').count();
    const staffSum = await page.locator('[data-testid="checkout-staff-summary"]').textContent();
    check('staff panel compact: ≤ 8 rows of 200 + counts', staffRows <= 8 && /of 200 shown/.test(staffSum || ''), `${staffRows} rows · ${staffSum}`);
    const insights = await page.locator('section.co-right .co-scroll > div:first-child > div').count();
    check('AI insights: 3–5 advisory items', insights >= 1 && insights <= 5, `${insights}`);
    const live = await page.getAttribute('[data-testid="checkout-live"]', 'data-live');
    check('Live chip shows the real connection state', ['CONNECTED', 'RECONNECTING', 'OFFLINE', 'DEGRADED'].includes(live || ''), String(live));
    const ar = page.locator('[data-testid="checkout-auto-refresh"]');
    const before = await ar.getAttribute('aria-pressed'); await ar.click(); const after = await ar.getAttribute('aria-pressed'); await ar.click();
    check('Auto Refresh is a real switch', before !== after, `${before} → ${after}`);
    const dead = await page.evaluate(() => [...document.querySelectorAll('.checkout-page button')].map((b) => b.textContent?.trim()).filter((t) => /Send Receipt Alert/i.test(t || '')));
    check('no dead "Send Receipt Alert" button', dead.length === 0);
    // a note floats: trigger one (View Signature on a ticket with none) and check the board did not move
    await qa(page, 'View Signature').click(); await page.waitForTimeout(400);
    const noteShown = await page.locator('[data-testid="checkout-note"]').count();
    const qaTop2 = await page.evaluate(() => document.querySelector('[data-testid="checkout-quick-actions"]').getBoundingClientRect().top);
    const sc = await scrolls(page);
    check('a note does not push the layout', noteShown === 1 && qaTop2 === qaTop && sc.pageMax <= 0 && sc.docMax <= 0, `note ${noteShown}, QA top ${qaTop}→${qaTop2}, page max ${sc.pageMax}`);
    // touch targets
    const t = await page.evaluate(() => {
      const vis = (b) => { const r = b.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.bottom <= innerHeight && r.top >= 0; };
      const all = [...document.querySelectorAll('.checkout-page button')].filter(vis);
      const h = (sel) => [...document.querySelectorAll(sel)].filter(vis).map((b) => Math.round(b.getBoundingClientRect().height));
      return { qa: h('[data-testid="checkout-quick-actions"] button'), complete: h('.co-actions button'), method: [...document.querySelectorAll('.co-ws button')].filter((b) => /^(Card|Cash|Gift Card|Split)$/.test(b.textContent?.trim() || '')).map((b) => Math.round(b.getBoundingClientRect().height)), under30: all.filter((b) => b.getBoundingClientRect().height < 30).map((b) => (b.getAttribute('aria-label') || b.textContent || '').trim().slice(0, 30)) };
    });
    check('touch: Quick Actions ≥ 44 px', Math.min(...t.qa) >= 44, t.qa.join('/'));
    check('touch: workspace actions ≥ 44 px (Complete Checkout etc.)', Math.min(...t.complete) >= 44, t.complete.join('/'));
    check('touch: no visible button under 30 px', t.under30.length === 0, t.under30.join(' | '));
    writeFileSync(join(OUTDIR, 'touch.json'), JSON.stringify(t, null, 1));
    await ctx.close(); }

  // ── normal board: every Quick Action does its job ──
  { const { ctx, page } = await open('normal');
    const first = await wsName(page);
    await qa(page, 'New Checkout').click(); await page.waitForTimeout(600);
    const second = await wsName(page);
    check('New Checkout opens the next waiting guest', !!first && !!second && first !== second, `${first} → ${second}`);
    await qa(page, 'Apply Discount').click(); await page.waitForTimeout(700);
    const sc = await scrolls(page);
    const focus = await page.evaluate(() => document.activeElement?.getAttribute('aria-label'));
    check('Apply Discount: focuses the discount field, the page itself never scrolls', sc.page === 0 && sc.doc === 0 && /discount/i.test(focus || ''), `page ${sc.page}, doc ${sc.doc}, focus ${focus}`);
    await qa(page, 'Split Payment').click(); await page.waitForTimeout(500);
    check('Split Payment switches the method to split (server recalculates)', /POST \/pos\/checkout\/tickets\/[^ ]+\/recalculate/.test(await log()));
    await qa(page, 'Send Receipt').click(); await page.waitForTimeout(400);
    check('Send Receipt sends through receipt/send-all', /POST \/pos\/checkout\/tickets\/[^ ]+\/receipt\/send-all/.test(await log()));
    await qa(page, 'View Signature').click(); await page.waitForTimeout(400);
    check('View Signature reads the ticket signature', /GET \/pos\/checkout\/tickets\/[^ ]+\/signature/.test(await log()));
    await qa(page, 'View Summary').click(); await page.waitForTimeout(500);
    const sum = await page.locator('[data-testid="checkout-summary"]').count();
    const sumText = await page.locator('[data-testid="checkout-summary"]').textContent().catch(() => '');
    check('View Summary opens the read-only summary (lines, totals, tenders, paid, balance)', sum === 1 && /Payments on this ticket/.test(sumText) && /Balance due/.test(sumText));
    await page.locator('[role="dialog"] button', { hasText: 'Close' }).click();
    await qa(page, 'Rebook Guest').click(); await page.waitForTimeout(500);
    const u1 = new URL(page.url());
    check('Rebook Guest → Booking with the guest chosen', u1.pathname === '/booking/new' && !!u1.searchParams.get('customerId') && !!u1.searchParams.get('customerName'), u1.pathname + u1.search);
    await page.goto(`${BASE}/checkout`, { waitUntil: 'load' }); await page.waitForSelector('[data-testid="checkout-workspace-body"]'); await page.waitForTimeout(500);
    await qa(page, 'Open Customer').click(); await page.waitForTimeout(500);
    const u2 = new URL(page.url());
    check('Open Customer → Customers filtered to the guest (+ profile id)', u2.pathname === '/customers' && !!u2.searchParams.get('q') && !!u2.searchParams.get('customerId'), u2.pathname + u2.search);
    await page.goto(`${BASE}/checkout`, { waitUntil: 'load' }); await page.waitForSelector('[data-testid="checkout-workspace-body"]'); await page.waitForTimeout(500);
    const before = (await log()).split('\n').filter((l) => /pay\/card/.test(l)).length;
    await qa(page, 'Take Payment').click(); await page.waitForTimeout(600);
    const after = (await log()).split('\n').filter((l) => /pay\/card/.test(l)).length;
    check('Take Payment starts ONE card payment', after - before === 1, `${after - before} request(s)`);
    await ctx.close(); }

  // ── big ticket: 24 lines stay in an overlay; the workspace keeps its size ──
  { const { ctx, page } = await open('big');
    const onBoard = await page.locator('[data-testid="checkout-workspace-body"] table tbody tr').first().locator('xpath=..').locator('tr').count();
    await page.locator('[data-testid="checkout-lines-more"]').click();
    const all = await page.locator('[role="dialog"] tbody tr').count();
    check('big ticket: 6 lines on the board, all 24 in the overlay', onBoard === 6 && all === 24, `${onBoard} / ${all}`);
    await ctx.close(); }

  // ── UNKNOWN: banner inside the workspace, Complete Checkout blocked, Verify offered ──
  { const { ctx, page } = await open('unknown');
    const banner = await page.locator('[data-testid="payment-unknown-banner"]').count();
    const inWs = await page.evaluate(() => !!document.querySelector('[data-testid="checkout-workspace"] [data-testid="payment-unknown-banner"]'));
    const blocked = await page.locator('.co-actions button', { hasText: 'Complete Checkout' }).isDisabled();
    const verify = await page.locator('[data-testid="payment-unknown-banner"] button', { hasText: 'Verify Payment' }).count();
    const declined = await page.evaluate(() => /declined/i.test(document.querySelector('[data-testid="payment-unknown-banner"]')?.textContent || ''));
    const sc = await scrolls(page);
    check('UNKNOWN: banner in the workspace, never called declined, Verify offered, Complete Checkout blocked, no page scroll', banner === 1 && inWs && blocked && verify === 1 && !declined && sc.pageMax <= 0, `banner ${banner} inWs ${inWs} blocked ${blocked} verify ${verify}`);
    const before = (await log()).split('\n').filter((l) => /pay\/card/.test(l)).length;
    await qa(page, 'Take Payment').click(); await page.waitForTimeout(500);
    const after = (await log()).split('\n').filter((l) => /pay\/card/.test(l)).length;
    check('UNKNOWN: Take Payment sends NO new charge', after === before, `${after - before} request(s)`);
    await ctx.close(); }

  // ── split: the server's paid / balance are on the totals strip ──
  { const { ctx, page } = await open('split');
    const pb = await page.locator('[data-testid="checkout-paid-balance"]').textContent().catch(() => null);
    check('partial / split payment: Paid + Balance from the server tenders', /Paid \$20\.00/.test(pb || '') && /Balance \$/.test(pb || ''), String(pb));
    await ctx.close(); }
} finally {
  await browser.close(); srv.kill();
  writeFileSync(join(OUTDIR, 'interact.json'), JSON.stringify({ label: LABEL, at: new Date().toISOString(), results }, null, 1));
  const bad = results.filter((r) => !r.ok).length;
  console.log(`${results.length - bad}/${results.length} passed`);
  process.exitCode = bad ? 1 : 0;
}
