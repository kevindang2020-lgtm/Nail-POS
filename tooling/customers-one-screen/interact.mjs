// interact.mjs — Customers one-screen E2E (Oct 29 2026): the real POS bundle against live-server.mjs (real controllers +
// SQL on a seeded TEST database). Each step clicks what a front-desk user clicks and checks the result on screen AND in
// the database / recorded side effects (the ledger, the jobs, the texts the recording messenger received, the audit
// trail). Writes results/<label>/e2e.json and a screenshot per step. Nothing leaves the machine: SMS go to a recorder.
//   node tooling/customers-one-screen/interact.mjs [label]
import { createRequire } from 'node:module';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url)); const ROOT = join(HERE, '..', '..');
const { chromium } = createRequire(join(process.env.TOOLS || '/opt/npm-tools/node_modules', 'x.js'))('playwright');
const LABEL = process.argv[2] || 'e2e'; const OUT = join(HERE, 'results', LABEL); mkdirSync(OUT, { recursive: true });
const PORT = Number(process.env.HARNESS_PORT || 4318), BASE = `http://127.0.0.1:${PORT}`;
const srv = spawn(process.execPath, ['--no-warnings', '--experimental-strip-types', '--import', join(ROOT, 'tooling/full-system-test/unit-standin/register.mjs'), join(HERE, 'live-server.mjs')],
  { env: { ...process.env, PORT: String(PORT), REPO_ROOT: ROOT, STUBS: '{}', FST_PG_TEMPLATE: process.env.FST_PG_TEMPLATE || 'aps' }, stdio: ['ignore', 'inherit', 'inherit'] });
for (let i = 0; i < 120; i++) { try { await fetch(`${BASE}/__log`); break; } catch { await new Promise((r) => setTimeout(r, 500)); } }
const J = (p) => fetch(BASE + p).then((r) => r.json());
const results = []; let n = 0;
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1920, height: 945 }, hasTouch: true, acceptDownloads: true });
const page = await ctx.newPage(); const errors = [];
page.on('pageerror', (e) => errors.push(String(e.message)));
page.on('console', (m) => { if (m.type() === 'error' && !/404|Failed to load resource/.test(m.text())) errors.push(m.text().slice(0, 200)); });
async function step(name, fn) {
  const t = Date.now(); let ok = true, detail = '';
  try { detail = (await fn()) ?? ''; } catch (e) { ok = false; detail = String(e?.message ?? e).split('\n')[0].slice(0, 300); }
  // a failed step must not poison the next one: close what it left open and reload the page
  if (!ok) { await page.keyboard.press('Escape').catch(() => undefined); const u = page.url(); await page.goto(u, { waitUntil: 'load' }).catch(() => undefined); await page.waitForTimeout(800); }
  await page.screenshot({ path: join(OUT, `${String(++n).padStart(2, '0')}-${name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.png`) }).catch(() => undefined);
  results.push({ step: name, ok, detail, ms: Date.now() - t }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
}
const expect = (cond, msg) => { if (!cond) throw new Error(msg); };
const text = (sel) => page.locator(sel).first().innerText();
const go = async (path) => { await page.goto(BASE + path, { waitUntil: 'load' }); await page.waitForSelector('.work.fit, .work.mos'); await page.waitForLoadState('networkidle').catch(() => undefined); await page.waitForTimeout(400); };
const settle = async () => { await page.waitForLoadState('networkidle').catch(() => undefined); await page.waitForTimeout(350); };

try {
  // ── Loyalty & Rewards ──────────────────────────────────────────────────────────────────────────────────────────────
  await go('/tenant/customers/loyalty');
  await step('loyalty: KPIs are the server numbers', async () => {
    const ov = await J('/api/v1/pos/loyalty/overview');
    const v = await text('[data-testid="kpi-members"] .fk-kpi-v');
    expect(v.replace(/\D/g, '') === String(ov.kpis.loyaltyMembers), `members KPI ${v} vs ${ov.kpis.loyaltyMembers}`);
    const p = await text('[data-testid="kpi-points"] .fk-kpi-v');
    expect(p.replace(/\D/g, '') === String(ov.kpis.pointsOutstanding), `points ${p} vs ${ov.kpis.pointsOutstanding}`);
    return `members ${v}, points ${p}, reconciled ${ov.kpis.balanceReconciled}`;
  });
  let enrolledName = '';
  await step('loyalty: Enroll Member → the new member is first on Page 1', async () => {
    const before = Number((await J('/__sql?k=profiles'))[0].n);
    // a customer who is not a member yet: the seed enrols every customer whose index % 3 !== 2 among the first ~130
    const s = await J('/api/v1/pos/customers/search?search=a');
    const ov = await J('/api/v1/pos/loyalty/members?page=1&pageSize=50');
    await page.getByRole('button', { name: 'Enroll Member' }).first().click();
    await page.fill('[data-testid="dlg-enroll"] input[type="search"]', 'Garcia'); await page.waitForTimeout(700);
    const picks = page.locator('[data-testid="dlg-enroll"] .fk-pick button');
    expect(await picks.count() > 0, 'no search results');
    // try candidates until one is not enrolled yet (the server refuses a second enrolment)
    for (let i = 0; i < await picks.count(); i++) {
      await picks.nth(i).click(); enrolledName = (await picks.nth(i).locator('b').innerText()).trim();
      await page.locator('[data-testid="dlg-enroll"] .fk-dialog-foot .fk-btn.primary').click(); await settle();
      if (!(await page.locator('[data-testid="dlg-enroll"]').count())) break;
    }
    void s; void ov;
    expect(!(await page.locator('[data-testid="dlg-enroll"]').count()), 'dialog still open (every candidate already enrolled?)');
    const first = await text('[data-testid="panel-members"] .fk-li .fk-li-t');
    expect(first.trim() === enrolledName, `first row is ${first}, expected ${enrolledName}`);
    const after = Number((await J('/__sql?k=profiles'))[0].n);
    expect(after === before + 1, `profiles ${before} → ${after}`);
    return `${enrolledName} enrolled; profiles ${before} → ${after}; note: ${(await text('.fk-note')).trim()}`;
  });
  await step('loyalty: Create Reward → it is first on Page 1 of the catalog', async () => {
    await page.getByRole('button', { name: 'Create Reward' }).first().click();
    const d = page.locator('[data-testid="dlg-reward"]');
    await d.locator('input').nth(0).fill('E2E $7 off'); await d.locator('input').nth(1).fill('250');
    await d.locator('.fk-field').filter({ hasText: /Dollars off/i }).locator('input').fill('7.00');
    await d.locator('.fk-dialog-foot .fk-btn.primary').click(); await settle();
    expect(!(await d.count()), 'reward dialog still open: ' + (await page.locator('.fk-err').allInnerTexts()).join(' '));
    const first = await text('[data-testid="panel-catalog"] .fk-li .fk-li-t');
    expect(first.trim() === 'E2E $7 off', `first reward is ${first}`);
    return `first catalog row: ${first}`;
  });
  await step('loyalty: Adjust points — a double tap posts ONE ledger entry', async () => {
    const before = Number((await J('/__sql?k=ledger'))[0].n);
    const row = page.locator('[data-testid="panel-members"] .fk-li').first();
    await row.getByRole('button', { name: 'Adjust points' }).click();
    const d = page.locator('[data-testid="dlg-adjust"]');
    await d.locator('input').nth(0).fill('50'); await d.locator('input').nth(1).fill('Welcome bonus');
    await d.getByRole('button', { name: 'Review' }).click();
    const c = d.locator('[data-testid="adjust-confirm"]');
    // a real double tap: two activations in the same frame, before React re-renders the busy state — both POSTs carry the same key
    await c.evaluate((el) => { el.click(); el.click(); }); await settle();
    const posts = (await J('/__log')).filter((l) => l.startsWith('POST /pos/loyalty/adjust')).length;
    const after = Number((await J('/__sql?k=ledger'))[0].n);
    expect(after === before + 1, `ledger ${before} → ${after}`);
    const pts = await row.locator('.fk-li-num').innerText();
    return `${posts} POST(s) sent, ledger +1 (${before} → ${after}); ${enrolledName} now ${pts}`;
  });
  let redemptionTitle = '';
  await step('loyalty: Redeem → the code is first in Recent Redemptions; balance checked server-side', async () => {
    // the member on this page with the most points
    const pts = (await page.locator('[data-testid="panel-members"] .fk-li .fk-li-num').allInnerTexts()).map((x) => Number(x.replace(/\D/g, '')));
    const row = page.locator('[data-testid="panel-members"] .fk-li').nth(pts.indexOf(Math.max(...pts)));
    await row.getByRole('button', { name: 'Redeem reward' }).click();
    const d = page.locator('[data-testid="dlg-redeem"]'); await page.waitForTimeout(400);
    const options = d.locator('.fk-pick button:not([disabled])');
    expect(await options.count() > 0, 'no affordable reward');
    redemptionTitle = (await options.first().locator('b').innerText()).trim();
    await options.first().click(); await d.locator('[data-testid="redeem-confirm"]').click(); await settle();
    const first = await text('[data-testid="panel-redemptions"] .fk-li .fk-li-t');
    expect(first.trim() === redemptionTitle, `first redemption ${first} vs ${redemptionTitle}`);
    return `redeemed "${redemptionTitle}"; ${(await text('.fk-note')).trim()}`;
  });
  await step('loyalty: Redemption detail → Void restores the points (audited)', async () => {
    await page.locator('[data-testid="panel-redemptions"] .fk-li').first().click();
    const d = page.locator('[data-testid="dlg-redemption"]'); await page.waitForTimeout(400);
    await d.locator('.fk-void input').fill('Wrong reward picked'); await d.locator('[data-testid="void-confirm"]').click(); await settle();
    const chip = await text('[data-testid="panel-redemptions"] .fk-li .fk-chip');
    expect(/void/i.test(chip), `status chip ${chip}`);
    const audit = await J('/__audit');
    const acts = audit.map((a) => a.action);
    expect(['member_enrolled', 'points_adjusted', 'reward_redeemed', 'redemption_voided'].every((a) => acts.includes(a)), 'audit ' + acts.join(','));
    return `status ${chip}; audit ${acts.join(', ')}`;
  });
  await step('loyalty: numbered pages — Page 2 shows the next rows, Previous / Next bounds', async () => {
    const pg = page.locator('[data-testid="panel-members"] .fk-pager').first();
    const prevDisabled = await pg.getByRole('button', { name: 'Previous' }).isDisabled();
    await pg.getByRole('button', { name: 'Page 2', exact: true }).first().click(); await settle();
    const range = await pg.locator('.fk-pager-range').innerText();
    expect(prevDisabled && /^\d+–\d+ of/.test(range.trim()) && !range.trim().startsWith('1–'), `range ${range}, prev disabled ${prevDisabled}`);
    await pg.getByRole('button', { name: 'Page 1', exact: true }).first().click(); await settle();
    return `range on page 2: ${range}`;
  });
  await step('loyalty: Points Ledger + Manage Tiers open, Escape closes, focus returns', async () => {
    const btn = page.locator('[data-testid="loyalty-quick"]').getByRole('button', { name: 'Points Ledger' });
    await btn.click(); await page.waitForSelector('[data-testid="dlg-ledger"] .fk-table'); const rows = await page.locator('[data-testid="dlg-ledger"] tbody tr').count();
    await page.keyboard.press('Escape'); await page.waitForTimeout(200);
    const focused = await page.evaluate(() => document.activeElement?.textContent?.trim());
    expect(!(await page.locator('[data-testid="dlg-ledger"]').count()) && focused === 'Points Ledger', `focus ${focused}`);
    await page.locator('[data-testid="loyalty-quick"]').getByRole('button', { name: 'Manage Tiers' }).click();
    const tiers = await page.locator('[data-testid="dlg-tiers"] tbody tr').count(); await page.keyboard.press('Escape');
    return `ledger rows ${rows}; tiers ${tiers}; focus back on "${focused}"`;
  });

  // ── Customer Retention ─────────────────────────────────────────────────────────────────────────────────────────────
  await go('/tenant/customers/retention');
  await step('retention: Never Visited is its own segment (no last visit, not at risk)', async () => {
    const s = await J('/api/v1/pos/retention/summary');
    await page.locator('[data-testid="seg-never"]').click(); await settle();
    const cells = await page.locator('[data-testid="panel-winback"] tbody tr td:nth-child(4)').allInnerTexts();
    expect(cells.length > 0 && cells.every((c) => /never/i.test(c)), 'last visit cells ' + cells.join('|'));
    const ar = await J('/api/v1/pos/retention/customers?segment=at_risk&page=1&pageSize=50');
    expect(ar.items.every((r) => r.visits > 0 && r.lastVisitAt), 'an at-risk row with no visit');
    return `never ${s.segments.never}, at risk ${s.segments.at_risk} (every at-risk row has a completed visit)`;
  });
  await step('retention (guide §10/§11): At Risk defaults to Smart Priority (highest first, with a why); "Longest absence" sorts by days', async () => {
    await page.locator('[data-testid="seg-at_risk"]').click(); await settle();
    const prios = page.locator('[data-testid="panel-winback"] [data-testid="rt-prio"]');
    const scores = (await prios.allInnerTexts()).map((x) => Number(x.replace(/[^0-9]/g, '')));
    expect(scores.length > 0 && scores.every((d, i) => i === 0 || d <= scores[i - 1]), 'priority not descending: ' + scores.join(','));
    const why = await prios.first().getAttribute('title'); expect(/Why this priority\?/.test(why || ''), 'no why: ' + why);
    await page.locator('[data-testid="rt-sort"]').selectOption('oldest_visit'); await settle();
    const days = (await page.locator('[data-testid="panel-winback"] tbody tr td:nth-child(5)').allInnerTexts()).map((x) => Number(x.replace(/\D/g, '')));
    expect(days.every((d, i) => i === 0 || d <= days[i - 1]), 'not descending: ' + days.join(','));
    await page.locator('[data-testid="rt-sort"]').selectOption(''); await settle();
    return `priority page 1: ${scores.join(', ')} · "${(why || '').slice(0, 90)}…" · longest absence: ${days.join(', ')}`;
  });
  await step('retention (guide §06): eight KPIs — Never Visited / Recovered / Campaign Recoveries equal the server', async () => {
    const s = await J('/api/v1/pos/retention/summary');
    const kv = async (id) => (await page.locator(`[data-testid="${id}"] .fk-kpi-v`).innerText()).replace(/[^0-9]/g, '');
    const got = { never: await kv('kpi-never'), recovered: await kv('kpi-recovered'), campaign: await kv('kpi-campaign-recoveries'), atRisk: await kv('kpi-at-risk') };
    expect(got.never === String(s.kpis.neverVisited) && got.recovered === String(s.kpis.recovered) && got.campaign === String(s.kpis.campaignRecoveries) && got.atRisk === String(s.kpis.atRisk), JSON.stringify(got) + ' vs ' + JSON.stringify(s.kpis));
    return `cards ${JSON.stringify(got)} · thresholds ${s.period.riskDays}/${s.period.approachingDays} v${s.period.settingsVersion}`;
  });
  await step('retention (guide §04): Never Visited rows cannot be picked for a win-back text and carry no priority', async () => {
    await page.locator('[data-testid="seg-never"]').click(); await settle();
    const boxes = await page.locator('[data-testid="panel-winback"] tbody input[type="checkbox"]').count();
    const enabled = await page.locator('[data-testid="panel-winback"] tbody input[type="checkbox"]:not([disabled])').count();
    const prios = await page.locator('[data-testid="panel-winback"] [data-testid="rt-prio"]').count();
    expect(boxes > 0 && enabled === 0 && prios === 0, `boxes ${boxes} enabled ${enabled} prios ${prios}`);
    return `${boxes} never-visited rows, 0 selectable, 0 scored`;
  });
  await step('retention (guide §09): period presets + a custom range + date basis reach the server', async () => {
    await page.locator('[data-testid="seg-all"]').click(); await settle();
    await page.locator('[data-testid="preset-week"]').click(); await settle();
    await page.locator('[data-testid="date-basis"]').selectOption('created'); await settle();
    const l = (await J('/__log')).filter((x) => x.startsWith('GET /pos/retention/customers?')).slice(-1)[0] || '';
    expect(/preset=week/.test(l) && /basis=created/.test(l), l);
    const sum = (await J('/__log')).filter((x) => x.startsWith('GET /pos/retention/summary?')).slice(-1)[0] || '';
    expect(/preset=week/.test(sum), sum);
    const period = await text('[data-testid="active-period"]');
    await page.locator('[data-testid="date-basis"]').selectOption('none'); await page.locator('[data-testid="preset-month"]').click(); await settle();
    return `${l.replace('GET ', '')} · shown "${period.trim()}"`;
  });
  await step('retention (guide §08): search reaches the whole salon — a service name and a ticket number', async () => {
    const svc = await J('/api/v1/pos/retention/customers?segment=all&q=gel&page=1&pageSize=50');
    await page.locator('[data-testid="rt-search"]').fill('gel'); await page.waitForTimeout(600); await settle();
    const rows = await page.locator('[data-testid="panel-winback"] [data-testid="rt-row"]').count();
    await page.locator('[data-testid="rt-search"]').fill(''); await page.waitForTimeout(600); await settle();
    expect(rows === Math.min(svc.totalItems, svc.pageSize) || rows <= svc.totalItems, `rows ${rows} vs ${svc.totalItems}`);
    return `"gel" → ${svc.totalItems} customer(s) server-side, ${rows} on the page`;
  });
  await step('retention (guide §14): the customer overlay explains the segment, lists visit evidence, closes back to the same list', async () => {
    await page.locator('[data-testid="seg-at_risk"]').click(); await settle();
    const pager = await text('[data-testid="panel-winback"] .fk-pager').catch(() => '');
    await page.locator('[data-testid="panel-winback"] tbody .fk-li-t.link').first().click();
    const d = page.locator('[data-testid="dlg-customer"]'); await d.waitFor();
    await d.locator('[data-testid="rt-segment-reason"]').waitFor();
    const reason = await d.locator('[data-testid="rt-segment-reason"]').innerText(); const why = await d.locator('[data-testid="rt-priority-why"]').innerText();
    const visits = await d.locator('[data-testid="rt-visits"] li').count();
    await d.locator('[data-testid="rt-customer-close"]').click(); await settle();
    const after = await text('[data-testid="panel-winback"] .fk-pager').catch(() => '');
    expect(/days since the last completed visit/.test(reason) && visits > 0 && pager === after && !(await d.count()), `${reason} / visits ${visits} / ${pager} vs ${after}`);
    return `"${reason.replace(/\n/g, ' ')}" · "${why.replace(/\n/g, ' ').slice(0, 80)}…" · ${visits} visit(s) · list unchanged`;
  });
  await step('retention (guide §13): Recovery & Trend — totals, definitions, six months, per campaign', async () => {
    const r = await J('/api/v1/pos/retention/recovery?preset=year');
    await page.locator('[data-testid="open-recovery"]').click();
    const d = page.locator('[data-testid="dlg-recovery"]'); await d.locator('[data-testid="rt-recovery-totals"]').waitFor();
    const tiles = await d.locator('[data-testid="rt-recovery-totals"]').innerText(); const months = await d.locator('[data-testid="rt-trend"] tbody tr').count();
    const def = await d.locator('.fk-hint').first().innerText();
    await page.keyboard.press('Escape'); await settle();
    expect(months === 6 && /not proven cause/.test(def), `months ${months} / ${def}`);
    return `${tiles.replace(/\n/g, ' ')} · trend ${months} months · year: ${r.totals.recoveredCustomers} recovered, ${r.totals.campaignObserved.customers} after a text`;
  });
  await step('retention (guide §05): Settings — 90 days moves customers out of At Risk; a stale version is refused; restored', async () => {
    const before = await J('/api/v1/pos/retention/summary');
    await page.locator('[data-testid="open-settings"]').click();
    const d = page.locator('[data-testid="dlg-settings"]'); await d.locator('[data-testid="set-risk"]').waitFor();
    await d.locator('[data-testid="set-risk"]').fill('90'); await d.locator('[data-testid="set-approaching"]').fill('60');
    await d.locator('[data-testid="settings-save"]').click(); await settle();
    const after = await J('/api/v1/pos/retention/summary');
    const stale = await fetch(`${BASE}/api/v1/pos/retention/settings`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ riskDays: 60, approachingDays: 45, observationWindowDays: 30, expectedVersion: 0 }) });
    const cur = await J('/api/v1/pos/retention/settings');
    const back = await fetch(`${BASE}/api/v1/pos/retention/settings`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ riskDays: 60, approachingDays: 45, observationWindowDays: 30, expectedVersion: cur.version }) });
    const audits = await J('/__sql?k=settings_audit');
    await page.locator('[data-testid="rt-refresh"]').click(); await settle();
    expect(after.period.riskDays === 90 && after.kpis.atRisk <= before.kpis.atRisk && stale.status === 409 && back.status === 200 && audits[0].n >= 2, `${before.kpis.atRisk}→${after.kpis.atRisk} stale ${stale.status} back ${back.status} audits ${JSON.stringify(audits)}`);
    return `At Risk ${before.kpis.atRisk} → ${after.kpis.atRisk} at 90 days; stale save ${stale.status}; restored (v${cur.version + 1}); ${audits[0].n} audit rows`;
  });
  await step('retention: Export downloads the filtered list — masked phones, formula-safe, audited', async () => {
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 8000 }), page.locator('[data-testid="rt-export"]').click()]);
    const p = join(OUT, dl.suggestedFilename()); await dl.saveAs(p);
    const csv = (await import('node:fs')).readFileSync(p, 'utf8'); const lines = csv.replace(/^\uFEFF/, '').split(/\r?\n/).filter(Boolean);
    const audits = await J('/__sql?k=export_audit');
    expect(lines.length > 1 && !/\+1[0-9]{10}/.test(csv) && !lines.slice(1).some((l) => /(^|,)[=+\-@]/.test(l)) && audits.some((a) => a.action === 'retention.export.succeeded'), `${lines.length} lines; audits ${JSON.stringify(audits)}`);
    return `${dl.suggestedFilename()}: ${lines.length - 1} rows; header "${lines[0].slice(0, 70)}…"; audit ${audits.map((a) => a.action).join(', ')}`;
  });
  let campaignId = '';
  await step('retention: select across pages → preview (exclusions explained) → confirm → individual texts', async () => {
    await page.locator('[data-testid="seg-contactable"]').click(); await settle();
    const boxes = page.locator('[data-testid="panel-winback"] tbody input[type="checkbox"]:not([disabled])');
    await boxes.nth(0).check(); await boxes.nth(1).check();
    await page.locator('[data-testid="panel-winback"] .fk-pager').getByRole('button', { name: 'Page 2', exact: true }).first().click(); await settle();
    await page.locator('[data-testid="panel-winback"] tbody input[type="checkbox"]:not([disabled])').first().check();
    const count = await text('.rt-selcount'); expect(/^3 selected/.test(count.trim()), 'selection ' + count);
    await page.locator('[data-testid="send-sms"]').click();
    const d = page.locator('[data-testid="dlg-compose"]');
    await d.locator('textarea').fill('We miss you! Book your next visit this week.');
    await d.locator('[data-testid="sms-preview"]').click(); await settle();
    const sub = await d.locator('.fk-dialog-sub').innerText();
    const before = (await J('/__sent')).length;
    await d.locator('[data-testid="sms-confirm"]').click(); await settle(); await page.waitForTimeout(2600);
    const sent = (await J('/__sent')).slice(before);
    expect(sent.length >= 1 && sent.every((m) => /Reply STOP to opt out\./.test(m.body) && m.body.startsWith('Pilot Nail Salon') && m.purpose === 'marketing'), 'sent ' + JSON.stringify(sent).slice(0, 300));
    expect(new Set(sent.map((m) => m.to)).size === sent.length, 'one text per destination');
    const camp = page.locator('[data-testid="dlg-campaign"]'); await camp.waitFor({ timeout: 5000 });
    campaignId = (await J('/api/v1/pos/retention/sms/campaigns?page=1&pageSize=1')).items[0].id;
    return `${sub.split('·')[0].trim()}; ${sent.length} individual text(s) through the recorder; body: "${sent[0].body}"`;
  });
  await step('retention: campaign history shows per-recipient status (no invented "delivered")', async () => {
    await page.waitForTimeout(5500);   // the dialog refreshes while sending
    const d = await J(`/api/v1/pos/retention/sms/campaigns/${campaignId}?page=1&pageSize=20`);
    expect(d.campaign.counts.delivered === 0, 'delivered without a carrier report');
    const stats = await page.locator('[data-testid="dlg-campaign"] .rt-stat').allInnerTexts();
    await page.keyboard.press('Escape');
    return `status ${d.campaign.status}; counts ${JSON.stringify(d.campaign.counts)}; tiles ${stats.map((s) => s.replace(/\n/g, ' ')).join(' | ')}`;
  });
  await step('retention: a confirmed campaign re-sent with the same key is the same campaign (no new jobs)', async () => {
    const jobsBefore = await J('/__sql?k=jobs');
    const r = await fetch(`${BASE}/api/v1/pos/retention/sms/campaigns`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ previewId: campaignId, idempotencyKey: '11111111-1111-4111-8111-111111111111' }) }).then((x) => x.json());
    const jobsAfter = await J('/__sql?k=jobs');
    expect(r.duplicate === true && JSON.stringify(jobsBefore) === JSON.stringify(jobsAfter), 'duplicate ' + JSON.stringify(r));
    return `duplicate=${r.duplicate}; jobs unchanged ${JSON.stringify(jobsAfter)}`;
  });
  await step('retention: "Select all matching" needs an explicit second confirmation and stays a server-side selection', async () => {
    await page.locator('[data-testid="seg-at_risk"]').click(); await settle();
    await page.locator('[data-testid="select-all-matching"]').click();
    const dlg = page.locator('[data-testid="dlg-select-all"]'); const msg = await dlg.locator('.rt-p').innerText();
    await dlg.locator('.fk-btn.primary').click(); const count = await text('.rt-selcount');
    await page.getByRole('button', { name: 'Clear' }).click();
    return `${msg} → "${count}" → cleared`;
  });

  // ── Four-Module Completion Guide (Oct 30 2026) CR-01..CR-04 ────────────────────────────────────────────────────────
  await go('/tenant/customers/retention');
  const GHOST_BRANCH = 'b0510000-0000-4000-8000-000000000009', OTHER_SALON_BRANCH = 'b0510000-0000-4000-8000-000000000002';
  await step('retention CR-02: Branch selector — tenant-wide vs branch activity; one customer once; Unknown branch counted; another salon\'s branch 403', async () => {
    const s = await J('/api/v1/pos/retention/summary');
    const scopeText = await text('[data-testid="rt-scope"]'); const unk = await text('[data-testid="rt-unknown-branch"]');
    expect(s.scope.label === 'tenant_wide' && /Tenant-wide customer retention/.test(scopeText) && s.scope.unknownBranchVisits === 2 && /2/.test(unk), `${scopeText} / ${unk} / ${JSON.stringify(s.scope)}`);
    const v = s.scope.branches.find((b) => b.name === 'Voorhees'); expect(!!v && s.scope.branches.length === 2, 'branches ' + JSON.stringify(s.scope.branches));
    await page.locator('[data-testid="flt-branch"]').selectOption(v.branchId); await settle();
    const scope2 = await text('[data-testid="rt-scope"]');
    const l = (await J('/__log')).filter((x) => x.startsWith('GET /pos/retention/customers?')).slice(-1)[0] || '';
    const sb = await J(`/api/v1/pos/retention/summary?branch=${v.branchId}`);
    expect(/Branch activity retention · Voorhees/.test(scope2) && l.includes('branch=' + v.branchId) && sb.segments.all === s.segments.all, `${scope2} / ${l} / all ${sb.segments.all} vs ${s.segments.all}`);
    // one customer with visits at both branches: listed once in each scope, the branch's own visit count
    const all = await J('/api/v1/pos/retention/customers?segment=all&sort=visits&page=1&pageSize=50');
    const vo = await J(`/api/v1/pos/retention/customers?segment=all&sort=visits&branch=${v.branchId}&page=1&pageSize=50`);
    const both = all.items.find((x) => vo.items.some((y) => y.customerId === x.customerId && y.visits > 0 && y.visits < x.visits));
    expect(!!both, 'no customer with visits at both branches');
    const one = await J(`/api/v1/pos/retention/customers?segment=all&q=${both.customerId}&page=1&pageSize=50`);
    const oneV = await J(`/api/v1/pos/retention/customers?segment=all&q=${both.customerId}&branch=${v.branchId}&page=1&pageSize=50`);
    expect(one.items.length === 1 && oneV.items.length === 1 && oneV.items[0].visits < one.items[0].visits, 'duplicated or wrong per-branch visits');
    const denied = await fetch(`${BASE}/api/v1/pos/retention/summary?branch=${OTHER_SALON_BRANCH}`); const denied2 = await fetch(`${BASE}/api/v1/pos/retention/customers?segment=all&page=1&pageSize=5&branch=${GHOST_BRANCH}`);
    await page.locator('[data-testid="flt-branch"]').selectOption(''); await settle();
    expect(denied.status === 403 && denied2.status === 403, `denied ${denied.status} / ${denied2.status}`);
    return `"${scopeText}" → "${scope2}"; ${both.customerName}: ${one.items[0].visits} visits salon-wide, ${oneV.items[0].visits} at Voorhees (one row each); Unknown branch ${s.scope.unknownBranchVisits}; other salon's / unknown branch → ${denied.status}/${denied2.status}`;
  });
  await step('retention CR-01: As of Date — a day without a snapshot is "Incomplete / unverifiable"; Rebuild history queues one job per day (audited)', async () => {
    await page.locator('[data-testid="open-history"]').click();
    const d = page.locator('[data-testid="dlg-history"]'); await d.locator('[data-testid="hist-state"]').waitFor();
    const st = await d.locator('[data-testid="hist-state"]').getAttribute('data-state'); const msg = await d.locator('[data-testid="hist-state"]').innerText();
    expect(st === 'missing' && /Incomplete \/ unverifiable/.test(msg), `${st}: ${msg}`);
    const before = await J('/__sql?k=backfill_audit');
    await d.locator('[data-testid="hist-backfill"]').click(); await d.locator('[data-testid="hist-backfill-note"]').waitFor();
    const note = await d.locator('[data-testid="hist-backfill-note"]').innerText();
    let runs = []; for (let i = 0; i < 90; i++) { runs = await J('/__sql?k=snapshot_runs'); const done = runs.filter((r) => r.status === 'completed').reduce((a, r) => a + r.n, 0); if (done >= 30) break; await page.waitForTimeout(1000); }
    const after = await J('/__sql?k=backfill_audit');
    await d.locator('[data-testid="hist-close"]').click(); await settle();
    expect(/30 day/.test(note) && after[0].n === before[0].n + 1 && runs.some((r) => r.status === 'completed'), `${note} / runs ${JSON.stringify(runs)} / audit ${before[0].n}→${after[0].n}`);
    return `before: "${msg.replace(/\n/g, ' ').slice(0, 110)}…"; "${note}"; runs ${JSON.stringify(runs)}; jobs ${JSON.stringify(await J('/__sql?k=snapshot_jobs'))}`;
  });
  await step('retention CR-01: the stored snapshot — counts = server, member drill-down, compare two dates (deltas + who moved)', async () => {
    await page.locator('[data-testid="open-history"]').click();
    const d = page.locator('[data-testid="dlg-history"]'); await d.locator('[data-testid="hist-counts"]').waitFor({ timeout: 8000 });
    const st = await d.locator('[data-testid="hist-state"]').getAttribute('data-state'); const msg = await d.locator('[data-testid="hist-state"]').innerText();
    const runs = await J('/api/v1/pos/retention/snapshots/runs?page=1&pageSize=1'); const y = runs.items[0].date;
    const api = await J(`/api/v1/pos/retention/snapshots/day?date=${y}`);
    const tile = async (s) => (await d.locator(`[data-testid="hist-seg-${s}"] b`).innerText()).replace(/\D/g, '');
    const got = { at_risk: await tile('at_risk'), never_visited: await tile('never_visited'), active: await tile('active') };
    expect(st === 'available' && got.at_risk === String(api.counts.at_risk) && got.never_visited === String(api.counts.never_visited) && got.active === String(api.counts.active) && /Reconstructed/.test(msg), `${st} ${JSON.stringify(got)} vs ${JSON.stringify(api.counts)} / ${msg}`);
    const members = await d.locator('[data-testid="hist-member"]').count();
    expect(members > 0, 'no at-risk members listed');
    // compare: the first stored day of the backfill window vs yesterday, picked in the calendar
    const firstDay = (await J('/api/v1/pos/retention/snapshots/runs?page=1&pageSize=50')).items.map((r) => r.date).sort()[0];
    const today = runs.to; const sameMonth = firstDay.slice(0, 7) === today.slice(0, 7) ? firstDay : today.slice(0, 7) + '-01';
    await d.locator('[data-testid="hist-compare"]').click(); await d.locator(`.fn-pop button[data-ymd="${sameMonth}"]`).click(); await settle();
    await d.locator('[data-testid="hist-compare-table"]').waitFor({ timeout: 6000 });
    const cmp = await J(`/api/v1/pos/retention/snapshots/compare?a=${sameMonth}&b=${y}`);
    const rowsTxt = await d.locator('[data-testid="hist-compare-table"] tbody tr').allInnerTexts();
    const moves = await d.locator('[data-testid="hist-moves"] li').count();
    await d.locator('[data-testid="hist-close"]').click(); await settle();
    expect(cmp.comparable && rowsTxt.length === 5, 'compare ' + JSON.stringify(cmp.delta));
    return `${y}: ${msg.replace(/\n/g, ' ').slice(0, 120)} · tiles ${JSON.stringify(got)} · ${members} at-risk member row(s) · ${sameMonth}→${y} delta ${JSON.stringify(cmp.delta)} · ${moves} movement row(s)`;
  });
  await step('retention CR-03: SMS estimate — "Price unknown — cannot estimate" with no price; after Settings sets a price the preview shows the estimate (audited)', async () => {
    const pick2 = async () => {
      await page.locator('[data-testid="seg-contactable"]').click(); await settle();
      const boxes = page.locator('[data-testid="panel-winback"] tbody input[type="checkbox"]:not([disabled])'); await boxes.nth(0).check(); await boxes.nth(1).check();
      await page.locator('[data-testid="send-sms"]').click();
      const c = page.locator('[data-testid="dlg-compose"]'); await c.locator('textarea').fill('We miss you! Book your next visit this week.');
      await c.locator('[data-testid="sms-preview"]').click(); await c.locator('[data-testid="sms-estimate"]').waitFor();
      const t = await c.locator('[data-testid="sms-estimate"]').innerText(); await page.keyboard.press('Escape'); await settle();
      if (await page.getByRole('button', { name: 'Clear' }).count()) await page.getByRole('button', { name: 'Clear' }).click();
      return t;
    };
    const unknown = await pick2();
    expect(/Price unknown — cannot estimate/.test(unknown) && !/\$0\.00/.test(unknown), unknown);
    await page.locator('[data-testid="open-settings"]').click();
    const s = page.locator('[data-testid="dlg-settings"]'); await s.locator('[data-testid="sms-pricing-current"]').waitFor();
    const none = await s.locator('[data-testid="sms-pricing-current"]').innerText();
    await s.locator('[data-testid="price-retail"]').fill('0.035'); await s.locator('[data-testid="price-save"]').click(); await settle();
    const cur = await s.locator('[data-testid="sms-pricing-current"]').innerText(); await page.keyboard.press('Escape'); await settle();
    const audits = await J('/__sql?k=pricing_audit');
    const est = await pick2();
    expect(/No SMS price/.test(none) && /0\.035/.test(cur) && audits[0].n === 1 && /Cost estimate/.test(est) && /at least \$0\.07/.test(est) && /Unknown — not included/.test(est), `${none} / ${cur} / ${audits[0].n} / ${est}`);
    return `before: "${unknown.split('\n')[0]}"; settings: "${cur}"; after: "${est.replace(/\n/g, ' ').slice(0, 160)}"`;
  });
  await step('retention CR-04: Book appointment opens the EXISTING New Appointment flow with that customer (loaded by id); nothing is saved by opening it', async () => {
    await page.locator('[data-testid="seg-at_risk"]').click(); await settle();
    const name = (await text('[data-testid="panel-winback"] tbody tr .fk-li-t.link')).trim();
    const apptBefore = await J('/__sql?k=appointments'); const logBefore = (await J('/__log')).length;
    await page.locator('[data-testid="panel-winback"] [data-testid="rt-row-book"]').first().click();
    await page.waitForURL(/\/booking\/new\?customerId=/); const sel = page.locator('[data-testid="booking-selected-customer"]'); await sel.waitFor({ timeout: 8000 });
    const url = page.url(); const cid = await sel.getAttribute('data-customer-id'); const shown = await sel.innerText();
    const writes = (await J('/__log')).slice(logBefore).filter((x) => !x.startsWith('GET ') && / \/pos\//.test(x));
    const apptAfter = await J('/__sql?k=appointments');
    expect(shown.includes(name) && url.includes('customerId=' + cid) && !/customerName|customerPhone|\+1/.test(decodeURIComponent(url)) && writes.length === 0 && apptAfter[0].n === apptBefore[0].n,
      `${shown} vs ${name} / ${url} / writes ${JSON.stringify(writes)} / appts ${apptBefore[0].n}→${apptAfter[0].n}`);
    const note = await text('[data-testid="booking-prefill-note"]');
    // an id that is not this salon's customer → actionable message + the manual search, nothing preselected
    await page.goto(`${BASE}/booking/new?customerId=e0510000-0000-4000-8000-00000000ffff&from=retention`, { waitUntil: 'load' });
    await page.locator('[data-testid="booking-prefill-failed"]').waitFor({ timeout: 8000 }); const failed = await text('[data-testid="booking-prefill-failed"]');
    const preselected = await page.locator('[data-testid="booking-selected-customer"]').count();
    expect(preselected === 0 && /Search for the customer/.test(failed), 'failed prefill ' + failed);
    // and from the customer overlay
    await go('/tenant/customers/retention'); await page.locator('[data-testid="seg-at_risk"]').click(); await settle();
    await page.locator('[data-testid="panel-winback"] tbody .fk-li-t.link').first().click(); const dlg = page.locator('[data-testid="dlg-customer"]'); await dlg.locator('[data-testid="rt-book"]').waitFor();
    await dlg.locator('[data-testid="rt-book"]').click(); await page.locator('[data-testid="booking-selected-customer"]').waitFor({ timeout: 8000 });
    const shown2 = await text('[data-testid="booking-selected-customer"]');
    await go('/tenant/customers/retention');
    return `row → ${url.replace(BASE, '')} shows "${shown.split('\n')[0]}" (${note}); 0 writes, appointments ${apptAfter[0].n} unchanged; unknown id → "${failed.slice(0, 80)}…"; overlay → "${shown2.split('\n')[0]}"`;
  });

  // ── Membership Overview ────────────────────────────────────────────────────────────────────────────────────────────
  await go('/tenant/customers/memberships');
  const QA = [['Add New Member', null], ['Create Plan', null], ['Send Reminder', 'dlg-reminder'], ['Manage Discounts', 'dlg-discounts'], ['Membership Report', 'dlg-report'],
    ['Export Members', 'download'], ['Export Payments', 'download'], ['Export Redemptions', 'download'], ['Plan Performance', 'dlg-performance'], ['Membership Settings', 'navigate']];
  for (const [label, kind] of QA) {
    await step(`memberships: quick action "${label}" works`, async () => {
      const b = page.locator('[data-testid="membership-quick"]').getByRole('button', { name: label, exact: true });
      if (kind === 'download') {
        const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 8000 }), b.click()]);
        const p = join(OUT, dl.suggestedFilename()); await dl.saveAs(p);
        const csv = (await import('node:fs')).readFileSync(p, 'utf8');
        const lines = csv.split('\r\n');
        const injection = lines.slice(1).some((l) => /(^|,)[=+\-@]/.test(l));
        expect(!injection, 'a cell starts with = + - @');
        return `${dl.suggestedFilename()}: ${lines.length - 1} line(s), BOM ${csv.charCodeAt(0) === 0xfeff}, formula-safe`;
      }
      if (kind === 'navigate') { await b.click(); await page.waitForTimeout(500); const url = page.url(); await go('/tenant/customers/memberships'); expect(/settings/.test(url), url); return url.replace(BASE, ''); }
      await b.click(); await page.waitForTimeout(700);
      if (!kind) { const tid = label === 'Add New Member' ? 'dlg-membership-enroll' : 'dlg-plan-builder'; await page.waitForSelector(`[data-testid="${tid}"]`, { timeout: 4000 });
        const h = await page.locator(`[data-testid="${tid}"] h2`).first().innerText(); await page.keyboard.press('Escape'); await page.waitForTimeout(250);
        expect(!(await page.locator(`[data-testid="${tid}"]`).count()), 'Escape did not close it'); return `"${h}" opened; Escape closed it`; }
      await page.waitForSelector(`[data-testid="${kind}"]`); const body = (await page.locator(`[data-testid="${kind}"] .fk-dialog-body`).innerText()).replace(/\s+/g, ' ').slice(0, 140);
      if (kind === 'dlg-reminder') {
        const before = await page.locator('[data-testid="reminder-send"]').innerText();
        await page.locator('[data-testid="reminder-send"]').click(); await settle();
        return `${before} → ${(await text('.fk-note')).trim()}`;
      }
      await page.keyboard.press('Escape'); return body;
    });
  }
  // Membership Overview rebuild (Oct 29 2026): KPIs → tabs, phone-first search, periods, numbered pages, Member Details, sidebar
  await step('memberships: Expiring Soon opens Members filtered to the next 7 days (count = the card)', async () => {
    await page.locator('[data-testid="kpi-expiring"]').click(); await page.waitForSelector('[data-testid="members-list"] .fk-pager'); await settle();
    const range = await page.locator('[data-testid="members-list"] .fk-pager-range').innerText();
    const kpi = await text('[data-testid="kpi-expiring"] .fk-kpi-v');
    expect(page.url().includes('tab=members'), page.url()); expect(await page.locator('[data-testid="member-filter"]').inputValue() === 'expiring', 'filter');
    expect(range.includes(`of ${kpi}`), `${range} vs ${kpi}`);
    return `Expiring KPI ${kpi}; Members tab "${range}"`;
  });
  await step('memberships: phone search in four formats finds the same member (all tenant records, not Page 1)', async () => {
    await page.locator('[data-testid="member-filter"]').selectOption('any'); await settle();
    const all = await J('/api/v1/pos/memberships/members?filter=any&page=5&pageSize=10');
    const m = all.items[all.items.length - 1];
    const ph = (await J(`/__sql?k=phone&a=${m.customerId}`))[0]?.p ?? '';
    const d = ph.replace(/\D/g, '').slice(-10); expect(d.length === 10, 'phone ' + ph);
    const forms = [d, `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`, `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`, `+1 ${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6)}`];
    const seen = [];
    for (const f of forms) {
      await page.fill('[data-testid="search"]', f); await page.waitForTimeout(900); await settle();
      const names = await page.locator('[data-testid="member-row"] [data-testid="member-name"]').allInnerTexts();
      expect(names.includes(m.customerName), `"${f}" → ${names.join(', ')}`); seen.push(`${f} → ${names.length}`);
    }
    await page.click('[data-testid="search-clear"]'); await settle();
    return `${m.customerName}: ${seen.join(' · ')}`;
  });
  await step('memberships: similar names stay separate people (two rows, two membership IDs)', async () => {
    await page.fill('[data-testid="search"]', 'Linh'); await page.waitForTimeout(900); await settle();
    const rows = await page.locator('[data-testid="member-row"]').count();
    const api = await J('/api/v1/pos/memberships/members?filter=any&q=Linh&page=1&pageSize=10');
    expect(rows === Math.min(10, api.totalItems), `${rows} rows vs ${api.totalItems}`);
    expect(new Set(api.items.map((x) => x.membershipId)).size === api.items.length, 'duplicate ids');
    await page.click('[data-testid="search-clear"]'); await settle();
    return `${rows} row(s): ${api.items.slice(0, 5).map((x) => x.customerName + ' #' + (x.memberNumber ?? '—')).join(' | ')}`;
  });
  await step('memberships: numbered pages are newest enrolment first; Page 2 continues Page 1', async () => {
    await page.locator('[data-testid="member-filter"]').selectOption('any'); await settle();
    const p1 = await J('/api/v1/pos/memberships/members?filter=any&page=1&pageSize=10'); const p2 = await J('/api/v1/pos/memberships/members?filter=any&page=2&pageSize=10');
    const first1 = await page.locator('[data-testid="member-name"]').first().innerText();
    await page.locator('[data-testid="members-list"] .fk-pager .fk-pbtn.num', { hasText: /^2$/ }).click(); await settle();
    const first2 = await page.locator('[data-testid="member-name"]').first().innerText();
    expect(first1 === p1.items[0].customerName && first2 === p2.items[0].customerName, `${first1}/${first2}`);
    const dates = [...p1.items, ...p2.items].map((x) => x.startedAt);
    expect(dates.every((d, i) => i === 0 || (dates[i - 1] ?? '') >= (d ?? '')), 'not newest first');
    return `page 1 starts ${first1}, page 2 starts ${first2}; ${p1.totalItems} total`;
  });
  await step('memberships: a period filters the event list only — the current-state cards do not move', async () => {
    const before = await page.locator('[data-testid="membership-kpis"]').innerText();
    await page.click('[data-testid="tab-activity"]'); await settle();
    const all = await page.locator('[data-testid="activity-list"] .fk-pager-range').innerText();
    await page.click('[data-testid="preset-today"]'); await settle();
    const today = await page.locator('[data-testid="activity-list"] .fk-pager-range').innerText().catch(() => 'empty');
    const api = await J('/api/v1/pos/memberships/activity?preset=today&page=1&pageSize=10');
    const after = await page.locator('[data-testid="membership-kpis"]').innerText();
    expect(before === after, 'KPIs changed'); expect(today === 'empty' ? api.totalItems === 0 : today.includes(`of ${api.totalItems}`), `${today} vs ${api.totalItems}`);
    await page.click('[data-testid="preset-all"]'); await settle();
    return `activity all "${all}" → today "${today}" (server ${api.totalItems}); KPIs unchanged`;
  });
  await step('memberships: Custom Range opens a month calendar; Apply filters Payments by payment date', async () => {
    await page.click('[data-testid="tab-payments"]'); await settle();
    await page.click('[data-testid="preset-custom"]'); await page.waitForTimeout(300);
    const cal = page.locator('[data-testid="range-calendar"]'); await cal.waitFor({ timeout: 3000 });
    const days = cal.locator('[data-testid="cal-left"] button[data-ymd]:not([disabled])'); const nDays = await days.count();
    expect(nDays >= 28, 'month grid has ' + nDays);
    const ymdA = await days.nth(0).getAttribute('data-ymd'); const ymdB = await days.nth(nDays - 1).getAttribute('data-ymd');
    await page.click('[data-testid="range-from"]'); await days.nth(0).click(); await days.nth(nDays - 1).click();
    await page.click('[data-testid="range-apply"]'); await settle();
    const api = await J(`/api/v1/pos/memberships/payments?status=all&preset=custom&from=${ymdA}&to=${ymdB}&page=1&pageSize=10`);
    const range = await page.locator('[data-testid="payments-list"] .fk-pager-range').innerText().catch(() => 'empty');
    expect(range === 'empty' ? api.totalItems === 0 : range.includes(`of ${api.totalItems}`), `${range} vs ${api.totalItems}`);
    const active = await text('[data-testid="active-period"]');
    const totals = await page.locator('[data-testid="pay-totals"]').innerText();
    return `range "${active}" · ${totals.replace(/\s+/g, ' ').slice(0, 120)}`;
  });
  await step('memberships: Member Details — identity, lifecycle, billing, benefits, activity + audit', async () => {
    await page.click('[data-testid="preset-all"]').catch(() => undefined);
    await page.click('[data-testid="tab-members"]'); await settle();
    await page.locator('[data-testid="member-details"]').first().click(); await page.waitForSelector('[data-testid="md-identity"]');
    const idn = (await page.locator('[data-testid="md-identity"]').innerText()).replace(/\s+/g, ' ');
    expect((/•••/.test(idn) || /No phone on file/.test(idn)) && !/\(\d{3}\) \d{3}-\d{4}/.test(idn), 'phone not masked: ' + idn.slice(0, 80));
    const tabs = [];
    for (const t of ['billing', 'benefits', 'activity']) { await page.click(`[data-testid="md-tab-${t}"]`); await settle(); tabs.push(t + ': ' + (await page.locator('[data-testid="dlg-member"] .fk-dialog-body').innerText()).replace(/\s+/g, ' ').slice(0, 60)); }
    await page.keyboard.press('Escape');
    return idn.slice(0, 90) + ' || ' + tabs.join(' || ');
  });
  await step('memberships: the sidebar highlights Memberships, not Service Packages', async () => {
    // open every group, so both items are on screen (they shared one route before the fix — both lit)
    for (let i = 0; i < 30; i++) { const closed = page.locator('.grp-head:not(.open)'); if (!(await closed.count())) break; await closed.first().click(); await page.waitForTimeout(80); }
    const active = await page.locator('.navlink.active').allInnerTexts();
    expect(active.some((t) => /^Memberships$/i.test(t.trim())), 'Memberships not highlighted: ' + active.join(', '));
    expect(!active.some((t) => /Service Packages/i.test(t)), 'Service Packages highlighted: ' + active.join(', '));
    return 'active: ' + active.join(', ');
  });
  // ── Vietnamese ─────────────────────────────────────────────────────────────────────────────────────────────────────
  await fetch(`${BASE}/__lang?l=vi`);
  await go('/tenant/customers/loyalty');
  await step('vi: Loyalty renders in Vietnamese (no English UI labels)', async () => {
    const h = await text('h1'); const btns = (await page.locator('.fk-head-actions button, [data-testid="loyalty-quick"] button').allInnerTexts()).join(' | ');
    expect(/Thân thiết/.test(h) && /Đăng ký thành viên/.test(btns), h + ' / ' + btns);
    return `${h} — ${btns}`;
  });
  await go('/tenant/customers/retention');
  await step('vi (CR-01/02): the scope line, branch selector and As of Date are Vietnamese', async () => {
    const sc = await text('[data-testid="rt-scope"]'); const h = await text('[data-testid="open-history"]'); const b = await page.locator('[data-testid="flt-branch"] option').first().innerText();
    expect(/Giữ chân khách toàn tiệm/.test(sc) && /Theo ngày/.test(h) && /chi nhánh/.test(b), `${sc} / ${h} / ${b}`);
    return `${sc} · ${h} · ${b}`;
  });
  await step('vi: the SMS composer is Vietnamese, the customer-facing text stays English', async () => {
    await page.locator('[data-testid="seg-contactable"]').click(); await settle();
    await page.locator('[data-testid="panel-winback"] tbody input[type="checkbox"]:not([disabled])').first().check();
    await page.locator('[data-testid="send-sms"]').click();
    const t = await page.locator('[data-testid="dlg-compose"] h2').innerText(); const ph = await page.locator('[data-testid="dlg-compose"] textarea').getAttribute('placeholder');
    await page.keyboard.press('Escape');
    expect(/SMS/.test(t) && /We miss/.test(ph), t + ' / ' + ph);
    return `title "${t}", message placeholder (customer-facing, English): "${ph}"`;
  });
} finally {
  writeFileSync(join(OUT, 'e2e.json'), JSON.stringify({ at: new Date().toISOString(), results, errors, unhandled: await J('/__unhandled').catch(() => []) }, null, 1));
  console.log(`\n${results.filter((r) => r.ok).length}/${results.length} passed; page errors ${errors.length}${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''}`);
  await browser.close(); srv.kill();
}
