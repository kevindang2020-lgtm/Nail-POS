// interact-rcp.mjs — AI Receptionist E2E steps (guide Oct 31 2026: UI-01..04, SR-01/02, DT-01, PG-01/02, VO-01/02/07, BK-05,
// AI-01, HL-01/02, OPS-01 where a browser can show them). Run with `node tooling/catalog-one-screen/interact.mjs <label> rcp`
// against the live harness (rcp-extra.mjs serves the REAL ReceptionistCenterController). Nothing leaves the machine.
export const STEPS_RCP = ({ page, expect, settle, go, tid, noJunk, J, T }) => {
  const URL0 = '/tenant/ai/receptionist';
  const open = () => go(URL0, tid('rcp-checklist'));
  const shot = (name) => page.screenshot({ path: `tooling/catalog-one-screen/results/rcp-e2e/${name}.png`, fullPage: false }).catch(() => undefined);
  const st = () => J('/__rcp?state=1');
  const closeDlg = async () => { await page.keyboard.press('Escape'); await settle(); };
  const reason = async (text) => { await page.waitForSelector(tid('rcp-reason')); await page.fill(tid('rcp-reason-text'), text); await page.click(tid('rcp-reason-ok')); await settle(); await page.waitForTimeout(300); };
  return [
    ['rcp: P0 — with only the PLATFORM’s Twilio env, nothing reads "Connected"; all 8 steps, 5 cards and 7 quick actions preserved', async () => {
      await J('/__tenant?name=pilot'); await J('/__role?r=OWNER'); await J('/__lang?l=en'); await J('/__rcp?reset=1'); await J('/__rcp?env=none');
      await open(); await noJunk();
      const tw = await T(tid('rcp-conn-twilio'));   // the pilot salon's own row exists but was never checked: never "Ready"/"Connected"
      expect(!/^Ready|Connected/.test(tw) && /not checked|not connected|route not verified/.test(tw), `twilio: ${tw}`);   // other sections may have checked the account; the ROUTE is never proven without a call
      expect(/Not configured/.test(await T(tid('rcp-conn-retell'))), 'retell not configured');
      expect(/Not issued/.test(await T(tid('rcp-conn-key'))) && /Handoff-only/.test(await T(tid('rcp-conn-booking'))), 'key not issued, handoff-only');
      expect(await page.locator('[data-testid^="rcp-step-"]').count() === 8, '8 setup steps');
      for (const k of ['calls', 'booked', 'handoffs', 'abandoned', 'duration']) expect(await page.locator(tid(`rcp-kpi-${k}`)).count() === 1, `card ${k}`);
      expect(await page.locator(`${tid('rcp-quick')} button`).count() === 7, '7 quick actions');
      expect(/Not configured/.test(await T('.rcp-head')), 'stage Not configured');
      await shot('01-rcp-p0-platform-env-only-not-connected');
      return 'Twilio: salon row saved but never checked (not Connected) · Retell not configured · key not issued · handoff-only · stage Not configured';
    }],
    ['rcp: seeded salon → "Ready for test" (never production verified); KPI cards equal an independent SQL count; Check is read-only', async () => {
      await J('/__bs?seed=1'); await J('/__rcp?seed=1'); await J('/__rcp?env=full'); await open(); await noJunk();
      expect(/Ready for test/.test(await T('.rcp-head')), `stage: ${await T('.rcp-head')}`);
      const s = await st();
      expect((await T(tid('rcp-kpi-calls'))).includes(String(s.calls_month)), `calls card vs DB month ${s.calls_month}`);
      expect((await T(tid('rcp-kpi-booked'))).includes(`${s.booked_month} confirmed`), `booked card vs DB ${s.booked_month}`);
      const before = s.control;
      await page.click(tid('rcp-check')); await page.waitForSelector(tid('rcp-h-rt.key')); await settle();
      const h = await T(tid('rcp-health'));
      expect(/not a connection/.test(h) && /Blocked \(outside\)/.test(h) && /Fix:/.test(h), 'saved key ≠ connected; live check blocked outside; remedies shown');
      await shot('02-rcp-health-check-read-only');
      await closeDlg();
      const after = await st();
      expect(JSON.stringify(after.control) === JSON.stringify(before) && after.health_runs >= 1, 'control unchanged; run recorded');
      return `stage Ready for test · calls ${s.calls_month} / booked ${s.booked_month} (= DB) · check recorded, nothing changed`;
    }],
    ['rcp: history — newest first, 10/page, page 2 differs, search finds a call beyond page 1, From/To calendar with date basis', async () => {
      await open();
      const firstRows = await page.locator(tid('rcp-call-row')).allInnerTexts();
      expect(firstRows.length === 10, `page 1 rows ${firstRows.length}`);
      const pager = await T(`${tid('rcp-calls')} .fk-pager`);
      expect(/27|of 2[0-9]/.test(pager) || /2/.test(pager), `pager: ${pager}`);
      await page.locator(`${tid('rcp-calls')} .fk-pager button.num`, { hasText: '2' }).first().click(); await settle();
      const second = await page.locator(tid('rcp-call-row')).allInnerTexts();
      expect(second.length > 0 && second[0] !== firstRows[0], 'page 2 differs');
      await page.fill(tid('rcp-search'), 'gel removal'); await page.waitForTimeout(600); await settle();
      const found = await page.locator(tid('rcp-call-row')).allInnerTexts();
      expect(found.length === 1 && /call_h_20/.test(found[0]), `search: ${found.join(' | ').slice(0, 120)}`);
      await page.fill(tid('rcp-search'), ''); await page.waitForTimeout(500); await settle();
      await page.click(tid('rcp-cal')); await page.waitForSelector(tid('rcp-calendar'));
      expect(await page.locator(`${tid('rcp-calendar')} button`).count() > 20, 'month grid');
      await shot('03-rcp-calendar');
      await closeDlg();
      await page.selectOption(tid('rcp-f-period'), 'today'); await settle();
      expect(await page.locator(tid('rcp-basis-note')).count() === 1, 'date basis shown');
      await page.selectOption(tid('rcp-f-period'), ''); await settle();
      return `10 rows · page 2 differs · "gel removal" → call_h_20 (beyond page 1) · calendar + basis note`;
    }],
    ['rcp: overlay — Close, masked caller, generated summary flagged; Front Desk transcript restricted; Open Booking keeps the customer', async () => {
      await J('/__role?r=FRONT_DESK'); await open();
      await page.fill(tid('rcp-search'), 'call_h_20'); await page.waitForTimeout(600); await settle();
      await page.locator(`${tid('rcp-call-row')} button`).first().click(); await page.waitForSelector(tid('rcp-overlay'));
      const ov = await T(tid('rcp-overlay'));
      expect(/•••• \d{4}/.test(await T(tid('rcp-ov-caller'))) && !/\+1\d{10}/.test(ov), 'caller masked');
      expect(/Generated/.test(ov), 'AI summary flagged generated');
      expect(/only owners and managers/.test(await T(tid('rcp-ov-transcript'))), 'transcript restricted for Front Desk');
      expect(await page.locator(tid('rcp-ov-test')).count() === 0, 'no test-call control for Front Desk');
      await shot('04-rcp-overlay-front-desk');
      await page.click(tid('rcp-ov-close')); await settle();
      expect(await page.locator(tid('rcp-overlay')).count() === 0, 'Close closes');
      await J('/__role?r=OWNER'); await open();
      await page.fill(tid('rcp-search'), 'call_h_20'); await page.waitForTimeout(600); await settle();
      await page.locator(`${tid('rcp-call-row')} button`).first().click(); await page.waitForSelector(tid('rcp-overlay'));
      expect(/Open transcript/.test(await T(tid('rcp-ov-transcript'))), 'owner sees the transcript link');
      await page.click(tid('rcp-ov-book')); await page.waitForTimeout(600);
      expect(/\/booking\/new\?customerId=/.test(page.url()), `booking url ${page.url()}`);
      return 'masked · generated label · FD restricted / owner link · Close · Open Booking with customerId';
    }],
    ['rcp: priority — person request first, older missed call above newer; Front Desk prepares (nothing executed), owner confirms once', async () => {
      await J('/__role?r=FRONT_DESK'); await open();
      const kinds = await page.locator('[data-testid^="rcp-prio-"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')));
      expect(kinds[0] === 'rcp-prio-person_requested', `first ${kinds[0]}`);
      expect(kinds.includes('rcp-prio-pending_verification'), 'code-pending booking visible');
      const rows = await page.locator(tid('rcp-prio-missed_call')).allInnerTexts();
      expect(rows.length >= 2, 'two missed calls');
      await page.locator(`${tid('rcp-prio-missed_call')} ${tid('rcp-prepare')}`).first().click(); await settle(); await page.waitForTimeout(300);
      expect((await st()).fu_missed_older === 0, 'prepare executes nothing');
      expect(await page.locator(tid('rcp-confirm')).count() === 0, 'Front Desk cannot confirm');
      await J('/__role?r=OWNER'); await open();
      await page.locator(tid('rcp-confirm')).first().click(); await settle(); await page.waitForTimeout(400);
      expect((await st()).fu_missed_older === 1, 'one follow-up task after confirm');
      await shot('05-rcp-priority-confirmed');
      return 'person request first · older missed call first · prepared → 0 tasks · owner confirm → 1 task';
    }],
    ['rcp: controls — arm booking, verify a REAL recorded call as the test call, activate → Live; change history recorded', async () => {
      await open();
      await page.click(tid('rcp-arm')); await reason('All gates passed; owner approves booking');
      expect(/Armed/.test(await T(tid('rcp-conn-booking'))), 'armed');
      await page.fill(tid('rcp-search'), 'call_h_20'); await page.waitForTimeout(600); await settle();
      await page.locator(`${tid('rcp-call-row')} button`).first().click(); await page.waitForSelector(tid('rcp-overlay'));
      await page.click(tid('rcp-ov-test')); await reason('Owner placed the authorized test call');
      expect(/Test-call verified/.test(await T('.rcp-head')), `stage after test: ${await T('.rcp-head')}`);
      await page.click(tid('rcp-activate')); await reason('Go live after the verified test call');
      expect(/Live/.test(await T('.rcp-head')), 'stage Live');
      const s = await st();
      expect(s.control.booking_armed && s.control.activated && s.control.test_call_provider_call_id === 'call_h_20' && s.control_events === 3, `control ${JSON.stringify(s.control)} events ${s.control_events}`);
      await shot('06-rcp-live');
      return 'armed · test call = call_h_20 (recorded) · Live · 3 append-only change events';
    }],
    ['rcp: Vietnamese on the Front Desk POS — labels translated, numbers unchanged', async () => {
      const callsEn = await T(tid('rcp-kpi-calls'));
      await J('/__lang?l=vi'); await open();
      expect((await T('h1')) === 'Lễ tân AI', `title ${await T('h1')}`);
      expect(/Cuộc gọi/.test(await T(tid('rcp-kpi-calls'))) && (await T(tid('rcp-kpi-calls'))).match(/\d+/)?.[0] === callsEn.match(/\d+/)?.[0], 'calls card translated, same number');
      await shot('07-rcp-vi'); await J('/__lang?l=en');
      return 'title + cards in Vietnamese, same numbers';
    }],
    ['rcp: layout — 1920×945, 1536×864, 1366×768, 1280×720, 1024×768 with no sideways scroll; five cards on one row at 1920', async () => {
      const out = [];
      for (const [w, h] of [[1920, 945], [1536, 864], [1366, 768], [1280, 720], [1024, 768]]) {
        await page.setViewportSize({ width: w, height: h }); await open(); await page.waitForTimeout(300);
        const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        expect(over <= 1, `${w}×${h}: page overflows by ${over}px`);
        if (w === 1920) { const tops = await page.locator('[data-testid^="rcp-kpi-"]').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top))); expect(new Set(tops).size === 1, `cards on one row: ${tops}`); }
        await shot(`08-rcp-${w}x${h}`); out.push(`${w}×${h} ok`);
      }
      await page.setViewportSize({ width: 1920, height: 945 });
      return out.join(' · ');
    }],
  ];
};
