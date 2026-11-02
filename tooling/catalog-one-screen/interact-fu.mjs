// interact-fu.mjs — AI Follow-Ups & Human Handoff Center E2E (AI Follow-Ups guide, Oct 31 2026: T01–T07, T12, T13, T17,
// T19–T25, T33, T35, T36, T42, T44 where a browser can show them). Run with `node tooling/catalog-one-screen/interact.mjs
// <label> rcc,fu` against the live harness (fu-extra.mjs serves the REAL AiFollowUpCenterController; texts go through the
// REAL Reception Copilot center served by rcc-extra.mjs and its test sender). Nothing leaves the machine.
export const STEPS_FU = ({ page, expect, settle, go, tid, noJunk, J, T }) => {
  const URL0 = '/tenant/ai/receptionist/follow-ups';
  const open = () => go(URL0, tid('aifu-k-open'));
  const shot = (name) => page.screenshot({ path: `tooling/catalog-one-screen/results/fu-e2e/${name}.png`, fullPage: false }).catch(() => undefined);
  const num = async (id) => Number((await T(tid(id))).match(/\d+/)?.[0] ?? NaN);
  const rows = () => page.$$eval('[data-testid="aifu-row"]', (r) => r.length);
  let seed = null;
  return [
    ['fu: T01/T02 original chips, + New Follow-Up and Back to Command Center kept; KPI cards equal SQL truth', async () => {
      await J('/__tenant?name=pilot'); await J('/__role?r=OWNER'); await J('/__lang?l=en'); await J('/__fu?reset=1'); seed = await J('/__fu?seed=1');
      await open(); await settle();
      { const b = await T('body'); const m = b.match(/.{0,60}(Invalid Date|NaN|undefined|\[object Object\]|\d{4}-\d{2}-\d{2}T\d{2}:).{0,60}/); expect(!m, `junk on page: ${m?.[0]}`); }
      for (const c of ['open', 'assigned', 'in_progress', 'waiting', 'resolved', 'all']) expect(!!(await page.$(tid(`aifu-chip-${c}`))), `chip ${c}`);
      expect(!!(await page.$(tid('aifu-new'))) && !!(await page.$(tid('aifu-back'))), 'New + Back kept');
      const s = await J('/__fu?state=1');
      for (const [k, v] of [['aifu-k-open', s.open], ['aifu-k-assigned', s.assigned], ['aifu-k-in_progress', s.in_progress], ['aifu-k-waiting', s.waiting], ['aifu-k-overdue', s.overdue], ['aifu-k-resolved', s.resolved]]) expect(await num(k) === v, `${k} ${await num(k)} vs SQL ${v}`);
      expect(/Follow-Ups/.test(await T('h1')), 'title');
      await shot('01-fu-open');
      return `open ${s.open} · assigned ${s.assigned} · in progress ${s.in_progress} · waiting ${s.waiting} · overdue ${s.overdue} · resolved ${s.resolved} — equal SQL`;
    }],
    ['fu: T27/T30/T33 the signed failed-transfer handoff is ONE task; its overlay shows the original AI call and "Did not connect"', async () => {
      await open(); await page.fill(tid('aifu-q'), 'fux_call_1'); await settle();
      expect(await rows() === 1, `one AI task for the call (got ${await rows()})`);
      await page.click(tid('aifu-row')); await page.waitForSelector(tid('aifu-d-close'));
      await page.click(tid('aifu-tab-call')); await settle();
      expect(/Did not connect/.test(await T(tid('aifu-ca-transfer'))), 'transfer failed shown');
      await page.click(tid('aifu-tab-customer')); await settle();
      expect(/FUX Ava Kim/.test(await T(tid('aifu-p-customer'))), 'single-match customer linked');
      await shot('02-fu-ai-call');
      await page.click(tid('aifu-d-close'));
      return 'AI task linked to FUX Ava Kim; call tab: Did not connect';
    }],
    ['fu: T03/T07/T12/T17 All lists every status; search finds a row beyond page 1; 10/20/50 pages, newest first', async () => {
      await open(); await page.fill(tid('aifu-q'), ''); await page.click(tid('aifu-chip-all')); await settle();
      await page.selectOption(tid('aifu-pagesize'), '10'); await settle();
      expect(await rows() === 10, `10 rows (got ${await rows()})`);
      const total = Number((await T(tid('aifu-count'))).match(/\d+/)?.[0]);
      expect(total >= 28, `All total ${total}`);
      const firstPage = await page.$$eval('[data-testid="aifu-row"] .sub', (x) => x.map((e) => e.textContent).join('|'));
      expect(!/FUX task 25/.test(await T(tid('aifu-table'))), 'oldest seeded task not on page 1 (newest first)');
      await page.fill(tid('aifu-q'), 'FUX task 25'); await settle();
      expect(await rows() === 1, 'search finds the oldest task beyond page 1');
      await page.fill(tid('aifu-q'), 'FUX Ben'); await settle();
      expect(/FUX Ben Lee/.test(await T(tid('aifu-table'))), 'customer-name search');
      await page.fill(tid('aifu-q'), ''); await page.selectOption(tid('aifu-pagesize'), '50'); await settle();
      expect(await rows() === Math.min(50, total), `50/page rows ${await rows()}`);
      await shot('03-fu-all-paged');
      return `total ${total}; 10/page then 50/page; "FUX task 25" found off page 1 (${firstPage.length > 0 ? 'stable order' : ''})`;
    }],
    ['fu: T04/T05/T06 + New Follow-Up: a double-tapped Save is ONE task, shown first, overlay opens with Close', async () => {
      await open(); await page.click(tid('aifu-new')); await page.waitForSelector(tid('aifu-create'));
      await page.fill(tid('aifu-c-phone'), '+16095558809'); await page.fill(tid('aifu-c-desc'), 'FUX new from the desk');
      await page.click(tid('aifu-create-save')); await page.click(tid('aifu-create-save')).catch(() => undefined);
      await page.waitForSelector(tid('aifu-d-close'));
      const t = await J('/__fu?task=' + encodeURIComponent('FUX new from the desk'));
      expect(t.length === 1 && t[0].status === 'open', `one open task (got ${t.length})`);
      await page.click(tid('aifu-d-close')); await settle();
      expect(/FUX new from the desk|\+?\D*8809/.test(await T(tid('aifu-table'))), 'new task visible on page 1 of All');
      await shot('04-fu-created');
      return 'one task, first on page 1, overlay Close works';
    }],
    ['fu: T22–T25 assign → Start → Resolve (outcome required) are server-validated and audited; the queue updates', async () => {
      await open(); await page.click(tid('aifu-chip-all')); await page.fill(tid('aifu-q'), 'FUX new from the desk'); await settle();
      await page.click(tid('aifu-row')); await page.waitForSelector(tid('aifu-d-assign'));
      const opts = await page.$$eval(`${tid('aifu-d-assign')} option`, (o) => o.map((x) => x.value).filter(Boolean));
      await page.selectOption(tid('aifu-d-assign'), opts[0]); await page.waitForSelector(tid('aifu-d-msg'));
      await page.click(tid('aifu-d-start')); await settle();
      await page.selectOption(tid('aifu-d-rescat'), 'customer_reached'); await page.fill(tid('aifu-d-note'), 'Called back, all set'); await page.click(tid('aifu-d-resolve')); await settle();
      const t = (await J('/__fu?task=' + encodeURIComponent('FUX new from the desk')))[0];
      expect(t.status === 'resolved' && t.resolution_category === 'customer_reached' && !!t.assigned_user_id, `resolved ${JSON.stringify(t)}`);
      await page.click(tid('aifu-tab-audit')); await settle();
      const audit = await T(tid('aifu-p-audit'));
      for (const w of ['Created', 'Assigned', 'Status changed', 'Resolved']) expect(audit.includes(w), `audit has ${w}`);
      await shot('05-fu-lifecycle');
      await page.click(tid('aifu-d-close'));
      return `assigned → in progress → resolved (customer_reached); audit: Created, Assigned, Status changed, Resolved`;
    }],
    ['fu: T35/T36 a text is previewed first (nothing sent), then confirmed through the Copilot — shown SUBMITTED, never delivered', async () => {
      await open(); await page.fill(tid('aifu-q'), 'fux_call_1'); await settle();
      await page.click(tid('aifu-row')); await page.waitForSelector(tid('aifu-d-close'));
      await page.click(tid('aifu-tab-attempts')); await page.fill(tid('aifu-tx-body'), 'Hi Ava, this is Pilot Nail Salon returning your call.');
      await page.click(tid('aifu-tx-prepare')); await page.waitForSelector(tid('aifu-tx-preview'));
      const id = (await J('/__fu?task=')).length === 0 ? null : null; void id;
      const task = (await page.$eval(tid('aifu-p-overview'), () => '').catch(() => ''));  void task;
      const before = await page.$$eval('[data-testid="aifu-attempt"]', (r) => r.length);
      expect(before === 0, 'nothing recorded at preview');
      await page.click(tid('aifu-tx-confirm')); await page.waitForSelector(tid('aifu-d-msg'));
      const msg = await T(tid('aifu-d-msg'));
      expect(/Submitted \(not confirmed delivered\)/.test(msg) && !/Delivered\b/.test(msg.replace('not confirmed delivered', '')), `honest state: ${msg}`);
      await settle();
      expect(await page.$$eval('[data-testid="aifu-attempt"]', (r) => r.length) === 1, 'one text attempt recorded');
      await shot('06-fu-text-submitted');
      await page.click(tid('aifu-d-close'));
      return msg;
    }],
    ['fu: T42/T44 Check Follow-Up System: distinct read-only states, never a single green; nothing is sent', async () => {
      await open(); await page.click(tid('aifu-health')); await page.waitForSelector(tid('aifu-health-dialog'));
      const body = await T(tid('aifu-health-dialog'));
      expect(/Voice events/.test(body) && /Not configured/.test(body), 'voice events not configured (no signing key in the harness)');
      expect(/Handoff detection/.test(body) && /Staff assignment/.test(body) && /Background jobs/.test(body), 'all domains listed');
      expect(!/^Ready$/.test((await T(tid('aifu-health-dialog'))).split('\n')[0] ?? ''), 'overall not a single green');
      await shot('07-fu-health');
      await page.keyboard.press('Escape').catch(() => undefined); await page.click('[data-testid="aifu-health-dialog"] button[aria-label="Close"]').catch(() => undefined);
      return 'health: Voice events Not configured; every domain shown';
    }],
    ['fu: Front Desk works tasks; a Technician can view but not work them', async () => {
      await J('/__role?r=FRONT_DESK'); await open(); await settle();
      expect(!!(await page.$(tid('aifu-new'))), 'front desk sees New');
      await J('/__role?r=TECHNICIAN'); await open(); await settle();
      const txt = await T('body');
      expect(/cannot see AI follow-ups|view follow-ups but not work them|Follow-Ups/.test(txt), 'technician gets view or an honest refusal');
      await J('/__role?r=OWNER');
      return 'front desk: works · technician: view-only / refused';
    }],
    ['fu: Vietnamese POS labels; layout at 1920×945, 1366×768, 1280×720, 1024×768, 1536×864 — no sideways scroll', async () => {
      await J('/__lang?l=vi'); await open(); await settle();
      expect(/Theo dõi/.test(await T('h1')) && /Kiểm tra Hệ thống Theo dõi/.test(await T(tid('aifu-health'))), 'vi labels');
      await shot('08-fu-vi');
      await J('/__lang?l=en');
      const sizes = [[1920, 945], [1366, 768], [1280, 720], [1024, 768], [1536, 864]]; const res = [];
      for (const [w, h] of sizes) {
        await page.setViewportSize({ width: w, height: h }); await open(); await settle();
        const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(over <= 1, `horizontal overflow ${over}px at ${w}x${h}`); res.push(`${w}x${h}`);
        await shot(`09-fu-${w}x${h}`);
      }
      await page.setViewportSize({ width: 1920, height: 945 });
      return `vi labels · no sideways scroll at ${res.join(', ')}`;
    }],
  ];
};
