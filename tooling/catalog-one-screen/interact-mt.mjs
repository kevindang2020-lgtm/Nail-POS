// interact-mt.mjs — Communications → Message Templates steps of the catalog E2E (Message Templates & Automation Center guide,
// Oct 30 2026): the REAL screen in Chromium against the REAL MessageTemplatesController → SQL (mt-extra.mjs), the REAL SMS
// Inbox (inbox-extra.mjs) for the guide's P0 "used by an existing Communications workflow", and the REAL NotificationsService
// talking to the FAKE Twilio only. `node tooling/catalog-one-screen/interact.mjs <label> mt` (the inbox fixtures are seeded at
// server start). Nothing reaches a real provider.
export const STEPS_MT = ({ page, expect, settle, go, tid, noJunk, API, J, T, rowsText, customRange, today }) => {
  const URL0 = '/tenant/communications/templates';
  const open = (qs = '') => go(URL0 + qs, tid('message-templates'));
  const shot = (name) => page.screenshot({ path: `tooling/catalog-one-screen/results/mt-e2e/${name}.png`, fullPage: false }).catch(() => undefined);
  const kpiV = async (t) => (await T(`${tid(t)} .fk-kpi-v`)).replace(/\s+/g, ' ').trim();
  const st = () => J('/__mt?state=1');
  const waitFor = async (fn, ms = 8000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return true; await page.waitForTimeout(200); } return false; };
  const firstRowName = async () => (await T(`${tid('mt-row')} .mt-name`)).trim();
  let tplId = ''; let remId = '';
  return [
    ['mt: "No templates yet" is the salon\'s REAL zero (DB + API agree); the original page stays — Your Templates, New Template with Name, Channel, Message, Create', async () => {
      await J('/__tenant?name=pilot'); await J('/__role?r=OWNER'); await J('/__lang?l=en'); await J('/__mt?reset=1');
      const s0 = await st(); expect(s0.templates === 0, 'db templates ' + s0.templates);
      const api = await API('/pos/message-templates/templates'); expect(api.totalItems === 0, 'api total ' + api.totalItems);
      await open(); await noJunk();
      expect((await T(`${tid('message-templates')} h1`)) === 'Message Templates', 'title');
      expect(/No templates yet/.test(await T(tid('mt-library'))), 'empty state text');
      for (const s of ['mt-f-name', 'mt-f-channel', 'mt-f-body', 'mt-create', 'mt-kpis', 'mt-usage', 'mt-connections']) expect(await page.locator(tid(s)).count() >= 1, s);
      expect(await kpiV('mt-kpi-total') === '0', 'total kpi');
      await shot('01-mt-empty-is-real');
      return `DB 0 · API 0 · screen "No templates yet" · New Template form kept (Name, Channel, Message, Create)`;
    }],
    ['mt: the ORIGINAL form creates a real template — "[name]" kept — saved, reloaded, Active v1 on page 1; DB has the template + version 1', async () => {
      await page.fill(tid('mt-f-name'), 'Appointment confirmation');
      await page.fill(tid('mt-f-body'), 'Hi [name], this is a reminder about your appointment at {salon_name}.');
      await page.click(tid('mt-create')); await page.waitForSelector(tid('mt-note')); await settle();
      expect(await firstRowName() === 'Appointment confirmation', 'first row ' + await firstRowName());
      const s = await st(); expect(s.templates === 1 && s.versions === 1 && s.active === 1, 'db ' + JSON.stringify(s));
      tplId = (await API('/pos/message-templates/templates')).items[0].id;
      await page.reload(); await page.waitForSelector(tid('mt-row')); await settle();
      const row = (await rowsText(tid('mt-row')))[0]; expect(/Active/.test(row) && /v1/.test(row), 'row ' + row);
      expect(await kpiV('mt-kpi-total') === '1' && await kpiV('mt-kpi-active') === '1', 'kpis');
      await shot('02-mt-created-and-reloaded');
      return `${tplId.slice(0, 12)}… Active v1 after reload; DB 1 template + 1 version`;
    }],
    ['mt: Smart Variable Assistant inserts at the cursor; live preview (sample data, never sends) shows segments; an unknown variable is flagged; Save as draft', async () => {
      const n0 = (await st()).notifications;
      await page.fill(tid('mt-f-name'), 'Reminder (library)'); await page.selectOption(tid('mt-f-category'), 'appointment_reminder');
      await page.fill(tid('mt-f-body'), 'Hi , see you  at .');
      const put = async (pos, tok) => { await page.waitForTimeout(200); await page.locator(tid('mt-f-body')).evaluate((el, p) => { el.focus(); el.setSelectionRange(p, p); }, pos); await page.click(tid('mt-var-' + tok)); await page.waitForTimeout(200); };
      await put(3, 'customer_first_name'); const b1 = await page.inputValue(tid('mt-f-body')); await put(b1.indexOf('  ') + 1, 'appointment_date');
      const b2 = await page.inputValue(tid('mt-f-body')); await put(b2.lastIndexOf('.'), 'appointment_time');
      const body = await page.inputValue(tid('mt-f-body'));
      expect(body === 'Hi {customer_first_name}, see you {appointment_date} at {appointment_time}.', 'body ' + body);
      expect(await waitFor(async () => /Hi Ava, see you Tue, Nov 3 at 2:30 PM\./.test(await T(tid('mt-rendered')).catch(() => ''))), 'live preview');
      expect(/GSM-7 · \d+ characters · 1 SMS part/.test(await T(tid('mt-segments'))), 'segments ' + await T(tid('mt-segments')));
      await page.fill(tid('mt-f-body'), body + ' {customer_nickname}');
      expect(await waitFor(async () => (await page.locator(tid('mt-finding')).allInnerTexts()).some((x) => /not a known variable/.test(x))), 'unknown flagged');
      await page.fill(tid('mt-f-body'), body + ' with {technician_name}');
      await page.click(tid('mt-save-draft')); await page.waitForSelector(tid('mt-note')); await settle();
      expect((await st()).notifications === n0, 'preview / save sent something');
      remId = (await API('/pos/message-templates/templates?status=draft')).items.find((x) => x.name === 'Reminder (library)').id;
      await shot('03-mt-assistant-preview-draft');
      return `inserted 3 tokens at the cursor · preview "Hi Ava, see you Tue, Nov 3 at 2:30 PM." · unknown {customer_nickname} flagged · saved as draft · 0 messages`;
    }],
    ['mt: overlay — Activate; Preview & Test: sample data + "Nothing is sent"; Test Send needs the tick, sends ONE message via the salon\'s fake Twilio', async () => {
      await page.click(tid('mt-clear')).catch(() => undefined);
      await open('?status=all'); await page.locator(tid('mt-row')).filter({ hasText: 'Reminder (library)' }).first().click(); await page.waitForSelector(tid('mt-detail'));
      await page.click(tid('mt-activate')); await page.waitForSelector(tid('mt-dlg-note')); await settle();
      await page.click(tid('mt-tab-test')); await page.waitForSelector(tid('mt-pv-text')); await settle();
      expect(/Hi Ava/.test(await T(tid('mt-pv-text'))) && /Nothing is sent/.test(await T(tid('mt-preview-box'))), 'preview');
      const n0 = (await st()).notifications;
      await page.fill(tid('mt-test-to'), '(609) 555-0199');
      expect(await page.locator(tid('mt-test-send')).isDisabled(), 'send must need the tick');
      await page.check(tid('mt-test-confirm')); await page.click(tid('mt-test-send')); await page.waitForSelector(tid('mt-test-result')); await settle();
      const res = await T(tid('mt-test-result')); const s = await st();
      expect(/Test sent to ••• 0199/.test(res), 'result ' + res); expect(s.tests === 1 && s.notifications === n0 + 1, 'db ' + JSON.stringify(s));
      await shot('04-mt-preview-test-send');
      await page.click(tid('mt-close'));
      return `activated · preview sample "Hi Ava…" · one test → ••• 0199 (salon sender, fake Twilio) · ${s.tests} test row`;
    }],
    ['mt: a stale edit shows the conflict (never overwrites); Reload, save → version 2; Versions tab keeps v1 unchanged', async () => {
      await open(); await page.locator(tid('mt-row')).filter({ hasText: 'Appointment confirmation' }).first().click(); await page.waitForSelector(tid('mt-f-body'));
      await J('/__mt?bump=' + tplId);   // another manager saves meanwhile
      const dlgBody = page.locator(`${tid('mt-detail')} ${tid('mt-f-body')}`);
      await dlgBody.fill('Hi [name], your appointment at {salon_name} is confirmed.');
      await page.click(`${tid('mt-detail')} ${tid('mt-save')}`); await page.waitForSelector(tid('mt-conflict')); await settle();
      const d1 = await API('/pos/message-templates/templates/' + tplId); expect(d1.template.version === 1, 'overwritten!');
      await page.click(`${tid('mt-conflict')} button`); await settle();
      await page.locator(`${tid('mt-detail')} ${tid('mt-f-body')}`).fill('Hi [name], your appointment at {salon_name} is confirmed.');
      await page.click(`${tid('mt-detail')} ${tid('mt-save')}`); await page.waitForSelector(tid('mt-dlg-note')); await settle();
      await page.click(tid('mt-tab-versions')); const v = await rowsText(`${tid('mt-versions')} li`);
      expect(v.length === 2 && /v2/.test(v[0]) && /v1/.test(v[1]) && /reminder about your appointment/.test(v[1]), 'versions ' + v.join(' | '));
      await shot('05-mt-conflict-then-version-2');
      await page.click(tid('mt-close'));
      return `conflict shown, nothing overwritten · saved as v2 · v1 text kept`;
    }],
    ['mt: Automation Connections — non-bindable workflows say why; connect Appointment Reminders (no send); archiving the bound template is blocked until a replacement', async () => {
      const n0 = (await st()).notifications;
      await page.locator(tid('mt-connections')).scrollIntoViewIfNeeded();
      expect(/Uses its own text/.test(await T(tid('mt-wf-reschedule_cancellation'))) && /No booking-confirmation message/.test(await T(tid('mt-wf-booking_confirmation'))), 'honest sources');
      await page.click(tid('mt-connect-appointment_reminder-sms')); await page.waitForSelector(tid('mt-pick-select'));
      await page.selectOption(tid('mt-pick-select'), remId); await page.click(tid('mt-pick-connect')); await page.waitForSelector(tid('mt-binding')); await settle();
      expect(/Reminder \(library\)/.test(await T(tid('mt-wf-appointment_reminder'))), 'binding shown');
      const s = await st(); expect(s.bindings === 1 && s.notifications === n0, 'db ' + JSON.stringify(s));
      await page.click(`${tid('mt-binding')} .fk-link`); await page.waitForSelector(tid('mt-detail'));
      await page.click(tid('mt-archive')); await page.waitForSelector(tid('mt-in-use')); await settle();
      expect(/1 active automation/.test(await T(tid('mt-in-use'))), 'in-use panel');
      expect((await API('/pos/message-templates/templates/' + remId)).template.status === 'active', 'archived anyway!');
      await shot('06-mt-automation-protected');
      await page.click(tid('mt-close'));
      return `Appointment Reminders → "Reminder (library)" v1 · 0 messages · archive refused (1 automation) until a replacement is chosen`;
    }],
    ['mt: P0 in the REAL SMS Inbox — the template is filled in for the conversation\'s customer ("Hi Mai"), sent once, and the message records the template version', async () => {
      const seeded = await J('/__seeded'); await J('/__inbox?ready=1');
      await go('/tenant/communications/sms?thread=' + seeded.inboxMai, tid('comms-inbox')); await page.waitForSelector(tid('ci-conv-head')); await settle();
      await page.fill(tid('ci-text'), ''); await page.click(tid('ci-templates')); await page.waitForSelector(tid('ci-tpl'));
      await page.locator(tid('ci-tpl')).filter({ hasText: 'Appointment confirmation' }).first().click(); await settle();
      const draft = await page.inputValue(tid('ci-text'));
      expect(/^Hi Mai, your appointment at Pilot Nail Salon is confirmed\.$/.test(draft), 'draft ' + draft);
      const u0 = (await st()).inbox_usage;
      await page.click(tid('ci-send')); await page.waitForSelector(tid('ci-note')); await settle();
      const s = await st(); expect(s.inbox_usage === u0 + 1, 'usage ' + JSON.stringify(s));
      const h = await API('/pos/message-templates/usage?templateId=' + tplId + '&workflow=sms_inbox');
      expect(h.items[0].version === 2 && h.items[0].customerName === 'Mai Le' && h.items[0].renderedBody === draft, 'usage row ' + JSON.stringify(h.items[0]).slice(0, 200));
      await J('/__inbox?ready=0');
      await shot('07-mt-inbox-uses-template');
      return `"${draft}" sent once · usage row v2 · customer Mai Le · delivery ${h.items[0].delivery}`;
    }],
    ['mt: Template Usage History — search the customer by name (text NOT in the URL), the row opens the exact message snapshot', async () => {
      await open(); await page.locator(tid('mt-usage')).scrollIntoViewIfNeeded();
      await page.fill(tid('mt-usage-search'), 'mai le'); await page.waitForTimeout(700); await settle();
      const rows = await rowsText(tid('mt-usage-row')); expect(rows.length >= 1 && rows.every((r) => /Mai Le/.test(r)), 'rows ' + rows.join(' | '));
      expect(!/mai/i.test(new URL(page.url()).search), 'search text leaked into the URL');
      await page.locator(tid('mt-usage-row')).first().click(); await page.waitForSelector(tid('mt-message'));
      expect(/your appointment at Pilot Nail Salon is confirmed/.test(await T(tid('mt-message-text'))), 'snapshot');
      await shot('08-mt-usage-history');
      await page.keyboard.press('Escape'); await settle();
      return `${rows.length} message(s) for "mai le" · URL clean · snapshot shown`;
    }],
    ['mt: server search beyond page 1, numbered pages + 10/20/50, newest first, From/To calendar with an explicit date basis', async () => {
      await J('/__mt?bulk=24'); await open();
      expect(await firstRowName() === 'Bulk 24', 'newest first ' + await firstRowName());
      const p1 = await API('/pos/message-templates/templates'); expect(p1.totalPages >= 3, 'pages ' + p1.totalPages);
      await page.click(`${tid('mt-library')} .fk-pbtn[aria-label="Page 3"]`).catch(async () => page.locator(`${tid('mt-library')} .fk-pbtn.num`).nth(2).click()); await settle();
      expect(new URL(page.url()).searchParams.get('page') === '3', 'page 3 in URL');
      await page.fill(tid('mt-search'), 'note 7'); await page.waitForTimeout(600); await settle();
      const found = await rowsText(`${tid('mt-row')} .mt-name`); expect(found.join('|') === 'Bulk 07', 'search "note 7" → ' + found.join('|'));
      expect(!new URL(page.url()).searchParams.get('page'), 'search resets to page 1');
      await page.fill(tid('mt-search'), ''); await page.waitForTimeout(600); await settle();
      await page.selectOption(tid('mt-size'), '50'); await settle(); expect((await page.locator(tid('mt-row')).count()) === p1.totalItems, 'all on one page');
      await customRange(today, today); await settle();
      expect(/created date from/.test(await T(tid('mt-basis-active'))), 'basis label ' + await T(tid('mt-basis-active')));
      expect((await page.locator(tid('mt-row')).count()) === p1.totalItems, 'all created today');
      await shot('09-mt-search-pages-calendar');
      return `${p1.totalItems} templates · page 3 · "note 7" → Bulk 07 · 50/page · custom ${today}…${today} by created date`;
    }],
    ['mt: Vietnamese staff screen — labels in Vietnamese, the same numbers; a role without Communications access (Technician) can neither read nor write', async () => {
      // the language comes from the signed-in profile after the first paint: wait for it, then read (labels may be upper-cased by CSS)
      await J('/__lang?l=vi'); await open('?size=10');
      expect(await waitFor(async () => /Kiểm tra mẫu tin/i.test(await T(tid('mt-open-health')))), 'vi did not apply'); await settle(); await noJunk();
      const total = await kpiV('mt-kpi-total'); const body = await T(tid('message-templates'));
      expect(/Kiểm tra mẫu tin/i.test(body) && /Đã dùng tháng này/i.test(body) && /Lịch sử dùng mẫu/i.test(body) && /Kết nối tự động/i.test(body), 'vi labels ' + body.slice(0, 160));
      await J('/__lang?l=en'); await open('?size=10');
      expect(await waitFor(async () => /Check Templates/i.test(await T(tid('mt-open-health')))), 'en did not apply'); await settle();
      expect(await kpiV('mt-kpi-total') === total, 'numbers differ by language');
      await shot('10-mt-vietnamese');
      // the role policy (packages/permissions) decides who manages templates: OWNER / MANAGER / FRONT_DESK hold communications.manage
      await J('/__role?r=TECHNICIAN'); await page.goto(page.url(), { waitUntil: 'load' }); await settle();
      expect(await waitFor(async () => (await page.locator(tid('mt-forbidden')).count()) === 1 || /permission/i.test(await page.locator('body').innerText())), 'technician sees the screen');
      const base = new URL(page.url()).origin;
      const r = await fetch(base + '/api/v1/pos/message-templates/templates', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'x', channel: 'sms', body: 'y' }) });
      const l = await fetch(base + '/api/v1/pos/message-templates/templates');
      expect(r.status === 403 && l.status === 403, `technician POST ${r.status} GET ${l.status}`);
      await J('/__role?r=OWNER');
      return `VI labels · same total ${total} · Technician: no screen, GET 403, POST 403 (Front Desk holds communications.manage by the role policy)`;
    }],
    ['mt: Check Templates — read-only findings (sender facts, the binding, legacy [name]) — nothing sent; fits 1920×945 · 1536×864 · 1440×900 · 1366×768 · 1280×720 with no sideways scroll', async () => {
      const n0 = (await st()).notifications;
      await open(); expect(await waitFor(async () => /Check Templates/i.test(await T(tid('mt-open-health')))), 'en did not apply');
      await page.click(tid('mt-open-health')); await page.waitForSelector(tid('mt-health-list')); await settle();
      const h = await T(tid('mt-health-list'));
      expect(/SMS sender/.test(h) && /Automation connection/.test(h) && /Old \[name\] placeholders/.test(h), 'findings ' + h.slice(0, 200));
      expect((await st()).notifications === n0, 'health check sent something');
      await shot('11-mt-health'); await page.keyboard.press('Escape');
      const sizes = [[1920, 945], [1536, 864], [1440, 900], [1366, 768], [1280, 720]]; const out = [];
      for (const [w, hh] of sizes) {
        await page.setViewportSize({ width: w, height: hh }); await open(); await page.waitForTimeout(300);
        const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        expect(over <= 1, `${w}x${hh} sideways overflow ${over}px`);
        await page.screenshot({ path: `tooling/catalog-one-screen/results/mt-e2e/mt-${w}x${hh}.png` }); out.push(`${w}×${hh}`);
      }
      await page.setViewportSize({ width: 1920, height: 945 });
      return `health ok, 0 sent · ${out.join(', ')} fit`;
    }],
  ];
};
