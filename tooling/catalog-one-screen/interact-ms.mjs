// interact-ms.mjs — Text Messaging Setup & SMS Readiness guide (Oct 31 2026) E2E steps: six-part readiness, Check SMS
// System, the Setup Wizard, branch senders, the searchable setup history (calendar, basis, 10/20/50, detail) and the
// editable test text — on the REAL controllers + services + SQL with comms-extra.mjs's FAKE Twilio (no text leaves the
// machine, no number is bought, nothing is registered).   node tooling/catalog-one-screen/interact.mjs <label> ms
const FULL_SID = /(AC|SK)[0-9a-f]{32}/;
export const STEPS_MS = ({ page, expect, settle, go, tid, noJunk, API, SQL, J, T, rowsText, search, customRange, today, addDays }) => {
  const URL0 = '/tenant/communications/messaging-setup';
  const open = () => go(URL0, tid('ms-readiness'));
  const shot = (name) => page.screenshot({ path: `tooling/catalog-one-screen/results/ms-e2e/${name}.png`, fullPage: false }).catch(() => undefined);
  const ov = () => API('/tenant/messaging/setup/overview');
  const actRows = () => page.locator(`${tid('ms-act-table')} ${tid('ms-act-row')}`);
  const total = async () => Number((await T(tid('ms-total'))).replace(/\D+/g, ''));
  return [
    ['ms: six independent parts on screen equal the server — Connected account, yet registration Pending, so overall is NOT Ready', async () => {
      await J('/__tenant?name=pilot'); await J('/__role?r=OWNER'); await J('/__lang?l=en');
      await open(); await noJunk();
      const o = await ov();
      expect(o.parts.map((p) => p.key).join(',') === 'account,sender,registration,inbound,delivery,booking_verify', 'six parts');
      for (const p of o.parts) expect(await page.locator(tid('ms-state-' + p.key)).getAttribute('data-state') === p.state, `${p.key}: UI vs server ${p.state}`);
      expect(o.parts.find((p) => p.key === 'account').state === 'ready', 'account ' + o.parts[0].state);
      expect(o.parts.find((p) => p.key === 'registration').state === 'pending', 'registration should be Pending (campaign IN_PROGRESS)');
      expect(o.overall !== 'ready', 'overall must not be Ready while registration is pending');
      expect(!FULL_SID.test(await page.content()) && !FULL_SID.test(JSON.stringify(o)), 'a full SID on the page / in the overview');
      await shot('01-ms-readiness-1920');
      return o.parts.map((p) => `${p.key} ${p.state}`).join(' · ') + ` → overall ${o.overall}`;
    }],
    ['ms: Check SMS System records ONE read-only provider check and sends nothing', async () => {
      const c0 = (await SQL('checks')).length, s0 = (await SQL('smsTests')).length;
      await page.click(tid('pm-run-check')); await settle(); await page.waitForTimeout(400);
      const c1 = await SQL('checks'), s1 = (await SQL('smsTests')).length;
      expect(c1.length === c0 + 1 && c1[0].trigger_kind === 'manual', `checks ${c0} → ${c1.length}`);
      expect(s1 === s0, `a test text was sent by the check (${s0} → ${s1})`);
      expect(await page.locator(tid('ms-state-account')).getAttribute('data-state') === 'ready', 'account still Ready');
      return `checks ${c0} → ${c1.length} (manual, ${c1[0].account_state}) · test texts unchanged ${s0}`;
    }],
    ['ms: Setup Wizard resumes at the first unfinished step; a pending registration is never "Done"; Go to opens the existing card', async () => {
      const o = await ov();
      await page.click(tid('ms-open-wizard')); await page.waitForSelector(tid('ms-wizard'));
      const cur = await page.locator(`${tid('ms-wizard')} [aria-current="step"]`).getAttribute('data-testid');
      expect(cur === 'ms-step-' + o.wizard.resumeAt, `resume ${cur} vs ${o.wizard.resumeAt}`);
      for (const s of o.wizard.steps) expect(await page.locator(tid('ms-step-' + s.key)).getAttribute('data-state') === s.state, `step ${s.key}`);
      expect(o.wizard.steps.find((s) => s.key === 'registration').state !== 'done', 'registration step done while pending');
      expect(o.wizard.steps.find((s) => s.key === 'summary').state === 'blocked', 'summary must be Not complete');
      await shot('02-ms-wizard');
      await page.click(tid('ms-step-go')); await page.waitForSelector(tid('ms-wizard'), { state: 'detached', timeout: 8000 }); await page.waitForTimeout(300);
      const target = { connect: 'pm-credentials', number: 'pm-search', registration: 'pm-registration', webhooks: 'pm-webhooks', test: 'pm-test' }[o.wizard.resumeAt];
      const inView = await page.evaluate((id) => { const r = document.getElementById(id)?.getBoundingClientRect(); return !!r && r.top < innerHeight && r.bottom > 0; }, target);
      expect(inView, `${target} scrolled into view`);
      return `resumed at ${o.wizard.resumeAt}; ${o.wizard.steps.map((s) => `${s.key}:${s.state}`).join(' ')} → Go to #${target}`;
    }],
    ['ms: Branch senders — the sender each branch would actually use (inherited from the salon default here), masked account', async () => {
      await open();
      const b = await API('/tenant/messaging/setup/branches');
      expect(b.branches.length >= 1, 'at least one branch');
      for (const x of b.branches) {
        const row = await T(tid('ms-br-' + x.branchId));
        expect(row.includes(x.inherits ? 'Inherits salon default' : 'Own Twilio') && row.includes(x.sender ?? '—'), `branch row ${row}`);
      }
      expect(!FULL_SID.test(await T(tid('ms-branches'))), 'full SID in the branch table');
      return b.branches.map((x) => `${x.name}: ${x.inherits ? 'inherits' : 'own'} ${x.sender} ${x.accountSidMasked}`).join(' · ');
    }],
    ['ms: Setup history — exact total, newest first, search reaches beyond page 1, 10/20/50, page 2, kind filter, one calendar day, detail + Close', async () => {
      await page.locator(tid('ms-activity')).scrollIntoViewIfNeeded();
      const srv = await API('/tenant/messaging/setup/activity?pageSize=10');
      expect(await total() === srv.totalItems, `total ${await total()} vs ${srv.totalItems}`);
      expect(await actRows().count() === Math.min(10, srv.totalItems), 'page of 10');
      await search(tid('ms-search'), '6060');
      expect(await total() === 1 && (await rowsText(`${tid('ms-act-row')} td:nth-child(5)`))[0] === '•••6060', 'the oldest seeded text found by its last 4');
      await search(tid('ms-search'), '');
      await page.selectOption(tid('ms-size'), '20'); await settle();
      expect(await actRows().count() === Math.min(20, srv.totalItems), 'page of 20');
      await page.selectOption(tid('ms-size'), '10'); await settle();
      if (srv.totalPages > 1) {
        await page.click(`${tid('ms-activity')} [aria-label="Page 2"]`); await settle();
        const p2 = await API('/tenant/messaging/setup/activity?pageSize=10&page=2');
        expect(await actRows().count() === p2.items.length, 'page 2 rows');
      }
      await page.selectOption(tid('ms-kind'), 'health_check'); await settle();
      const kinds = await page.locator(tid('ms-act-row')).evaluateAll((els) => els.map((e) => e.getAttribute('data-kind')));
      expect(kinds.length > 0 && kinds.every((k) => k === 'health_check'), 'kind filter');
      await page.selectOption(tid('ms-kind'), ''); await settle();
      const day = addDays(today, -2);
      await customRange(day, day);
      const dayServer = await API(`/tenant/messaging/setup/activity?preset=custom&from=${day}&to=${day}`);
      const shown = (await page.locator(tid('ms-total')).count()) ? await total() : 0;
      expect(shown === dayServer.totalItems, `one day ${day}: UI ${shown} vs server ${dayServer.totalItems}`);
      await page.click(tid('ms-clear')); await settle();
      await page.locator(tid('ms-act-view')).first().click(); await page.waitForSelector(tid('ms-detail')); await noJunk();
      await shot('03-ms-history-detail');
      await page.click(tid('ms-detail-close')); await page.waitForSelector(tid('ms-detail'), { state: 'detached', timeout: 8000 });
      return `total ${srv.totalItems} (pages ${srv.totalPages}) · '6060' → 1 · 20 rows · page 2 · kind filter · ${day}: ${dayServer.totalItems} · detail closed`;
    }],
    ['ms: the test text can be edited (≤ 160); confirmation required; accepted ≠ delivered; cost shown as unavailable', async () => {
      await page.locator(tid('pm-test')).scrollIntoViewIfNeeded();
      expect(/unavailable/i.test(await T(tid('ms-test-cost'))), 'cost unavailable');
      const before = (await SQL('smsTests'))[0]?.idempotency_key ?? null;   // the lookup is capped at 10 rows: compare the newest
      await page.getByLabel('Send to (E.164)', { exact: true }).fill('+15551230777');
      await page.fill(tid('ms-test-text'), 'Pilot salon setup check from the wizard');
      await page.getByRole('button', { name: 'Send test SMS' }).click();
      await page.getByRole('button', { name: 'Send once' }).click(); await settle();
      const s1 = await SQL('smsTests');
      expect(s1[0].idempotency_key !== before && s1[0].status === 'accepted' && s1[0].destination_masked === '•••0777', JSON.stringify(s1[0]));
      expect(/accepted/i.test(await T(tid('pm-test-msg'))) && /Delivered only after/i.test(await T(tid('pm-test-msg'))), 'accepted, not delivered');
      return `one new test text ${s1[0].destination_masked} · status ${s1[0].status} (fake Twilio; nothing left the machine)`;
    }],
    ['ms: Vietnamese staff labels keep the same states', async () => {
      await J('/__lang?l=vi'); await open();
      expect(/Kiểm tra hệ thống SMS/.test(await T(tid('pm-run-check'))), 'VI check label');
      const o = await ov();
      for (const p of o.parts) expect(await page.locator(tid('ms-state-' + p.key)).getAttribute('data-state') === p.state, 'VI ' + p.key);
      await shot('04-ms-vietnamese');
      await J('/__lang?l=en');
      return 'VI labels; identical part states';
    }],
    ['ms: fits 1920×945 · 1536×864 · 1440×900 · 1366×768 · 1024×768 with no sideways page scroll; wizard Close reachable', async () => {
      const out = [];
      for (const [w, h] of [[1920, 945], [1536, 864], [1440, 900], [1366, 768], [1024, 768]]) {
        await page.setViewportSize({ width: w, height: h }); await open(); await page.waitForTimeout(300);
        const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        expect(over <= 1, `${w}x${h} sideways scroll ${over}px`);
        await shot(`05-ms-${w}x${h}`); out.push(`${w}x${h}`);
      }
      await page.click(tid('ms-open-wizard')); await page.waitForSelector(tid('ms-wizard'));
      const btn = page.locator(tid('ms-wizard')).getByRole('button', { name: 'Close' }).last();
      expect(await btn.isVisible(), 'wizard Close visible at 1024');
      await btn.click(); await page.setViewportSize({ width: 1920, height: 945 });
      return out.join(' · ') + ' — no horizontal page scroll';
    }],
  ];
};
