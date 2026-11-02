// interact-wb.mjs — Customer Retention & Win-Back E2E steps (Complete Build Guide, Oct 30 2026). Run with
// `node tooling/catalog-one-screen/interact.mjs <label> wb` against the live harness (wb-extra.mjs serves the REAL
// RetentionController; cc-extra.mjs / seg-extra.mjs serve Campaign Center and Segments). Nothing leaves the machine.
export const STEPS_WB = ({ page, expect, settle, go, tid, noJunk, J, T, search }) => {
  const URL0 = '/tenant/marketing/win-back';
  const open = () => go(URL0, tid('retention-kpis'));
  const shot = (name) => page.screenshot({ path: `tooling/catalog-one-screen/results/wb-e2e/${name}.png`, fullPage: false }).catch(() => undefined);
  const kpiV = async (id) => (await T(`${tid(id)} .fk-kpi-v`)).replace(/[^0-9]/g, '');
  const st = () => J('/__wb?state=1');
  const rows = () => page.locator(tid('rt-row'));
  const cells = async (i) => (await rows().nth(i).locator('td').allInnerTexts()).map((x) => x.trim());
  const tab = async (s) => { await page.click(tid('seg-' + s)); await settle(); };
  const pick = async (sel, v) => { await page.selectOption(tid(sel), v); await settle(); };
  const names = async () => (await rows().locator('td:nth-child(2)').allInnerTexts()).map((x) => x.trim());
  return [
    ['wb: P0 — At Risk and Never Visited equal the database; no At Risk row says "Never"; the never-visited customers are in Never Visited', async () => {
      await J('/__tenant?name=pilot'); await J('/__role?r=OWNER'); await J('/__lang?l=en'); await J('/__wb?reset=1'); await J('/__wb?seed=1');
      await open(); await noJunk();
      const s = await st();
      expect(Number(await kpiV('kpi-at-risk')) === s.atRisk, `At Risk screen ${await kpiV('kpi-at-risk')} vs DB ${s.atRisk}`);
      expect(Number(await kpiV('kpi-never')) === s.never, `Never Visited screen ${await kpiV('kpi-never')} vs DB ${s.never}`);
      await tab('at_risk');
      const n = await rows().count(); const lastVisit = [];
      for (let i = 0; i < n; i++) lastVisit.push((await cells(i))[3]);
      expect(n > 0 && lastVisit.every((v) => v && !/^Never$/i.test(v)), `At Risk last visits: ${lastVisit.join(' | ')}`);
      await tab('never'); await search(tid('rt-search'), 'Wb ');
      const nv = await names();
      expect(nv.some((x) => /Wb Nora/.test(x)) && nv.some((x) => /Wb Gus/.test(x)), `Never Visited: ${nv.join(', ')}`);
      await search(tid('rt-search'), '');
      await shot('01-wb-overview-1920');
      return `At Risk ${s.atRisk} = screen · Never Visited ${s.never} = screen (Nora, Gus — whose only ticket was removed) · ${n} At Risk rows, none "Never"`;
    }],
    ['wb: Already Rebooked and Contacted tabs; the strip shows Delivered only from provider evidence', async () => {
      await open();
      await tab('rebooked'); await search(tid('rt-search'), 'Wb ');
      expect((await names()).some((x) => /Wb Uma/.test(x)), 'Uma is Already Rebooked');
      await tab('contacted');
      const c = await names();
      expect(c.some((x) => /Wb Tia/.test(x)) && !c.some((x) => /Wb Olga/.test(x)), `Contacted: ${c.join(', ')} (a FAILED text is not contact)`);
      await search(tid('rt-search'), '');
      const strip = await T(tid('wb-strip'));
      expect(/Contacted in period: \d+/.test(strip) && /Delivered \(provider-confirmed\): \d+|Delivered: Unknown/.test(strip), strip);
      return strip.replace(/\s+/g, ' ');
    }],
    ['wb: inactivity 90+ / custom 100 / email opted-out / future booking filter on the server and reset to page 1', async () => {
      await open(); await tab('all');
      await pick('flt-inactivity', '90'); await search(tid('rt-search'), 'Wb ');
      const s90 = await names();
      expect(s90.length >= 1 && s90.every((x) => !/Wb Nora|Wb Nate|Wb Gus|Wb Owen|Wb Uma/.test(x)), `90+: ${s90.join(', ')}`);
      expect(s90.some((x) => /Wb Olga/.test(x)) && s90.some((x) => /Wb Nico/.test(x)), `90+ has Olga + Nico: ${s90.join(', ')}`);
      await pick('flt-inactivity', 'custom'); await page.fill(tid('flt-days'), '110'); await page.waitForTimeout(500); await settle();
      const s110 = await names();
      expect(s110.some((x) => /Wb Olga/.test(x)) && !s110.some((x) => /Wb Nico/.test(x)), `110+: ${s110.join(', ')}`);
      await pick('flt-inactivity', ''); await pick('flt-email', 'opted_out');
      const oo = await names();
      expect(oo.some((x) => /Wb Olga/.test(x)) && !oo.some((x) => /Wb Tia/.test(x)), `opted out: ${oo.join(', ')}`);
      await pick('flt-email', ''); await pick('flt-future', 'yes');
      expect((await names()).some((x) => /Wb Uma/.test(x)), 'future booking: Uma');
      await page.click(tid('flt-clear')); await settle();
      return `90+ → ${s90.length} (${s90.join(', ')}) · custom 110+ → Olga only · opted out → Olga · future booking → Uma`;
    }],
    ['wb: the overlay — communications with honest states, email consent, refunds, Close; Open Booking carries the customer id', async () => {
      await open(); await tab('at_risk'); await search(tid('rt-search'), 'Wb Tia');
      await rows().first().locator('td:nth-child(2) button').click(); await page.waitForSelector(tid('rt-comms')); await settle();
      const comms = await T(tid('rt-comms'));
      expect(/Delivered/.test(comms) && /SMS/.test(comms), comms);
      expect(/Yes/.test(await T(tid('rt-email-consent'))), 'email consent');
      await shot('02-wb-overlay');
      await page.click(tid('rt-book')); await page.waitForTimeout(600);
      const url = page.url();
      expect(/customerId=e7490000-0000-4000-8000-000000000103/.test(url), url);
      await open(); await search(tid('rt-search'), '');
      return `communications: ${comms.replace(/\s+/g, ' ').slice(0, 90)} · booking → ${url.replace(/^https?:\/\/[^/]+/, '')}`;
    }],
    ['wb: Check Retention Data is read-only — the queued text to a never-visited customer is Failed, possible duplicates and a missing paid time need attention; a second run within a minute is refused', async () => {
      await open(); const before = await st();
      await page.click(tid('open-health')); await page.waitForSelector(tid('health-run')); await page.click(tid('health-run')); await page.waitForSelector(tid('health-result')); await settle();
      const q2nv = await T(tid('health-queued_to_never_visited'));
      expect(/^Failed/.test(q2nv.trim()), q2nv);
      expect(/Attention required/.test(await T(tid('health-possible_duplicate_visits'))), 'duplicates');
      expect(/Attention required/.test(await T(tid('health-visit_timestamps'))), 'paid time');
      expect(/Ready/.test(await T(tid('health-never_visited_not_lapsed'))) && /Ready/.test(await T(tid('health-segments_agree'))) && /Ready/.test(await T(tid('health-lapsed_value_reconciles'))), 'ready checks');
      const after = await st();
      expect(after.tickets === before.tickets && after.tickets_updated === before.tickets_updated && after.gus_recipient === 'queued' && after.health_runs === before.health_runs + 1, `read-only: ${JSON.stringify({ before, after })}`);
      const overall = await T(tid('health-overall'));
      await shot('03-wb-health');
      await page.click(tid('health-run')); await settle(); await page.waitForTimeout(300);
      const err = await page.locator(`${tid('dlg-health')} .fk-err`).first().innerText().catch(() => '');
      expect(/just ran|Try again/i.test(err), `second run: ${err}`);
      expect((await st()).health_runs === after.health_runs, 'still one run');
      await page.keyboard.press('Escape'); await settle();
      return `overall ${overall} · queued→never ${q2nv.split('\n')[0]} · tickets untouched · second run refused: "${err}"`;
    }],
    ['wb: Win-Back Assistant — factual criteria, never visited separate, save an UNSENT audience, then a Campaign Center DRAFT; nothing sent', async () => {
      await open(); const before = await st();
      await page.click(tid('open-assistant')); await page.waitForSelector(tid('ai-plan'));
      await page.click(tid('ai-plan')); await page.waitForSelector(tid('ai-result')); await settle();
      const crit = await T(tid('ai-criteria')); const never = await T(tid('ai-never')); const elig = Number((await T(tid('ai-eligible'))).replace(/[^0-9]/g, ''));
      expect(/At least one completed visit/.test(crit) && /not included/.test(never) && elig > 0, `${crit} · ${never} · eligible ${elig}`);
      await shot('04-wb-assistant');
      await page.click(tid('ai-save')); await page.waitForSelector(tid('ai-saved')); await settle();
      await page.click(tid('ai-campaign')); await page.waitForSelector(tid('ai-created')); await settle();
      const after = await st();
      expect(after.drafts === before.drafts + 1 && after.drafts_linked === before.drafts_linked + 1 && after.campaign_drafts === before.campaign_drafts + 1, `drafts ${JSON.stringify({ before, after })}`);
      expect(after.notifications === before.notifications && after.recipients === before.recipients, 'nothing sent or queued');
      await shot('05-wb-assistant-saved');
      await page.keyboard.press('Escape'); await settle();
      return `"${crit}" · ${never} · eligible ${elig} → 1 unsent audience + 1 Campaign Center draft; notifications ${after.notifications} (unchanged)`;
    }],
    ['wb: Front Desk can check the data but has no assistant (no marketing permission) — the API refuses it too', async () => {
      await J('/__role?r=FRONT_DESK'); await open();
      expect(await page.locator(tid('open-health')).count() === 1 && await page.locator(tid('open-assistant')).count() === 0, 'front desk buttons');
      const r = await page.evaluate(async () => { const x = await fetch('/api/v1/pos/retention/winback/plan', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ goal: 'inactive_risk' }) }); return x.status; });
      expect(r === 403, `plan as front desk → ${r}`);
      await J('/__role?r=OWNER');
      return 'Front Desk: Check Retention Data shown, Win-Back Assistant hidden, POST winback/plan → 403';
    }],
    ['wb: Vietnamese POS labels; the shell fits at 1920×945, 1536×864, 1366×768 and 1280×720 with no page-wide sideways scroll', async () => {
      await J('/__lang?l=vi'); await open();
      expect(/Kiểm tra dữ liệu giữ chân/.test(await T(tid('open-health'))), 'VI health button');
      await J('/__lang?l=en');
      const out = [];
      for (const [w, h] of [[1920, 945], [1536, 864], [1366, 768], [1280, 720]]) {
        await page.setViewportSize({ width: w, height: h }); await open(); await page.waitForTimeout(300);
        const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        expect(over <= 1, `${w}×${h}: page overflows by ${over}px`);
        await shot(`06-wb-${w}x${h}`); out.push(`${w}×${h} ok`);
      }
      await page.setViewportSize({ width: 1920, height: 945 });
      return out.join(' · ');
    }],
  ];
};
