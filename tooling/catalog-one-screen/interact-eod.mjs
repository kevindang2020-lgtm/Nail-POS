// interact-eod.mjs — End-of-Day Follow-Ups E2E steps (EOD Follow-Ups Complete Build Guide, Oct 30 2026). Run with
// `node tooling/catalog-one-screen/interact.mjs <label> eod` against the live harness (eod-extra.mjs serves the real
// controllers + service on the seeded TEST database). No SMS / email / push leaves the machine.
export const STEPS_EOD = ({ page, expect, settle, go, tid, noJunk, J, T, rowsText, search }) => {
  const URL0 = '/settings/follow-ups';
  const open = () => go(URL0, tid('eod-kpis'));
  const shot = (name) => page.screenshot({ path: `tooling/catalog-one-screen/results/eod-e2e/${name}.png`, fullPage: false }).catch(() => undefined);
  const kpi = async (id) => (await T(`${tid(id)} .fk-kpi-v`)).replace(/\s+/g, ' ').trim();
  const st = () => J('/__eod?state=1');
  const ours = async (status) => ((await st()).tasks.find((x) => x.status === status)?.n ?? 0);
  const detailOf = async (text) => { await search(tid('eod-search'), text); await page.locator(tid('eod-row-details')).first().click(); await page.waitForSelector(tid('eod-d-close')); await settle(); };
  const closeDetail = async () => { await page.click(tid('eod-d-close')); await settle(); await search(tid('eod-search'), ''); };
  return [
    ['eod: the seven photographed settings + the new cooldown show their SAVED values; health is evidence-based (no worker → Unknown, never green)', async () => {
      await J('/__tenant?name=pilot'); await J('/__role?r=OWNER'); await J('/__lang?l=en'); await J('/__eod?reset=1'); await J('/__eod?seed=1');
      await open(); await noJunk();
      expect((await T(tid('eod-title'))) === 'End-of-Day Follow-Ups', 'title');
      const s = (await st()).settings;
      expect(s.enabled && s.generationTime === '20:00' && s.autoExpirePendingHours === 24 && !s.requireManagerApproval && s.contactCooldownHours === 24, JSON.stringify(s));
      expect((await page.locator(tid('eod-set-time')).inputValue()) === '20:00', '8:00 PM');
      expect((await page.locator(tid('eod-set-expire')).inputValue()) === '24', 'After 24 hours');
      expect((await page.locator(tid('eod-set-approval')).getAttribute('aria-pressed')) === 'false', 'approval Off');
      for (const label of ['Enable End-of-Day Follow-Ups', 'Daily generation time', 'Allow tech to edit message before sending', 'Auto-remove unsent follow-ups', 'Allow customer replies', 'Require manager approval before sending', 'Reminder notification to technician'])
        expect(await page.locator(tid('eod-settings'), { hasText: label }).count() === 1, `setting "${label}" shown`);
      const sch = await T(tid('eod-h-scheduler'));
      expect(/Unknown/.test(sch) && /scheduler_runs/.test(sch), `scheduler health: ${sch}`);
      expect(!/Ready/.test(await kpi('eod-kpi-automation')), 'automation not shown green without a worker');
      await shot('01-eod-overview-1920');
      return `8:00 PM · After 24 hours · approval Off · cooldown 24 h · scheduler "${sch.split('\n')[1] ?? 'Unknown'}" · automation ${await kpi('eod-kpi-automation')}`;
    }],
    ['eod: Preview Tonight is read-only — counts with reasons, and NOTHING is created, sent or notified', async () => {
      const before = await st();
      await page.click(tid('eod-preview-btn')); await page.waitForSelector(tid('eod-pv-create')); await settle();
      const create = Number(await T(tid('eod-pv-create')));
      const reasons = await T(tid('eod-pv-reasons'));
      expect(/Customer archived: 1/.test(reasons) && /Already booked: 1/.test(reasons), reasons);
      expect(/nothing was created, sent or notified/i.test(await T(tid('eod-pv-note'))), 'read-only note');
      await shot('02-eod-preview');
      await page.keyboard.press('Escape'); await settle();
      const after = await st();
      expect(JSON.stringify(before.tasks) === JSON.stringify(after.tasks) && before.messages === after.messages && before.techAlerts === after.techAlerts && before.runs === after.runs, `preview wrote: ${JSON.stringify([before, after])}`);
      globalThis.__eodPreview = create;
      return `would create ${create} · ${reasons} · tasks/messages/alerts/runs unchanged`;
    }],
    ['eod: the REAL scheduler gate on a controlled clock — 7:59 PM creates nothing, 8:01 PM creates exactly what Preview said, a re-run adds nothing', async () => {
      const early = await J('/__eod?clock=19:59');
      expect(!early.run, `7:59 PM ran: ${JSON.stringify(early)}`);
      const r = await J('/__eod?clock=20:01');
      expect(r.run && r.run.run_status === 'completed' && r.run.created_count === globalThis.__eodPreview, `8:01 PM: ${JSON.stringify(r.run)} vs preview ${globalThis.__eodPreview}`);
      const s1 = await st();
      expect((await ours('pending')) === 4 && s1.techAlerts === 2, `our tasks ${JSON.stringify(s1.tasks)} alerts ${s1.techAlerts}`);
      const again = await J('/__eod?clock=20:30'); const s2 = await st();
      expect(JSON.stringify(s2.tasks) === JSON.stringify(s1.tasks) && s2.techAlerts === 2 && s2.runs === s1.runs, `re-run changed: ${JSON.stringify(again)}`);
      await open();
      expect(await page.locator(tid('eod-run-row')).count() >= 1, 'run listed');
      const runRow = await T(tid('eod-run-row'));
      await shot('03-eod-after-8pm');
      return `7:59 → no run · 8:01 → ${r.run.candidates_count} services, ${r.run.created_count} created, ${r.run.excluded_count} excluded (${JSON.stringify(r.run.exclusions_json)}) · re-run: no change · alerts 2 · row "${runRow.replace(/\s+/g, ' ')}"`;
    }],
    ['eod: approval — a technician submits Ava; the manager must write a note to return it; Finn (technician 1) is approved and sent (one Customer App message)', async () => {
      await J('/__eod?approval=1');
      const a = await J('/__eod?tech=ava'); expect(a.status === 'pending_manager_approval', JSON.stringify(a));
      await open();
      await page.selectOption(tid('eod-f-approval'), 'awaiting'); await settle();
      expect((await page.locator(tid('eod-row')).count()) === 1, 'one awaiting');
      await page.locator(tid('eod-row-details')).first().click(); await page.waitForSelector(tid('eod-d-reject'));
      expect(await page.locator(tid('eod-d-reject')).isDisabled(), 'Return disabled without a note');
      await page.fill(tid('eod-d-reject-note'), 'Mention the cuticle oil by name'); await page.click(tid('eod-d-reject')); await settle();
      expect(/Returned/.test(await T(`${tid('eod-detail')}`)), 'returned');
      await shot('04-eod-returned');
      await page.click(tid('eod-d-close')); await settle();
      const b = await J('/__eod?tech=finn'); expect(b.status === 'pending_manager_approval', JSON.stringify(b));
      await open(); await page.selectOption(tid('eod-f-approval'), 'awaiting'); await settle();
      await page.locator(tid('eod-row-details')).first().click(); await page.waitForSelector(tid('eod-d-approve'));
      await page.click(tid('eod-d-approve')); await settle();
      const delivery = await T(tid('eod-d-delivery'));
      expect(/Customer App inbox/.test(delivery), delivery);
      await page.click(tid('eod-d-close')); await settle(); await page.selectOption(tid('eod-f-approval'), ''); await settle();
      await J('/__eod?approval=0');
      const s = await st();
      expect(s.messages === 1 && (await ours('rejected')) === 1, JSON.stringify(s));
      return `returned with a note (status Returned) · approved → sent · messages ${s.messages} · ${delivery}`;
    }],
    ['eod: customer protection at send time — Finn already got one today (two technicians): refused, then sent with a written manager exception; no app → nothing sent', async () => {
      await open();
      await detailOf('Finn');
      const pending = page.locator(tid('eod-d-send'));
      if (!(await pending.count())) { await closeDetail(); await search(tid('eod-search'), 'Finn'); await page.locator(tid('eod-row-details')).nth(1).click(); await page.waitForSelector(tid('eod-d-close')); }
      await page.click(tid('eod-d-send')); await settle();
      const refusal = await T(tid('eod-d-msg'));
      expect(/recently|already received/i.test(refusal), `first send: ${refusal}`);
      expect(await page.locator(tid('eod-d-send')).isDisabled(), 'Send anyway disabled until a reason is written');
      await page.fill(tid('eod-d-override'), 'Bo wants to share aftercare tips'); await page.click(tid('eod-d-send')); await settle();
      expect(/Manager exception/.test(await T(tid('eod-detail'))), 'exception recorded on the task');
      await shot('05-eod-exception');
      await closeDetail();
      await detailOf('Ben'); await page.click(tid('eod-d-send')); await settle();
      expect(/No customer app/.test(await T(tid('eod-detail'))), 'Ben has no app');
      await closeDetail();
      const s = await st();
      expect(s.messages === 2, `messages ${s.messages}`);
      return `"${refusal.slice(0, 90)}" → sent with the reason · Ben: No customer app, nothing sent · messages ${s.messages}`;
    }],
    ['eod: history — server search beyond page 1, 10/20/50 rows, newest first', async () => {
      await open();
      await search(tid('eod-search'), 'Gus');
      await page.selectOption(tid('eod-f-rows'), '10'); await settle();
      expect((await page.locator(tid('eod-row')).count()) === 10, 'page 1 has 10');
      await page.locator(`${tid('eod-activity')} .fk-pbtn.num`, { hasText: /^3$/ }).click(); await settle();
      const p3 = await page.locator(tid('eod-row')).count();
      expect(p3 === 4, `page 3 rows ${p3} (24 Gus rows)`);
      await search(tid('eod-search'), ''); await page.selectOption(tid('eod-f-rows'), '20'); await settle();
      const first = (await rowsText(`${tid('eod-row')} td:nth-child(1)`))[0];
      await shot('06-eod-history');
      return `"Gus" → 24 across pages (page 3: ${p3}) · newest first: ${first}`;
    }],
    ['eod: the 24-hour expiry keeps history — an unsent (returned) task expires, stays visible, and cannot be sent', async () => {
      const r = await J('/__eod?expire=1');
      const s = await st();
      expect((await ours('expired')) >= 1 && s.deleted === 0, `expired ${JSON.stringify(s.tasks)} deleted ${s.deleted} (${JSON.stringify(r)})`);
      await open(); await page.selectOption(tid('eod-f-status'), 'expired'); await settle();
      expect((await page.locator(tid('eod-row')).count()) >= 1, 'expired rows listed');
      await page.locator(tid('eod-row-details')).first().click(); await page.waitForSelector(tid('eod-d-expired'));
      expect((await page.locator(tid('eod-d-send')).count()) === 0 && (await page.locator(tid('eod-d-approve')).count()) === 0, 'no send on an expired task');
      const ex = await T(tid('eod-d-expired'));
      await shot('07-eod-expired');
      await page.click(tid('eod-d-close')); await settle(); await page.selectOption(tid('eod-f-status'), ''); await settle();
      return `expired ${await ours('expired')} · deleted rows 0 · "${ex}" · no Send button`;
    }],
    ['eod: health turns Ready only from evidence (worker heartbeats); Vietnamese; Front Desk', async () => {
      await J('/__eod?workers=1'); await open();
      const sch = await T(tid('eod-h-scheduler'));
      expect(/Ready/.test(sch), sch);
      await J('/__lang?l=vi'); await open();
      const vi = await T(tid('eod-title')); await J('/__lang?l=en');
      expect(vi === 'Chăm sóc khách cuối ngày', vi);
      await J('/__role?r=FRONT_DESK'); await go(URL0, 'body'); await page.waitForTimeout(800);
      const fd = (await page.locator(tid('eod-forbidden')).count()) ? 'permission notice (no customers.edit)' : (await page.locator(tid('eod-kpis')).count()) ? 'center shown (role has customers.edit)' : 'unknown';
      await J('/__role?r=OWNER');
      await shot('08-eod-health-ready');
      return `scheduler: ${sch.split('\n')[1] ?? sch} · VI "${vi}" · Front Desk: ${fd}`;
    }],
    ['eod: 1920×945, 1536×864, 1440×900, 1366×768, 1024×768 — no horizontal page scroll; the details overlay Close stays visible', async () => {
      const out = [];
      for (const [w, h] of [[1920, 945], [1536, 864], [1440, 900], [1366, 768], [1024, 768]]) {
        await page.setViewportSize({ width: w, height: h }); await open(); await page.waitForTimeout(300);
        const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        expect(over <= 1, `${w}x${h} sideways scroll ${over}px`);
        await shot(`09-eod-${w}x${h}`); out.push(`${w}x${h}`);
      }
      await page.locator(tid('eod-row-details')).first().click(); await page.waitForSelector(tid('eod-d-close'));
      expect(await page.locator(tid('eod-d-close')).isVisible(), 'close visible at 1024');
      await page.click(tid('eod-d-close')); await page.setViewportSize({ width: 1920, height: 945 });
      return out.join(' · ') + ' — no horizontal page scroll';
    }],
  ];
};
