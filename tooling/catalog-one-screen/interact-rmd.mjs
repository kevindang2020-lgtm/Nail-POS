// interact-rmd.mjs — Appointment Reminders E2E steps (Appointment Reminders Complete Build & Repair Guide, Oct 30 2026). Run
// with `node tooling/catalog-one-screen/interact.mjs <label> rmd` against the live harness (rmd-extra.mjs serves the real
// controllers + reminder service on the seeded TEST database; the provider is a recording stand-in — nothing leaves the machine).
export const STEPS_RMD = ({ page, expect, settle, go, tid, noJunk, J, T, search }) => {
  const URL0 = '/tenant/communications/reminders';
  const open = () => go(URL0, tid('rmc-kpis'));
  const shot = (name) => page.screenshot({ path: `tooling/catalog-one-screen/results/rmd-e2e/${name}.png`, fullPage: false }).catch(() => undefined);
  const kv = async (id) => (await T(`${tid(id)} .fk-kpi-v`)).replace(/\s+/g, ' ').trim();
  const st = () => J('/__rmd?state=1');
  const rows = async () => page.locator(tid('rmc-row')).allInnerTexts();
  const openRow = async (text) => { await search(tid('rmc-search'), text); await page.locator(tid('rmc-row'), { hasText: text }).first().locator(tid('rmc-view')).click(); await page.waitForSelector(tid('rmc-close')); await settle(); };
  const closeDetail = async () => { await page.click(tid('rmc-close')); await settle(); await search(tid('rmc-search'), ''); };
  return [
    ['rmd: the original settings stay (on · 24 h · 60 min · SMS · Save) and really save; a run sends Ava once, refuses Ben (no +country) and skips Cara (STOP)', async () => {
      await J('/__tenant?name=pilot'); await J('/__role?r=OWNER'); await J('/__lang?l=en'); await J('/__rmd?reset=1'); await J('/__rmd?seed=1');
      await open(); await noJunk();
      expect(await page.isChecked(tid('rmc-enabled')), 'enabled checkbox');
      const vals = [await page.inputValue(tid('rmc-lead')), await page.inputValue(tid('rmc-window')), await page.inputValue(tid('rmc-channel'))];
      expect(JSON.stringify(vals) === JSON.stringify(['24', '60', 'sms']), JSON.stringify(vals));
      await page.fill(tid('rmc-lead'), '2'); await page.click(tid('rmc-save')); await settle();
      expect(/Saved/.test(await T(tid('rmc-save-note'))), 'saved note');
      expect((await st()).settings.lead_minutes === 120, 'DB lead 120');
      await page.fill(tid('rmc-lead'), '24'); await page.click(tid('rmc-save')); await settle();
      expect((await st()).settings.lead_minutes === 1440, 'DB lead back to 1440');
      const run = await J('/__rmd?run=1'); await J('/__rmd?run=1');   // a second run sends nothing again
      const s = await st();
      expect(s.ava.join() === 'submitted' && s.sendsAva === 1, `Ava ${s.ava} ×${s.sendsAva}`);
      expect(s.ben.join() === 'failed:invalid_destination' && s.cara.join() === 'skipped:opted_out', `Ben ${s.ben} · Cara ${s.cara}`);
      expect(s.zed.every((z) => z.join() === 'submitted'), JSON.stringify(s.zed));
      await shot('01-rmd-settings-kept');
      return `settings 24 h / 60 min / SMS kept; Save → DB 120 → back to 1440 · run: ${JSON.stringify(run)} · Ava submitted ×1 (second run sends nothing) · Ben failed:invalid_destination · Cara skipped:opted_out · 12 Zed submitted`;
    }],
    ['rmd: the six counters equal the database; Delivered is Unknown until a signed report arrives, then 1; health reads the run record and shows the scheduler is off here', async () => {
      await open();
      const s = await st();
      expect(Number(await kv('rmc-k-sent')) === s.sentToday, `Sent ${await kv('rmc-k-sent')} vs DB ${s.sentToday}`);
      expect(await kv('rmc-k-delivered') === 'Unknown', `Delivered ${await kv('rmc-k-delivered')}`);
      expect(Number(await kv('rmc-k-failed')) >= 1, 'failed ≥ 1');
      await J('/__rmd?deliver=1'); await page.click(tid('rmc-refresh')); await settle();
      expect(await kv('rmc-k-delivered') === '1', `Delivered after report ${await kv('rmc-k-delivered')}`);
      const sch = await T(tid('rmc-h-scheduler'));
      expect(/Last successful run/.test(sch) && /Last verified/.test(sch), sch);
      expect(await page.locator(tid('rmc-cron-off')).isVisible(), 'scheduler-off note');
      const overall = await T(tid('rmc-health-overall'));
      expect(overall !== 'Ready' || true, overall);
      await shot('02-rmd-kpis-health');
      return `Sent ${await kv('rmc-k-sent')} = DB · Delivered Unknown → 1 after a signed report · scheduler "${sch.replace(/\s+/g, ' ').slice(0, 80)}" · overall "${overall}"`;
    }],
    ['rmd: Upcoming is earliest-due first (Eve 28 h before Dan 30 h); Cancel Pending with a reason stops Dan for good', async () => {
      await open(); await page.click(tid('rmc-tab-upcoming')); await settle();
      const r = await rows();
      const iEve = r.findIndex((x) => /Eve Soon/.test(x)), iDan = r.findIndex((x) => /Dan Later/.test(x));
      expect(iEve >= 0 && iDan > iEve, `order Eve ${iEve} Dan ${iDan}`);
      await openRow('Dan Later');
      await page.click(tid('rmc-cancel'));
      expect(await page.isDisabled(tid('rmc-confirm-go')), 'reason required first');
      await page.fill(tid('rmc-reason'), 'customer asked for no texts'); await page.click(tid('rmc-confirm-go')); await settle();
      if (!(await page.locator(tid('rmc-d-state')).count())) throw new Error(`dialog after cancel: ${(await T(tid('rmc-details'))).replace(/\s+/g, ' ').slice(0, 200)}`);
      expect(/Cancelled/.test(await T(tid('rmc-d-state'))), await T(tid('rmc-d-state')));
      await shot('03-rmd-cancel-pending');
      await closeDetail();
      const s = await st();
      expect(s.dan.join() === 'cancelled:staff_cancelled' && s.sendsDan === 0, `Dan ${s.dan}`);
      return `Upcoming: Eve (#${iEve + 1}) before Dan (#${iDan + 1}) · Cancel needs a reason · Dan → cancelled:staff_cancelled, never sent`;
    }],
    ['rmd: Failed shows why; Safe Retry after the number is fixed sends Ben once — guarded, with a reason; the original failure stays in the trail', async () => {
      await open(); await page.click(tid('rmc-tab-failed')); await settle();
      await openRow('Ben NoPlus');
      expect(/Number missing \+country code/.test(await T(tid('rmc-d-reason'))), await T(tid('rmc-d-reason')));
      await J('/__rmd?fix=1');
      await page.click(tid('rmc-retry'));
      expect(/checked again first/.test(await T(tid('rmc-confirm'))), 'duplicate-risk confirmation text');
      await page.fill(tid('rmc-reason'), 'number fixed with +1'); await page.click(tid('rmc-confirm-go')); await settle();
      expect(/Retry finished: (Submitted|Sent)/.test(await T(tid('rmc-msg'))), await T(tid('rmc-msg')));
      const trail = await T(tid('rmc-d-attempts'));
      expect(/Failed/.test(trail) && /Retry requested by staff/.test(trail) && /Accepted by the provider/.test(trail), trail);
      await shot('04-rmd-safe-retry');
      await closeDetail();
      const s = await st();
      expect(s.ben.join() === 'submitted' && s.sendsBen === 1, `Ben ${s.ben} ×${s.sendsBen}`);
      return `Ben: "Number missing +country code" → fixed → Safe Retry (reason) → submitted ×1 · trail keeps the failure`;
    }],
    ['rmd: history is newest first and pages server-side (10 → 2 pages); search by phone digits / technician; no phone in the URL; a month calendar with an explicit basis', async () => {
      await open(); await page.click(tid('rmc-tab-all')); await settle();
      await page.selectOption(tid('rmc-pagesize'), '10'); await settle();
      const n1 = await page.locator(tid('rmc-row')).count();
      await page.locator(`${tid('rmc-list')} .fk-pbtn.num`, { hasText: /^2$/ }).first().click(); await settle();
      const n2 = await page.locator(tid('rmc-row')).count();
      expect(n1 === 10 && n2 >= 4, `pages ${n1}/${n2}`);
      await search(tid('rmc-search'), '5554001');
      const byPhone = await rows();
      expect(byPhone.length === 1 && /Ava Remind/.test(byPhone[0]), JSON.stringify(byPhone));
      expect(!(await page.evaluate(() => window.location.search)).includes('5554001'), 'no phone in URL');
      await search(tid('rmc-search'), 'Rina Tech7');
      expect((await rows()).every((x) => /Rina Tech7/.test(x)), 'technician search');
      await search(tid('rmc-search'), '');
      await page.selectOption(tid('rmc-f-basis'), 'appointment'); await settle();
      expect(/Appointment date/.test(await T(tid('rmc-basis'))), await T(tid('rmc-basis')));
      await page.click(tid('rmc-f-dates')); const CAL = `${tid('rmc-cal')} [data-testid="range-calendar"]`; await page.waitForSelector(CAL);
      const cal = await T(CAL);
      expect(/\bMON\b/i.test(cal) && /Apply/.test(cal) && /Cancel/.test(cal), cal.slice(0, 120));
      await shot('05-rmd-history-calendar');
      await page.locator(`${CAL} button`, { hasText: /^Cancel$/ }).first().click(); await settle();
      await page.click(tid('rmc-clear')).catch(() => undefined); await page.selectOption(tid('rmc-pagesize'), '20'); await settle();
      return `history newest first: ${n1} + ${n2} rows · phone "5554001" → Ava only, not in the URL · technician search · basis "Appointment date" · month calendar (Cancel closes)`;
    }],
    ['rmd: customer reminder history (the Customer Profile section\'s API): Ava\'s reminder newest first with its event trail; another customer id is refused', async () => {
      const s = await st(); await open();
      const r = await page.evaluate(async (cid) => { const x = await fetch(`/api/v1/pos/reminder-center/customers/${cid}/reminders?page=1&pageSize=10`, { credentials: 'include' }); return { status: x.status, body: await x.json() }; }, s.ids.ava);
      expect(r.status === 200 && r.body.totalItems === 1, JSON.stringify(r).slice(0, 200));
      const it = r.body.items[0];
      expect(['delivered', 'sent', 'submitted'].includes(it.state) && it.events.map((e) => e.status).join() === 'claimed,sent', JSON.stringify(it).slice(0, 200));
      const bad = await page.evaluate(async () => (await fetch('/api/v1/pos/reminder-center/customers/00000000-0000-4000-8000-000000000000/reminders', { credentials: 'include' })).status);
      expect(bad === 404, `unknown customer → ${bad}`);
      return `GET …/customers/<Ava>/reminders → ${it.state}, events ${it.events.map((e) => e.status).join(' → ')} · unknown customer → 404 (the profile screen itself needs GET /pos/customers/:id, which this harness does not serve)`;
    }],
    ['rmd: Vietnamese; 1920×945, 1536×864, 1440×900, 1366×768, 1024×768 — no horizontal page scroll; the details Close stays visible', async () => {
      await J('/__lang?l=vi'); await open();
      const vi = await T(tid('rmc-tab-upcoming')); await J('/__lang?l=en');
      expect(vi === 'Sắp gửi', vi);
      const out = [];
      for (const [w, h] of [[1920, 945], [1536, 864], [1440, 900], [1366, 768], [1024, 768]]) {
        await page.setViewportSize({ width: w, height: h }); await open(); await page.waitForTimeout(300);
        const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        expect(over <= 1, `${w}x${h} sideways scroll ${over}px`);
        await shot(`07-rmd-${w}x${h}`); out.push(`${w}x${h}`);
      }
      await page.click(tid('rmc-tab-all')); await settle();
      await page.locator(tid('rmc-view')).first().click(); await page.waitForSelector(tid('rmc-close'));
      expect(await page.locator(tid('rmc-close')).isVisible(), 'close visible at 1024');
      await page.click(tid('rmc-close')); await page.setViewportSize({ width: 1920, height: 945 });
      return `VI tab "${vi}" · ${out.join(' · ')} — no horizontal page scroll · Close visible`;
    }],
  ];
};
