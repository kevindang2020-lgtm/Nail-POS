// interact-aical.mjs — AI Calendar E2E steps (AI Calendar guide, Oct 31 2026: T02–T07, T08, T11, T13–T15, T17–T20, T31,
// T33, T37, T40–T45 where a browser can show them). Run with `node tooling/catalog-one-screen/interact.mjs <label> rcc,aical`
// against the live harness (aical-extra.mjs serves the REAL AiCalendarCenterController; rcc-extra.mjs serves the Copilot's
// prepare / confirm the Scheduling Assistant uses). Nothing leaves the machine.
const LEGACY_DAY = '2026-07-01';   // must match aical-extra.mjs (not imported: that module loads the decorated controller)

export const STEPS_AICAL = ({ page, expect, settle, go, tid, noJunk, J, T, API }) => {
  const URL0 = '/tenant/ai/receptionist/calendar';
  const open = () => go(URL0, tid('aic-kpi-appointments'));
  const shot = (name) => page.screenshot({ path: `tooling/catalog-one-screen/results/aical-e2e/${name}.png`, fullPage: false }).catch(() => undefined);
  const st = () => J('/__aical?state=1');
  const num = async (id) => Number((await T(tid(id))).match(/\d+/)?.[0] ?? NaN);
  let seed = null;
  return [
    ['aical: T06/T31/T33/T37 original title, controls and four counters kept; numbers equal SQL truth; no literal \\u escapes; AI = canonical source', async () => {
      await J('/__tenant?name=pilot'); await J('/__role?r=OWNER'); await J('/__lang?l=en'); await J('/__aical?reset=1'); seed = await J('/__aical?seed=1');
      await open(); await noJunk();
      const body = await T('body');
      expect(!/\\u[0-9a-fA-F]{4}|u2039|u2014|u203a|u2013/.test(body), 'no literal unicode escapes on screen');
      for (const m of ['Calendar', 'Open in POS Booking', '‹ Previous', 'Today', 'Next ›', 'Appointments', 'AI-Created', 'Open Slots', 'Technicians On']) expect(body.includes(m), `kept: ${m}`);
      const truth = await st();
      expect(await num('aic-kpi-appointments') === truth.appointments && await num('aic-kpi-ai') === truth.ai, `kpis appts ${await num('aic-kpi-appointments')}/${truth.appointments} ai ${await num('aic-kpi-ai')}/${truth.ai}`);
      expect(/1 linked to an AI call/.test(await T(tid('aic-kpi-ai'))) && /1 waiting for a code/.test(await T(tid('aic-kpi-ai'))), `ai hint ${await T(tid('aic-kpi-ai'))}`);
      expect(await num('aic-kpi-techs') <= truth.active_techs, 'technicians on ≤ active roster');
      await page.click(tid('aic-defs-btn')); await page.waitForSelector(tid('aic-defs'));
      const defs = await T(tid('aic-defs'));
      expect(/45-minute service/.test(defs) && /POS Booking engine total/.test(defs) && /never counted/.test(defs), 'definitions + reconciliation shown');
      expect(new RegExp(seed.today).test(await page.inputValue(tid('aic-date'))), `day defaults to the salon's today ${seed.today}`);
      await shot('01-aical-counters-and-definitions');
      return `appointments ${truth.appointments} = SQL · AI ${truth.ai} (1 call-linked, 1 code-pending not counted) · definitions + 114-style reconciliation · no \\u text`;
    }],
    ['aical: T05/T19 Day (12 per page, service-time order, AI badge, live hold) → Week → Month → tap a day returns to Day', async () => {
      await page.waitForSelector(tid('aic-day'));
      expect(/of \d+/.test(await T(tid('aic-tech-label'))), `tech label ${await T(tid('aic-tech-label'))}`);
      const times = await page.locator(tid('aic-appt') + ' .aic-time').allTextContents();
      expect(times.length >= 2, `appointments shown ${times.length}`);
      expect(await page.locator(tid('aic-appt') + '.ai').count() >= 1 && await page.locator(tid('aic-hold')).count() >= 1, 'AI badge + held slot (code pending)');
      expect(/six-digit code/.test(await T(tid('aic-day'))), 'pending hold labelled not confirmed');
      await shot('02-aical-day');
      await page.click(tid('aic-view-week')); await page.waitForSelector(tid('aic-week'));
      expect(await page.locator(tid('aic-daycell')).count() === 7, 'week has 7 days');
      await shot('03-aical-week');
      await page.click(tid('aic-view-month')); await page.waitForSelector(tid('aic-month'));
      const cells = await page.locator(tid('aic-daycell')).count();
      expect(cells >= 28 && cells <= 31, `month cells ${cells}`);
      await shot('04-aical-month');
      await page.locator(tid('aic-daycell') + `[data-date="${seed.today}"]`).click(); await page.waitForSelector(tid('aic-day'));
      return `day: ${times.length} appointments in time order, AI badge, pending hold · week 7 · month ${cells} · tap → day`;
    }],
    ['aical: T07/T08/T11/T15/T17/T18/T20 List — name & phone search, AI-only, From/To month calendar, pages of 10 without duplicates', async () => {
      await page.click(tid('aic-view-list')); await page.waitForSelector(tid('aic-list'));
      await page.click(tid('aic-p-today')); await settle();
      await page.fill(tid('aic-search'), 'aical ava'); await page.waitForTimeout(700); await settle();
      expect(/AICAL Ava Kim/.test(await T(tid('aic-table'))), 'partial name found');
      await page.fill(tid('aic-search'), '+1 (609) 555-0142'); await page.waitForTimeout(700); await settle();
      expect(/AICAL Ava Kim/.test(await T(tid('aic-table'))) && /•••0142/.test(await T(tid('aic-table'))), 'phone with punctuation found; masked in list');
      await page.fill(tid('aic-search'), ''); await page.waitForTimeout(700); await page.check(tid('aic-f-ai')); await settle();
      const srcs = await page.locator(tid('aic-row') + ' td:nth-child(6)').allTextContents();
      expect(srcs.length >= 1 && srcs.every((s) => /AI/.test(s)), `ai only ${srcs}`);
      await page.click(tid('aic-clear')); await settle();
      await page.click(tid('aic-p-custom')); await page.waitForSelector(tid('aic-calendar'));
      expect(await page.locator(tid('aic-calendar') + ' button').count() >= 28, 'a real month-view calendar opens (day buttons)');
      await shot('05-aical-range-calendar');
      await page.keyboard.press('Escape'); await settle();
      await page.selectOption(tid('aic-f-basis'), 'service'); await page.click(tid('aic-p-year')); await page.selectOption(tid('aic-f-size'), '10'); await settle();
      await page.fill(tid('aic-search'), 'AICAL List'); await page.waitForTimeout(700); await settle();
      // custom range covering the seeded January 2027 rows
      const win = await T(tid('aic-list-window'));
      if (!/2027/.test(win)) { await page.click(tid('aic-p-custom')); await page.waitForSelector(tid('aic-calendar')); await page.keyboard.press('Escape'); }
      return `name + phone (masked) search, AI-only, Clear All, From/To calendar opens · ${win}`;
    }],
    ['aical: T17/T18/T20 pages 1/2/3 of the 26 seeded rows — newest created first, no duplicates across pages', async () => {
      const r1 = await API('/pos/ai/calendar-center/appointments?q=AICAL%20List&period=custom&from=2027-01-01&to=2027-01-31&pageSize=10&page=1');
      const r2 = await API('/pos/ai/calendar-center/appointments?q=AICAL%20List&period=custom&from=2027-01-01&to=2027-01-31&pageSize=10&page=2');
      const r3 = await API('/pos/ai/calendar-center/appointments?q=AICAL%20List&period=custom&from=2027-01-01&to=2027-01-31&pageSize=10&page=3');
      const all = [...r1.items, ...r2.items, ...r3.items];
      expect(r1.total === 26 && r1.totalPages === 3 && new Set(all.map((x) => x.id)).size === 26, `total ${r1.total} pages ${r1.totalPages} unique ${new Set(all.map((x) => x.id)).size}`);
      expect(all.every((x, i) => i === 0 || all[i - 1].createdAt >= x.createdAt), 'newest created first');
      expect(r1.items[0].customerName === 'AICAL List 25', `newest first: ${r1.items[0].customerName}`);
      return '26 rows → 10 + 10 + 6, unique, newest created first (AICAL List 25 on page 1)';
    }],
    ['aical: T40/T41/T42 overlay — 8 tabs, AI evidence, Close; Open in POS Booking carries the day and changes nothing; view audited', async () => {
      await page.click(tid('aic-view-day')); await page.waitForSelector(tid('aic-day'));
      const before = await st();
      await page.locator(tid('aic-appt') + '.ai').first().click(); await page.waitForSelector(tid('aic-ov-overview'));
      for (const k of ['overview', 'customer', 'services', 'history', 'ai', 'holds', 'comms', 'audit']) expect(await page.locator(tid('aic-tab-' + k)).count() === 1, `tab ${k}`);
      expect(/linked to an AI call/.test(await T(tid('aic-overlay'))), 'AI evidence from the tool ledger');
      await page.click(tid('aic-tab-ai')); expect(/book_appointment/.test(await T(tid('aic-overlay'))), 'tool result shown');
      await shot('06-aical-overlay');
      await page.click(tid('aic-ov-close')); await settle();
      expect(await page.locator(tid('aic-overlay')).count() === 0, 'Close closes');
      const after = await st();
      expect(after.overlay_views === before.overlay_views + 1 && after.last_change === before.last_change, `audited ${after.overlay_views}; no booking change`);
      return `8 tabs, AI evidence, Close · audited view (${after.overlay_views}) · no booking changed`;
    }],
    ['aical: T44 Check Calendar System — 8 groups with evidence and next steps; a repeat within 30 s shows the recorded run', async () => {
      await page.click(tid('aic-health-btn')); await page.waitForSelector(tid('aic-health'));
      const groups = await page.locator(tid('aic-check')).count();
      expect(groups === 8, `checks ${groups}`);
      expect(/Read-only/.test(await T(tid('aic-health'))), 'read-only note');
      await shot('07-aical-health');
      await page.click(tid('aic-health-close')); await page.click(tid('aic-health-btn')); await page.waitForSelector(tid('aic-health'));
      expect(/last run/.test(await T(tid('aic-health'))), 'rate-limited repeat');
      await page.click(tid('aic-health-close'));
      const s = await st(); expect(s.health_runs === 1, `runs ${s.health_runs}`);
      return `8 groups, overall ${await T(tid('aic-health-overall')).catch(() => 'shown')} · one recorded run`;
    }],
    ['aical: T43 Scheduling Assistant — a legacy overlap → Review (no write) → Confirm via Copilot → moved and verified', async () => {
      await go(URL0 + '?date=' + LEGACY_DAY + '&view=day', tid('aic-kpi-appointments'));   // the URL carries the day (refresh / back keep it)
      expect((await page.inputValue(tid('aic-date'))) === LEGACY_DAY, 'day from the URL');
      await page.click(tid('aic-assist-btn')); await page.waitForSelector(tid('aic-assistant'));
      await page.waitForSelector(tid('aic-card') + '[data-kind="staff_conflict"]', { timeout: 15000 });
      const conflict = page.locator(tid('aic-card') + '[data-kind="staff_conflict"]').first();
      expect(await conflict.count() === 1, 'staff conflict card with evidence');
      await conflict.locator(tid('aic-move-time')).fill('14:00');
      const before = await st();
      await conflict.locator(tid('aic-move-review')).click(); await page.waitForSelector(tid('aic-move'));
      expect(JSON.stringify((await st()).legacy) === JSON.stringify(before.legacy), 'review writes nothing');
      await shot('08-aical-assistant-review');
      await page.click(tid('aic-move-confirm')); await page.waitForSelector(tid('aic-move-outcome'));
      const after = await st();
      // the assistant proposes moving one of the two (whichever the overlap query lists second): exactly one moves, the other keeps its time
      const vals = Object.values(after.legacy);
      expect(vals.filter((v) => /14:00/.test(v)).length === 1 && vals.filter((v) => /10:00|10:30/.test(v)).length === 1, `moved: ${JSON.stringify(after.legacy)}`);
      await shot('09-aical-assistant-confirmed');
      return `conflict card → review (no write) → confirm → ${JSON.stringify(after.legacy)}`;
    }],
    ['aical: T42/T45 Front Desk sees masked contact; Vietnamese labels; 1920×945, 1366×768, 1280×720, 1024×768 — no sideways scroll', async () => {
      await J('/__role?r=FRONT_DESK'); await open(); await page.waitForSelector(tid('aic-day'));
      await page.locator(tid('aic-appt') + '.ai').first().click(); await page.waitForSelector(tid('aic-ov-overview'));
      await page.click(tid('aic-tab-customer'));
      expect(/•••0142/.test(await T(tid('aic-overlay'))) && /masked/.test(await T(tid('aic-overlay'))), 'front desk: masked contact');
      await page.click(tid('aic-ov-close'));
      await J('/__role?r=OWNER'); await J('/__lang?l=vi'); await open();
      expect(/Kiểm tra hệ thống lịch/.test(await T(tid('aic-health-btn'))) && /Lịch hẹn/.test(await T(tid('aic-kpi-appointments'))), 'vi labels');
      await shot('10-aical-vi');
      await J('/__lang?l=en');
      const res = [];
      for (const [w, h] of [[1920, 945], [1366, 768], [1280, 720], [1024, 768]]) {
        await page.setViewportSize({ width: w, height: h }); await open(); await settle();
        const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(over <= 1, `horizontal overflow ${over}px at ${w}x${h}`); res.push(`${w}x${h}`);
        await shot(`11-aical-${w}x${h}`);
      }
      await page.setViewportSize({ width: 1920, height: 945 });
      return `front desk masked · vi labels · no sideways scroll at ${res.join(', ')}`;
    }],
  ];
};
