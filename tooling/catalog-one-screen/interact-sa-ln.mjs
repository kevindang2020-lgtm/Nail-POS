// interact-sa-ln.mjs — Super Admin → Loyalty Network E2E (Global Loyalty & Rewards Network, Oct 30 2026). The REAL Super
// Admin bundle (APP=admin-web node tooling/checkout-one-screen/build.mjs) in Chromium against live-server.mjs in admin mode:
// the REAL SuperAdminGlobalRewardsController + GlobalRewardsController → service → repository → SQL on the seeded TEST
// database, the SANDBOX funding provider. No real money moves.
//   node tooling/catalog-one-screen/interact-sa-ln.mjs [label]
import { createRequire } from 'node:module';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url)); const ROOT = join(HERE, '..', '..');
const { chromium } = createRequire(join(process.env.TOOLS || '/opt/npm-tools/node_modules', 'x.js'))('playwright');
const LABEL = process.argv[2] || 'sa-ln-e2e'; const OUT = join(HERE, 'results', LABEL); mkdirSync(OUT, { recursive: true });
const PORT = Number(process.env.HARNESS_PORT || 4397), BASE = `http://127.0.0.1:${PORT}`;
const srv = spawn(process.execPath, ['--no-warnings', '--experimental-strip-types', '--import', join(ROOT, 'tooling/full-system-test/unit-standin/register.mjs'), join(HERE, 'live-server.mjs')],
  { env: { ...process.env, PORT: String(PORT), REPO_ROOT: ROOT, STUBS: '{}', FST_PG_TEMPLATE: process.env.FST_PG_TEMPLATE || 'aps', HARNESS_APP: 'admin' }, stdio: ['ignore', 'inherit', 'inherit'] });
for (let i = 0; i < 160; i++) { try { await fetch(`${BASE}/__log`); break; } catch { await new Promise((r) => setTimeout(r, 500)); } }
const J = (p) => fetch(BASE + p).then((r) => r.json());
const API = (p, init) => fetch(BASE + '/api/v1' + p, init).then((r) => r.json());
const rn = (qs) => J('/__rn?' + qs);
const browser = await chromium.launch(); const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });
const errors = []; page.on('pageerror', (e) => errors.push(String(e?.message ?? e)));
const results = [];
const expect = (c, m) => { if (!c) throw new Error(m); };
const tid = (t) => `[data-testid="${t}"]`;
const settle = async () => { await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => undefined); await page.waitForTimeout(400); };
const T = async (sel) => (await page.locator(sel).first().innerText()).replace(/\s+/g, ' ').trim();
const open = async (tab) => { await page.goto(BASE + '/loyalty-network', { waitUntil: 'load' }); await page.waitForSelector(tid('sa-loyalty-network'), { timeout: 20000 }); await settle(); if (tab) { await page.click(tid('sa-ln-tab-' + tab)); await settle(); } };
const note = async () => (await page.locator('[role="status"]').first().innerText().catch(() => '')).replace(/\s+/g, ' ');
async function step(name, fn) {
  const t0 = Date.now();
  try { const detail = await fn(); results.push({ name, ok: true, ms: Date.now() - t0, detail }); console.log('PASS ', name, ' — ', detail); }
  catch (e) { results.push({ name, ok: false, ms: Date.now() - t0, error: String(e?.message ?? e) }); console.log('FAIL ', name, ' — ', String(e?.message ?? e).slice(0, 300)); }
  await page.screenshot({ path: join(OUT, String(results.length).padStart(2, '0') + '-' + name.replace(/[^a-z0-9]+/gi, '-').toLowerCase().slice(0, 60) + '.png') }).catch(() => undefined);
}

try {
  await rn('reset=1&flags=on&provider=sandbox&stepup=off');
  await step('sa: the control centre opens from the nav; funding = SANDBOX; switches, values and impact = the server', async () => {
    await page.goto(BASE + '/dashboard', { waitUntil: 'load' }); await settle();
    const link = page.locator('a[href="/loyalty-network"]'); expect(await link.count() >= 1, 'nav link'); await link.first().click(); await page.waitForSelector(tid('sa-loyalty-network')); await settle();
    const ov = await API('/super-admin/loyalty-network/overview');
    expect(/SANDBOX/.test(await T(tid('sa-loyalty-network'))), 'sandbox badge');
    expect((await page.locator('[data-testid^="sa-ln-pause-"]').count()) === 4, 'four switches');
    expect((await T(tid('sa-ln-impact-global'))).includes(String(ov.impact.globalModeTenants)), 'impact');
    return `program v${ov.program.version} · global ${ov.impact.globalModeTenants} · custom ${ov.impact.customModeTenants} · healthy ${ov.reconciliation.healthy}`;
  });
  await step('sa: Salons — enroll the pilot salon with a reason (audited); its wallet opens at zero', async () => {
    await open('salons'); await page.fill('input[aria-label="Search salons"]', 'Pilot'); await page.waitForTimeout(600); await settle();
    const row = page.locator(tid('sa-ln-salon-row')).filter({ hasText: 'Pilot' }).first(); expect(await row.count() === 1, 'pilot row');
    await row.locator(tid('sa-ln-enroll')).click(); await page.waitForSelector(tid('sa-ln-reason-modal'));
    expect(await page.locator(tid('sa-ln-reason-confirm')).isDisabled(), 'reason required'); await page.fill(tid('sa-ln-reason'), 'Pilot salon joins the rewards network'); await page.click(tid('sa-ln-reason-confirm')); await settle();
    expect(/enrolled/i.test(await T(`${tid('sa-ln-salon-row')}:has-text("Pilot")`)), 'enrolled row');
    const db = await rn('state=1'); expect(db.wallet && Number(db.wallet.available_cents) === 0, 'wallet 0');
    return await T(`${tid('sa-ln-salon-row')}:has-text("Pilot")`);
  });
  await step('sa: Global rules — preview $5–$100 against the rule in force + salons reached; schedule; cancel before it starts', async () => {
    await open('rules'); await page.fill(tid('sa-ln-g-spend'), '5'); await page.fill(tid('sa-ln-g-points'), '1'); await page.click(tid('sa-ln-g-preview')); await page.waitForSelector(tid('sa-ln-g-preview-panel'));
    const pv = await T(tid('sa-ln-g-preview-panel')); expect(/Reaches \d+ salon/.test(pv), 'impact line'); expect(/\$100\.00 20 2 10 pts · 1 \+1/.test(pv), 'row $100: ' + pv.slice(0, 400));
    expect(await page.locator(tid('sa-ln-g-publish')).isDisabled(), 'reason required');
    const d = new Date(Date.now() + 3 * 86400e3); const p2 = (n) => String(n).padStart(2, '0');
    await page.fill('input[type="datetime-local"]', `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}T09:00`); await page.click(tid('sa-ln-g-preview')); await page.waitForSelector(tid('sa-ln-g-preview-panel'));
    await page.fill(tid('sa-ln-g-reason'), 'Harness: future global rule check'); await page.click(tid('sa-ln-g-publish')); await settle();
    expect(/scheduled for/.test(await note()), 'note ' + await note());
    const rowS = page.locator(`${tid('sa-ln-versions')} tr`).filter({ hasText: 'scheduled' }); expect(await rowS.count() >= 1, 'scheduled version');
    await rowS.first().locator('button', { hasText: 'Cancel' }).click(); await page.waitForSelector(tid('sa-ln-reason-modal')); await page.fill(tid('sa-ln-reason'), 'Harness: cancel the future rule'); await page.click(tid('sa-ln-reason-confirm')); await settle();
    expect(/canceled/.test(await note()), 'cancel note: ' + await note() + ' | ' + (await page.locator(tid('sa-ln-reason-modal')).innerText().catch(() => '')).slice(0, 200)); expect(await page.locator(`${tid('sa-ln-versions')} tr`).filter({ hasText: 'scheduled' }).count() === 0, 'none scheduled');
    const ov = await API('/super-admin/loyalty-network/overview'); const inForce = ov.globalVersions.filter((v) => v.status === 'published' && Date.parse(v.effectiveFrom) <= Date.now());
    expect(inForce.length >= 1 && inForce.every((v) => v.pointTenthsPerIncrement === 5), 'in-force rule unchanged');
    return 'preview + impact · scheduled → canceled · rule in force unchanged';
  });
  await step('sa: Overview — pause token purchases (reason) → the salon cannot buy; resume', async () => {
    await open('overview'); await page.locator(`${tid('sa-ln-pause-purchases_paused')} button`).click(); await page.waitForSelector(tid('sa-ln-reason-modal'));
    await page.fill(tid('sa-ln-reason'), 'Harness: pause purchases network-wide'); await page.click(tid('sa-ln-reason-confirm')); await settle();
    expect(/Paused/.test(await T(tid('sa-ln-pause-purchases_paused'))), 'paused');
    await J('/__role?r=OWNER'); const st = await API('/pos/loyalty/network/state'); await J('/__role?r=SUPER_ADMIN'); expect(st.program.purchasesPaused === true && st.permissions.canBuyTokens === false, 'salon blocked');
    await page.locator(`${tid('sa-ln-pause-purchases_paused')} button`).click(); await page.fill(tid('sa-ln-reason'), 'Harness: resume purchases network-wide'); await page.click(tid('sa-ln-reason-confirm')); await settle();
    expect(/Running/.test(await T(tid('sa-ln-pause-purchases_paused'))), 'resumed');
    return 'paused → salon canBuyTokens false → resumed';
  });
  await step('sa: Token purchases — a salon purchase is PAYMENT_CONFIRMED; the sandbox stand-in moves it to FUNDS_VERIFIED; books reconcile', async () => {
    await J('/__role?r=OWNER');
    const buy = await API('/pos/loyalty/network/purchases', { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': 'sa-harness-buy-' + Date.now() }, body: JSON.stringify({ tokens: 40 }) });
    await J('/__role?r=SUPER_ADMIN'); expect(buy.status === 'PAYMENT_CONFIRMED', 'buy ' + JSON.stringify(buy).slice(0, 160));
    await open('purchases'); const row = page.locator(tid('sa-ln-purchase-row')).first(); expect(/payment confirmed/.test(await row.innerText()), 'row status');
    await row.locator(tid('sa-ln-adv-FUNDS_VERIFIED')).click(); await settle();
    expect(/funds verified/.test(await page.locator(tid('sa-ln-purchase-row')).first().innerText()), 'verified');
    const db = await rn('state=1'); expect(Number(db.wallet.available_cents) === 4000, 'wallet 4000 ¢: ' + db.wallet.available_cents);
    await open('recon'); const rc = await T(tid('sa-ln-recon')); expect(!/Exception/.test(rc), 'recon: ' + rc.slice(0, 300));
    const r = await API('/super-admin/loyalty-network/reconciliation'); expect(r.healthy === true && r.unbalancedEntries === 0, 'healthy');
    return `wallet ${db.wallet.available_cents}¢ · prepaid liability ${r.balances.merchant_prepaid_liability}¢ · healthy`;
  });
  await step('sa: Integrity — a real cross-salon redemption shows as held→redeemed, $2 OWED (not paid); KPIs = the server', async () => {
    await J('/__rn?flags=on'); const red = await rn('redeem=1'); expect(red.redeemed?.outcome === 'confirmed', 'redeemed ' + JSON.stringify(red).slice(0, 200));
    await open('integrity'); await page.waitForSelector(tid('sa-ln-integrity'));
    const i = await API('/super-admin/loyalty-network/integrity');
    expect(i.payables.owedCents === 200, 'owed ' + i.payables.owedCents); expect(i.payouts.state === 'BLOCKED_EXTERNAL', 'payout state');
    expect(/\$2\.00/.test(await T(tid('sa-ln-kpi-owed'))), 'owed kpi ' + await T(tid('sa-ln-kpi-owed')));
    expect(/BLOCKED_EXTERNAL/.test(await T(tid('sa-ln-kpi-paid'))), 'paid kpi');
    expect(/Matches outstanding points/.test(await T(tid('sa-ln-kpi-liability'))), 'liability ' + await T(tid('sa-ln-kpi-liability')));
    return `owed ${i.payables.owedCents}¢ · liability ${i.liability.journalCents}¢ = points ${i.liability.outstandingValueCents}¢ · payouts ${i.payouts.state}`;
  });
  await step('sa: Integrity — Run check now (same checker as the daily job): no FAILED; payout provider = UNKNOWN finding; review it with a note', async () => {
    await page.click(tid('sa-ln-run-check')); await settle(); await page.waitForTimeout(500);
    const st = await T(tid('sa-ln-books-status')); expect(/UNKNOWN|PASS|WARNING/.test(st) && !/FAILED/.test(st.split('Last daily')[0]), 'status ' + st);
    const f = await API('/super-admin/loyalty-network/books-check/findings?pageSize=50');
    expect(f.items.some((x) => x.checkType === 'payout_provider' && x.outcome === 'UNKNOWN'), 'payout finding'); expect(!f.items.some((x) => x.outcome === 'FAILED'), 'no FAILED: ' + JSON.stringify(f.items.filter((x) => x.outcome === 'FAILED').map((x) => x.checkType)));
    await page.locator(`${tid('sa-ln-findings')} tr`, { hasText: 'payout provider' }).first().locator('button', { hasText: 'Review' }).click();
    await page.waitForSelector(tid('sa-ln-int-dialog')); await page.fill(tid('sa-ln-int-note'), 'Known: payout provider not approved yet'); await page.click(tid('sa-ln-int-save')); await settle();
    const after = await API('/super-admin/loyalty-network/books-check/findings?pageSize=50&outcome=UNKNOWN');
    expect(after.items.some((x) => x.checkType === 'payout_provider' && x.reviewStatus === 'INVESTIGATING'), 'reviewed');
    return st.slice(0, 160);
  });
  await step('sa: Integrity — payable Eligible → Pay out answers "no approved payout provider"; it stays owed (never PAID); lineage shows every stage', async () => {
    const row = page.locator(tid('sa-ln-payable-row')).first();
    await row.locator('button', { hasText: 'Eligible' }).click(); await settle();
    await page.locator(tid('sa-ln-payable-row')).first().locator(tid('sa-ln-payout')).click(); await settle();
    expect(/no approved payout provider/.test(await note()), 'note ' + await note());
    const p = await API('/super-admin/loyalty-network/payables?pageSize=5'); expect(p.items[0].status === 'PAYOUT_ELIGIBLE', 'status ' + p.items[0].status);
    await page.locator(tid('sa-ln-payable-row')).first().locator('button', { hasText: 'Lineage' }).click(); await page.waitForSelector(tid('sa-ln-lineage'));
    await page.waitForFunction(() => /Payable/.test(document.querySelector('[data-testid="sa-ln-lineage"]')?.textContent || ''));
    const lin = await T(tid('sa-ln-lineage')); expect(/confirmed redeemed/.test(lin) && /payout eligible/.test(lin) && /redemption committed/.test(lin), 'lineage ' + lin.slice(0, 300));
    await page.keyboard.press('Escape');
    return 'eligible → payout refused (BLOCKED_EXTERNAL) → still owed';
  });
  await step('sa: a salon user cannot reach the control centre API', async () => {
    await J('/__role?r=OWNER'); const r = await API('/super-admin/loyalty-network/overview'); await J('/__role?r=SUPER_ADMIN');
    expect(r.code === 'PERMISSION_DENIED', 'owner → ' + JSON.stringify(r).slice(0, 120)); return 'OWNER → PERMISSION_DENIED';
  });
  await step('sa: layout — 1440×900 and 1280×800 have no sideways page scroll', async () => {
    const out = [];
    for (const [w, h] of [[1440, 900], [1280, 800]]) {
      await page.setViewportSize({ width: w, height: h });
      for (const tab of ['overview', 'rules', 'salons', 'purchases', 'recon']) { await open(tab); const sx = await page.evaluate(() => document.scrollingElement.scrollWidth - innerWidth); expect(sx <= 0, `${w} ${tab} sideways ${sx}`); }
      out.push(`${w}×${h} ok`); await page.screenshot({ path: join(OUT, `sa-ln-${w}x${h}.png`) });
    }
    return out.join(' · ');
  });
} finally {
  const unhandled = await J('/__unhandled').catch(() => []);
  writeFileSync(join(OUT, 'results.json'), JSON.stringify({ label: LABEL, at: new Date().toISOString(), results, errors, unhandled }, null, 1));
  console.log(`\n${results.filter((r) => r.ok).length}/${results.length} steps passed · page errors: ${errors.length ? errors.slice(0, 5).join(' | ') : 'none'}`);
  await browser.close(); srv.kill();
}
