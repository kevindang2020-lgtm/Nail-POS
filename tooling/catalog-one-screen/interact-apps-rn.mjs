// interact-apps-rn.mjs — Customer App "My Rewards" + Owner App "Rewards" E2E (Final Completion guide §10–§11). The REAL app
// bundles (APP=customer-web / owner-web build.mjs) in Chromium against live-server.mjs in customer / owner mode: the REAL
// CustomerRewardsController / OwnerRewardsController → rewards-apps.ts → SQL on the seeded TEST database, after a REAL
// cross-salon hold → paid → finalize on the pilot salon. No real money moves.
//   node tooling/catalog-one-screen/interact-apps-rn.mjs [label]
import { createRequire } from 'node:module';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url)); const ROOT = join(HERE, '..', '..');
const { chromium } = createRequire(join(process.env.TOOLS || '/opt/npm-tools/node_modules', 'x.js'))('playwright');
const LABEL = process.argv[2] || 'apps-rn-e2e'; const OUT = join(HERE, 'results', LABEL); mkdirSync(OUT, { recursive: true });
const results = []; const errors = [];
const expect = (c, m) => { if (!c) throw new Error(m); };
const tid = (t) => `[data-testid="${t}"]`;

async function withApp(app, port, body) {
  const BASE = `http://127.0.0.1:${port}`;
  const srv = spawn(process.execPath, ['--no-warnings', '--experimental-strip-types', '--import', join(ROOT, 'tooling/full-system-test/unit-standin/register.mjs'), join(HERE, 'live-server.mjs')],
    { env: { ...process.env, PORT: String(port), REPO_ROOT: ROOT, STUBS: '{}', FST_PG_TEMPLATE: process.env.FST_PG_TEMPLATE || 'aps', HARNESS_APP: app }, stdio: ['ignore', 'inherit', 'inherit'] });
  for (let i = 0; i < 160; i++) { try { await fetch(`${BASE}/__log`); break; } catch { await new Promise((r) => setTimeout(r, 500)); } }
  const browser = await chromium.launch(); const page = await browser.newPage({ viewport: { width: 430, height: 932 } });
  page.on('pageerror', (e) => errors.push(`${app}: ${String(e?.message ?? e)}`));
  const J = (p) => fetch(BASE + p).then((r) => r.json());
  const API = (p, init) => fetch(BASE + '/api/v1' + p, init).then((r) => r.json());
  const settle = async () => { await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => undefined); await page.waitForTimeout(400); };
  const T = async (sel) => (await page.locator(sel).first().innerText()).replace(/\s+/g, ' ').trim();
  const step = async (name, fn) => {
    const t0 = Date.now();
    try { const detail = await fn(); results.push({ name, ok: true, ms: Date.now() - t0, detail }); console.log('PASS ', name, ' — ', detail); }
    catch (e) { results.push({ name, ok: false, ms: Date.now() - t0, error: String(e?.message ?? e) }); console.log('FAIL ', name, ' — ', String(e?.message ?? e).slice(0, 300)); }
    await page.screenshot({ path: join(OUT, String(results.length).padStart(2, '0') + '-' + name.replace(/[^a-z0-9]+/gi, '-').toLowerCase().slice(0, 60) + '.png'), fullPage: true }).catch(() => undefined);
  };
  try { await body({ page, J, API, settle, T, step, BASE }); } finally { await browser.close(); srv.kill(); }
}

try {
  await withApp('customer', 4398, async ({ page, J, API, settle, T, step, BASE }) => {
    await J('/__rn?reset=1&flags=on&enroll=1'); const red = await J('/__rn?redeem=1'); expect(red.redeemed?.outcome === 'confirmed', 'seed redemption ' + JSON.stringify(red).slice(0, 160));
    await step('customer: My Rewards — available 10 / held 0, $1.00 to use; the redemption at this salon is listed with its ticket ref', async () => {
      await page.goto(BASE + '/rewards', { waitUntil: 'load' }); await page.waitForSelector(tid('my-rewards')); await settle(); await page.waitForTimeout(3000);   // the launch splash fades out
      const v = await API('/customer/global-rewards'); expect(v.state === 'ACTIVE', 'state ' + v.state);
      const bal = await T(tid('rewards-balance')); expect(/Available 10 pts/.test(bal) && /= \$1\.00 to use/.test(bal) && /Held 0 pts/.test(bal), 'balance ' + bal);
      const reds = await T(tid('rewards-redemptions')); expect(/Redeemed/.test(reds) && /T-[0-9A-F]{6}/.test(reds) && /−20/.test(reds), 'redemptions ' + reds);
      expect(/Points do not expire/.test(bal), 'no invented expiry');
      return `${v.account.availablePoints} available · ${v.account.heldPoints} held · ${v.redemptions.length} redemption(s)`;
    });
    await step('customer: leaving keeps the points (no forfeiture); joining again needs the terms + an affirmative tick', async () => {
      await page.getByText('Leave AI PowerSalon Rewards').click(); await page.click(tid('rewards-leave')); await settle();
      await page.waitForSelector(tid('rewards-optin')); const box = await T(tid('rewards-optin'));
      expect(/You still have 10 points/.test(box), 'kept ' + box); expect(/Terms version/.test(box) && /Privacy policy/.test(box), 'terms + privacy');
      expect(await page.locator(tid('rewards-join')).isDisabled(), 'join needs the tick');
      await page.check(tid('rewards-agree')); await page.click(tid('rewards-join')); await settle(); await page.waitForTimeout(600);
      const v = await API('/customer/global-rewards'); expect(v.state === 'ACTIVE' && v.account.availablePoints === '10', 'rejoined ' + v.state + ' ' + v.account?.availablePoints);
      const opt = await API('/customer/global-rewards/opt-in', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ termsVersion: 'old-version', accept: true }) });
      expect(opt.code === 'VALIDATION_FAILED', 'stale terms refused ' + JSON.stringify(opt).slice(0, 120));
      return 'withdrawn (points kept) → rejoined with explicit consent; stale terms version refused';
    });
    await step('customer: only a CUSTOMER session sees My Rewards (an owner session is refused)', async () => {
      await J('/__role?r=OWNER'); const r = await API('/customer/global-rewards'); await J('/__role?r=CUSTOMER');
      expect(r.code === 'PERMISSION_DENIED', 'owner → ' + JSON.stringify(r).slice(0, 120)); return 'OWNER → PERMISSION_DENIED';
    });
  });
  await withApp('owner', 4399, async ({ page, J, API, settle, T, step, BASE }) => {
    await J('/__rn?reset=1&flags=on&enroll=1'); await J('/__rn?redeem=1');
    await step('owner: Rewards — accepted points, $2.00 OWED (not paid), payouts BLOCKED_EXTERNAL, Buy Tokens not offered; numbers = the server', async () => {
      await page.goto(BASE + '/', { waitUntil: 'load' }); await settle();
      const more = page.getByRole('button', { name: /More/ }); if (await more.count()) { await more.first().click(); await settle(); }
      await page.getByText('AI PowerSalon Rewards').first().click(); await page.waitForSelector(tid('owner-rewards')); await settle();
      const v = await API('/owner/loyalty/rewards');
      expect(v.owed.totalCents === 200, 'owed ' + v.owed.totalCents); expect(v.accepted.length >= 1, 'accepted');
      expect(/\$2\.00/.test(await T(tid('owner-rewards-owed'))), 'owed kpi ' + await T(tid('owner-rewards-owed')));
      expect(/never shown as paid/.test(await T(tid('owner-payout-state'))), 'payout state');
      expect(/Not available|TEST/.test(await T(tid('owner-buy-state'))), 'buy state ' + await T(tid('owner-buy-state')));
      expect(/20 pts/.test(await T(tid('owner-rewards-accepted'))), 'accepted row');
      return `owed ${v.owed.totalCents}¢ · accepted ${v.accepted.length} · payouts ${v.payouts.state} · buy ${v.buyTokens.state}`;
    });
    await step('owner: a front-desk session cannot read the owner rewards view', async () => {
      await J('/__role?r=FRONT_DESK'); const r = await API('/owner/loyalty/rewards'); await J('/__role?r=OWNER');
      expect(r.code === 'PERMISSION_DENIED', 'desk → ' + JSON.stringify(r).slice(0, 120)); return 'FRONT_DESK → PERMISSION_DENIED';
    });
  });
} finally {
  writeFileSync(join(OUT, 'results.json'), JSON.stringify({ label: LABEL, at: new Date().toISOString(), results, errors }, null, 1));
  console.log(`\n${results.filter((r) => r.ok).length}/${results.length} steps passed · page errors: ${errors.length ? errors.slice(0, 5).join(' | ') : 'none'}`);
}
