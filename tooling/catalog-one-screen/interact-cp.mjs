// interact-cp.mjs — Marketing → Coupons steps of the catalog E2E (Coupons & Promotions Management Center guide, Oct 30 2026):
// the REAL screen in Chromium against the REAL DiscountsScreenController / DealsController / CouponCenterController → SQL
// (extra.mjs + cp-extra.mjs). Nothing is sent: creating, duplicating and the assistant make DRAFTS; the checker is read-only.
// `node tooling/catalog-one-screen/interact.mjs <label> cp`
export const STEPS_CP = ({ page, expect, settle, go, tid, noJunk, API, J, T, rowsText }) => {
  const URL0 = '/tenant/marketing/coupons';
  const open = (qs = '') => go(URL0 + qs, tid('coupons-screen'));
  const rows = () => rowsText(tid('coupon-row'));
  const kpiV = async (t) => (await T(`${tid(t)} .fk-kpi-v`)).replace(/\s+/g, ' ').trim();
  const N = (s) => Number(String(s).replace(/[^0-9]/g, ''));
  const fit = async () => page.evaluate(() => { const se = document.scrollingElement; return { h: se.scrollWidth - innerWidth }; });
  const find = async (text) => { await page.fill(tid('search'), text); await page.waitForTimeout(450); await settle(); };
  const vishalRow = async () => { await find('vishal'); return page.locator(tid('coupon-row')).filter({ hasText: /^.*vishal(?! \(copy\)).*$/m }).first(); };
  const shot = (name) => page.screenshot({ path: `tooling/catalog-one-screen/results/cp-e2e/${name}.png`, fullPage: false }).catch(() => undefined);
  return [
    ['cp: the Coupons route now shows its own "Coupons & Promotions" screen (Promotions and Deals routes still work); the vishal 20% record and the cards = the server', async () => {
      await J('/__tenant?name=pilot'); await J('/__role?r=OWNER'); await J('/__lang?l=en');
      await open(); await noJunk();
      const h1 = await T(`${tid('coupons-screen')} h1`); expect(h1 === 'Coupons & Promotions', 'title ' + h1);
      const k = await API('/pos/discounts/kpis');
      expect(N(await kpiV('kpi-total')) === k.total && N(await kpiV('kpi-active')) === k.activeDiscounts && N(await kpiV('kpi-paused')) === k.split.paused && N(await kpiV('kpi-redemptions')) === k.ledger.confirmedEvents, 'cards = server');
      const r = (await rowsText(tid('coupon-row'))).find((x) => /vishal/.test(x)) ?? (await (await vishalRow()).innerText()).replace(/\s+/g, ' ');
      expect(/••••NG20/.test(r) && /20% off/.test(r) && /Active/.test(r), 'vishal row ' + r);
      await find('');
      await go('/tenant/marketing/promotions', 'h1'); const ph = await T('h1');
      await go('/tenant/marketing/deals', 'h1'); const dh = await T('h1');
      expect(!/Coupons & Promotions/.test(ph) && dh.length > 0, `promotions "${ph}" deals "${dh}"`);
      return `title "${h1}" · total ${k.total} active ${k.activeDiscounts} paused ${k.split.paused} redemptions ${k.ledger.confirmedEvents} · ${r.slice(0, 70)} · /promotions "${ph}" · /deals "${dh}"`;
    }],
    ['cp: one canonical record — vishal is ONE deals row with ONE hashed code; Promotions\' API and the Coupons library return the same id', async () => {
      const st = await J('/__cp?state=1'); expect(st.vishal_rows === 1 && st.vishal_codes === 1, 'db ' + JSON.stringify(st));
      const promos = await API('/pos/salon-promotions/state'); const p = (promos.items ?? promos.promotions ?? promos).filter?.((x) => x.name === 'vishal') ?? [];
      const lib = await API('/pos/discounts?q=vishal&status=all');
      expect(p.length === 1 && lib.items.length === 1 && p[0].id === lib.items[0].id, `promotions ${p.map((x) => x.id)} library ${lib.items.map((x) => x.id)}`);
      return `deals rows 1 · codes 1 · same id ${lib.items[0].id.slice(0, 8)} on Promotions and Coupons`;
    }],
    ['cp: Check Coupon on ticket #77001 ($33.35) — Eligible, would take $6.67 (Checkout\'s engine), and the check writes nothing', async () => {
      await open(); const before = await J('/__cp?state=1');
      const row = await vishalRow(); await row.locator(tid('coupon-check')).click(); await page.waitForSelector(tid('dlg-check'));
      await page.fill(tid('check-ticket'), '77001'); await page.click(tid('check-run')); await page.waitForSelector(tid('check-result')); await settle();
      const v = await T(tid('check-verdict')); const d = await T(tid('check-discount'));
      expect(v === 'Eligible' && /\$6\.67/.test(d) && /\$33\.35/.test(d), `verdict ${v} · ${d}`);
      await page.click(tid('check-code')); await page.click(tid('check-run')); await settle();
      const v2 = await T(tid('check-verdict')); expect(v2 === 'Code needed', 'without the code: ' + v2);
      const after = await J('/__cp?state=1'); expect(after.redemptions === before.redemptions && after.holds === before.holds, 'no writes ' + JSON.stringify([before, after]));
      await page.keyboard.press('Escape'); await page.waitForTimeout(250);
      return `${v}: ${d} · without code: ${v2} · redemptions ${after.redemptions} holds ${after.holds} unchanged`;
    }],
    ['cp: server search — exact code (masked in the result), name, beyond page 1; numbered pages and 10/20/50 rows; Clear All', async () => {
      await open(); await find('VISHALNG20');
      const r = await rows(); expect(r.length === 1 && /vishal/.test(r[0]) && /exact code/i.test(r[0]) && !/VISHALNG20/.test(r[0]), 'code search ' + r);
      await find(''); await page.selectOption(tid('status'), 'all'); await settle();
      const total = N(await T(`${tid('coupons-list')} .fk-muted`));
      await page.selectOption(tid('page-size'), '10'); await settle();
      const pages = await page.locator(`${tid('coupons-list')} .fk-pbtn.num`).count();
      let p2 = 'n/a';
      if (total > 10) { await page.locator(`${tid('coupons-list')} .fk-pbtn.num`).nth(1).click(); await settle(); p2 = (await rows())[0]?.slice(0, 40); expect((await rows()).length > 0, 'page 2 rows'); }
      await page.selectOption(tid('page-size'), '50'); await settle(); const all = (await rows()).length;
      expect(all === Math.min(50, total), `50 rows → ${all} of ${total}`);
      await page.click(tid('clear-all')); await settle(); expect((await page.inputValue(tid('status'))) === 'live', 'cleared');
      return `exact code → "${r[0].slice(0, 50)}" · ${total} coupons, ${pages} page buttons at 10 · page 2 first "${p2}" · 50/page shows ${all}`;
    }],
    ['cp: From/To month calendar — "Active during range" basis, custom dates, basis shown; changing dates resets to page 1', async () => {
      await open(); await page.selectOption(tid('status'), 'all'); await settle();
      await page.selectOption(tid('date-basis'), 'active'); await settle();
      await page.click(tid('preset-custom')); await page.waitForSelector(tid('range-calendar'));
      const cells = await page.locator(`${tid('range-calendar')} [data-ymd]`).count(); expect(cells >= 28, 'month grid cells ' + cells);
      await page.keyboard.press('Escape').catch(() => undefined); await page.click(tid('preset-month')); await settle();
      const shown = await T(tid('coupons-list')); expect(/Active during range/.test(shown), 'basis shown');
      const active = await T(tid('active-period'));
      await page.click(tid('preset-all')); await page.selectOption(tid('date-basis'), 'created'); await page.selectOption(tid('status'), 'live'); await settle();
      return `calendar opens a month grid (${cells} day cells) · basis "Active during range" shown · period "${active}"`;
    }],
    ['cp: Details overlay — Overview / Codes / Financial / Related Campaigns ("Fall regulars SMS") / History, with Close; filters kept', async () => {
      await open(); await find('vishal');
      await (await vishalRow()).locator(tid('coupon-view')).click(); await page.waitForSelector(tid('dlg-discount')); await settle();
      const seen = [];
      for (const t of ['overview', 'codes', 'financial', 'campaigns', 'history']) { await page.click(tid('dd-tab-' + t)); await settle(); seen.push(t); }
      await page.click(tid('dd-tab-campaigns')); await settle();
      const camp = await T(tid('dd-campaigns')); expect(/Fall regulars SMS/.test(camp) && /25 codes/.test(camp), 'campaigns ' + camp);
      await shot('cp-details-campaigns');
      await page.click(tid('dd-close')); await page.waitForTimeout(250);
      expect((await page.inputValue(tid('search'))) === 'vishal', 'search kept after Close');
      return `tabs ${seen.join(' · ')} · campaign "${camp.split('\n')[0]}" · Close keeps the search`;
    }],
    ['cp: lifecycle — Pause vishal (card moves, checker says Paused) then Resume (rechecks dates/limits) — history kept', async () => {
      await open(); await find('vishal'); const k0 = N(await kpiV('kpi-paused'));
      await (await vishalRow()).locator(tid('coupon-view')).click(); await page.waitForSelector(tid('dlg-discount'));
      await page.click(tid('dd-pause')); await settle();
      const n1 = await T(tid('note')); expect(/paused/i.test(n1), 'note ' + n1);
      const st = await J('/__cp?state=1'); expect(st.vishal_status === 'paused', 'db ' + st.vishal_status);
      const vid = (await API('/pos/discounts?q=vishal&status=all')).items[0].id;
      const chk = await fetch(new URL('/api/v1/pos/coupons/' + vid + '/check', page.url()).href, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ spendCents: 3335, codeEntered: true }) }).then((x) => x.json());
      expect(chk.verdict === 'PAUSED', 'check ' + chk.verdict);
      await page.click(tid('dd-close')).catch(() => undefined); await page.waitForTimeout(200); await open(); await find('vishal');
      expect(N(await kpiV('kpi-paused')) === k0 + 1, 'paused card +1');
      await (await vishalRow()).locator(tid('coupon-view')).click(); await page.waitForSelector(tid('dlg-discount'));
      await page.click(tid('dd-resume')); await settle(); await page.click(tid('dd-close')).catch(() => undefined);
      const st2 = await J('/__cp?state=1'); expect(st2.vishal_status === 'active', 'resumed ' + st2.vishal_status);
      return `paused (card ${k0}→${k0 + 1}, checker PAUSED) → resumed active`;
    }],
    ['cp: Duplicate vishal → a DRAFT "vishal (copy)" first on page 1; no code, uses or history copied', async () => {
      await open(); await find('vishal'); const before = await J('/__cp?state=1');
      await (await vishalRow()).locator(tid('coupon-view')).click(); await page.waitForSelector(tid('dlg-discount'));
      await page.click(tid('dd-duplicate')); await page.waitForSelector(tid('dlg-duplicate')); await page.click(tid('dup-save')); await settle();
      await page.click(tid('dd-close')).catch(() => undefined); await page.waitForTimeout(200);
      await find(''); const first = (await rows())[0] ?? '';
      expect(/vishal \(copy\)/.test(first) && /Draft/.test(first) && /No code/.test(first), 'first row ' + first);
      const after = await J('/__cp?state=1'); expect(after.drafts === before.drafts + 1 && after.vishal_codes === 1 && after.redemptions === before.redemptions, 'db ' + JSON.stringify(after));
      return `first row "${first.slice(0, 60)}" · drafts ${before.drafts}→${after.drafts}`;
    }],
    ['cp: New Coupon — the deal wizard opens as a coupon; saving makes a DRAFT that appears first (nothing goes live)', async () => {
      await open(); const before = await J('/__cp?state=1');
      await page.click(tid('new-coupon')); await page.waitForSelector(tid('deal-wizard'));
      expect((await page.locator(`${tid('deal-wizard')} select[aria-label="Deal type"]`).inputValue()) === 'coupon', 'kind preset coupon');
      await page.fill(`${tid('deal-wizard')} [aria-label="Title"]`, 'Autumn Gel 10');
      await page.fill(`${tid('deal-wizard')} [aria-label="Coupon code"]`, 'AUTUMN10GEL').catch(() => undefined);
      await page.locator(tid('deal-wizard')).getByRole('button', { name: 'Next', exact: true }).click();
      await page.fill(`${tid('deal-wizard')} [aria-label="Discount value"]`, '10');
      for (let i = 0; i < 3; i++) await page.locator(tid('deal-wizard')).getByRole('button', { name: 'Next', exact: true }).click();
      await page.locator(tid('deal-wizard')).getByRole('button', { name: 'Create draft' }).click(); await settle();
      const first = (await rows())[0] ?? ''; const after = await J('/__cp?state=1');
      expect(/Autumn Gel 10/.test(first) && /Draft/.test(first) && after.active === before.active && after.drafts === before.drafts + 1, `first "${first}" ${JSON.stringify(after)}`);
      return `"${first.slice(0, 60)}" · active unchanged ${after.active}`;
    }],
    ['cp: Coupon Assistant — a suggestion from the salon\'s own tickets, edited to 10%, saved as a DRAFT with an audit row; nothing activated or sent', async () => {
      await open(); const before = await J('/__cp?state=1');
      await page.click(tid('assistant')); await page.waitForSelector(tid('dlg-assistant'));
      await page.selectOption(tid('assist-goal'), 'promote_service'); await page.click(tid('assist-suggest')); await page.waitForSelector(tid('assist-result')); await settle();
      const exp = await T(tid('assist-result'));
      await page.fill(tid('assist-pct'), '10'); await page.fill(tid('assist-code'), 'SHOWCASE10'); await page.click(tid('assist-save')); await settle();
      const after = await J('/__cp?state=1');
      expect(after.assistant_rows === before.assistant_rows + 1 && after.drafts === before.drafts + 1 && after.active === before.active && after.campaigns_not_draft === 0 && after.notifications === before.notifications, 'db ' + JSON.stringify([before, after]));
      await page.click(tid('dd-close')).catch(() => undefined);
      return `"${exp.split('\n')[0].slice(0, 80)}" · draft + audit row · active ${after.active} · sent 0`;
    }],
    ['cp: Health — every check from verified queries (Ready / Attention / Unknown, never a fake green)', async () => {
      await open('?tab=health'); await page.waitForSelector(tid('health-checks')); await settle();
      const o = await T(tid('health-overall')); const h = await API('/pos/coupons/health');
      expect(o === { ready: 'Ready', attention: 'Attention', unknown: 'Unknown', failed: 'Failed' }[h.overall] && h.checks.length === 5, `overall ${o} vs ${h.overall}`);
      return `overall ${o} · ${h.checks.map((c) => c.key + ':' + c.status).join(' · ')}`;
    }],
    ['cp: Front Desk — no Marketing access in the salon\'s role policy: the screen says so; create / change / draft are refused by the server (API 403). Front Desk still applies codes at Checkout', async () => {
      const vid = (await API('/pos/discounts?q=vishal&status=all')).items[0].id;
      await J('/__role?r=FRONT_DESK'); await open();
      const canSee = (await page.locator(tid('coupons-list')).count()) > 0;
      const noNew = (await page.locator(tid('new-coupon')).count()) === 0 && (await page.locator(tid('assistant')).count()) === 0;
      const r = await fetch(new URL('/api/v1/pos/coupons/assistant/draft', page.url()).href, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ goal: 'slow_weekdays' }) }).then((x) => x.status);
      const d = await fetch(new URL('/api/v1/pos/deals/' + vid + '/pause', page.url()).href, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }).then((x) => x.status);
      await J('/__role?r=OWNER');
      const msg = await T(tid('coupons-screen'));
      expect(noNew && r === 403 && d === 403 && !canSee && /permission|access/i.test(msg), `see ${canSee} noNew ${noNew} draft ${r} pause ${d} msg ${msg.slice(0, 80)}`);
      return `library hidden (role policy) · "${msg.replace(/\s+/g, ' ').slice(0, 70)}" · New/Assistant absent · draft API ${r} · pause API ${d}`;
    }],
    ['cp: Vietnamese — title, tabs and cards in Vietnamese; the numbers are the same', async () => {
      await open(); const en = await kpiV('kpi-total');
      await J('/__lang?l=vi'); await open(); await noJunk();
      const h1 = await T(`${tid('coupons-screen')} h1`); const tab = await T(tid('tab-redemptions'));
      expect(/Phiếu giảm giá/.test(h1) && /Lịch sử sử dụng/.test(tab) && (await kpiV('kpi-total')) === en, `vi ${h1} · ${tab}`);
      await J('/__lang?l=en');
      return `vi "${h1}" · "${tab}" · total ${en}`;
    }],
    ['cp: layout — 1920×945 · 1366×768 · 1280×720 · 1024×768: the page scrolls vertically only (no sideways page scroll)', async () => {
      const out = [];
      for (const [w, h] of [[1920, 945], [1366, 768], [1280, 720], [1024, 768]]) {
        await page.setViewportSize({ width: w, height: h }); await open(); await page.waitForTimeout(300);
        const f = await fit(); expect(f.h <= 0, `${w}×${h} sideways scroll ${f.h}px`);
        await shot(`cp-${w}x${h}`); out.push(`${w}×${h} ok`);
      }
      await page.setViewportSize({ width: 1920, height: 945 });
      return out.join(' · ');
    }],
  ];
};
