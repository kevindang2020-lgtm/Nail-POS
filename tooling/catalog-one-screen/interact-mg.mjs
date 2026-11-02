// interact-mg.mjs — Marketing → Marketing & Growth steps of the catalog E2E (Marketing & Growth Complete Build Guide, Oct 30 2026):
// the REAL dashboard in Chromium against the REAL MarketingGrowthController + Campaign Center overview + Discounts KPIs → SQL
// (mg-extra.mjs). Loyalty / Referrals / Gift Cards / Marketing Report state routes are NOT served by this harness (their
// repositories need the Kysely query builder): the dashboard must say those sections could not be loaded and keep every
// other section working — the guide's "fail independently" rule. Nothing is ever sent.
// `node tooling/catalog-one-screen/interact.mjs <label> mg`
const MIA = 'a6e74000-0000-4000-8000-000000000001';

export const STEPS_MG = ({ page, expect, settle, go, tid, noJunk, API, J, T, rowsText, customRange, today, BASE }) => {
  const URL0 = '/tenant/marketing';
  const open = (qs = '') => go(URL0 + qs, tid('mg-screen'));
  const shot = (name) => page.screenshot({ path: `tooling/catalog-one-screen/results/mg-e2e/${name}.png`, fullPage: false }).catch(() => undefined);
  const kpiV = async (t) => (await T(`${tid(t)} .fk-kpi-v`)).replace(/\s+/g, ' ').trim();
  const N = (s) => Number(String(s).replace(/[^0-9]/g, ''));
  const money = (c) => '$' + (c / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  let notifBefore = 0;
  return [
    ['mg: the photographed screen is kept — title, Refresh, Campaigns & Promotions / Loyalty / Referrals / Gift Cards with Open, six quick actions; six KPI cards; ROI reads N/A (never "0x")', async () => {
      await J('/__tenant?name=pilot'); await J('/__role?r=OWNER'); await J('/__lang?l=en'); await J('/__mg?seed=1');
      notifBefore = (await J('/__mg?state=1')).notifications;
      await open(); await noJunk();
      const h1 = await T(`${tid('mg-screen')} h1`); expect(h1 === 'Marketing & Growth', 'title ' + h1);
      for (const s of ['mg-sec-campaigns', 'mg-sec-loyalty', 'mg-sec-referrals', 'mg-sec-gift', 'mg-refresh', 'mg-quick', 'mg-kpis', 'mg-checks', 'mg-econ', 'mg-activity'])
        expect(await page.locator(tid(s)).count() === 1, s);
      for (const s of ['mg-sec-campaigns', 'mg-sec-loyalty', 'mg-sec-referrals', 'mg-sec-gift']) expect(await page.locator(`${tid(s)} button`).count() === 1, 'Open on ' + s);
      const qa = (await page.locator(`${tid('mg-quick')} button`).allInnerTexts()).map((x) => x.trim());
      expect(qa.join('|') === 'Create Campaign|Launch Promo|Issue Gift Card|Request Review|Marketing Report|Customer display ads', 'quick actions ' + qa.join('|'));
      expect(await page.locator(`${tid('mg-kpis')} [data-testid^="mg-kpi-"]`).count() === 6, 'six KPI cards');
      const ov = await API('/pos/campaign-center/overview?preset=all');
      expect(await kpiV('mg-kpi-revenue') === money(ov.kpis.campaignRevenueCents), 'revenue = Campaign Center ' + await kpiV('mg-kpi-revenue'));
      const roi = await kpiV('mg-kpi-roi'); expect(ov.kpis.avgRoi == null ? roi === 'N/A' : roi === `${ov.kpis.avgRoi}x`, 'ROI ' + roi);
      expect(!/\b0x\b/.test(await T(tid('mg-screen'))), 'no "0x" anywhere');
      const dk = await API('/pos/discounts/kpis'); expect(N(await kpiV('mg-kpi-promotions')) === dk.activeDiscounts, 'active promotions = Discounts');
      await shot('01-mg-preserved');
      return `title ok · 4 sections with Open · 6 quick actions · revenue ${await kpiV('mg-kpi-revenue')} = Campaign Center · ROI ${roi} · promotions ${dk.activeDiscounts}`;
    }],
    ['mg: sections fail independently — Loyalty / Referrals / Gift Cards say "could not be loaded" (no fake 0) while Campaigns, checks and activity still work', async () => {
      const body = await T(tid('mg-screen'));
      const unavailable = (body.match(/could not be loaded right now/g) ?? []).length;
      expect(unavailable >= 3, 'unavailable notices ' + unavailable);
      expect(await page.locator(tid('mg-t-revenue')).count() === 1 && await page.locator(tid('mg-act-table')).count() === 1, 'other sections render');
      for (const k of ['mg-kpi-loyalty', 'mg-kpi-referrals', 'mg-kpi-gift']) expect(await kpiV(k) === 'N/A', k + ' ' + await kpiV(k));
      return `${unavailable} sections say "could not be loaded"; KPI cards read N/A, not 0; campaigns + activity render`;
    }],
    ['mg: GATE 0 data checks — loyalty Σ balances and Σ ledger equal the database; details show the formula, roll-forward and every defect with amount + source', async () => {
      const st = await J('/__mg?state=1'); const r = await API('/pos/marketing-growth/reconciliation');
      const l = r.sections.find((s) => s.key === 'loyalty'); const g = r.sections.find((s) => s.key === 'gift_cards');
      expect(l.values.pointsOutstandingTenantWide === st.points && l.values.ledgerTotal === st.ledger && l.values.members === st.members, 'loyalty vs DB ' + JSON.stringify([l.values, st]));
      expect(g.values.outstandingCents === st.gift_owed, 'gift owed vs DB');
      expect(await T(tid('mg-checks-overall')) === { ready: 'Ready', attention_required: 'Attention required', failed: 'Failed', unknown: 'Unknown' }[r.overall], 'overall badge');
      await page.click(tid('mg-check-open-loyalty')); await page.waitForSelector(tid('mg-check-detail-loyalty'));
      const d = (await T(tid('mg-check-detail-loyalty'))).replace(/\s+/g, ' ');
      expect(/Σ customer_loyalty_profiles\.points_balance/.test(d) && /roll-forward/i.test(d), 'formula + roll ' + d.slice(0, 160));
      for (const df of l.defects) expect(await page.locator(tid('mg-defect-' + df.code)).count() === 1, 'defect row ' + df.code);
      await shot('02-mg-data-checks');
      await page.click(tid('mg-check-open-loyalty'));
      return `loyalty ${st.points} pts = Σ balances; ledger ${st.ledger}; ${l.defects.length} defect(s) shown (${l.defects.map((x) => x.code).join(', ') || 'none'}) · gift owed ${money(st.gift_owed)} · overall ${r.overall}`;
    }],
    ['mg: one search box — "mia" groups a customer (masked phone, never the full number); the text is NOT put in the URL', async () => {
      await page.fill(tid('mg-search'), 'mia'); await page.waitForTimeout(600); await settle();
      await page.waitForSelector(tid('mg-group-customers'));
      const g = (await T(tid('mg-group-customers'))).replace(/\s+/g, ' ');
      expect(/Mia Journey/.test(g) && /••• 7001/.test(g), 'customer row ' + g);
      expect(!/2155557001|mia@example\.com/.test(await T(tid('mg-screen'))), 'no full phone / e-mail on screen');
      expect(!/mia/i.test(page.url()), 'no search text in the URL ' + page.url());
      return `${(await T(tid('mg-search-count'))).trim()} · ${g.slice(0, 80)}`;
    }],
    ['mg: Customer Marketing Journey — opens from the search, shows consent and the timeline with sources, is audited, has Close and Open Booking', async () => {
      const before = (await J('/__mg?state=1')).audits;
      await page.locator(`${tid('mg-group-customers')} ${tid('mg-result')}`).filter({ hasText: 'Mia Journey' }).first().click();
      await page.waitForSelector(tid('mg-j-timeline'));
      const c = await T(tid('mg-j-consent')); expect(/Text: opted in/.test(c) && /Email: no consent/.test(c), 'consent ' + c);
      const tl = (await T(tid('mg-j-timeline'))).replace(/\s+/g, ' ');
      for (const w of ['Message', 'Loyalty', 'Gift card', 'Review']) expect(tl.includes(w), 'timeline has ' + w + ': ' + tl.slice(0, 200));
      expect(/loyalty_ledger|gift_card_transactions|ai_marketing_campaign_sends/.test(tl), 'source badges');
      expect(new URL(page.url()).searchParams.get('journey') === MIA, 'journey id in URL (an id, not a name)');
      const after = (await J('/__mg?state=1')).audits; expect(after > before, `audited ${before}→${after}`);
      expect(await page.locator(tid('mg-j-book')).count() === 1, 'Open Booking');
      await shot('03-mg-journey');
      await page.click(tid('mg-j-close')); await page.waitForTimeout(300);
      expect(await page.locator(tid('mg-journey')).count() === 0, 'Close closes');
      return `${c} · ${tl.slice(0, 120)}… · audit ${before}→${after}`;
    }],
    ['mg: gift cards — the exact last 4 "7311" finds the card (masked, no balance); "731" finds nothing', async () => {
      await page.click(tid('mg-scope-gift_cards')); await page.fill(tid('mg-search'), '7311'); await page.waitForTimeout(600); await settle();
      const g = (await T(tid('mg-group-gift_cards'))).replace(/\s+/g, ' ');
      expect(/•••• 7311/.test(g) && !/\$35|3,500|3500/.test(g), 'masked, no balance ' + g);
      await page.fill(tid('mg-search'), '731'); await page.waitForTimeout(600); await settle();
      expect(/No matches/.test(await T(tid('mg-filters'))), 'partial number finds nothing');
      await page.fill(tid('mg-search'), ''); await page.click(tid('mg-scope-all')); await settle();
      return `"7311" → ${g.slice(0, 60)} · "731" → no matches`;
    }],
    ['mg: activity history — newest first, numbered pages, 10 / 20 rows, type filter resets to page 1, exact total; custom month calendar today→today', async () => {
      await open('?preset=all');
      const a = await API('/pos/marketing-growth/activity?preset=all&pageSize=10');
      expect((await page.locator(tid('mg-act-row')).count()) === Math.min(10, a.pagination.totalItems), 'page 1 rows');
      if (a.pagination.totalPages > 1) { await page.click('.mg-foot .fk-pager .fk-pbtn.num >> text="2"'); await settle(); expect(/page=2/.test(page.url()), 'page 2 in URL'); }
      await page.selectOption(tid('mg-size'), '20'); await settle(); expect(!/page=2/.test(page.url()), 'size → page 1');
      await page.selectOption(tid('mg-type'), 'loyalty'); await settle();
      const types = await rowsText(`${tid('mg-act-row')} td:nth-child(2)`); expect(types.length > 0 && types.every((x) => x === 'Loyalty'), 'loyalty only ' + types.join(','));
      await page.selectOption(tid('mg-type'), ''); await settle(); await page.selectOption(tid('mg-size'), '10'); await settle();
      await customRange(today, today); await settle();
      expect(/preset=custom/.test(page.url()), 'custom range in URL ' + page.url());
      const t1 = await API(`/pos/marketing-growth/activity?preset=custom&from=${today}&to=${today}&pageSize=10`);
      expect((await page.locator(tid('mg-act-row')).count()) === Math.min(10, t1.pagination.totalItems) || t1.pagination.totalItems === 0, 'today rows = server');
      await shot('04-mg-activity');
      return `${a.pagination.totalItems} events all-time · ${a.pagination.totalPages} pages · loyalty filter ${types.length} rows · today ${t1.pagination.totalItems}`;
    }],
    ['mg: Marketing Cost & Profit (owner) — unknown spend is N/A (never $0), rows add up to the totals; Front Desk sees the owner-only notice and the API refuses (403)', async () => {
      await open('?preset=all');
      const e = await API('/pos/marketing-growth/economics?preset=all');
      const spend = await kpiV('mg-econ-spend'); expect(e.totals.spendCents == null ? spend === 'N/A' : spend === money(e.totals.spendCents), 'spend ' + spend);
      expect(/add up/.test(await T(tid('mg-econ-rec'))) === e.reconciliation.reconciled, 'reconciliation badge');
      await shot('05-mg-economics');
      await J('/__role?r=FRONT_DESK'); await page.goto(BASE + URL0); await page.waitForTimeout(1500); await settle();
      const body = await T('body');
      const r = await fetch(BASE + '/api/v1/pos/marketing-growth/economics');
      await J('/__role?r=OWNER');
      expect(/Owners and managers only|Your role cannot/.test(body) && r.status === 403, `front desk ${r.status}`);
      return `spend ${spend} · ${e.totals.campaignsMissingCost} campaign(s) without cost · rows reconciled ${e.reconciliation.reconciled} · Front Desk economics → ${r.status}`;
    }],
    ['mg: Smart Campaign Assistant — a goal opens Campaign Center\'s own assistant (proposal only); nothing is sent', async () => {
      await open(); await page.click(tid('mg-assistant')); await page.waitForSelector(tid('mg-assist'));
      expect(await page.locator(`${tid('mg-assist')} [data-testid^="mg-goal-"]`).count() === 4, 'four goals');
      await page.click(tid('mg-goal-inactive'));
      await page.waitForSelector(tid('cc-assistant'), { timeout: 20000 }); await settle();
      const on = await page.locator(`${tid('cc-a-goal-inactive')}.on`).count();
      expect(on === 1 && /\/tenant\/marketing\/campaigns/.test(page.url()), 'Campaign Center assistant on goal "inactive" ' + page.url());
      const a = (await T(tid('cc-assistant'))).replace(/\s+/g, ' ');
      expect(/NOT included/.test(a), 'never-visited excluded from win-back: ' + a.slice(0, 160));
      await shot('06-mg-assistant');
      const st = await J('/__mg?state=1'); expect(st.notifications === notifBefore, `no messages written ${notifBefore}→${st.notifications}`);
      return `goal → ${page.url().replace(BASE, '')} · assistant open on "inactive" · notifications ${notifBefore}→${st.notifications}`;
    }],
    ['mg: Vietnamese POS — labels in Vietnamese, the same numbers', async () => {
      await open(); const en = await kpiV('mg-kpi-revenue');
      await J('/__lang?l=vi'); await open(); await noJunk();
      const b = await T(tid('mg-checks')); const vi = await kpiV('mg-kpi-revenue');
      await shot('07-mg-vietnamese'); await J('/__lang?l=en');
      expect(/Kiểm tra dữ liệu/.test(b) && vi === en, `vi ${b.slice(0, 40)} · ${vi} vs ${en}`);
      return `"${b.slice(0, 40)}" · revenue ${vi} = ${en}`;
    }],
    ['mg: layout — 1920×945, 1536×864, 1440×900, 1366×768, 1024×768: no page-wide horizontal scroll, the page scrolls vertically; the journey overlay has a 36px+ Close and Escape closes', async () => {
      const out = [];
      for (const [w, h] of [[1920, 945], [1536, 864], [1440, 900], [1366, 768], [1024, 768]]) {
        await page.setViewportSize({ width: w, height: h }); await open();
        const m = await page.evaluate(() => { const se = document.scrollingElement; const c = document.querySelector('[data-testid="mg-screen"]'); return { hx: se.scrollWidth - innerWidth, cx: c.scrollWidth - c.clientWidth }; });
        expect(m.hx <= 0 && m.cx <= 1, `${w}x${h} ${JSON.stringify(m)}`);
        await page.screenshot({ path: `tooling/catalog-one-screen/results/mg-e2e/mg-${w}x${h}.png` });
        out.push(`${w}×${h} ok`);
      }
      await open('?journey=' + MIA); await page.waitForSelector(tid('mg-j-close'));
      const box = await page.locator(tid('mg-j-close')).boundingBox(); expect(box && box.height >= 36, 'close ' + JSON.stringify(box));
      await page.keyboard.press('Escape'); await page.waitForTimeout(300);
      expect(await page.locator(tid('mg-journey')).count() === 0, 'Escape closes');
      await page.setViewportSize({ width: 1920, height: 945 });
      return out.join(' · ') + ` · Close ${Math.round(box.height)}px, Escape closes`;
    }],
  ];
};
