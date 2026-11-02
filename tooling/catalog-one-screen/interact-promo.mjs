// interact-promo.mjs — Marketing → Promotions steps of the catalog E2E (Promotions Management guide, Oct 30 2026): the REAL
// screen in Chromium against the REAL DiscountsScreenController / DealsController / CouponCenterController /
// PromotionsCenterController → SQL (extra.mjs + cp-extra.mjs + promo-extra.mjs). Nothing is sent or charged: checks are
// previews, creating and the assistant make DRAFTS, the one paid visit is a TEST ticket run through the deals engine.
// `node tooling/catalog-one-screen/interact.mjs <label> promo`
export const STEPS_PROMO = ({ page, expect, settle, go, tid, noJunk, API, J, T, rowsText, customRange, today }) => {
  const URL0 = '/tenant/marketing/promotions';
  const open = (qs = '') => go(URL0 + qs, tid('promotions-screen'));
  const rows = () => rowsText(tid('promotion-row'));
  const kpiV = async (t) => (await T(`${tid(t)} .fk-kpi-v`)).replace(/\s+/g, ' ').trim();
  const N = (s) => Number(String(s).replace(/[^0-9]/g, ''));
  const fit = async () => page.evaluate(() => { const se = document.scrollingElement; return { h: se.scrollWidth - innerWidth }; });
  const find = async (text) => { await page.fill(tid('search'), text); await page.waitForTimeout(500); await settle(); };
  const shot = (name) => page.screenshot({ path: `tooling/catalog-one-screen/results/promo-e2e/${name}.png`, fullPage: false }).catch(() => undefined);
  // the ORIGINAL vishal — the Coupons section duplicates it into a draft "vishal (copy)" when both run in one harness
  const vishalRow = () => page.locator(tid('promotion-row')).filter({ hasText: 'vishal' }).filter({ hasNotText: '(copy)' }).first();
  return [
    ['promo: the original screen is preserved — route, "Promotions" title, the five cards (+ discount value) = the server, New Promotion, vishal ••••NG20 20% Active with Pause', async () => {
      await J('/__tenant?name=pilot'); await J('/__role?r=OWNER'); await J('/__lang?l=en');
      await open(); await noJunk();
      const h1 = await T(`${tid('promotions-screen')} h1`); expect(h1 === 'Promotions', 'title ' + h1);
      const k = await API('/pos/discounts/kpis');
      const cards = { total: N(await kpiV('kpi-total')), active: N(await kpiV('kpi-active')), paused: N(await kpiV('kpi-paused')), red: N(await kpiV('kpi-redemptions')), exp: N(await kpiV('kpi-expiring')) };
      expect(cards.total === k.total && cards.active === k.activeDiscounts && cards.paused === k.split.paused && cards.red === k.ledger.confirmedEvents && cards.exp === k.expiringSoon, 'cards ' + JSON.stringify([cards, k]));
      const r = (await vishalRow().innerText()).replace(/\s+/g, ' ');
      expect(/••••NG20/.test(r) && /vishal/.test(r) && /20% off/.test(r) && /Active/.test(r) && (await vishalRow().locator(tid('row-pause')).count()) === 1, 'vishal row ' + r);
      expect((await page.locator(tid('new-promotion')).count()) === 1, 'New Promotion');
      const nav = await page.locator('a, button').filter({ hasText: /^Promotions$/ }).count();
      await shot('promo-preserved');
      return `title "${h1}" · cards ${JSON.stringify(cards)} = server · ${r.slice(0, 70)} · sidebar link ${nav}`;
    }],
    ['promo: Check Promotion (header) → vishal on a $100 sample visit → Eligible, would take $20.00 (Checkout\'s engine); the check is LOGGED and consumes nothing', async () => {
      await open(); const before = await J('/__promo?state=1');
      await page.click(tid('check-promotion')); await page.waitForSelector(tid('dlg-choose'));
      await page.fill(tid('choose-search'), 'vishal'); await page.waitForTimeout(500); await settle();
      await page.locator(tid('choose-item')).filter({ hasText: 'vishal' }).first().click(); await page.waitForSelector(tid('dlg-check'));
      await page.fill(tid('check-spend'), '100'); await page.click(tid('check-run')); await page.waitForSelector(tid('check-result')); await settle();
      const v = await T(tid('check-verdict')); const d = await T(tid('check-discount')); const logged = await page.locator(tid('check-logged')).count();
      const after = await J('/__promo?state=1');
      expect(v === 'Eligible' && /\$20\.00/.test(d) && /\$100\.00/.test(d) && logged === 1, `verdict ${v} · ${d} · logged ${logged}`);
      expect(after.checks === before.checks + 1 && after.redeemed === before.redeemed && after.applied === before.applied && after.vishal_used === before.vishal_used, 'db ' + JSON.stringify([before, after]));
      await page.keyboard.press('Escape'); await page.waitForTimeout(250);
      return `${v}: ${d} · checks ${before.checks}→${after.checks} · redemptions ${after.redeemed} / held ${after.applied} / used ${after.vishal_used} unchanged`;
    }],
    ['promo: Eligibility Checks scope — only customers somebody checked; the sample check is listed (no customer), Eligible, $20.00; URL keeps the scope', async () => {
      await page.click(tid('tab-checks')); await page.waitForSelector(tid('checks-list')); await settle();
      const r = await rowsText(tid('check-row')); const url = page.url();
      expect(r.length >= 1 && /vishal/.test(r[0]) && /Eligible/.test(r[0]) && /\$20\.00/.test(r[0]) && /scope=checks/.test(url), 'rows ' + r[0] + ' url ' + url);
      await find('Promo Tester'); const none = (await rowsText(tid('check-row'))).length; await find('');
      expect(none === 0, 'a customer never checked is not listed: ' + none);
      await shot('promo-eligibility-checks');
      return `${r[0].slice(0, 90)} · "Promo Tester" (never checked) → ${none} rows · ${url.split('?')[1]}`;
    }],
    ['promo: the 20% vishal promotion through the deals engine (TEST ticket, $100): applied → paid → ONE redemption of $20.00 even with a replayed callback; KPIs move once', async () => {
      await open(); const k0 = await API('/pos/discounts/kpis'); const before = await J('/__promo?state=1');
      const v = await J('/__promo?redeem=1');
      const after = await J('/__promo?state=1'); const k1 = await API('/pos/discounts/kpis');
      expect(v.discountCents === 2000 && v.first.redeemed === 1 && v.replay.redeemed === 0 && after.redeemed === before.redeemed + 1 && after.vishal_used === before.vishal_used + 1, 'trace ' + JSON.stringify([v, before, after]));
      expect(k1.ledger.confirmedEvents === k0.ledger.confirmedEvents + 1 && k1.ledger.savingsCents === k0.ledger.savingsCents + 2000, 'kpis ' + JSON.stringify([k0.ledger, k1.ledger]));
      await open(); const red = N(await kpiV('kpi-redemptions')); const val = await kpiV('kpi-value');
      expect(red === k1.ledger.confirmedEvents && N(val) === k1.ledger.savingsCents, `cards ${red} ${val} vs ${k1.ledger.savingsCents}`);
      return `ticket #${v.ticketNumber}: $100.00 − $20.00 · first callback redeemed ${v.first.redeemed}, replay ${v.replay.redeemed} · redemptions ${k0.ledger.confirmedEvents}→${k1.ledger.confirmedEvents} · value ${val}`;
    }],
    ['promo: Redemption History — server search by customer name, phone, email and ticket #; Open Ticket links to Checkout; phone masked', async () => {
      await page.click(tid('view-history')); await page.waitForSelector(tid('redemptions-list')); await settle();
      const hits = {};
      for (const q of ['Promo Tester', '0388', 'promo.tester@example.test', '#88001']) { await find(q); hits[q] = (await rowsText(tid('redemption-row'))).length; }
      const r = (await rowsText(tid('redemption-row')))[0] ?? '';
      expect(Object.values(hits).every((n) => n === 1) && /−\$20\.00/.test(r) && /••• 0388/.test(r) && !/2155550388/.test(r), 'hits ' + JSON.stringify(hits) + ' row ' + r);
      const link = await page.locator(tid('red-ticket')).count();
      await page.locator(tid('red-ticket')).first().click(); await page.waitForTimeout(600);
      const url = page.url(); expect(link === 1 && /\/checkout\?ticket=/.test(url), 'open ticket ' + url);
      await open('?scope=redemptions'); await find('');
      await shot('promo-redemption-history');
      return `${JSON.stringify(hits)} · "${r.slice(0, 80)}" · Open Ticket → ${url.replace(/^https?:\/\/[^/]+/, '').slice(0, 40)}`;
    }],
    ['promo: library search (name, exact code masked) · numbered pages 1/2/3 with 10/20/50 rows · newest first · URL keeps page and size', async () => {
      await J('/__promo?many=25'); await open('?status=all');
      await find('VISHALNG20'); const c = await rows();
      expect(c.length === 1 && /vishal/.test(c[0]) && !/VISHALNG20/.test(c[0]), 'exact code ' + c);
      await find('Fixture promo 07'); const f = await rows(); expect(f.length === 1 && /Fixture promo 07/.test(f[0]), 'name ' + f);
      await find('');
      const total = N(await T(`${tid('promotions-list')} .fk-muted`)); const first = (await rows())[0];
      expect(/Fixture promo 25/.test(first), 'newest first ' + first);
      const nums = await page.locator(`${tid('promotions-list')} .fk-pbtn.num`).count();
      await page.locator(`${tid('promotions-list')} .fk-pbtn.num`).nth(2).click(); await settle();
      const p3 = await rows(); const url3 = page.url();
      expect(nums >= 3 && p3.length > 0 && /page=3/.test(url3), `pages ${nums} p3 ${p3.length} ${url3}`);
      await page.selectOption(tid('page-size'), '20'); await settle(); const r20 = (await rows()).length; const urlS = page.url();
      await page.selectOption(tid('page-size'), '50'); await settle(); const r50 = (await rows()).length;
      expect(r20 === 20 && r50 === Math.min(50, total) && /size=20/.test(urlS) && !/page=3/.test(urlS), `20→${r20} 50→${r50} of ${total} · ${urlS}`);
      await page.selectOption(tid('page-size'), '10'); await settle();
      return `code → 1 masked row · name → 1 · total ${total} · newest "${first.slice(0, 30)}" · ${nums} numbered pages · page 3 ${p3.length} rows · 20→${r20} · 50→${r50}`;
    }],
    ['promo: month calendar — Custom Range today→today: "Created" excludes vishal (made 3 days ago) but "Active during range" includes it', async () => {
      await open('?status=all'); await find('vishal');
      await customRange(today, today); await settle();
      await page.selectOption(tid('date-basis'), 'created'); await settle(); const created = (await rows()).filter((x) => /vishal/.test(x) && !/\(copy\)/.test(x)).length;
      await page.selectOption(tid('date-basis'), 'active'); await settle(); const active = (await rows()).filter((x) => /vishal/.test(x) && !/\(copy\)/.test(x)).length;
      const url = page.url();
      expect(created === 0 && active === 1 && /preset=custom/.test(url) && /basis=active/.test(url), `created ${created} active ${active} ${url}`);
      await shot('promo-calendar-active');
      await page.click(tid('clear-all')); await settle();
      return `Created → ${created} · Active During Range → ${active} · ${url.split('?')[1]}`;
    }],
    ['promo: lifecycle with RBAC + audit — row Pause → Paused, Resume → Active; Activity shows who and active → paused → active; Cancel asks first', async () => {
      const id = (await API('/pos/discounts?q=Fixture%20promo%2003&status=all')).items[0].id;
      for (const a of ['submit', 'approve', 'publish']) await fetch(new URL(`/api/v1/pos/deals/${id}/${a}`, page.url()).href, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
      await open('?status=all'); await find('Fixture promo 03');
      await page.locator(tid('row-pause')).first().click(); await settle();
      const p = (await rows())[0]; await page.locator(tid('row-resume')).first().click(); await settle(); const a = (await rows())[0];
      expect(/Paused/.test(p) && /Active/.test(a), `paused "${p}" active "${a}"`);
      await page.locator(tid('promotion-row')).first().click(); await page.waitForSelector(tid('dlg-discount-detail')).catch(() => undefined);
      await page.getByRole('tab', { name: 'Activity' }).click(); await page.waitForSelector(tid('dd-activity-body')); await settle();
      const act = await rowsText(tid('activity-row'));
      expect(act.some((x) => /paused → active/.test(x)) && act.some((x) => /active → paused/.test(x)), 'activity ' + act.join(' | '));
      await page.click(tid('dd-cancel')); const confirm = await page.locator(tid('dd-confirm')).count();
      await page.click(tid('dd-confirm-no')); const still = (await API(`/pos/discounts/${id}`)).dealStatus ?? (await API(`/pos/discounts/${id}`)).status;
      expect(confirm === 1 && still === 'active', `confirm ${confirm} status ${still}`);
      await shot('promo-activity');
      await page.keyboard.press('Escape'); await page.waitForTimeout(250);
      return `Pause → "${p.slice(-20)}" · Resume → "${a.slice(-20)}" · activity: ${act.slice(0, 3).join(' | ').slice(0, 120)} · Cancel asked first, still ${still}`;
    }],
    ['promo: New Promotion — the full overlay (steps, Create draft + Save & activate); Save & activate runs submit → approve → publish (server-checked) and the new promotion is first, Active', async () => {
      await open(); const before = await J('/__promo?state=1');
      await page.click(tid('new-promotion')); await page.waitForSelector(tid('deal-wizard'));
      const kind = await page.locator(`${tid('deal-wizard')} select[aria-label="Deal type"]`).inputValue();
      await page.fill(`${tid('deal-wizard')} [aria-label="Title"]`, 'Winter Gel 15');
      await page.fill(`${tid('deal-wizard')} [aria-label="Coupon code"]`, 'WINTER15GEL').catch(() => undefined);
      await page.locator(tid('deal-wizard')).getByRole('button', { name: 'Next', exact: true }).click();
      await page.fill(`${tid('deal-wizard')} [aria-label="Discount value"]`, '15');
      for (let i = 0; i < 3; i++) await page.locator(tid('deal-wizard')).getByRole('button', { name: 'Next', exact: true }).click();
      const both = (await page.locator(tid('wiz-save')).count()) + (await page.locator(tid('wiz-activate')).count());
      await shot('promo-new-overlay');
      await page.locator(tid('wiz-activate')).click(); await settle();
      const after = await J('/__promo?state=1'); const first = (await rows())[0] ?? ''; const note = await T(tid('note')).catch(() => '');
      expect(kind === 'coupon' && both === 2 && /Winter Gel 15/.test(first) && /Active/.test(first) && /is active now/.test(note) && after.notifications === before.notifications, `kind ${kind} buttons ${both} first "${first}" note "${note}"`);
      await page.keyboard.press('Escape'); await page.waitForTimeout(250);
      return `kind ${kind} · Create draft + Save & activate · first row "${first.slice(0, 50)}" · ${note.slice(0, 80)} · notifications ${after.notifications}`;
    }],
    ['promo: Promotion Assistant — suggestion + safety flags (unchecked ones say "Not checked") + message PREVIEW; saving makes a DRAFT; nothing activated or sent', async () => {
      await open(); const before = await J('/__promo?state=1');
      await page.click(tid('assistant')); await page.waitForSelector(tid('dlg-assistant'));
      await page.selectOption(tid('assist-goal'), 'promote_service'); await page.click(tid('assist-suggest')); await page.waitForSelector(tid('assist-safety')); await settle();
      const flags = await rowsText(`${tid('assist-safety')} li`); const msg = await T(tid('assist-message'));
      expect(flags.length === 7 && flags.some((f) => /Staffing/.test(f) && /Not checked/.test(f)) && /Reply STOP to opt out/.test(msg) && /not saved, not sent/i.test(msg), 'flags ' + flags.join(' | '));
      await shot('promo-assistant');
      await page.fill(tid('assist-code'), 'ASSIST10PM'); await page.click(tid('assist-save')); await settle();
      const after = await J('/__promo?state=1');
      expect(after.assistant_rows === before.assistant_rows + 1 && after.drafts === before.drafts + 1 && after.campaigns_not_draft === 0 && after.notifications === before.notifications, 'db ' + JSON.stringify([before, after]));
      await page.keyboard.press('Escape'); await page.waitForTimeout(250);
      return `${flags.length} flags (${flags.map((f) => f.split(' ')[0]).join(',')}) · "${msg.split('\n')[1]?.slice(0, 60)}" · draft + audit row · sent 0`;
    }],
    ['promo: Insights — completed redemptions per day = the ledger; top promotion vishal; branch and service views labelled associated', async () => {
      await open('?scope=insights'); await page.waitForSelector(tid('insights')); await settle();
      const t = await API('/pos/promotions/trends?grain=day&preset=month');
      const bars = await page.locator(`${tid('trend-bars')} li`).count(); const top = await T(tid('top'));
      expect(bars === t.series.length && t.totals.redemptions >= 1 && /vishal/.test(top) && /associated/i.test(await T(tid('by-service'))), `bars ${bars} series ${t.series.length} top ${top.slice(0, 60)}`);
      await shot('promo-insights');
      return `${bars} day bar(s) · ${t.totals.redemptions} redemption(s) · net ${t.totals.netDiscountCents}¢ · top "${top.split('\n')[1] ?? ''}"`;
    }],
    ['promo: Check System — verified checks only (Ready / Attention / Unknown, never a fake green)', async () => {
      await open('?scope=health'); await page.waitForSelector(tid('health-checks')); await settle();
      const o = await T(tid('health-overall')); const h = await API('/pos/coupons/health');
      expect(o === { ready: 'Ready', attention: 'Attention', unknown: 'Unknown', failed: 'Failed' }[h.overall], `overall ${o} vs ${h.overall}`);
      return `overall ${o} · ${h.checks.map((c) => c.key + ':' + c.status).join(' · ')}`;
    }],
    ['promo: Front Desk — the role policy has no Marketing access: permission message, no New / Assistant; the server refuses pause and assistant (403)', async () => {
      const vid = (await API('/pos/discounts?q=vishal&status=all')).items[0].id;
      await J('/__role?r=FRONT_DESK'); await open();
      const msg = await T(tid('promotions-screen'));
      const noNew = (await page.locator(tid('new-promotion')).count()) === 0 && (await page.locator(tid('assistant')).count()) === 0;
      const pause = await fetch(new URL('/api/v1/pos/deals/' + vid + '/pause', page.url()).href, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }).then((x) => x.status);
      const sug = await fetch(new URL('/api/v1/pos/promotions/assistant/suggest', page.url()).href, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ goal: 'slow_weekdays' }) }).then((x) => x.status);
      await J('/__role?r=OWNER');
      expect(/permission|access/i.test(msg) && noNew && pause === 403 && sug === 403, `msg ${msg.slice(0, 60)} noNew ${noNew} pause ${pause} suggest ${sug}`);
      return `"${msg.replace(/\s+/g, ' ').slice(0, 70)}" · pause API ${pause} · assistant API ${sug}`;
    }],
    ['promo: Vietnamese — title, scope tabs and cards in Vietnamese; the numbers are the same', async () => {
      await open(); const en = await kpiV('kpi-total');
      await J('/__lang?l=vi'); await open(); await noJunk();
      const h1 = await T(`${tid('promotions-screen')} h1`); const tab = await T(tid('tab-checks'));
      expect(/Khuyến mãi/.test(h1) && /Lượt kiểm tra điều kiện/.test(tab) && (await kpiV('kpi-total')) === en, `vi ${h1} · ${tab}`);
      await shot('promo-vi');
      await J('/__lang?l=en');
      return `vi "${h1}" · "${tab}" · total ${en}`;
    }],
    ['promo: layout — 1920×945 · 1536×864 · 1366×768 · 1280×720 · 1024×768: vertical scroll only (no sideways page scroll), details overlay has Close', async () => {
      const out = [];
      for (const [w, h] of [[1920, 945], [1536, 864], [1366, 768], [1280, 720], [1024, 768]]) {
        await page.setViewportSize({ width: w, height: h }); await open(); await page.waitForTimeout(300);
        const f = await fit(); expect(f.h <= 0, `${w}×${h} sideways scroll ${f.h}px`);
        await shot(`promo-${w}x${h}`); out.push(`${w}×${h} ok`);
      }
      await page.setViewportSize({ width: 1920, height: 945 }); await open(); await find('vishal');
      await vishalRow().click(); await page.waitForTimeout(500);
      const closeBtn = await page.getByRole('button', { name: /close/i }).count();
      expect(closeBtn >= 1, 'overlay close'); await page.keyboard.press('Escape');
      return out.join(' · ') + ` · overlay Close ${closeBtn}`;
    }],
  ];
};
