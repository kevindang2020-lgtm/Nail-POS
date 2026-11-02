// interact-fuq.mjs — Follow-Up Queue E2E steps (Follow-Up Queue Complete Build Guide, Oct 30 2026). Run with
// `node tooling/catalog-one-screen/interact.mjs <label> fuq` against the live harness (fuq-extra.mjs serves the real
// controller on the seeded TEST database; send / skip / approve use the existing routes). Nothing leaves the machine.
export const STEPS_FUQ = ({ page, expect, settle, go, tid, noJunk, J, T, search }) => {
  const URL0 = '/follow-ups';
  const open = () => go(URL0, tid('fuq-kpis'));
  const shot = (name) => page.screenshot({ path: `tooling/catalog-one-screen/results/fuq-e2e/${name}.png`, fullPage: false }).catch(() => undefined);
  const kpiV = async (id) => (await T(`${tid(id)} .fk-kpi-v`)).replace(/\s+/g, ' ').trim();
  const st = () => J('/__fuq?state=1');
  const sum = (rows, list) => rows.filter((r) => list.includes(r.status)).reduce((a, r) => a + r.n, 0);
  const detailOf = async (text) => { await search(tid('fuq-search'), text); await page.locator(tid('fuq-row-details')).first().click(); await page.waitForSelector(tid('fuq-d-close')); await settle(); };
  const closeDetail = async () => { await page.click(tid('fuq-d-close')); await settle(); await search(tid('fuq-search'), ''); };
  return [
    ['fuq: the five counters equal the database for today\'s due date; the basis is written on screen; the sidebar names the page correctly', async () => {
      await J('/__tenant?name=pilot'); await J('/__role?r=OWNER'); await J('/__lang?l=en'); await J('/__fuq?reset=1'); await J('/__fuq?seed=1');
      await open(); await noJunk();
      const s = await st(); const rows = s.todayAll;
      const want = { pending: sum(rows, ['pending', 'pending_manager_approval', 'rejected']), sent: sum(rows, ['sent', 'customer_replied', 'rebooked']), skipped: sum(rows, ['skipped', 'dismissed', 'customer_not_available']), total: rows.reduce((a, r) => a + r.n, 0) };
      const got = { pending: Number(await kpiV('fuq-kpi-pending')), sent: Number(await kpiV('fuq-kpi-sent')), skipped: Number(await kpiV('fuq-kpi-skipped')), total: Number(await kpiV('fuq-kpi-total')) };
      expect(JSON.stringify(got) === JSON.stringify(want), `screen ${JSON.stringify(got)} vs DB ${JSON.stringify(want)}`);
      expect(Number(await kpiV('fuq-kpi-rebooked')) >= 1, 'Rita rebooked');
      const basis = await T(tid('fuq-basis'));
      expect(basis.includes(`due date is ${s.today}`) && /overdue from earlier days/.test(basis) && /missed calls today/.test(basis), basis);
      const grp = page.locator('nav.nav').getByText(/^Communications$/i).first();
      if (await grp.count()) { await grp.click(); await page.waitForTimeout(250); }                  // expand the Communications group
      const navHasQueue = await page.locator(':text-is("Follow-Up Queue")').count();          // the page title + the sidebar item
      const navOld = await page.locator(':text-is("Missed Call Follow-Up")').count();
      expect(navHasQueue >= 2 && navOld === 0, `sidebar: "Follow-Up Queue" ×${navHasQueue}, old label ×${navOld}`);
      await shot('01-fuq-overview-1920');
      return `screen = DB ${JSON.stringify(got)} · rebooked ${await kpiV('fuq-kpi-rebooked')} · "${basis.slice(0, 120)}…" · sidebar "Follow-Up Queue"`;
    }],
    ['fuq: queue order — the overdue task is first and High; an open low rating is High with its reason; history is newest first and pages server-side', async () => {
      await open();
      const first = await T(tid('fuq-row'));
      expect(/Olivia Overdue/.test(first) && /Overdue/.test(first) && /High/.test(first), `first row: ${first}`);
      const cleo = page.locator(tid('fuq-row'), { hasText: 'Cleo Concern' });
      expect(await cleo.count() === 1 && /High/.test(await cleo.innerText()), 'Cleo High');
      const why = await cleo.locator(tid('fuq-row-priority')).getAttribute('title');
      expect(/Open concern on record/.test(why ?? ''), `why: ${why}`);
      await page.click(tid('fuq-view-history')); await settle();
      await page.selectOption(tid('fuq-f-rows'), '10'); await settle();
      await search(tid('fuq-search'), 'zed match');
      const info = await T(`${tid('fuq-list')} .fk-pager-range`).catch(() => '');
      const n1 = await page.locator(tid('fuq-row')).count();
      await page.locator(`${tid('fuq-list')} .fk-pbtn.num`, { hasText: /^2$/ }).first().click(); await settle();
      const n2 = await page.locator(tid('fuq-row')).count();
      expect(n1 === 10 && n2 === 2, `page sizes ${n1}/${n2} ${info}`);
      await search(tid('fuq-search'), '5553012');
      const byPhone = await T(tid('fuq-row'));
      expect(/Zed Match 12/.test(byPhone), byPhone);
      expect(!(await page.evaluate(() => window.location.search)).includes('5553012'), 'no phone in the URL');
      await search(tid('fuq-search'), ''); await page.click(tid('fuq-view-queue')); await page.selectOption(tid('fuq-f-rows'), '20'); await settle();
      await shot('02-fuq-queue-order');
      return `first: Olivia Overdue (Overdue · High) · Cleo High ("${why}") · history 12 "Zed" matches → 10 + 2 · phone search finds Zed Match 12 · no phone in URL`;
    }],
    ['fuq: details — contact check, priority reasons, preview; Skip with a reason (no message); Approve sends one Customer App message; Already Sent and Missing Contact block Send', async () => {
      const before = (await st()).messages;
      await detailOf('Pia Pending');
      expect(/Eligible/.test(await T(tid('fuq-d-contact'))), await T(tid('fuq-d-contact')));
      expect(/cuticle oil/.test(await T(tid('fuq-d-preview'))), 'preview');
      await page.selectOption(tid('fuq-d-skip-reason'), 'customer_declined'); await page.click(tid('fuq-d-skip')); await page.waitForSelector(tid('fuq-d-msg')); await settle();
      const s1 = await st();
      expect(s1.piaSkipReason === 'customer_declined' && s1.messages === before, `skip: ${JSON.stringify(s1)}`);
      await shot('03-fuq-detail-skip');
      await closeDetail();
      await detailOf('Amy Approve');
      expect(/Needs Approval/.test(await T(tid('fuq-d-contact'))), 'needs approval');
      await page.click(tid('fuq-d-approve')); await page.waitForSelector(tid('fuq-d-msg')); await settle();
      const s2 = await st();
      expect(s2.messages === before + 1, `approve messages ${s2.messages} vs ${before + 1}`);
      await closeDetail();
      await page.click(tid('fuq-view-history')); await settle();
      await detailOf('Rita Rebooked');
      expect(/Already Sent/.test(await T(tid('fuq-d-contact'))) && (await page.locator(tid('fuq-d-send')).count()) === 0, 'Rita already sent');
      await closeDetail();
      await detailOf('Nora NoApp');
      const nora = await T(tid('fuq-d-contact'));
      expect(/Missing Contact/.test(nora) && (await page.locator(tid('fuq-d-send')).count()) === 0 && (await page.locator(tid('fuq-d-retry')).count()) === 0, `nora: ${nora}`);
      await shot('04-fuq-detail-missing-contact');
      await closeDetail(); await page.click(tid('fuq-view-queue')); await settle();
      return `Pia skipped "customer_declined", messages unchanged · Amy approved → +1 Customer App message · Rita: Already Sent (no Send) · Nora: Missing Contact (no Send / Retry)`;
    }],
    ['fuq: Generate Now reports eligible / created / already existed — and never sends', async () => {
      const before = (await st()).messages;
      await page.click(tid('fuq-generate')); await page.waitForSelector(tid('fuq-gen-result')); await settle();
      const r1 = await T(tid('fuq-gen-result'));
      await page.click(tid('fuq-generate')); await page.waitForTimeout(600); await settle();
      const r2 = await T(tid('fuq-gen-result'));
      expect(/Generating never sends anything/.test(r2), r2);
      expect(!/[1-9]\d* created now/.test(r2) || /No completed service qualified/.test(r2), `second click created: ${r2}`);
      expect((await st()).messages === before, 'no message from generating');
      await shot('05-fuq-generate');
      return `1st: "${r1.replace(/\s+/g, ' ').slice(0, 140)}" · 2nd: "${r2.replace(/\s+/g, ' ').slice(0, 140)}" · messages unchanged`;
    }],
    ['fuq: the Missed Call type is its own list — awaiting / replied / recovered, a filter, and Open SMS Inbox', async () => {
      await open(); await page.click(tid('fuq-type-missed_call')); await page.waitForSelector(tid('fuq-mc-table')); await settle();
      const rows = await page.locator(tid('fuq-mc-row')).allInnerTexts();
      const ours = rows.filter((r) => /Mona Missed|Rey Replied|•••9090/.test(r));
      expect(ours.length === 3, `rows: ${JSON.stringify(rows)}`);
      expect(ours.some((r) => /Mona Missed/.test(r) && /Awaiting callback/.test(r)) && ours.some((r) => /Rey Replied/.test(r) && /Replied/.test(r)) && ours.some((r) => /9090/.test(r) && /Recovered/.test(r)), JSON.stringify(ours));
      await page.selectOption(tid('fuq-f-mcstate'), 'awaiting_callback'); await settle();
      const aw = await page.locator(tid('fuq-mc-row')).allInnerTexts();
      expect(aw.every((r) => /Awaiting callback/.test(r)), JSON.stringify(aw));
      await shot('06-fuq-missed-calls');
      await page.locator(tid('fuq-mc-row')).first().getByRole('button', { name: 'Open SMS Inbox' }).click(); await page.waitForTimeout(500);
      const url = page.url();
      expect(/\/tenant\/communications\/sms/.test(url), url);
      await open(); await page.click(tid('fuq-type-after_service')); await settle();
      return `Mona: Awaiting callback · Rey: Replied · •••9090: Recovered · filter → ${aw.length} awaiting · Open SMS Inbox → ${new URL(url).pathname}`;
    }],
    ['fuq: dates — presets and a real month calendar with an explicit basis; results with the causation note; Book Appointment keeps the customer', async () => {
      let at = 'open';
      try {
        await open(); await page.click(tid('fuq-view-history')); await settle();
        at = 'preset'; await page.click(tid('fuq-preset-month')); await settle();
        const note = await T(tid('fuq-basis-note'));
        expect(/Filtering by Created date/.test(note), note);
        at = 'basis'; await page.selectOption(tid('fuq-f-basis'), 'sent'); await settle();
        expect(/Filtering by Sent date/.test(await T(tid('fuq-basis-note'))), 'basis label follows');
        at = 'calendar'; await page.click(tid('fuq-f-dates')); const CAL = `${tid('fuq-cal')} [data-testid="range-calendar"]`; await page.waitForSelector(CAL);
        const cal = await T(CAL);
        expect(/\bMON\b/i.test(cal) && /\bSUN\b/i.test(cal) && /Apply/.test(cal) && /Cancel/.test(cal), `calendar grid: ${cal.replace(/\s+/g, ' ').slice(0, 120)}`);
        await shot('07-fuq-calendar');
        at = 'cancel'; await page.locator(`${CAL} button`, { hasText: /^Cancel$/ }).first().click({ timeout: 8000 }); await settle();
        expect((await page.locator(tid('fuq-cal')).count()) === 0, 'calendar closed by Cancel');
        at = 'clear'; await page.click(tid('fuq-f-clear'), { timeout: 8000 }); await settle();
        at = 'results'; const res = await T(tid('fuq-results'));
        expect(/Association, not causation/.test(res) && /Revenue from return visits/.test(res), res.slice(0, 200));
        at = 'history'; await page.click(tid('fuq-view-history'), { timeout: 8000 }); await settle();
        at = 'detail'; await detailOf('Rita Rebooked');
        at = 'book'; await page.click(tid('fuq-d-book'), { timeout: 8000 }); await page.waitForTimeout(500);
        const url = page.url();
        expect(/\/booking\/new\?customerId=/.test(url) && /from=follow-up-queue/.test(url), url);
        await open();
        return `This Month → "${note}" · Sent basis · calendar month grid (Cancel closes) · results with causation note · Book → ${new URL(url).pathname}?customerId=…&from=follow-up-queue`;
      } catch (e) { throw new Error(`at ${at}: ${e?.message}`); }
    }],
    ['fuq: Vietnamese; 1920×945, 1536×864, 1440×900, 1366×768, 1024×768 — no horizontal page scroll; the details Close stays visible', async () => {
      await J('/__lang?l=vi'); await open();
      const vi = await page.locator('h1').first().innerText(); await J('/__lang?l=en');
      expect(vi === 'Hàng chờ theo dõi khách', vi);
      const out = [];
      for (const [w, h] of [[1920, 945], [1536, 864], [1440, 900], [1366, 768], [1024, 768]]) {
        await page.setViewportSize({ width: w, height: h }); await open(); await page.waitForTimeout(300);
        const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        expect(over <= 1, `${w}x${h} sideways scroll ${over}px`);
        await shot(`08-fuq-${w}x${h}`); out.push(`${w}x${h}`);
      }
      await page.locator(tid('fuq-row-details')).first().click(); await page.waitForSelector(tid('fuq-d-close'));
      expect(await page.locator(tid('fuq-d-close')).isVisible(), 'close visible at 1024');
      await page.click(tid('fuq-d-close')); await page.setViewportSize({ width: 1920, height: 945 });
      return `VI "${vi}" · ${out.join(' · ')} — no horizontal page scroll`;
    }],
  ];
};
