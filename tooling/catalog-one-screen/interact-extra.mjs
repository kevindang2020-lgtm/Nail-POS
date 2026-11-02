// interact-extra.mjs — the Services → Discounts steps of the catalog E2E (Oct 29 2026). Membership's steps live in the
// customers harness (tooling/customers-one-screen/interact.mjs), which seeds memberships.
export const STEPS_EXTRA = ({ page, expect, T, settle, go, tid, noJunk, close, kpi, rowsText, search, customRange, API, J, today, addDays }) => {
  const D = '/tenant/services/discounts', C = '.work.dsc';
  const range = async (panel) => (await page.locator(`${tid(panel)} .fk-pager-range`).innerText().catch(() => 'empty'));
  return [
    ['discounts: the five cards are the server definitions; the photo coupon ••••NG20 keeps its seven columns', async () => {
      await go(D, C); await noJunk();
      const k = await J('/api/v1/pos/discounts/kpis');
      for (const [t, v] of [['kpi-active', k.activeDiscounts], ['kpi-percent', k.percentOff], ['kpi-fixed', k.fixedAmount], ['kpi-redemptions', k.redemptions], ['kpi-expiring', k.expiringSoon]])
        expect((await kpi(t)).replace(/\D/g, '') === String(v), `${t} ${await kpi(t)} vs ${v}`);
      const head = await rowsText(`${tid('discounts-table')} thead th`);
      for (const h of ['CODE', 'DISCOUNT', 'ON A $100 TICKET', 'MIN PURCHASE', 'VALID', 'USAGE', 'STATUS']) expect(head.some((x) => x.toUpperCase() === h), 'column missing: ' + h);
      const row = (await rowsText(tid('discount-row'))).find((r) => r.includes('NG20')) ?? '';
      expect(/••••NG20/.test(row) && /20% off/.test(row) && /−\$20\.00/.test(row) && /\$10\.00/.test(row) && /No end date/.test(row) && /0 used/.test(row) && /Active/.test(row), row);
      expect(!(await page.locator('body').innerText()).includes('SPRING20'), 'a full code is on screen');
      return `cards ${k.activeDiscounts}/${k.percentOff}/${k.fixedAmount}/${k.redemptions}/${k.expiringSoon}; row: ${row}`;
    }],
    ['discounts: numbered pages, newest created first; a card filters the list (Fixed-Amount)', async () => {
      const p1 = await API('/pos/discounts?status=live&page=1&pageSize=10'); const p2 = await API('/pos/discounts?status=live&page=2&pageSize=10');
      const first = (await rowsText(tid('discount-row')))[0];
      await page.locator(`${tid('discounts-list')} .fk-pager .fk-pbtn.num`, { hasText: /^2$/ }).click(); await settle();
      const first2 = (await rowsText(tid('discount-row')))[0];
      expect(first.includes(p1.items[0].name) && first2.includes(p2.items[0].name), `${first} / ${first2}`);
      const created = [...p1.items, ...p2.items].map((x) => x.createdAt); expect(created.every((d, i) => !i || created[i - 1] >= d), 'not newest first');
      await page.click(tid('kpi-fixed')); await settle();
      const r = await range('discounts-list'); const k = await kpi('kpi-fixed');
      expect(r.includes(`of ${k}`) && (await page.locator(tid('type')).inputValue()) === 'fixed', `${r} vs ${k}`);
      return `page 1 "${first.slice(0, 30)}…", page 2 "${first2.slice(0, 30)}…"; Fixed-Amount ${k} → ${r}`;
    }],
    ['discounts: one search box — exact code (any case), last four, service, customer phone in any format', async () => {
      await page.click(tid('clear-all')).catch(() => undefined); await settle();
      const out = [];
      for (const [q, want] of [['spring 20', 'Spring Glow'], ['ng20', 'Spring Glow'], ['spa pedicure', 'Pedicure Week'], ['(856) 555-1200', 'Pedicure Week'], ['+1 856 555 1200', 'Pedicure Week'], ['8565551200', 'Pedicure Week']]) {
        await search(tid('search'), q); const rows = await rowsText(tid('discount-row'));
        expect(rows.some((x) => x.includes(want)), `"${q}" → ${rows.map((x) => x.slice(0, 24)).join(' | ')}`); out.push(`${q} → ${rows.length}`);
      }
      await search(tid('search'), 'zzzz-nothing'); const empty = await page.locator(`${tid('discounts-list')} .fk-empty`).innerText();
      expect(/Nothing matches/.test(empty), empty);
      await page.click(tid('search-clear')); await settle();
      return out.join(' · ') + ` · no match → "${empty.replace(/\s+/g, ' ')}"`;
    }],
    ['discounts: Redemption History is confirmed-only, newest first, paged; pending and reversed are kept apart', async () => {
      await page.click(tid('tab-redemptions')); await settle(); await noJunk();
      const api = await API('/pos/discounts/redemptions?page=1&pageSize=10');
      const r = await range('redemptions-list'); expect(r.includes(`of ${api.totalItems}`), `${r} vs ${api.totalItems}`);
      const ats = api.items.map((x) => x.at); expect(ats.every((d, i) => !i || ats[i - 1] >= d), 'not newest first');
      expect(api.items.every((x) => x.status === 'redeemed' || x.status === 'partially_reversed'), 'a non-confirmed row in the default history');
      const rows = await rowsText(tid('redemption-row')); expect(!rows.some((x) => /\(\d{3}\) \d{3}-\d{4}/.test(x)), 'an unmasked phone');
      await page.locator(tid('red-state')).selectOption('pending'); await settle();
      const pend = await rowsText(tid('redemption-row')); expect(pend.length === 1 && /Applied, not paid/.test(pend[0]), pend.join(' | '));
      await page.locator(tid('red-state')).selectOption('reversed'); await settle();
      const rev = await rowsText(tid('redemption-row')); expect(rev.length === 1 && /Reversed/.test(rev[0]), rev.join(' | '));
      await page.locator(tid('red-state')).selectOption('confirmed'); await settle();
      return `confirmed ${api.totalItems} (${r}); pending 1; reversed 1; first: ${rows[0]}`;
    }],
    ['discounts: Custom Range (month calendar) filters by redemption date; the cards do not move', async () => {
      const before = await page.locator(tid('kpis')).innerText();
      await customRange(today, today);
      const api = await API(`/pos/discounts/redemptions?preset=custom&from=${today}&to=${today}&page=1&pageSize=10`);
      const r = await range('redemptions-list');
      expect(r === 'empty' ? api.totalItems === 0 : r.includes(`of ${api.totalItems}`), `${r} vs ${api.totalItems}`);
      expect(before === (await page.locator(tid('kpis')).innerText()), 'cards changed with the period');
      await page.click(tid('preset-all')); await settle();
      return `today: ${api.totalItems} confirmed (${r}); cards unchanged`;
    }],
    ['discounts: ticket search finds the redemption; details open from the history with all six sections', async () => {
      const api = await API('/pos/discounts/redemptions?page=1&pageSize=10'); const t = api.items[0];
      await search(tid('search'), '#' + t.ticketNumber); const rows = await rowsText(tid('redemption-row'));
      expect(rows.length === 1 && rows[0].includes('#' + t.ticketNumber), rows.join(' | '));
      await page.locator(tid('red-coupon')).first().click(); await page.waitForSelector(tid('dd-overview'));
      const seen = [];
      for (const s of ['eligibility', 'limits', 'items', 'redemptions', 'history']) { await page.click(tid('dd-tab-' + s)); await settle(); seen.push(s + ': ' + (await page.locator(`${tid('dlg-discount')} .fk-dialog-body`).innerText()).replace(/\s+/g, ' ').slice(0, 50)); }
      await noJunk(); await close(); await page.click(tid('search-clear')); await settle();
      return `#${t.ticketNumber} → ${t.dealName}; ` + seen.join(' || ');
    }],
    ['discounts: Performance totals reconcile with the history; Manage in Promotions opens the rule editor', async () => {
      await page.click(tid('tab-performance')); await page.click(tid('preset-all')); await settle();
      const p = await API('/pos/discounts/performance?preset=all&page=1&pageSize=10'); const h = await API('/pos/discounts/redemptions?preset=all&page=1&pageSize=10');
      expect(p.totals.redemptions === h.totalItems && p.totals.savingsCents === h.totals.savingsCents, `${JSON.stringify(p.totals)} vs ${h.totalItems}/${h.totals.savingsCents}`);
      const tot = (await page.locator(tid('perf-totals')).innerText()).replace(/\s+/g, ' ');
      await page.click(tid('manage-promotions')); await page.waitForTimeout(600);
      expect(/\/tenant\/marketing\/promotions/.test(page.url()), page.url());
      return `${tot.slice(0, 110)} → ${page.url().replace(/^https?:\/\/[^/]+/, '')}`;
    }],
  ];
};
