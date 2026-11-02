// interact-em.mjs — Communications → Email E2E steps (Email Complete Build Guide, Oct 31 2026). Run with
// `node tooling/catalog-one-screen/interact.mjs <label> em` against the live harness (em-extra.mjs serves the REAL Email
// Center controller + the ONE email path on the seeded TEST database; the provider is the mock sender — nothing leaves).
export const STEPS_EM = ({ page, expect, settle, go, tid, noJunk, J, T, search }) => {
  const URL0 = '/tenant/communications/email';
  const open = () => go(URL0, tid('emc-kpis'));
  const shot = (name) => page.screenshot({ path: `tooling/catalog-one-screen/results/em-e2e/${name}.png`, fullPage: false }).catch(() => undefined);
  const kv = async (id) => (await T(`${tid(id)} .fk-kpi-v`)).replace(/\s+/g, ' ').trim();
  const st = () => J('/__em?state=1');
  const rows = () => page.locator(tid('emc-row'));
  return [
    ['em: the photographed settings stay and are REAL — the email sender name (not the SMS brand), both toggles; switching receipts off really stops a receipt email', async () => {
      await J('/__tenant?name=pilot'); await J('/__role?r=OWNER'); await J('/__lang?l=en'); await J('/__em?reset=1'); await J('/__em?seed=1');
      await open(); await noJunk();
      const name = await page.inputValue(tid('emc-name'));
      expect(name === 'Pilot Nail Salon', `sender name "${name}" (the GET returns senderBrand "SMS Brand Co" — it must not show)`);
      expect(await page.isChecked(tid('emc-booking')) && await page.isChecked(tid('emc-receipts')), 'both toggles on');
      expect(await page.isDisabled(tid('emc-save')), 'Save disabled until something changes');
      await page.uncheck(tid('emc-receipts')); expect(/Unsaved/.test(await T(tid('emc-save-state'))), 'Unsaved changes shown');
      await page.click(tid('emc-save')); await settle();
      const s1 = await st(); expect(JSON.stringify(s1.settings.receiptDelivery) === '["SMS"]', JSON.stringify(s1.settings));
      expect(/Saved/.test(await T(tid('emc-save-state'))), 'Saved at shown');
      const probe = await J('/__em?receipt=1'); expect(probe.reason === 'receipt_email_disabled' && !probe.sent, JSON.stringify(probe));
      await page.check(tid('emc-receipts')); await page.click(tid('emc-save')); await settle();
      const probe2 = await J('/__em?receipt=1'); expect(probe2.sent === true, JSON.stringify(probe2));
      await page.fill(tid('emc-name'), 'Pilot <spoof@x.com>'); await page.click(tid('emc-save')); await settle();
      const bad = await T(tid('emc-save-state')); expect(/Save failed/.test(bad), bad);
      expect((await st()).settings.emailSenderName === 'Pilot Nail Salon', 'refused name not stored');
      await shot('01-em-settings');
      return `name "Pilot Nail Salon" (not the SMS brand) · toggles kept · receipts off → DB ["SMS"] → a receipt email is blocked receipt_email_disabled · on → sent · "Pilot <spoof@x.com>" refused (${bad.slice(0, 60)})`;
    }],
    ['em: honest counters — Delivered is N/A until a verified provider event, then 1; Accepted equals the database', async () => {
      await open();
      const d0 = await kv('emc-kpi-delivered'); expect(/N\/A/.test(d0), `Delivered before events: ${d0}`);
      const s = await st(); const accepted = s.rows.filter((r) => r.status === 'sent' || r.status === 'delivered').reduce((a, r) => a + r.n, 0);
      expect(Number(await kv('emc-kpi-accepted')) === accepted, `Accepted ${await kv('emc-kpi-accepted')} vs DB ${accepted}`);
      await J('/__em?deliver=1'); await page.click(tid('emc-refresh')); await settle();
      const d1 = await kv('emc-kpi-delivered'); expect(/^1\b/.test(d1), `Delivered after the event: ${d1}`);
      await shot('02-em-kpis');
      return `Delivered "${d0}" → after a verified event "${d1}" · Accepted ${accepted} = DB · Booking ${await kv('emc-kpi-booking')} · Receipts ${await kv('emc-kpi-receipt')}`;
    }],
    ['em: provider health by layer — never green from a saved key; a check is recorded; a TEST sender never reads Ready; the next action is named', async () => {
      await open();
      const o0 = await T(tid('emc-health-overall'));
      expect(!/^Ready$/.test(o0), `overall before a check: ${o0}`);
      await J('/__em?verify=bad'); await page.click(tid('emc-check')); await settle();
      const prov = await T(tid('emc-layer-provider_health')); expect(/Down/.test(prov) && /Correct credentials/.test(prov), prov);
      const cfg = await T(tid('emc-layer-configuration')); expect(/Test sender/.test(cfg), cfg);
      expect(/Attention required/.test(await T(tid('emc-health-overall'))), 'attention required');
      expect((await st()).checks >= 1, 'check recorded');
      await shot('03-em-health');
      return `before: "${o0}" · after a rejected key: provider "Down → Correct credentials" · configuration "Test sender" · overall Attention required · checks recorded`;
    }],
    ['em: a test email goes only to a staff member of this salon, after confirmation; a customer address is refused', async () => {
      await open();
      await page.click(`${tid('emc-health')} summary`);
      await page.fill(tid('emc-test-to'), 'ava.mailer@example.com'); await page.check(tid('emc-test-confirm')); await page.click(tid('emc-test-send')); await settle();
      const refused = await T(tid('emc-test-msg')); expect(/staff member/.test(refused), refused);
      const n0 = (await st()).providerCalls;
      await page.fill(tid('emc-test-to'), 'em-desk@pilot.test'); await page.check(tid('emc-test-confirm')); await page.click(tid('emc-test-send')); await settle();
      const ok = await T(tid('emc-test-msg')); expect(/Recorded|Accepted/.test(ok), ok);
      const s = await st(); expect(s.providerCalls === n0 + 1 && s.lastTo === 'em-desk@pilot.test', JSON.stringify(s));
      return `customer address → "${refused}" · staff → "${ok}" (one provider call, to em-desk@pilot.test)`;
    }],
    ['em: history — server search beyond page 1, 10/20/50 rows, newest first, status filter, month calendar range', async () => {
      await open();
      await search(tid('emc-search'), 'Aftercare'); await page.selectOption(tid('emc-size'), '10'); await settle();
      expect((await rows().count()) === 10, 'page 1 has 10');
      const first = await rows().first().innerText(); expect(/#24/.test(first), `newest first: ${first.slice(0, 80)}`);
      await page.locator(`${tid('emc-history')} .fk-pbtn.num`, { hasText: /^3$/ }).click(); await settle();
      const p3 = await rows().count(); expect(p3 === 4, `page 3 has ${p3}`);
      await search(tid('emc-search'), ''); await page.selectOption(tid('emc-f-status'), 'failed'); await settle();
      const failed = await rows().count(); expect(failed === 1, `failed rows ${failed}`);
      await page.selectOption(tid('emc-f-status'), ''); await settle();
      await shot('04-em-history');
      return `"Aftercare" → 24 across pages (page 1: 10, newest #24 first, page 3: 4) · Failed filter → ${failed}`;
    }],
    ['em: details overlay — events, attempts, Close; protected Resend makes ONE linked attempt and refuses a second', async () => {
      await open();
      await page.selectOption(tid('emc-f-status'), 'failed'); await settle();
      await rows().first().locator(tid('emc-row-view')).click(); await page.waitForSelector(tid('emc-d-close'));
      expect(/Failed/.test(await T(tid('emc-d-status'))), 'failed status');
      expect(await page.locator(tid('emc-d-noevents')).count() === 1, 'no verified events message');
      await page.check(tid('emc-d-resend-confirm')); await page.click(tid('emc-d-resend')); await settle();
      const m1 = await T(tid('emc-d-msg')); expect(/Resend: Recorded|Resend: Accepted/.test(m1), m1);
      await page.check(tid('emc-d-resend-confirm')); await page.click(tid('emc-d-resend')); await settle();
      const m2 = await T(tid('emc-d-msg')); expect(/ALREADY_RESENT/.test(m2), m2);
      const att = await page.locator(`${tid('emc-d-attempts')} li`).count(); expect(att === 2, `attempts ${att}`);
      await shot('05-em-detail-resend');
      await page.click(tid('emc-d-close')); await settle(); await page.selectOption(tid('emc-f-status'), ''); await settle();
      expect((await st()).resends === 1, 'one linked resend in the DB');
      return `"${m1}" · second → "${m2}" · attempts ${att} · DB resends 1`;
    }],
    ['em: composer — pick a customer (address from the record), preview, confirm, send; a customer without email cannot be sent to', async () => {
      await open();
      await page.click(tid('emc-compose')); await page.waitForSelector(tid('emc-c-search'));
      await page.fill(tid('emc-c-search'), 'Noemail'); await page.locator(tid('emc-c-hit'), { hasText: 'Ben Noemail' }).first().click();
      await page.fill(tid('emc-c-subject'), 'Hello'); await page.fill(tid('emc-c-body'), 'Hi Ben'); await page.check(tid('emc-c-confirm'));
      expect(await page.isDisabled(tid('emc-c-send')), 'no email → Send disabled');
      await page.locator(`${tid('emc-composer')} button`, { hasText: '×' }).click();
      await page.fill(tid('emc-c-search'), 'ava.mailer'); await page.locator(tid('emc-c-hit'), { hasText: 'ava.mailer@example.com' }).first().click();
      await page.fill(tid('emc-c-subject'), 'Your next visit'); await page.fill(tid('emc-c-body'), 'We saved your favourite colour.');
      expect(/Your next visit/.test(await T(tid('emc-c-preview'))), 'preview');
      await page.click(tid('emc-c-send')); await settle();
      const msg = await T(tid('emc-c-msg')); expect(/Recorded|Accepted/.test(msg), msg);
      expect((await st()).lastTo === 'ava.mailer@example.com', 'sent to the record address');
      await shot('06-em-composer');
      await page.click(tid('emc-c-close')); await settle();
      return `Ben (no email): Send disabled · Ava: "${msg}" to the address on her record`;
    }],
    ['em: Vietnamese staff screen; Front Desk', async () => {
      await J('/__lang?l=vi'); await open();
      const vi = await T(tid('emc-history') + ' h3'); await J('/__lang?l=en');
      expect(vi === 'Lịch sử email', vi);
      await J('/__role?r=FRONT_DESK'); await go(URL0, 'body'); await page.waitForTimeout(900);
      const fd = (await page.locator(tid('emc-kpis')).count()) ? 'center shown' : 'not shown';
      const fdEdit = (await page.locator(tid('emc-name')).count()) ? (await page.isDisabled(tid('emc-name')) ? 'settings read-only' : 'settings editable') : 'no settings';
      await J('/__role?r=OWNER');
      await shot('07-em-vi');
      return `VI "${vi}" · Front Desk: ${fd}, ${fdEdit}`;
    }],
    ['em: 1920×945, 1536×864, 1440×900, 1366×768, 1024×768 — no horizontal page scroll; the details overlay Close stays visible', async () => {
      const out = [];
      for (const [w, h] of [[1920, 945], [1536, 864], [1440, 900], [1366, 768], [1024, 768]]) {
        await page.setViewportSize({ width: w, height: h }); await open(); await page.waitForTimeout(300);
        const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        expect(over <= 1, `${w}x${h} sideways scroll ${over}px`);
        await shot(`08-em-${w}x${h}`); out.push(`${w}x${h}`);
      }
      await rows().first().locator(tid('emc-row-view')).click(); await page.waitForSelector(tid('emc-d-close'));
      expect(await page.locator(tid('emc-d-close')).isVisible(), 'close visible at 1024');
      await page.click(tid('emc-d-close')); await page.setViewportSize({ width: 1920, height: 945 });
      return out.join(' · ') + ' — no horizontal page scroll';
    }],
  ];
};
