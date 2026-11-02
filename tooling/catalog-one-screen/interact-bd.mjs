// interact-bd.mjs — Birthday Campaigns E2E steps (guide Oct 31 2026, §16–§17). Run with
// `node tooling/catalog-one-screen/interact.mjs <label> bd` against the live harness (bd-extra.mjs serves the REAL
// BirthdayCenterController; Campaign Center only receives a DRAFT). Nothing leaves the machine.
export const STEPS_BD = ({ page, expect, settle, go, tid, noJunk, J, T, search }) => {
  const URL0 = '/tenant/marketing/birthdays';
  const open = () => go(URL0, tid('bd-kpis'));
  const shot = (name) => page.screenshot({ path: `tooling/catalog-one-screen/results/bd-e2e/${name}.png`, fullPage: false }).catch(() => undefined);
  const kpiV = async (id) => Number((await T(`${tid(id)} .fk-kpi-v`)).replace(/[^0-9]/g, ''));
  const st = () => J('/__bd?state=1');
  const rows = () => page.locator(tid('bd-row'));
  const names = async () => (await rows().locator('td:nth-child(1) .sg-name').allInnerTexts()).map((x) => x.trim());
  const pick = async (sel, v) => { await page.selectOption(tid(sel), String(v)); await settle(); };
  const nowMonth = () => page.evaluate(() => new Date().getMonth() + 1);
  return [
    ['bd: P0 — the month dropdown opens on this month; "Birthdays in range" and the list equal the database; month/day only, never a year', async () => {
      await J('/__tenant?name=pilot'); await J('/__role?r=OWNER'); await J('/__lang?l=en'); await J('/__bd?reset=1'); await J('/__bd?seed=1');
      await open(); await noJunk();
      const s = await st();
      expect(Number(await page.inputValue(tid('bd-month'))) === await nowMonth(), 'Month dropdown = this month');
      expect(await kpiV('bd-kpi-range') === s.thisMonth, `KPI ${await kpiV('bd-kpi-range')} vs DB ${s.thisMonth}`);
      expect((await T(tid('bd-count'))).includes(String(s.thisMonth)), `count text "${await T(tid('bd-count'))}" vs DB ${s.thisMonth}`);
      await search(tid('bd-search'), 'Bd ');
      const n = await names();
      expect(n.some((x) => /Bd Ava/.test(x)) && n.some((x) => /Bd Eve/.test(x)) && !n.some((x) => /Bd Leap|Bd Nora/.test(x)), `this month: ${n.join(', ')}`);
      const table = await T(tid('bd-results'));
      expect(!/\b(1990|1975|2001|2000)\b/.test(table), 'no birth year anywhere in the table');
      await search(tid('bd-search'), '');
      await shot('01-bd-this-month-1920');
      return `month = this month · KPI ${s.thisMonth} = list = DB · Ava / Eve (month/day only) listed, no birth year shown`;
    }],
    ['bd: Feb 29 — Feb 28 by default, Mar 1 after the salon changes the setting (saved, survives a reload)', async () => {
      await open(); await pick('bd-month', 2); await search(tid('bd-search'), 'Bd Leap');
      expect((await names()).some((x) => /Bd Leap/.test(x)), 'Leap in February (Feb 28 policy, non-leap year)');
      await page.click(tid('bd-settings')); await page.click(tid('bd-set-mar1')); await page.click(tid('bd-set-save')); await settle();
      expect((await st()).policy === 'mar1', 'policy saved');
      await page.reload(); await page.waitForSelector(tid('bd-kpis')); await pick('bd-month', 2); await search(tid('bd-search'), 'Bd Leap');
      const isLeap = await page.evaluate(() => { const y = new Date().getFullYear(); return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0; });
      if (!isLeap) { expect(!(await names()).some((x) => /Bd Leap/.test(x)), 'not in February under Mar 1');
        await pick('bd-month', 3); expect((await names()).some((x) => /Bd Leap/.test(x)), 'in March under Mar 1'); }
      await page.click(tid('bd-settings')); await page.click(tid('bd-set-feb28')); await page.click(tid('bd-set-save')); await settle();
      await search(tid('bd-search'), '');
      return `Feb 28 policy → February; Mar 1 saved (${(await st()).policy === 'feb28' ? 'then restored to Feb 28' : '?'}) → ${isLeap ? 'leap year: Feb 29 itself' : 'March'}`;
    }],
    ['bd: Next 7 Days preset equals the database; the customer two days out is there with "in 2 days"', async () => {
      await open(); await page.click(tid('bd-preset-next7')); await settle();
      const s = await st();
      expect(await kpiV('bd-kpi-next7') === s.next7, `next7 KPI ${await kpiV('bd-kpi-next7')} vs DB ${s.next7}`);
      await search(tid('bd-search'), 'Bd Soon');
      const row = (await rows().first().allInnerTexts()).join(' ');
      expect(/Bd Soon/.test(row) && /in 2 days/.test(row), row);
      await search(tid('bd-search'), '');
      return `Next 7 Days: ${s.next7} = DB · Bd Soon "in 2 days"`;
    }],
    ['bd: Custom Range — the month calendar crosses the year (Dec 25 → Jan 5) and finds Dec 31 and Jan 2', async () => {
      await open(); await page.click(tid('bd-preset-custom')); await page.waitForSelector(tid('range-calendar'));
      const y = await page.evaluate(() => new Date().getFullYear());
      const nav = async (ymd) => { for (let i = 0; i < 14 && !(await page.locator(`[data-ymd="${ymd}"]`).count()); i++) { await page.click(`${tid('cal-right')} [aria-label="Next month"]`); await page.waitForTimeout(80); } };
      await page.click(tid('range-from')); await nav(`${y}-12-25`); await page.click(`[data-ymd="${y}-12-25"]`);
      await nav(`${y + 1}-01-05`); await page.click(`[data-ymd="${y + 1}-01-05"]`);
      await shot('02-bd-calendar');
      await page.click(tid('range-apply')); await settle();
      await search(tid('bd-search'), 'Bd ');
      const n = await names();
      expect(n.some((x) => /Bd Dee/.test(x)) && n.some((x) => /Bd Jan/.test(x)), `Dec 25 → Jan 5: ${n.join(', ')}`);
      await search(tid('bd-search'), '');
      return `Dec 25 ${y} → Jan 5 ${y + 1}: ${n.join(', ')}`;
    }],
    ['bd: search and scopes — a name outside the period explains itself; All finds it; Missing lists the two without birthdays (= Missing Center = DB)', async () => {
      await open(); await search(tid('bd-search'), 'Bd Leap');
      expect(/No customer matching "Bd Leap"/.test(await T(tid('bd-results'))), 'out-of-period hint');
      await page.click(tid('bd-scope-all')); await settle();
      expect((await names()).some((x) => /Bd Leap/.test(x)), 'All customers with birthdays finds Leap');
      await search(tid('bd-search'), 'Bd N'); await page.click(tid('bd-scope-missing')); await settle();
      const miss = await names();
      expect(miss.some((x) => /Bd Nora/.test(x)) && miss.some((x) => /Bd Ned/.test(x)), `missing: ${miss.join(', ')}`);
      await search(tid('bd-search'), ''); await page.click(tid('bd-check-missing')); await page.waitForSelector(tid('bd-mc-missing'));
      const s = await st(); const mc = Number((await T(`${tid('bd-mc-missing')} .fk-kpi-v`)).replace(/[^0-9]/g, ''));
      expect(mc === s.missing, `Missing Center ${mc} vs DB ${s.missing}`);
      await shot('03-bd-missing-center');
      await page.keyboard.press('Escape'); await settle();
      return `period hint → All finds Leap → Missing: ${miss.join(', ')} · Missing Center ${mc} = DB`;
    }],
    ['bd: pages of 10 / 20 / 50 with exact totals; a sort change goes back to page 1', async () => {
      await open(); await page.click(tid('bd-scope-all')); await settle(); await pick('bd-size', 10);
      const total = Number(((await T('.fk-pager')).match(/of\s+([\d,]+)/i) ?? [])[1]?.replace(/,/g, '') ?? 'NaN');
      expect(total > 10 && (await rows().count()) === 10, `10 per page of ${total}`);
      await page.click('.fk-pager button:has-text("2")'); await settle();
      const p2 = await names();
      await pick('bd-sort', 'name_asc');
      expect(/1\s*–\s*10/.test(await T('.fk-pager')), `back to page 1: ${await T('.fk-pager')}`);
      await pick('bd-size', 50);
      return `10 per page of ${total} · page 2 (${p2.length} rows) · sort → page 1 · 50 per page`;
    }],
    ['bd: overlay — Add birthday (MM-DD) is saved year-unknown by staff, the missing count drops, Book Appointment preselects the customer', async () => {
      await open(); const before = await st();
      await page.click(tid('bd-scope-missing')); await settle(); await search(tid('bd-search'), 'Bd Nora');
      await page.click(tid('bd-add')); await page.waitForSelector(tid('bd-edit-input'));
      await page.fill(tid('bd-edit-input'), '07-04'); await page.click(tid('bd-edit-save'));
      await page.waitForSelector(tid('bd-ov-birthday') + ':has-text("July 4")');
      const after = await st();
      expect(after.nora && after.nora.birthday === '2000-07-04' && after.nora.year_known === false && after.nora.source === 'staff', `Nora: ${JSON.stringify(after.nora)}`);
      expect(after.missing === before.missing - 1, `missing ${before.missing} → ${after.missing}`);
      await shot('04-bd-overlay');
      await page.click(tid('bd-book')); await page.waitForURL(/\/booking\/new\?customerId=/);
      expect(page.url().includes(`customerId=e7500000-0000-4000-8000-000000000109`), page.url());
      return `Nora → 07-04 (year unknown, staff) · missing ${before.missing} → ${after.missing} · Book → ${new URL(page.url()).pathname}`;
    }],
    ['bd: Smart Birthday Campaign Assistant — counts with reasons, saved as an UNSENT Campaign Center draft (nothing sent, nothing claimed)', async () => {
      await open(); const before = await st();
      await page.click(tid('bd-create')); await page.waitForSelector(tid('bd-ai-check'));
      await page.click(tid('bd-ai-check')); await page.waitForSelector(tid('bd-ai-counts'));
      const c = await T(tid('bd-ai-counts')); const m = c.match(/(\d+) selected · (\d+) eligible · (\d+) excluded/);
      expect(!!m && Number(m[1]) === Number(m[2]) + Number(m[3]) && Number(m[3]) >= 2, `counts: ${c}`);
      await shot('05-bd-assistant');
      await page.click(tid('bd-ai-save')); await page.waitForSelector(tid('bd-ai-saved'));
      const after = await st();
      expect(after.birthday_drafts === before.birthday_drafts + 1, `birthday drafts ${before.birthday_drafts} → ${after.birthday_drafts}`);
      expect(after.notifications === before.notifications && after.claims === before.claims, 'nothing sent, nothing claimed');
      await page.keyboard.press('Escape'); await settle();
      return `${c} → 1 draft campaign (occasion birthday); notifications ${after.notifications} and claims ${after.claims} unchanged`;
    }],
    ['bd: Front Desk has no marketing access — the page says so and the API refuses', async () => {
      await J('/__role?r=FRONT_DESK'); await go(URL0, tid('birthdays-screen'));
      const txt = await T(tid('birthdays-screen'));
      const r = await page.evaluate(async () => (await fetch('/api/v1/pos/birthdays/summary')).status);
      await J('/__role?r=OWNER');
      expect(/cannot open Birthday Campaigns/.test(txt) && r === 403, `front desk: "${txt.slice(0, 80)}" · API ${r}`);
      return 'Front Desk: no-access notice · GET /pos/birthdays/summary → 403';
    }],
    ['bd: Vietnamese POS labels; fits 1920×945, 1536×864, 1366×768, 1280×720 and 1024×768 with no page-wide sideways scroll', async () => {
      await J('/__lang?l=vi'); await open();
      const vc = await T(tid('bd-create')), vk = await T(tid('bd-kpi-next7'));
      expect(/Tạo chiến dịch sinh nhật/.test(vc) && /7 ngày tới/i.test(vk), `VI labels: "${vc}" · "${vk}"`);
      await shot('06-bd-vi');
      await J('/__lang?l=en');
      const out = [];
      for (const [w, h] of [[1920, 945], [1536, 864], [1366, 768], [1280, 720], [1024, 768]]) {
        await page.setViewportSize({ width: w, height: h }); await open(); await page.waitForTimeout(300);
        const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        expect(over <= 1, `${w}×${h}: page overflows by ${over}px`);
        await shot(`07-bd-${w}x${h}`); out.push(`${w}×${h} ok`);
      }
      await page.setViewportSize({ width: 1920, height: 945 });
      return out.join(' · ');
    }],
  ];
};
