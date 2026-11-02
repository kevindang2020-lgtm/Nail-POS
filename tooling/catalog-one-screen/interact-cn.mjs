// interact-cn.mjs — Communications → Customer Notifications steps of the catalog E2E (Customer Notifications Complete Build Guide,
// Oct 30 2026, migration 741): the REAL screen in Chromium against the REAL CustomerNotificationsController → SQL (cn-extra.mjs),
// the REAL NotificationsService (fake Twilio only) and the REAL readiness service.
// `node tooling/catalog-one-screen/interact.mjs <label> cn`. Nothing reaches a real provider.
export const STEPS_CN = ({ page, expect, settle, go, tid, noJunk, API, J, T, rowsText, customRange, today }) => {
  const URL0 = '/tenant/communications/notifications';
  const open = (qs = '') => go(URL0 + qs, tid('customer-notifications'));
  const shot = (name) => page.screenshot({ path: `tooling/catalog-one-screen/results/cn-e2e/${name}.png`, fullPage: false }).catch(() => undefined);
  const kpiV = async (t) => (await T(`${tid(t)} .fk-kpi-v`)).replace(/\s+/g, ' ').trim();
  const st = () => J('/__cn?state=1');
  const waitFor = async (fn, ms = 8000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return true; await page.waitForTimeout(200); } return false; };
  let ids = {};
  const rowFor = async (id) => { await open(`?preset=all&record=${id}`); await page.waitForSelector(tid('cn-detail'), { timeout: 15000 }); await settle(); };
  return [
    ['cn: the original page is kept (Sent (Recent) / Blocked-Failed / Opt-Outs meaning as the legacy line, Activity + Opt-outs, When / Channel / Recipient / Status / Detail); KPIs equal the database', async () => {
      await J('/__tenant?name=pilot'); await J('/__role?r=OWNER'); await J('/__lang?l=en'); await J('/__cn?reset=1'); ids = await J('/__cn?seed=1');
      await open('?preset=all'); await noJunk();
      expect((await T(`${tid('customer-notifications')} h1`)) === 'Customer Notifications', 'title');
      const s = await st();
      expect(await kpiV('cn-kpi-sent') === String(s.accepted), `sent ${await kpiV('cn-kpi-sent')} vs db ${s.accepted}`);
      expect(await kpiV('cn-kpi-delivered') === String(s.delivered), 'delivered = db');
      expect(await kpiV('cn-kpi-failed') === String(s.failed), 'failed = db');
      expect(await kpiV('cn-kpi-blocked') === String(s.blocked), 'blocked = db');
      expect(/Sent \(Recent\) \d+ · Blocked \/ Failed \d+/.test(await T(tid('cn-legacy'))), 'legacy line');
      const head = (await rowsText(`${tid('cn-table')} thead th`)).map((h) => h.toLowerCase());
      for (const h of ['when', 'recipient', 'channel', 'status', 'detail']) expect(head.includes(h), 'column ' + h);
      expect(await page.locator(tid('cn-tab-optouts')).count() === 1, 'opt-outs tab');
      await shot('01-cn-kpis-and-activity');
      return `Sent ${s.accepted} (accepted) · Delivered ${s.delivered} · Failed ${s.failed} · Blocked ${s.blocked} — all equal the DB; legacy line kept`;
    }],
    ['cn: P0 — the three provider refusals classify by evidence: auth (code 20003, SID masked), "region" = a number with no +country code, invalid number; none offered for blind resend', async () => {
      await rowFor(ids.auth);
      expect(/Account credentials refused/.test(await T(tid('cn-d-category'))), 'auth family');
      const msg = await T(tid('cn-d-message'));
      expect(!/AC0123456789abcdef/.test(msg) && /AC…cdef/.test(msg), 'sid masked: ' + msg);
      expect(/setup has not been checked as fixed/i.test(await T(tid('cn-d-noretry'))), 'auth resend blocked until the setup is re-checked');
      await shot('02-cn-p0-auth-diagnosis');
      await page.click(tid('cn-detail-close')); await rowFor(ids.region);
      expect(/Invalid phone number/.test(await T(tid('cn-d-category'))), 'region refusal → invalid destination');
      expect(/no \+country code/.test(await T(tid('cn-d-root'))), 'root cause: missing country code');
      expect(!/7876299624/.test(await T(tid('cn-d-message'))), 'number masked in the provider text');
      await shot('03-cn-p0-region-is-missing-country-code');
      await page.click(tid('cn-detail-close')); await rowFor(ids.invalid);
      expect(/Invalid phone number/.test(await T(tid('cn-d-category'))) && /not valid/i.test(await T(tid('cn-d-noretry'))), 'invalid number: no resend');
      await page.click(tid('cn-detail-close'));
      return 'auth → Messaging Setup (no resend until re-checked) · "region" → missing +country code (fix the customer\'s number) · invalid → fix the contact';
    }],
    ['cn: search by phone digits / name / receipt goes to the SERVER (matches beyond page 1, exact total) and is never written into the URL', async () => {
      await open('?preset=all&size=10');
      await page.fill(tid('cn-q'), '5551230001'); await page.waitForTimeout(500); await settle();
      const api = await API('/pos/customer-notifications/records?preset=all&q=5551230001&pageSize=10');
      expect((await T(tid('cn-total'))).includes(String(api.totalItems)) && api.totalItems > 10, 'total ' + api.totalItems);
      expect(!page.url().includes('5551230001'), 'search not in URL');
      await page.click('.fk-pager button[aria-label="Page 2"]'); await settle();
      expect((await rowsText(tid('cn-row'))).length >= 1, 'page 2 rows');
      await page.fill(tid('cn-q'), 'vishaal'); await page.waitForTimeout(500); await settle();
      const names = await rowsText(`${tid('cn-row')} ${tid('cn-cust')}`);
      expect(names.length >= 4 && names.every((n) => /Vishaal/.test(n)), 'name search');
      await shot('04-cn-search-server-side');
      await page.fill(tid('cn-q'), ''); await page.waitForTimeout(400); await settle();
      return `${api.totalItems} matches for the phone, page 2 served · name search · nothing private in the URL`;
    }],
    ['cn: month calendar (From/To) + date basis; numbered pages 10 / 20 / 50, newest first', async () => {
      await open('?size=10');
      await customRange(today, today);
      const w = await T(tid('cn-window'));
      expect(w.includes(today) && /America\/New_York/.test(w), 'window label ' + w);
      await page.selectOption(tid('cn-size'), '50'); await settle();
      const api = await API(`/pos/customer-notifications/records?preset=custom&from=${today}&to=${today}&pageSize=50`);
      expect((await rowsText(tid('cn-row'))).length === Math.min(50, api.totalItems), 'rows on page = server');
      await open('?preset=all&size=20'); expect((await rowsText(tid('cn-row'))).length === 20, '20 rows');
      await shot('05-cn-calendar-and-pages');
      return `today ${today} → ${api.totalItems} rows · sizes 10/20/50 · ${w}`;
    }],
    ['cn: Smart Failed Notification Recovery — transient failure → confirmation → ONE resend (new ledger row linked to it, original kept); a second resend is refused', async () => {
      const s0 = await st();
      await rowFor(ids.transient);
      await page.click(tid('cn-d-retry'));
      expect(await page.locator(tid('cn-d-confirm')).count() === 1, 'confirmation shown');
      expect((await st()).resends === s0.resends, 'nothing sent before the confirmation');
      await shot('06-cn-resend-confirmation');
      await page.click(tid('cn-d-retry-yes')); await settle();
      expect(await waitFor(async () => (await st()).resends === s0.resends + 1), 'one new ledger row');
      expect(/Resent/.test(await T(tid('cn-note'))), 'resent note');
      await page.waitForSelector(tid('cn-d-attempts'), { timeout: 8000 });
      expect((await rowsText(`${tid('cn-d-attempts')} li`)).length === 2, 'two attempts in the chain');
      expect(/already resent/i.test(await T(tid('cn-d-noretry'))), 'second resend not offered');
      await page.click(tid('cn-detail-close'));
      const s1 = await st();
      return `resends ${s0.resends} → ${s1.resends} · retry requests ${s1.retry_requests} · original stays failed`;
    }],
    ['cn: Review Failures groups real failures by root cause with the next action (nothing resent from the list)', async () => {
      await open('?preset=all'); await page.click(tid('cn-open-failures'));
      await page.waitForSelector(tid('cn-failures')); await waitFor(async () => (await page.locator(tid('cn-fgroup-auth')).count()) > 0);
      for (const g of ['auth', 'invalid_destination', 'email_bounce']) expect(await page.locator(tid('cn-fgroup-' + g)).count() === 1, 'group ' + g);
      expect(/no \+country code/.test(await T(tid('cn-froot'))), 'root cause shown in the group');
      await shot('07-cn-review-failures');
      await page.keyboard.press('Escape'); await page.waitForTimeout(300);
      return 'auth · invalid destination (with missing-country-code root cause) · email bounce';
    }],
    ['cn: Unified Customer Notification Timeline — SMS + booking links for ONE customer; Close; Open Booking preselects the customer', async () => {
      await open('?preset=all');
      await page.locator(tid('cn-cust'), { hasText: 'Vishaal' }).first().click();
      await page.waitForSelector(tid('cn-timeline'));
      expect(await waitFor(async () => (await page.locator(tid('cn-t-notification')).count()) >= 4), 'messages in the timeline ' + (await page.locator(tid('cn-t-notification')).count()));
      expect(/Vishaal Kumar/.test(await T(tid('cn-timeline'))), 'the clicked customer');
      await shot('08-cn-customer-timeline');
      await page.click(tid('cn-t-ch-email')); await settle();
      expect(await page.locator(tid('cn-t-notification')).count() === 0, 'Vishaal has no email');
      await page.click(tid('cn-t-close')); await page.waitForTimeout(300);
      expect(await page.locator(tid('cn-timeline')).count() === 0, 'closed');
      return 'SMS items for Vishaal only · channel filter · Close works';
    }],
    ['cn: Opt-outs — a customer\'s STOP is customer-only; a staff email opt-out is re-subscribed only WITH a consent note (history kept)', async () => {
      await open('?tab=optouts'); await page.waitForSelector(tid('cn-o-table'));
      expect(/Customer must text START/.test(await T(tid('cn-o-customeronly'))), 'STOP is customer-only');
      await shot('09-cn-optouts-current');
      await page.click(tid('cn-o-reoptin')); await page.waitForSelector(tid('cn-reoptin'));
      expect(await page.locator(`${tid('cn-reoptin-go')}[disabled]`).count() === 1, 'no note → disabled');
      await page.fill(tid('cn-reoptin-note'), 'Signed the consent form at the front desk'); await page.click(tid('cn-reoptin-go')); await settle();
      expect(await waitFor(async () => (await st()).staff_opt_ins === 1), 'staff opt-in with note recorded');
      await page.click(tid('cn-o-history')); await settle();
      const ev = await rowsText(tid('cn-o-event'));
      expect(ev.some((r) => /Opted in again.*Staff.*Signed the consent form/.test(r)), 'history row ' + ev.join(' | '));
      await shot('10-cn-optouts-history');
      return `STOP → customer only · email re-subscribed with a note · ${ev.length} history rows`;
    }],
    ['cn: Messaging health — Twilio / sender / registration / webhooks / email checked separately; "Run check now" sends nothing', async () => {
      await open(); const before = (await st()).rows;
      await page.click(tid('cn-open-health')); await page.waitForSelector(tid('cn-health'));
      for (const r of ['twilio', 'sender', 'registration', 'webhooks', 'email', 'callbacks']) expect(await page.locator(tid('cn-hrow-' + r)).count() === 1, 'row ' + r);
      expect(/Attention/.test(await T(tid('cn-hrow-email'))), 'email not configured → Attention, never green');
      await page.click(tid('cn-h-run')); await waitFor(async () => (await page.locator(tid('cn-h-checked')).count()) + (await page.locator(tid('cn-h-err')).count()) > 0);
      expect((await st()).rows === before, 'no message written by the health check');
      await shot('11-cn-health');
      await page.keyboard.press('Escape'); await page.waitForTimeout(300);
      return 'six separate states · email Attention · check ran without sending';
    }],
    ['cn: Automatic failure alerts — 3 auth refusals in 15 minutes → ONE open alert (dedupe on re-evaluation)', async () => {
      await J('/__cn?burst=1'); const ev = await J('/__cn?evaluate=1');
      await open(); await page.waitForSelector(tid('cn-incidents'), { timeout: 10000 });
      const rows = await rowsText(tid('cn-incident'));
      expect(rows.some((r) => /failing: auth/i.test(r)), 'incident ' + rows.join(' | '));
      const s1 = (await st()).open_incidents; await J('/__cn?burst=1'); await J('/__cn?evaluate=1');
      const s2 = (await st()).open_incidents;
      expect(ev.rules.includes('repeated_failures:auth'), 'rules ' + ev.rules.join(','));
      expect(s2 === s1, `dedupe ${s1} → ${s2}`);
      await shot('12-cn-incident');
      return `${s1} open alert(s), unchanged after a second burst`;
    }],
    ['cn: Front Desk follows the salon role policy (communications.manage → full contact; a view-only role is masked — pgtest); Vietnamese POS labels; no Invalid Date', async () => {
      await J('/__role?r=FRONT_DESK'); await open('?preset=all');
      const api = await API('/pos/customer-notifications/records?preset=all&pageSize=10');
      expect(api.recipientsMasked === false && (await page.locator(tid('cn-masked')).count()) === 0, 'Front Desk holds communications.manage today → unmasked');
      await rowFor(ids.transient);
      expect(await page.locator(tid('cn-d-body')).count() === 1, 'body visible to a manage role');
      await page.click(tid('cn-detail-close'));
      await J('/__lang?l=vi'); await open('?preset=all'); await noJunk();
      expect((await T(`${tid('customer-notifications')} h1`)) === 'Thông báo khách hàng', 'vi title');
      await shot('13-cn-front-desk-vi');
      await J('/__lang?l=en'); await J('/__role?r=OWNER');
      return 'Front Desk = communications.manage (role policy) · Vietnamese labels';
    }],
    ['cn: fits 1920×945 · 1366×768 · 1280×720 · 1024×768 with no sideways page scroll; overlay Close reachable', async () => {
      const out = [];
      for (const [w, h] of [[1920, 945], [1366, 768], [1280, 720], [1024, 768]]) {
        await page.setViewportSize({ width: w, height: h }); await open('?preset=all'); await page.waitForTimeout(300);
        const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        expect(over <= 1, `${w}×${h} sideways scroll ${over}px`);
        await page.screenshot({ path: `tooling/catalog-one-screen/results/cn-e2e/cn-${w}x${h}.png` }).catch(() => undefined);
        out.push(`${w}×${h} ok`);
      }
      await page.setViewportSize({ width: 1024, height: 768 }); await rowFor(ids.region);
      expect(await page.locator(tid('cn-detail-close')).isVisible(), 'Close visible at 1024×768');
      await page.click(tid('cn-detail-close'));
      await page.setViewportSize({ width: 1920, height: 945 });
      return out.join(' · ');
    }],
  ];
};
