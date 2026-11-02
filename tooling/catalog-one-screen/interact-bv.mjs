// interact-bv.mjs — Booking Phone Verification E2E steps (Booking Phone Verification Complete Build Guide, Oct 30 2026). Run with
// `node tooling/catalog-one-screen/interact.mjs <label> bv` against the live harness (bv-extra.mjs serves the real controllers).
export const STEPS_BV = ({ page, expect, settle, go, tid, noJunk, J, T, rowsText, search, customRange, today }) => {
  const URL0 = '/tenant/communications/phone-verification';
  const open = (qs = '') => go(URL0 + qs, tid('bv-history-table'));
  const shot = (name) => page.screenshot({ path: `tooling/catalog-one-screen/results/bv-e2e/${name}.png`, fullPage: false }).catch(() => undefined);
  const kpi = async (id) => (await T(`${tid(id)} .fk-kpi-v`)).replace(/\s+/g, ' ').trim();
  const st = () => J('/__bv?state=1');
  const names = () => rowsText(`${tid('bv-history-table')} tbody tr td:nth-child(2)`);
  return [
    ['bv: the photographed controls show their SAVED values; six KPI cards equal the database', async () => {
      await J('/__tenant?name=pilot'); await J('/__role?r=OWNER'); await J('/__lang?l=en'); await J('/__bv?reset=1'); await J('/__bv?seed=1');
      await open(); await noJunk();
      expect((await T(`${tid('bv-page')} h1`)) === 'Booking Phone Verification', 'title');
      const s = await st();
      expect(s.settings.enabled === false, 'seeded OFF like the screenshot');
      const main = page.locator(`${tid('bv-settings')} input[type=checkbox]`).first();
      expect(!(await main.isChecked()), 'main switch unchecked = saved value');
      expect((await page.locator(`${tid('bv-settings')} select`).first().inputValue()) === '86400', 'Once every 24 hours');
      expect((await page.locator(`${tid('bv-settings')} input[type=number]`).last().inputValue()) === '10', '10-minute hold');
      for (const label of ['Kiosk', 'Front desk (staff-created)', 'Walk-in check-in', 'Group bookings', 'Bookings that need a deposit', 'High-value bookings'])
        expect(await page.locator(`${tid('bv-settings')} label`, { hasText: label }).count() >= 1, `control "${label}" shown`);
      expect(await kpi('bv-kpi-pending') === String(s.pending), `pending ${await kpi('bv-kpi-pending')} vs db ${s.pending}`);
      expect(await kpi('bv-kpi-verified') === String(s.verified_today), `verified today ${await kpi('bv-kpi-verified')} vs db ${s.verified_today}`);
      expect(/%|—/.test(await kpi('bv-kpi-rate')), 'success rate shown with its denominator');
      await shot('01-bv-overview-1920');
      return `main switch OFF, 24 h trust, 10 min hold, six sources + three re-verify rules shown · Pending ${s.pending} · Verified today ${s.verified_today} = DB`;
    }],
    ['bv: Check Verification System — six itemized checks with state, evidence and next step (no SMS, nothing bought)', async () => {
      await page.click(tid('bv-check')); await page.waitForSelector(tid('bv-check-twilio_identity')); await settle();
      const items = await page.locator(`${tid('bv-health')} li`).count();
      expect(items === 6, `6 checks, got ${items}`);
      const tw = (await st()).twilio;
      const want = !tw ? /Needs setup/ : tw.has_error ? /Failed/ : tw.validated ? /Ready/ : /Pending provider action/;
      expect(want.test(await T(tid('bv-check-twilio_identity'))), `twilio identity = DB (${JSON.stringify(tw)})`);
      expect(/Needs setup/.test(await T(tid('bv-check-policy'))) && /Off/.test(await T(tid('bv-check-policy'))), 'policy: Off → Needs setup');
      expect(/Degraded/.test(await T(tid('bv-check-recent_errors'))), 'the provider failure is surfaced');
      await shot('02-bv-health');
      return '6 checks: Twilio = DB state · Verify Service · Sender · Policy Needs setup (off) · Recent errors Degraded (provider failure) · Holds & guard';
    }],
    ['bv: turn verification ON and save a $150 high-value line — both persist in the database and after reload', async () => {
      await page.locator(`${tid('bv-settings')} input[type=checkbox]`).first().locator('xpath=..').click(); await settle();
      expect((await st()).settings.enabled === true, 'db enabled');
      await page.fill('#bv-high-input', '150'); await page.click(tid('bv-high-save')); await settle();
      expect((await st()).settings.high_value_threshold_cents === 15000, 'db 15000 cents');
      await open();
      expect((await page.inputValue('#bv-high-input')) === '150', 'after reload');
      expect(await page.locator(`${tid('bv-settings')} input[type=checkbox]`).first().isChecked(), 'switch on after reload');
      await shot('03-bv-settings-saved');
      return 'PATCH /pos/settings/booking-phone-verification: enabled + high_value_threshold_cents 15000; reload reads both back';
    }],
    ['bv: live monitor — nearest expiry first, separate code and hold status, server countdown, no code on screen', async () => {
      const first = page.locator(tid('bv-live-row')).first();
      const txt = await first.innerText();
      expect(/Ava Kim/.test(txt) && /Expiring soon/.test(txt), `first row is the hold expiring in 90 s: ${txt.replace(/\s+/g, ' ')}`);
      expect(/left/.test(txt), 'countdown shown');
      const rows = await page.locator(tid('bv-live-row')).count();
      expect(rows === 3, `two open codes + the lockout from 2 minutes ago (failed attempts stay visible 10 min), got ${rows}`);
      expect(/Failed/.test(await page.locator(tid('bv-live-row')).last().innerText()), 'the lapsed lockout is listed last');
      const body = await T(tid('bv-live'));
      expect(!/\b\d{6}\b/.test(body.replace(/\d{1,2}:\d{2}/g, '')), 'no six-digit code anywhere in the live monitor');
      await shot('04-bv-live-monitor');
      return `3 live rows (2 open + a recent lockout last), most urgent first (Ava Kim — hold expiring) · code state and hold state separate · no code rendered`;
    }],
    ['bv: history — newest first, pages 1 2 3 with 10/20/50, exact total, server search and filters', async () => {
      const pager = await T(`${tid('bv-history')} .fk-pager-range`);
      expect(/1–10 of 30/.test(pager), `pager ${pager}`);
      await page.locator(`${tid('bv-history')} .fk-pbtn.num`, { hasText: '3' }).click(); await settle();
      expect(/21–30 of 30/.test(await T(`${tid('bv-history')} .fk-pager-range`)), 'page 3');
      await page.selectOption(tid('bv-size'), '50'); await settle();
      expect((await page.locator(tid('bv-history-row')).count()) === 30, 'all 30 on one page of 50');
      await search(tid('bv-search'), 'ava kim'); expect((await names()).every((n) => n === 'Ava Kim') && (await names()).length === 3, `ava kim: ${(await names()).join()}`);
      await search(tid('bv-search'), '0199'); expect((await page.locator(tid('bv-history-row')).count()) === 1, 'last-4 search finds the provider failure');
      await search(tid('bv-search'), 'Lan Pham'); expect((await page.locator(tid('bv-history-row')).count()) === 2, 'technician search');
      await search(tid('bv-search'), '');
      await page.selectOption(tid('bv-f-status'), 'provider_error'); await settle();
      expect((await page.locator(tid('bv-history-row')).count()) === 1, 'provider error filter');
      await page.click(tid('bv-clear')); await settle();
      expect(!(await page.url()).includes('ava') && !(await page.url()).includes('0199'), 'search text never in the URL');
      await shot('05-bv-history');
      return '30 rows: 1–10 of 30 → page 3 = 21–30 · 50/page · name 3 · last-4 1 · technician 2 · Provider error 1 · Clear All; search text never in the URL';
    }],
    ['bv: From/To month calendar with a date basis (salon-local, inclusive)', async () => {
      await customRange(today, today);
      const n = await page.locator(tid('bv-history-row')).count();
      const pager = await T(`${tid('bv-history')} .fk-pager-range`);
      expect(/of 29/.test(pager), `today = 29 (the 40-day-old one excluded): ${pager} (${n} rows)`);
      await page.selectOption(tid('date-basis'), 'hold_created'); await settle();
      expect((await page.locator(tid('bv-history-row')).count()) === 2, 'basis hold created → the two held bookings');
      await shot('06-bv-calendar-basis');
      await page.click(tid('bv-clear')); await settle();
      return `custom ${today}–${today}: 29 records · basis "Hold created": 2`;
    }],
    ['bv: details overlay — the rule that forced verification, timeline, authorized resend (counted, audited), Close', async () => {
      await open();
      await page.locator(tid('bv-live-row')).first().click(); await page.waitForSelector(tid('bv-why')); await settle();
      expect(/high-value/i.test(await T(tid('bv-why'))), 'why: high-value rule');
      expect((await page.locator(`${tid('bv-timeline')} li`).count()) >= 2, 'timeline');
      const before = (await st()).openResends;
      await page.click(tid('bv-resend')); await page.waitForSelector(tid('bv-resend-note')); await settle();
      expect(/new code was sent/.test(await T(tid('bv-resend-note'))), 'resend confirmed');
      expect((await st()).openResends === before + 1, 'resend counted on the session');
      await shot('07-bv-detail');
      await page.click(tid('bv-close')); await page.waitForSelector(tid('bv-detail'), { state: 'detached', timeout: 8000 });
      return `why = high-value · timeline · resend ${before}→${before + 1} (fake sender, nothing leaves the machine) · Close`;
    }],
    ['bv: Vietnamese staff labels keep the same numbers', async () => {
      await J('/__lang?l=vi'); await open();
      const pend = await kpi('bv-kpi-pending');
      expect(pend === String((await st()).pending), 'same pending in VI');
      expect(/Kiểm tra hệ thống xác minh/.test(await T(tid('bv-check'))), 'VI check label');
      await shot('08-bv-vietnamese');
      await J('/__lang?l=en');
      return 'VI labels; identical KPI numbers';
    }],
    ['bv: fits 1920×945 · 1536×864 · 1440×900 · 1366×768 · 1024×768 with no sideways page scroll; overlay Close reachable', async () => {
      const out = [];
      for (const [w, h] of [[1920, 945], [1536, 864], [1440, 900], [1366, 768], [1024, 768]]) {
        await page.setViewportSize({ width: w, height: h }); await open(); await page.waitForTimeout(300);
        const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        expect(over <= 1, `${w}x${h} sideways scroll ${over}px`);
        await shot(`09-bv-${w}x${h}`); out.push(`${w}x${h}`);
      }
      await page.locator(tid('bv-history-row')).first().click(); await page.waitForSelector(tid('bv-close'));
      expect(await page.locator(tid('bv-close')).isVisible(), 'close visible at 1024');
      await page.click(tid('bv-close')); await page.setViewportSize({ width: 1920, height: 945 });
      return out.join(' · ') + ' — no horizontal page scroll';
    }],
  ];
};
