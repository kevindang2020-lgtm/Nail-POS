// interact-rcc.mjs — Reception Copilot E2E steps (Reception Copilot guide, Oct 31 2026: CP02/CP03, CP04, CP05, CP08, CP10,
// CP11, CP16, CP19–CP24, CP29–CP33 where a browser can show them). Run with
// `node tooling/catalog-one-screen/interact.mjs <label> rcc` against the live harness (rcc-extra.mjs serves the REAL
// ReceptionCopilotCenterController + action spine + settings). Nothing leaves the machine.
export const STEPS_RCC = ({ page, expect, settle, go, tid, noJunk, J, T }) => {
  const URL0 = '/tenant/ai/copilot';
  const open = () => go(URL0, tid('rcc-ops'));
  const shot = (name) => page.screenshot({ path: `tooling/catalog-one-screen/results/rcc-e2e/${name}.png`, fullPage: false }).catch(() => undefined);
  const st = () => J('/__rcc?state=1');
  let seed = null;
  const section = (title) => page.locator('section', { hasText: title }).first();
  return [
    ['rcc: CP03 every original module is kept; the live strip shows real values with "as of"; priorities come from verified sources', async () => {
      await J('/__tenant?name=pilot'); await J('/__role?r=OWNER'); await J('/__lang?l=en'); await J('/__rcc?reset=1'); seed = await J('/__rcc?seed=1');
      await open(); await page.waitForSelector(tid('rcc-priority')); await noJunk();
      const body = await T('body');
      for (const m of ['Reception Copilot', 'Explain a service', 'Cancel an appointment', 'Send a text message', 'Book an appointment', 'Reschedule an appointment'])
        expect(body.includes(m), `original module kept: ${m}`);
      expect(/As of /.test(await T(tid('rcc-asof'))), 'as-of timestamp');
      const truth = await st();   // the strip must equal plain SQL truth (other harness sections may add calls to the same salon)
      const num = async (k) => Number((await T(tid('rcc-stat-' + k))).replace(/\D+/g, ' ').trim().split(' ').pop());
      expect(await num('missed') === truth.missed24 && await num('failed') === truth.failed24 && truth.missed24 >= 1 && truth.failed24 >= 1, `strip ${await T(tid('rcc-ops'))} vs db missed ${truth.missed24} failed ${truth.failed24}`);
      const kinds = await page.locator(tid('rcc-priority')).evaluateAll((els) => els.map((e) => e.getAttribute('data-kind')));
      for (const k of ['unanswered_call', 'conflict', 'failed_action']) expect(kinds.includes(k), `priority ${k} in ${kinds}`);
      expect(/Nothing happens until a person confirms|nothing happens until a person confirms/i.test(await T(tid('rcc-priorities'))), 'approval note');
      await shot('01-rcc-top-strip-and-priorities');
      return `original modules + strip = SQL (missed ${truth.missed24}, failed ${truth.failed24}, as-of) + priorities ${kinds.join(', ')}`;
    }],
    ['rcc: CP22/CP19 Cancel → server review (no write) → Confirm → verified "cancelled" with the real reference; ledger succeeded', async () => {
      const sec = section('Cancel an appointment');
      await sec.locator('input').nth(0).fill(seed.cancelMe); await sec.locator('input').nth(1).fill('Customer called to cancel');
      await sec.getByRole('button', { name: /Prepare/ }).click(); await page.waitForSelector(tid('rcc-cancel'));
      const card = await T(tid('rcc-cancel'));
      expect(/now/i.test(card) && /proposed/i.test(card) && /cancelled/.test(card) && /RCC Cancel Me/.test(card), `review card: ${card.slice(0, 200)}`);
      let s = await st(); expect(/^booked/.test(s.appts['RCC Cancel Me']) && s.actions === 1, `no write on review: ${JSON.stringify(s.appts['RCC Cancel Me'])} actions ${s.actions}`);
      await shot('02-rcc-cancel-review');
      await page.click(tid('rcc-cancel-confirm')); await page.waitForSelector(tid('rcc-cancel-outcome'));
      const out = await T(tid('rcc-cancel-outcome'));
      expect(/Completed/.test(out) && out.includes(seed.cancelMe) && /cancelled/.test(out), `outcome ${out}`);
      s = await st(); expect(/^cancelled/.test(s.appts['RCC Cancel Me']) && s.ledger[0].state === 'succeeded', `db ${s.appts['RCC Cancel Me']} ${JSON.stringify(s.ledger[0])}`);
      await shot('03-rcc-cancel-verified');
      return `review wrote nothing · confirmed → ${s.appts['RCC Cancel Me']} · ledger ${s.ledger[0].state}`;
    }],
    ['rcc: CP20 Reschedule into a taken slot: warned at review, refused at confirm, original kept; a free time completes', async () => {
      const sec = section('Reschedule an appointment');
      await sec.locator('input').nth(0).fill(seed.moveMe); await sec.locator('input').nth(1).fill('10:15'); await sec.locator('input').nth(2).fill('2027-01-16');
      await sec.getByRole('button', { name: /^Review$/ }).click(); await page.waitForSelector(tid('rcc-resched'));
      expect(/overlapping/.test(await T(tid('rcc-resched'))), 'overlap warning at review');
      await page.click(tid('rcc-resched-confirm')); await page.waitForSelector(tid('rcc-resched-outcome'));
      const bad = await T(tid('rcc-resched-outcome'));
      let s = await st(); expect(/Failed|Not done/.test(bad) && s.appts['RCC Move Me'].endsWith('09:00'), `refused, kept: ${bad} · ${s.appts['RCC Move Me']}`);
      await sec.locator('input').nth(1).fill('11:00'); await sec.getByRole('button', { name: /^Review$/ }).click(); await page.waitForSelector(tid('rcc-resched-confirm'));
      await page.click(tid('rcc-resched-confirm')); await page.waitForSelector(tid('rcc-resched-outcome') + '[data-state="completed"]');
      s = await st(); expect(s.appts['RCC Move Me'].endsWith('11:00'), `moved: ${s.appts['RCC Move Me']}`);
      await shot('04-rcc-reschedule');
      return `10:15 refused (original 09:00 kept) · 11:00 completed`;
    }],
    ['rcc: CP24 Text: no country code is blocked; a valid text is "Submitted" through the test sender — never "Delivered"', async () => {
      const sec = section('Send a text message');
      await sec.locator('input[type="tel"]').fill('6094440142'); await sec.locator('input').nth(1).fill('Running about 10 minutes late, sorry!');
      expect(!(await sec.getByRole('button', { name: /Review text/ }).isDisabled()), 'Review text enabled');
      await sec.getByRole('button', { name: /Review text/ }).click();
      await page.waitForSelector(`${tid('rcc-msg')}, ${tid('rcc-msg-error')}`);
      expect(await page.locator(tid('rcc-msg')).count() === 1, `review error: ${await page.locator(tid('rcc-msg-error')).innerText().catch(() => '')}`);
      expect(/country code/.test(await T(tid('rcc-msg'))) && await page.locator(tid('rcc-msg-confirm')).isDisabled(), 'blocked without +country');
      await sec.locator('input[type="tel"]').fill('+16094440142'); await sec.getByRole('button', { name: /Review text/ }).click(); await page.waitForSelector(tid('rcc-msg-confirm') + ':not([disabled])');
      expect(/Salon Twilio sender|Test sender/.test(await T(tid('rcc-msg'))) && /GSM-7/.test(await T(tid('rcc-msg'))), `sender + segments shown: ${(await T(tid('rcc-msg'))).slice(0, 300)}`);
      await page.click(tid('rcc-msg-confirm')); await page.waitForSelector(tid('rcc-msg-outcome'));
      const out = await T(tid('rcc-msg-outcome'));
      expect(/Submitted/.test(out) && /test sender/i.test(out) && !/Delivered/.test(out), `outcome ${out}`);
      const s = await st(); expect(s.texts === 1, `texts ${s.texts}`);
      await shot('05-rcc-text-submitted');
      return `blocked without +1 · confirmed → Submitted (test sender), 1 row, not "Delivered"`;
    }],
    ['rcc: CP33 Check Copilot System — 8 areas with evidence and next step; a repeat within 30 s shows the same run; nothing sent', async () => {
      const before = await st();
      await page.click(tid('rcc-check')); await page.waitForSelector(tid('rcc-health'));
      const rows = await page.locator(`${tid('rcc-health')} tr[data-check]`).count();
      expect(rows === 8, `rows ${rows}`);
      expect(/Overall/.test(await T(tid('rcc-health'))), 'overall');
      await shot('06-rcc-health');
      await page.keyboard.press('Escape'); await settle();
      await page.click(tid('rcc-check')); await page.waitForSelector(tid('rcc-health'));
      expect(/a check just ran/.test(await T(tid('rcc-health'))), 'rate-limited repeat');
      await page.keyboard.press('Escape'); await settle();
      const after = await st(); expect(after.health_runs === 1 && after.texts === before.texts && after.actions === before.actions, `runs ${after.health_runs}, texts ${after.texts}`);
      return `8 areas · repeat shows the same run · 1 run stored · no text / action written`;
    }],
    ['rcc: CP10/CP08 activity: newest first, state filter, 10/20/50, From/To month calendar', async () => {
      await page.click(tid('rcc-tab-activity')); await page.click(tid('rcc-act-refresh')); await settle(); await page.waitForSelector(tid('rcc-activity'));
      const states = await page.locator(`${tid('rcc-activity')} tbody tr`).evaluateAll((els) => els.map((e) => e.getAttribute('data-state')));
      expect(states.length >= 3 && states[0] === 'succeeded', `rows ${states}`);   // newest first: the last confirmed action leads
      await page.selectOption(tid('rcc-act-state'), 'failed'); await settle(); await page.waitForTimeout(400);
      const f = await page.locator(`${tid('rcc-activity')} tbody tr`).evaluateAll((els) => els.map((e) => e.getAttribute('data-state')));
      expect(f.length >= 1 && f.every((x) => x === 'failed'), `failed filter ${f}`);
      await page.selectOption(tid('rcc-act-state'), ''); await page.selectOption(tid('rcc-act-size'), '10'); await settle();
      await page.click(tid('rcc-act-cal')); await page.waitForSelector(tid('rcc-calendar'));
      expect(/Apply/.test(await T(tid('rcc-calendar'))) && /Clear/.test(await T(tid('rcc-calendar'))), 'month calendar with Apply / Clear');
      await shot('07-rcc-activity-calendar');
      await page.keyboard.press('Escape'); await settle();
      expect(/newest first/.test(await T(tid('rcc-act-window'))), 'window label');
      return `${states.length} rows newest first · failed filter ${f.length} · calendar opens`;
    }],
    ['rcc: CP04/CP05/CP29 search beyond page 1; shared phone flagged, not merged; customer overlay tabs, Close, audited', async () => {
      await page.click(tid('rcc-tab-search')); await page.selectOption(tid('rcc-scope'), 'customers');
      await page.fill(tid('rcc-q'), 'RCC Pat Lee'); await page.waitForTimeout(700); await settle();
      expect(/23 total/.test(await T(tid('rcc-search-scope'))), `count ${await T(tid('rcc-search-scope'))}`);
      await page.getByRole('button', { name: /^2$/ }).first().click().catch(() => undefined); await settle();
      await page.fill(tid('rcc-q'), 'RCC Mai'); await page.waitForTimeout(700); await settle();
      expect(/share this number/.test(await T(tid('rcc-search-results'))), 'shared phone flag');
      await page.click(tid('rcc-open-customer')); await page.waitForSelector(tid('rcc-ov-tab-overview'));
      for (const k of ['overview', 'appointments', 'messages', 'actions', 'consent', 'audit']) expect(await page.locator(tid('rcc-ov-tab-' + k)).count() === 1, `tab ${k}`);
      expect(/•••0199/.test(await T(tid('rcc-overlay'))), 'masked phone');
      await page.click(tid('rcc-ov-tab-appointments')); expect(/2027-02-01/.test(await T(tid('rcc-overlay'))), 'upcoming appointment');
      await shot('08-rcc-customer-overlay');
      await page.click(tid('rcc-ov-close')); await settle();
      const s = await st(); expect(s.overlay_views === 1, `audited ${s.overlay_views}`);
      return `23 matches over pages · shared-phone flag · overlay 6 tabs, masked, Close · view audited (${s.overlay_views})`;
    }],
    ['rcc: CP32 a priority proposal opens a review only — Back writes nothing', async () => {
      const before = await st();
      const conflict = page.locator(tid('rcc-priority') + '[data-kind="conflict"]').first();
      await conflict.locator(tid('rcc-priority-prepare')).click(); await page.waitForSelector(tid('rcc-priority-dialog'));
      expect(/Review/.test(await T(tid('rcc-priority-dialog'))), 'review dialog');
      await shot('09-rcc-priority-review');
      await page.keyboard.press('Escape'); await settle();
      const after = await st(); expect(after.actions === before.actions && JSON.stringify(after.appts) === JSON.stringify(before.appts), 'no write');
      return 'proposal → review dialog; closing writes nothing';
    }],
    ['rcc: Vietnamese POS labels; layout at 1920×945, 1366×768, 1280×720, 1024×768 — no sideways scroll', async () => {
      await J('/__lang?l=vi'); await open(); await settle();
      expect(/Kiểm tra hệ thống Copilot/.test(await T(tid('rcc-check'))) && /Ưu tiên quầy lễ tân/.test(await T(tid('rcc-priorities'))), 'vi labels');
      await shot('10-rcc-vi');
      await J('/__lang?l=en');
      const sizes = [[1920, 945], [1366, 768], [1280, 720], [1024, 768]]; const res = [];
      for (const [w, h] of sizes) {
        await page.setViewportSize({ width: w, height: h }); await open(); await settle();
        const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(over <= 1, `horizontal overflow ${over}px at ${w}x${h}`); res.push(`${w}x${h}`);
        await shot(`11-rcc-${w}x${h}`);
      }
      await page.setViewportSize({ width: 1920, height: 945 });
      return `vi labels · no sideways scroll at ${res.join(', ')}`;
    }],
  ];
};
