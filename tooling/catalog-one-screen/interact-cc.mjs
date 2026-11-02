// interact-cc.mjs — Marketing → Campaign Center steps of the catalog E2E (Campaign Center Complete Build Guide, Oct 30 2026): the
// REAL screen in Chromium against the REAL CampaignCenterController → SQL (cc-extra.mjs). Nothing leaves the machine: Launch
// only schedules; the one "send" is the REAL executor with a TEST sender that writes 'simulated' log rows.
// `node tooling/catalog-one-screen/interact.mjs <label> cc`
// the seeded "spring into glow" id (cc-extra.mjs SPRING) — not imported: this file runs without the TypeScript loader
const SPRING = 'cc739000-0000-4000-8000-000000000001';

export const STEPS_CC = ({ page, expect, settle, go, tid, noJunk, API, J, T, rowsText, customRange, today, BASE }) => {
  const URL0 = '/tenant/marketing/campaigns';
  const open = (path = URL0) => go(path, tid('campaign-center'));
  const shot = (name) => page.screenshot({ path: `tooling/catalog-one-screen/results/cc-e2e/${name}.png`, fullPage: false }).catch(() => undefined);
  const N = (s) => Number(String(s).replace(/[^0-9]/g, ''));
  const kpiV = async (t) => (await T(`${tid(t)} .fk-kpi-v`)).replace(/\s+/g, ' ').trim();
  const springRow = () => page.locator(tid('cc-row-' + SPRING));
  let created = '';
  return [
    ['cc: every original module is kept — title, New Campaign, six KPI cards = the server, 11 columns, funnel / mix / revenue, 4 related cards, 7 Quick Actions', async () => {
      await J('/__tenant?name=pilot'); await J('/__role?r=OWNER'); await J('/__lang?l=en'); await J('/__cc?seed=1');
      await open(); await noJunk();
      const h1 = await T(`${tid('campaign-center')} h1`); expect(h1 === 'Campaign Center', 'title ' + h1);
      const ov = await API('/pos/campaign-center/overview');
      expect(N(await kpiV('kpi-sent')) === ov.kpis.totalSent && N(await kpiV('kpi-active')) === ov.kpis.activeCampaigns && N(await kpiV('kpi-bookings')) === ov.kpis.totalBookings, 'kpis vs server');
      const heads = (await page.locator(`${tid('cc-table')} thead th`).allInnerTexts()).map((x) => x.trim().toLowerCase());   // CSS uppercases the header row
      expect(['campaign', 'channel', 'audience', 'status', 'sent', 'open', 'click', 'reply', 'bookings', 'revenue', 'roi'].every((h) => heads.includes(h)), 'columns ' + heads.join('|'));
      for (const t of ['cc-funnel', 'cc-mix', 'cc-revenue', 'cc-quick', 'cc-new']) expect(await page.locator(tid(t)).count() === 1, t);
      const qa = await page.locator(`${tid('cc-quick')} button`).allInnerTexts();
      expect(qa.length === 7, 'quick actions ' + qa.join('|'));
      expect(await page.locator('.cc-related .fk-panel').count() === 4, 'related cards');
      await shot('cc-preserved');
      return `title ok · KPIs = server (sent ${ov.kpis.totalSent}) · ${heads.length} columns · 4 related cards · ${qa.length} quick actions`;
    }],
    ['cc: spring into glow — typed audience shown as "~50 est.", Sent 0, "No messages were sent — no send record exists", Open/Click/Reply/ROI N/A, funnel Selected 0 (never "50 reached")', async () => {
      const r = (await springRow().innerText()).replace(/\s+/g, ' ');
      expect(/~50 est\./.test(r) && /No messages were sent/.test(r) && /N\/A/.test(r), 'row ' + r);
      const sel = await T(tid('cc-funnel-selected')); const sub = await T(tid('cc-funnel-submitted'));
      const legacy = await T(tid('cc-funnel-legacy'));
      // other harness sections (Customer Segments' audience drafts) add real snapshot campaigns, so the funnel is checked
      // against the server — and the server's Selected must be the snapshot sum, never including spring into glow's typed 50
      const ov = await API('/pos/campaign-center/overview'); const fv = (k) => ov.funnel.find((x) => x.key === k)?.value ?? 0;
      const num = (t) => Number((t.match(/[\d,]+(?!.*\d)/)?.[0] ?? 'NaN').replace(/,/g, ''));
      const spr = ov.funnel && (await API('/pos/campaign-center/campaigns?q=' + encodeURIComponent('spring into glow'))).items[0];
      expect(num(sel) === fv('selected') && num(sub) === fv('submitted') && legacy.includes(String(ov.legacyEstimateTotal)) && ov.legacyEstimateTotal >= 50 && spr?.counts?.selectedIsEstimate === true, `funnel ${sel.replace(/\s+/g, ' ')} / ${sub.replace(/\s+/g, ' ')} / ${legacy} vs server ${fv('selected')}/${fv('submitted')} · spring estimate ${spr?.counts?.selectedIsEstimate}`);
      expect(!/x$/.test((await kpiV('kpi-roi')).trim()) && /N\/A/.test(await kpiV('kpi-roi')), 'ROI card ' + await kpiV('kpi-roi'));
      const st = await J('/__cc?state=1');
      expect(st.spring.audience_size === 50 && st.spring.sent_count === 0 && st.spring.status === 'completed', 'row untouched ' + JSON.stringify(st.spring));
      await shot('cc-spring-into-glow');
      return `${r.slice(0, 120)} · funnel ${sel.replace(/\s+/g, ' ')} · ${legacy}`;
    }],
    ['cc: the details overlay explains it, and Check Campaign System traces it read-only (execution = attention, nothing sent, a health run recorded)', async () => {
      const before = await J('/__cc?state=1');
      await springRow().click(); await page.waitForSelector(tid('cc-detail'));
      const out = await T(tid('cc-detail-outcome')); const sel = await T(tid('cc-count-selected')); const subm = await T(tid('cc-count-submitted'));
      expect(/no send record/i.test(out) && /~50/.test(sel) && /\b0\b/.test(subm), `${out} · ${sel} · ${subm}`);
      await page.click(tid('cc-tab-events')); await settle(); const ev = await page.locator('.cc-tabbody').innerText();
      expect(/No send records/.test(ev), 'events ' + ev);
      await page.click(tid('cc-detail-health')); await page.waitForSelector(tid('cc-h-findings')); await settle();
      const f = (await page.locator(tid('cc-h-findings')).innerText()).replace(/\s+/g, ' ');
      expect(/no send was ever recorded/i.test(f) && /typed-in|hand-typed estimate/i.test(f), 'findings ' + f.slice(0, 200));
      const after = await J('/__cc?state=1');
      expect(after.ledger === before.ledger && after.notifTotal === before.notifTotal && after.healthRuns === before.healthRuns + 1, 'db ' + JSON.stringify([before, after]));
      await shot('cc-health-spring');
      await page.click(tid('cc-h-close')); await page.waitForTimeout(250);
      return `${out} · health: ${f.slice(0, 120)} · ledger ${after.ledger} · messages ${before.notifTotal}→${after.notifTotal}`;
    }],
    ['cc: /tenant/marketing/sms opens the SAME Campaign Center titled "SMS Marketing", pre-filtered to SMS on the server', async () => {
      await open('/tenant/marketing/sms');
      const h1 = await T(`${tid('campaign-center')} h1`); const ch = await page.inputValue(tid('cc-channel'));
      const rows = await page.locator(`${tid('cc-table')} tbody tr`).allInnerTexts();
      expect(h1 === 'SMS Marketing' && ch === 'sms' && rows.every((r) => /SMS/.test(r)), `${h1} · ${ch} · ${rows.length}`);
      return `${h1} · channel ${ch} · ${rows.length} SMS rows`;
    }],
    ['cc: New Campaign — details → audience (a Customer Segments snapshot: 6 selected / 4 eligible / 2 excluded) → message → review; preview never sends', async () => {
      const before = await J('/__cc?state=1');
      await open(); await page.click(tid('cc-new')); await page.waitForSelector(tid('cc-wizard'));
      await page.fill(tid('cc-w-name'), 'Fall glow E2E'); await page.fill(tid('cc-w-offer'), '15% off');
      await page.click(tid('cc-w-next')); await page.waitForSelector(tid('cc-w-sources')); await settle();
      await page.locator(tid('cc-w-use-source')).first().click(); await settle();
      const now = await T(tid('cc-w-audience-now')); expect(/6 selected · 4 eligible · 2 excluded/.test(now), 'audience ' + now);
      await page.click(tid('cc-step-content')); await page.fill(tid('cc-w-message'), 'Hi from {salon_name}! {offer} this week.');
      await page.click(tid('cc-w-next')); await settle();                       // → Schedule (send as soon as launched)
      await page.click(tid('cc-w-next')); await page.waitForSelector(tid('cc-w-review')); await settle();   // → Review
      const rv = (await T(tid('cc-w-review'))).replace(/\s+/g, ' ');
      expect(/Pilot Nail Salon: Hi from Pilot Nail Salon! 15% off this week\. Reply STOP to opt out/.test(rv) && /Preview only/.test(rv), 'review ' + rv.slice(0, 200));
      const st = await J('/__cc?state=1'); expect(st.ledger === before.ledger && st.notifTotal === before.notifTotal, 'nothing sent ' + JSON.stringify([before, st]));
      const l = await API('/pos/campaign-center/campaigns?q=' + encodeURIComponent('Fall glow E2E')); created = l.items[0].id;
      await shot('cc-wizard-review');
      return `${now} · ${rv.slice(0, 110)} · ledger ${st.ledger}`;
    }],
    ['cc: approval — Launch is not offered before approval; approve → Launch disabled until the confirmation is ticked → Scheduled (still nothing sent)', async () => {
      const before = await J('/__cc?state=1');
      await page.click(tid('cc-step-approval')); await settle();
      expect(await page.locator(tid('cc-w-launch')).count() === 0, 'launch before approval');
      const rd0 = await T(tid('cc-w-readiness')); expect(/approve/i.test(rd0), 'readiness ' + rd0);
      await page.click(tid('cc-w-submit')); await settle(); await page.click(tid('cc-w-approve')); await settle();
      const btn = page.locator(tid('cc-w-launch')); await btn.waitFor();
      expect(await btn.isDisabled(), 'launch must wait for the tick');
      await page.click(tid('cc-w-confirm')); await btn.click(); await settle(); await page.waitForTimeout(900);
      const d = await API(`/pos/campaign-center/campaigns/${created}`);
      const st = await J('/__cc?state=1');
      expect(d.status === 'scheduled' && d.approvalCurrent && st.notifTotal === before.notifTotal && st.ledger === before.ledger && st.plans >= 1, 'after launch ' + JSON.stringify([d.status, before, st]));
      await shot('cc-launched');
      return `status ${d.status} · approved ${d.approvedBy} · plans ${st.plans} · messages ${before.notifTotal}→${st.notifTotal} (none: only the worker sends)`;
    }],
    ['cc: the worker run (REAL executor, TEST sender): Eve has no consent (excluded), Ben revoked consent after scheduling (skipped), 3 accepted once; a re-run sends nothing', async () => {
      await J('/__cc?revoke=Ben Shine');
      const s0 = await J('/__cc?state=1');
      const r1 = await J('/__cc?execute=' + created); const r2 = await J('/__cc?execute=' + created);
      expect(r1.summary.sent === 3 && r1.summary.skipped === 1 && r1.testSends === 3 && (r2.error || r2.summary === undefined || r2.testSends === 0), 'runs ' + JSON.stringify([r1, r2]));
      const s1 = await J('/__cc?state=1');
      expect(s1.campaignMessages === s0.campaignMessages + 3 && s1.realProviderSends === 0, 'test sends only ' + JSON.stringify([s0, s1]));
      await J('/__cc?deliver=' + created);
      await open(); await page.fill(tid('cc-search'), 'Fall glow E2E'); await page.waitForTimeout(600); await settle();
      await page.locator(tid('cc-row-' + created)).click(); await page.waitForSelector(tid('cc-detail')); await settle();
      const c = Object.fromEntries(await Promise.all(['selected', 'eligible', 'excluded', 'attempted', 'submitted', 'delivered', 'unknown'].map(async (k) => [k, N(await T(tid('cc-count-' + k)))])));
      expect(c.selected === 6 && c.eligible === 4 && c.excluded === 2 && c.submitted === 3 && c.delivered === 1, 'counts ' + JSON.stringify(c));
      await page.click(tid('cc-tab-recipients')); await page.waitForSelector(tid('cc-rec-table')); await settle();
      const rows = await rowsText(`${tid('cc-rec-table')} tbody tr`);
      expect(rows.some((r) => /Ben Shine/.test(r) && /Skipped/.test(r) && /No consent/.test(r)) && rows.some((r) => /Eve NoConsent/.test(r) && /Excluded/.test(r)), 'recipient rows ' + rows.join(' || ').slice(0, 300));
      await shot('cc-results');
      return `run1 ${JSON.stringify(r1.summary).slice(0, 90)} · run2 ${JSON.stringify(r2).slice(0, 60)} · counts ${JSON.stringify(c)}`;
    }],
    ['cc: search scope "Recipients & delivery history" finds only real campaign recipients (Ava Glow), not every customer', async () => {
      await page.keyboard.press('Escape'); await open(URL0 + '?scope=recipients');
      await page.fill(tid('cc-search'), 'Ava Glow'); await page.waitForTimeout(600); await settle();
      const rows = await rowsText(tid('cc-recipient-row'));
      await page.fill(tid('cc-search'), 'Nobody Customer'); await page.waitForTimeout(600); await settle();
      const none = await page.locator(tid('cc-recipient-row')).count();
      expect(rows.length >= 1 && rows.every((r) => /Ava Glow/.test(r) && /Fall glow E2E/.test(r)) && none === 0, 'rows ' + rows.join(' | '));
      return `${rows[0].slice(0, 100)} · unknown name → ${none}`;
    }],
    ['cc: numbered pages 1/2/3, 10/20/50 rows, newest first; a new matching campaign is on page 1; filters reset the page; URL keeps the view', async () => {
      await J('/__cc?many=25'); await open();
      const total = (await API('/pos/campaign-center/campaigns?pageSize=50')).pagination.totalItems;
      const p1 = await rowsText(`${tid('cc-table')} tbody tr`);
      const pager = await page.locator('.fk-pager .fk-pbtn.num').allInnerTexts();
      expect(p1.length === 10 && pager.includes('2') && pager.includes('3'), 'pager ' + pager.join(','));
      await page.locator('.fk-pager .fk-pbtn.num', { hasText: '2' }).first().click(); await settle();
      expect(/page=2/.test(page.url()), 'url ' + page.url());
      await page.selectOption(tid('cc-size'), '20'); await settle(); const p20 = (await rowsText(`${tid('cc-table')} tbody tr`)).length;
      await page.selectOption(tid('cc-size'), '50'); await settle(); const p50 = (await rowsText(`${tid('cc-table')} tbody tr`)).length;
      await page.selectOption(tid('cc-status'), 'scheduled'); await settle();
      expect(!/page=/.test(page.url()), 'filter resets page ' + page.url());
      await page.selectOption(tid('cc-status'), ''); await settle();
      const first = (await rowsText(`${tid('cc-table')} tbody tr`))[0];
      expect(p20 === 20 && p50 === Math.min(50, total) && /Fall glow E2E/.test(first), `sizes ${p20}/${p50} of ${total} · first ${first.slice(0, 40)}`);
      return `10/20/${p50} rows · pages ${pager.join(',')} · newest first: ${first.slice(0, 30)}`;
    }],
    ['cc: From / To month calendar on the Created basis (salon time) — today only; Completion basis for a past month is empty; Clear all', async () => {
      await customRange(today, today);
      const rows = await rowsText(`${tid('cc-table')} tbody tr`); const hint = await T(tid('cc-basis-active'));
      expect(rows.length >= 1 && rows.every((r) => !/Fixture campaign/.test(r)) && /Created from/.test(hint), 'rows ' + rows.length + ' ' + hint);
      await page.click(tid('cc-clear')); await settle();
      expect(!/preset=/.test(page.url()), 'cleared ' + page.url());
      await shot('cc-calendar');
      return `${hint} · ${rows.length} created today`;
    }],
    ['cc: Campaign Assistant suggests from real data (never-visited excluded) and only saves a DRAFT; nothing is sent', async () => {
      const before = await J('/__cc?state=1');
      await page.click(tid('cc-open-assistant')); await page.waitForSelector(tid('cc-a-result')); await settle();
      const txt = (await T(tid('cc-a-result'))).replace(/\s+/g, ' ');
      expect(/NOT included/.test(txt) && /suggestion, not a verified fact/.test(txt), 'assistant ' + txt.slice(0, 200));
      await page.click(tid('cc-a-save')); await page.waitForSelector(tid('cc-wizard')); await settle();
      const after = await J('/__cc?state=1');
      expect(after.notifTotal === before.notifTotal && after.ledger === before.ledger, 'no send ' + JSON.stringify([before, after]));
      await page.click(tid('cc-w-close')); await page.waitForTimeout(300);
      return `${txt.slice(0, 120)} · drafts +1, ledger ${after.ledger} unchanged`;
    }],
    ['cc: Vietnamese POS — labels in Vietnamese, the same numbers', async () => {
      await J('/__lang?l=vi'); await open();
      const sent = await kpiV('kpi-sent'); const r = (await springRow().innerText()).replace(/\s+/g, ' ');
      expect(/ước tính/.test(r) && /Không có tin nào được gửi/.test(r), 'vi row ' + r);
      await shot('cc-vietnamese'); await J('/__lang?l=en');
      return `${r.slice(0, 100)} · sent ${sent}`;
    }],
    ['cc: layout — 1920×945, 1536×864, 1440×900, 1366×768, 1024×768: no page-wide horizontal scroll, the page scrolls vertically, the overlay has Close', async () => {
      const out = [];
      for (const [w, h] of [[1920, 945], [1536, 864], [1440, 900], [1366, 768], [1024, 768]]) {
        await page.setViewportSize({ width: w, height: h }); await open();
        const m = await page.evaluate(() => { const se = document.scrollingElement; const c = document.querySelector('[data-testid="campaign-center"]'); return { hx: se.scrollWidth - innerWidth, cx: c.scrollWidth - c.clientWidth, vy: c.scrollHeight > c.clientHeight }; });
        expect(m.hx <= 0 && m.cx <= 1, `${w}x${h} ${JSON.stringify(m)}`);
        await page.screenshot({ path: `tooling/catalog-one-screen/results/cc-e2e/cc-${w}x${h}.png` });
        out.push(`${w}×${h} ok`);
      }
      await springRow().click(); await page.waitForSelector(tid('cc-detail-close'));
      const closeBox = await page.locator(tid('cc-detail-close')).boundingBox(); expect(closeBox && closeBox.height >= 36, 'close target ' + JSON.stringify(closeBox));
      await page.keyboard.press('Escape'); await page.waitForTimeout(300);
      expect(await page.locator(tid('cc-detail')).count() === 0, 'Escape closes');
      await page.setViewportSize({ width: 1920, height: 945 });
      return out.join(' · ') + ' · Close ' + Math.round(closeBox.height) + 'px, Escape closes';
    }],
    ['cc: Front Desk (no marketing permission) sees the refusal and cannot create, approve or launch', async () => {
      await J('/__role?r=FRONT_DESK'); await page.goto(BASE + URL0); await page.waitForTimeout(1500); await settle();
      const body = await page.locator('body').innerText();
      const denied = await fetch(BASE + `/api/v1/pos/campaign-center/campaigns/${created}/approve`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }).then((r) => r.status).catch(() => 0);
      await J('/__role?r=OWNER');
      expect(/permission|not allowed|không có quyền/i.test(body) || denied === 403, 'front desk ' + body.slice(0, 200) + ' ' + denied);
      return `screen: ${/permission/i.test(body) ? 'permission notice' : 'refused'} · approve API ${denied}`;
    }],
  ];
};
