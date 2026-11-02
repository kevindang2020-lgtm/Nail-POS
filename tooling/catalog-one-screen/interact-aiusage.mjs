// interact-aiusage.mjs — AI Usage & Limits steps of the catalog E2E (Oct 30 2026): /tenant/ai/usage on the REAL controller +
// repository + SQL with aiusage-extra.mjs fixtures (no billing provider, no charge).
//   node tooling/catalog-one-screen/interact.mjs <label> aiusage
export const STEPS_AIUSAGE = ({ page, expect, settle, go, tid, noJunk, API, SQL, J, BASE }) => {
  const open = () => go('/tenant/ai/usage', '.work.aiu');
  const cardOf = (code) => page.locator(`${tid('aiu-card')}[data-code="${code}"]`);
  const toCard = async (code) => { for (let i = 0; i < 3 && !(await cardOf(code).count()); i++) await page.locator('.aiu-foot .fk-pager').getByRole('button', { name: 'Next' }).first().click().then(settle); return cardOf(code); };
  return [
    ['ai usage: the four KPIs are the server summary; cards carry the server states (no false "Trial")', async () => {
      await open(); await noJunk();
      const s = await API('/tenant/ai/usage-screen/summary');
      const v = async (t) => (await page.locator(`${tid(t)} .fk-kpi-v`).innerText()).trim();
      expect(await v('aiu-kpi-total') === String(s.kpis.totalPackages) && await v('aiu-kpi-active') === String(s.kpis.activeSubscriptions) && await v('aiu-kpi-trials') === String(s.kpis.trialsAndPending), 'kpis');
      expect((await v('aiu-kpi-cost')).replace(/[$,]/g, '') === (s.cost.recurringMonthlyCents / 100).toFixed(2), 'cost ' + await v('aiu-kpi-cost'));
      const biz = await toCard('ai_business_assistant');
      expect((await biz.locator(tid('aiu-state')).innerText()).trim() === 'Trial expired', 'business state');
      expect((await biz.locator(tid('aiu-primary')).innerText()).trim() === 'Upgrade', 'business action');
      const cards = await page.locator(tid('aiu-card')).count();
      return `15 packages / ${s.kpis.activeSubscriptions} active / ${s.kpis.trialsAndPending} trials+pending / $${(s.cost.recurringMonthlyCents / 100).toFixed(2)} (${s.cost.basis}) · ${cards} cards on this page · stored "trialing" past its end shows "Trial expired" + Upgrade`;
    }],
    ['ai usage: search, status and category filters cover the whole catalog; Clear resets to page 1', async () => {
      await open();
      await page.fill(tid('aiu-search'), 'receipt'); await page.waitForTimeout(450); await settle();
      const found = await page.locator(tid('aiu-card')).evaluateAll((els) => els.map((e) => e.getAttribute('data-code')));
      expect(found.includes('ai_ocr_receipt_scanner') && found.includes('ai_checkout_upsell_assistant'), 'search ' + found);
      await page.click(tid('aiu-clear')); await settle();
      await page.click(tid('aiu-status-trial_expired')); await settle();
      const te = await page.locator(tid('aiu-card')).evaluateAll((els) => els.map((e) => e.getAttribute('data-code')));
      expect(te.sort().join() === 'ai_analytics_forecasting,ai_business_assistant', 'trial expired ' + te);
      await page.selectOption(tid('aiu-category'), 'finance'); await settle();
      const fin = await page.locator(tid('aiu-card')).count();
      await page.click(tid('aiu-clear')); await settle();
      const pager = (await page.locator('.aiu-foot .fk-pager').innerText()).replace(/\s+/g, ' ');
      expect(/Page 1 of 2/.test(pager), pager);
      return `"receipt" → ${found.join(', ')} · Trial expired → ${te.join(', ')} · + Finance → ${fin} · cleared: ${pager.slice(0, 40)}`;
    }],
    ['ai usage: one click on a card opens Details (also Enter); Escape closes it and keeps the page', async () => {
      await open();
      await page.locator('.aiu-foot .fk-pager').getByRole('button', { name: 'Page 2', exact: true }).click(); await settle();
      const c = page.locator(tid('aiu-card')).first(); const code = await c.getAttribute('data-code');
      await c.locator('.aiu-desc').click(); await page.waitForSelector(tid('aiu-tab-overview'));
      const tabs = await page.locator(`${tid('aiu-detail')} [role="tab"]`).count();
      await page.keyboard.press('Escape'); await page.waitForTimeout(300);
      const focused = await page.evaluate(() => document.activeElement?.getAttribute('data-code'));
      await c.focus(); await page.keyboard.press('Enter'); await page.waitForSelector(tid('aiu-detail'));
      await page.click(tid('aiu-detail-close')); await page.waitForTimeout(250);
      const pager = (await page.locator('.aiu-foot .fk-pager').innerText()).replace(/\s+/g, ' ');
      expect(tabs === 6 && focused === code && /Page 2 of 2/.test(pager), `${tabs} tabs · focus ${focused} · ${pager}`);
      return `${code}: 6 tabs · Escape → focus back on the card · Enter opens · still ${pager.match(/Page \d of \d/)?.[0]}`;
    }],
    ['ai usage: Start Trial needs a confirmation, writes one trial + event + audit; the card is then Trialing', async () => {
      await open();
      const c = await toCard('ai_phone_call_assistant');
      await c.locator(tid('aiu-primary')).click(); await page.waitForSelector(tid('aiu-detail'));
      await page.click(tid('aiu-trial')); const box = await page.locator(tid('aiu-confirm-box')).innerText();
      expect(/Nothing is charged now/.test(box), box);
      await page.click(tid('aiu-confirm')); await settle();
      const subs = (await SQL('aisubs')).find((x) => x.package_code === 'ai_phone_call_assistant');
      const ev = (await SQL('aievents')).filter((x) => x.package_code === 'ai_phone_call_assistant');
      const au = (await SQL('aiaudit')).filter((x) => x.action === 'ai.subscription.trial_started');
      const state = (await page.locator(`${tid('aiu-detail')} .fk-chip`).first().innerText()).trim();
      await page.click(tid('aiu-detail-close'));
      expect(subs?.status === 'trialing' && ev.length === 1 && au.length === 1 && state === 'Trialing' && !(await page.locator(tid('aiu-trial')).count()), JSON.stringify({ subs, ev, au, state }));
      return `confirm: "${box.slice(0, 80)}…" → trialing, 1 event, 1 audit row; Details re-read: ${state}`;
    }],
    ['ai usage: Cancel shows the impact and confirms; afterwards no Cancel is offered', async () => {
      await open();
      const c = await toCard('ai_marketing_assistant'); await c.locator('.aiu-desc').click(); await page.waitForSelector(tid('aiu-detail'));
      await page.click(tid('aiu-cancel')); const box = await page.locator(tid('aiu-confirm-box')).innerText();
      await page.click(tid('aiu-confirm')); await settle();
      const st = (await SQL('aisubs')).find((x) => x.package_code === 'ai_marketing_assistant')?.status;
      const again = await page.locator(tid('aiu-cancel')).count();
      await page.click(tid('aiu-detail-close'));
      expect(/stops working right away/.test(box) && st === 'cancelled' && again === 0, `${st} · cancel buttons ${again}`);
      return `"${box.slice(0, 90)}…" → ${st}; Cancel no longer offered`;
    }],
    ['ai usage: the 100 % alert is one line per package; Got it acknowledges 80/90/100 and the sidebar badge drops', async () => {
      await open();
      const before = await API('/tenant/navigation/badges'); const line = await page.locator('.aiu-alert').first().innerText();
      await page.locator(tid('aiu-ack')).first().click(); await settle();
      const after = await API('/tenant/navigation/badges');
      const acked = (await SQL('aialerts')).filter((a) => a.package_code === 'ai_checkout_upsell_assistant').every((a) => a.acknowledged_at);
      expect(/100%/.test(line) && acked && after.aiUsageAlerts < before.aiUsageAlerts, `${line} · ${before.aiUsageAlerts} → ${after.aiUsageAlerts}`);
      return `"${line.replace(/\s+/g, ' ').slice(0, 100)}" · badge ${before.aiUsageAlerts} → ${after.aiUsageAlerts}`;
    }],
    ['ai usage: the cost breakdown lists subscription prices (yearly ÷ 12), trials apart, past due flagged', async () => {
      await open(); await page.click(tid('aiu-kpi-cost')); await page.waitForSelector(tid('aiu-cost'));
      const total = (await page.locator(tid('aiu-cost-total')).innerText()).trim(); const lines = await page.locator(`${tid('aiu-cost-lines')} tbody tr`).allInnerTexts();
      const body = await page.locator(tid('aiu-cost')).innerText();
      await page.keyboard.press('Escape');
      expect(lines.some((l) => /yearly ÷ 12/.test(l)) && lines.some((l) => /Past due/.test(l)) && /Trials \(not part of the cost\)/.test(body), lines.join(' | '));
      return `${total} · ${lines.length} lines · ${lines.map((l) => l.split('\t')[0]).join(', ').slice(0, 120)}`;
    }],
    ['ai usage: Usage History — newest first, Failed filter, audited CSV with redacted references', async () => {
      await open(); await page.click(tid('aiu-open-history')); await page.waitForSelector(tid('aiu-history-table'));
      const times = await page.locator(`${tid('aiu-history-table')} tbody tr td:first-child`).allInnerTexts();
      await page.selectOption(tid('aiu-h-status'), 'error'); await settle();
      const failed = await page.locator(`${tid('aiu-history-table')} tbody tr`).count();
      await page.selectOption(tid('aiu-h-status'), 'all'); await settle();
      const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 8000 }), page.click(tid('aiu-export'))]);
      const p = await dl.path(); const csv = (await import('node:fs')).readFileSync(p, 'utf8');
      const au = (await SQL('aiaudit')).map((a) => a.action).filter((a) => a.startsWith('ai.usage.export'));
      await page.click(tid('aiu-history-close'));
      expect(failed === 1 && /^﻿?Time \(UTC\),Package/.test(csv) && !/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/.test(csv) && au.includes('ai.usage.export.succeeded'), `failed ${failed} · audit ${au}`);
      return `${times.length} rows (first ${times[0]}) · Failed → ${failed} · CSV ${csv.split('\n').length - 2} rows, references masked · audit ${au.join(' → ')}`;
    }],
    ['ai usage: Disabled by admin offers no trial; a manager sees no costs and no Cancel', async () => {
      await open();
      const v = await toCard('ai_voice_transcription'); const vs = (await v.locator(tid('aiu-state')).innerText()).trim(); const vb = (await v.locator(tid('aiu-primary')).innerText()).trim();
      await fetch(`${BASE}/__role?r=MANAGER`); await open();
      const cost = (await page.locator(`${tid('aiu-kpi-cost')} .fk-kpi-v`).innerText()).trim();
      const b = await toCard('ai_booking_assistant'); await b.locator('.aiu-desc').click(); await page.waitForSelector(tid('aiu-detail'));
      const cancel = await page.locator(tid('aiu-cancel')).count();
      await page.click(tid('aiu-tab-billing')); const bill = await page.locator(tid('aiu-detail')).innerText();
      await page.click(tid('aiu-detail-close')); await fetch(`${BASE}/__role?r=OWNER`);
      expect(vs === 'Disabled by admin' && vb === 'View Details' && cost === 'Restricted' && cancel === 0 && /visible only to the owner/.test(bill), `${vs}/${vb}/${cost}/${cancel}`);
      return `voice: ${vs} → ${vb} · manager: cost ${cost}, Cancel ${cancel}, billing restricted`;
    }],
    // ── Round 2 (Four-Module Completion Guide, Oct 30 2026): AI-01 invoices + AI-02 branch settings ──────────────────────
    ['ai usage r2 (AI-01): Billing tab — Re-check invoices records the provider invoice: finalized $52, paid $0, due $52 (not $59 paid)', async () => {
      await open();
      const c = await toCard('ai_marketing_assistant'); await c.locator('.aiu-desc').click(); await page.waitForSelector(tid('aiu-detail'));
      await page.click(tid('aiu-tab-billing'));
      const before = await page.locator(tid('aiu-no-invoices')).count();
      const finBefore = (await page.locator(tid('aiu-fig-finalized')).innerText()).replace(/\s+/g, ' ');
      await page.click(tid('aiu-reconcile')); await page.waitForSelector(tid('aiu-reconcile-msg')); await settle();
      const msg = (await page.locator(tid('aiu-reconcile-msg')).innerText()).trim();
      const fig = async (k) => (await page.locator(tid('aiu-fig-' + k)).locator('b').innerText()).trim();
      const f = { recurring: await fig('recurring'), finalized: await fig('finalized'), paid: await fig('paid'), outstanding: await fig('outstanding') };
      const rows = await page.locator(tid('aiu-invoice-row')).allInnerTexts();
      await page.click(tid('aiu-reconcile')); await page.waitForTimeout(400); await settle();
      const inv = await SQL('aiinvoices'); const runs = await SQL('airuns');
      await page.click(tid('aiu-detail-close'));
      expect(before === 1 && /No finalized invoice yet/.test(finBefore) && f.recurring === '$59.00' && f.finalized === '$52.00' && f.paid === '$0.00' && f.outstanding === '$52.00', JSON.stringify({ before, finBefore, f }));
      expect(rows.length === 1 && /AI-1001/.test(rows[0]) && /\$3\.00/.test(rows[0]) && inv.length === 2 && runs.length === 2 && runs[0].created_count === 2 && runs[1].unchanged_count === 2, JSON.stringify({ rows, inv, runs }));
      return `before: "${finBefore.slice(0, 60)}" · "${msg.slice(0, 70)}" · recurring ${f.recurring} · finalized ${f.finalized} · paid ${f.paid} · due ${f.outstanding} · 2nd re-check: ${runs[1].unchanged_count} unchanged, ${inv.length} invoices (no duplicates)`;
    }],
    ['ai usage r2 (AI-01): the cost overview shows the same five figures from the server summary', async () => {
      await open(); await page.click(tid('aiu-kpi-cost')); await page.waitForSelector(tid('aiu-cost'));
      const s = await API('/tenant/ai/usage-screen/summary'); const x = s.cost.invoiced.currentPeriod;
      const fin = (await page.locator(`${tid('aiu-cost')} ${tid('aiu-fig-finalized')} b`).innerText()).trim();
      const due = (await page.locator(`${tid('aiu-cost')} ${tid('aiu-fig-outstanding')} b`).innerText()).trim();
      const ass = (await page.locator(`${tid('aiu-cost')} ${tid('aiu-assumptions')}`).innerText()).trim();
      await page.keyboard.press('Escape');
      expect(fin.replace(/[$,]/g, '') === (x.finalizedCents / 100).toFixed(2) && due.replace(/[$,]/g, '') === (x.outstandingCents / 100).toFixed(2) && /excludes tax/.test(ass), `${fin} ${due} ${JSON.stringify(x)}`);
      return `finalized ${fin} (${x.finalizedInvoices} invoices) · paid $${(x.paidCents / 100).toFixed(2)} · outstanding ${due} · "${ass.slice(0, 70)}…"`;
    }],
    ['ai usage r2 (AI-02): Settings tab — Voorhees Off, Cherry Hill inherits; one subscription; On is not offered for an expired trial', async () => {
      await open();
      const c = await toCard('ai_booking_assistant'); await c.locator('.aiu-desc').click(); await page.waitForSelector(tid('aiu-detail'));
      await page.click(tid('aiu-tab-settings')); await page.waitForSelector(tid('aiu-branches'));
      const row = (n) => page.locator(`${tid('aiu-branch-row')}[data-branch="${n}"]`);
      await row('Voorhees').locator(tid('aiu-branch-override')).selectOption('off');
      await row('Voorhees').locator(tid('aiu-branch-save')).click(); await settle(); await page.waitForTimeout(300);
      const eff = { v: (await row('Voorhees').locator(tid('aiu-branch-effective')).innerText()).trim(), c: (await row('Cherry Hill').locator(tid('aiu-branch-effective')).innerText()).trim() };
      const scope = (await row('Cherry Hill').innerText()).replace(/\s+/g, ' ');
      await page.click(tid('aiu-detail-close'));
      const br = await SQL('aibranch'); const hist = await SQL('aibranchhist'); const subs = (await SQL('aisubs')).filter((x) => x.package_code === 'ai_booking_assistant');
      const au = (await SQL('aiaudit')).filter((a) => a.action === 'ai.branch_setting.changed');
      const b = await toCard('ai_business_assistant'); await b.locator('.aiu-desc').click(); await page.waitForSelector(tid('aiu-detail'));
      await page.click(tid('aiu-tab-settings')); await page.waitForSelector(tid('aiu-branches'));
      const onDisabled = await page.locator(`${tid('aiu-branch-override')} option[value="on"]`).first().evaluate((o) => o.disabled);
      const bizEff = (await page.locator(tid('aiu-branch-effective')).first().innerText()).trim();
      await page.click(tid('aiu-detail-close'));
      expect(eff.v === 'Off — this branch' && eff.c === 'On' && /Salon subscription \(shared\)/.test(scope) && /Shared salon allowance/.test(scope), JSON.stringify({ eff, scope }));
      expect(br.length === 1 && br[0].name === 'Voorhees' && br[0].override_enabled === false && br[0].version === 1 && hist.length === 1 && subs.length === 1 && au.length === 1 && onDisabled && bizEff === 'Off — not subscribed',
        JSON.stringify({ br, hist, subs, au: au.length, onDisabled, bizEff }));
      return `Voorhees ${eff.v} · Cherry Hill ${eff.c} · ${subs.length} subscription row · history v${br[0].version} · audit ${au.length} · Business (trial expired): ${bizEff}, "On" disabled`;
    }],
  ];
};
