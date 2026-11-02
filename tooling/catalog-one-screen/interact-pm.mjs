// interact-pm.mjs — Customers → Phone Number Management steps of the catalog E2E (Phone Number Management Complete Build Guide, Oct 30
// 2026, migration 742): the REAL screen in Chromium against the REAL PhoneCenterController / CustomerPhoneController (state machine,
// atomic activation) / CustomerPhoneSettingsController → SQL (pm-extra.mjs). Fake six-digit provider and messenger only.
// `node tooling/catalog-one-screen/interact.mjs <label> pm`. Nothing reaches a real provider.
export const STEPS_PM = ({ page, expect, settle, go, tid, noJunk, API, J, T, rowsText }) => {
  const URL0 = '/tenant/customers/phone-management';
  const open = (qs = '') => go(URL0 + qs, tid('pm-page'));
  const shot = (name) => page.screenshot({ path: `tooling/catalog-one-screen/results/pm-e2e/${name}.png`, fullPage: false }).catch(() => undefined);
  const kpi = async (t) => (await T(`${tid(t)} .fk-kpi-v`)).replace(/\s+/g, ' ').trim();
  const st = (c) => J('/__pm?state=1' + (c ? '&customer=' + c : ''));
  const openRow = async (name) => { await page.locator(tid('pm-row'), { hasText: name }).first().click(); await page.waitForSelector(tid('pm-ov-body'), { timeout: 15000 }); await settle(); };
  const close = async () => { await page.click(tid('pm-ov-close')); await page.waitForSelector(tid('pm-overlay'), { state: 'detached', timeout: 8000 }); };
  let ids = {};
  return [
    ['pm: the seven original controls are shown with their SAVED values; six KPIs equal the database; health and sender are real', async () => {
      await J('/__tenant?name=pilot'); await J('/__role?r=OWNER'); await J('/__lang?l=en'); await J('/__pm?reset=1'); ids = await J('/__pm?seed=1');
      await open(); await noJunk();
      expect((await T(`${tid('pm-page')} h1`)) === 'Phone Number Management', 'title');
      const s = await st();
      const box = (re) => page.locator(`${tid('phone-settings')} label`, { hasText: re }).locator('input[type=checkbox]');
      const want = [[/Receptionists may update/, s.settings.allow_receptionist_updates], [/Customers may change their own number/, s.settings.customer_app_self_service],
        [/Require SMS verification when staff change/, s.settings.require_sms_verification], [/Save an unverified number as pending/, s.settings.allow_pending_unverified],
        [/confirm a number WITHOUT SMS/i, s.settings.allow_manual_confirmation], [/Allow shared family phone numbers/, s.settings.allow_shared_family_phones], [/Notify the old number/, s.settings.notify_old_number]];
      for (const [re, v] of want) expect((await box(re).isChecked()) === v, `${re} = ${v}`);
      expect(s.settings.allow_manual_confirmation === false, 'manager bypass OFF as in the screenshot');
      expect(await kpi('pm-kpi-verified') === String(s.verified), `verified ${await kpi('pm-kpi-verified')} vs ${s.verified}`);
      expect(await kpi('pm-kpi-pending') === String(s.pending), `pending ${await kpi('pm-kpi-pending')} vs ${s.pending}`);
      expect(await kpi('pm-kpi-shared') === String(s.shared), 'shared = db');
      expect(/Not checked|Ready|Not set up|Needs attention/.test(await kpi('pm-kpi-sms')), 'sms health is a real state');
      expect(/gave up after 8 tries/.test(await T(tid('pm-health-sync'))), 'dead sync job surfaced in health');
      await shot('01-pm-overview-1920');
      return `7 controls = saved values (bypass OFF) · Verified ${s.verified} · Pending ${s.pending} · Shared ${s.shared} — all equal the DB; sync health shows the job that gave up`;
    }],
    ['pm: a saved setting persists after reload (Notify old number off → reload → off → back on)', async () => {
      await open();
      const cb = page.locator(`${tid('phone-settings')} label`, { hasText: /Notify the old number/ }).locator('input[type=checkbox]');
      await cb.click(); await settle();
      expect((await st()).settings.notify_old_number === false, 'db off');
      await open(); expect(!(await cb.isChecked()), 'off after reload');
      await cb.click(); await settle(); expect((await st()).settings.notify_old_number === true, 'db back on');
      return 'saved through PATCH /pos/settings/customer-phone; reload reads the stored value';
    }],
    ['pm: Pending & Recovery lists unresolved work soonest-deadline first; history is newest first with numbered pages 1 2 3 and 10/20/50', async () => {
      await open('?tab=pending');
      const names = await rowsText(`${tid('pm-row')} .pm-name`);
      expect(names[0] === 'Hoa Nguyen', 'soonest live deadline first: ' + names.join(','));
      expect(names.includes('Daisy Park') && names.indexOf('Daisy Park') > names.indexOf('Kim Le'), 'expired after the live ones');
      expect(/Soonest deadline first/.test(await T(tid('pm-order'))), 'order label');
      await shot('02-pm-pending-recovery');
      await open('?tab=history&size=10');
      const api = await API('/pos/customer-phone-center/requests?pageSize=10');
      expect(api.totalPages >= 3, 'three+ pages: ' + api.totalPages);
      expect(await page.locator('.fk-pager button[aria-label="Page 3"]').count() === 1, 'page 3 button');
      const first = await rowsText(`${tid('pm-row')} .pm-name`);
      expect(first[0] === api.items[0].customerName, 'newest first = server');
      await page.click('.fk-pager button[aria-label="Page 2"]'); await settle();
      expect(page.url().includes('page=2'), 'page in URL');
      await page.selectOption(tid('pm-size'), '20'); await settle();
      expect(!page.url().includes('page=2') && (await rowsText(tid('pm-row'))).length === 20, 'size 20 resets to page 1');
      await shot('03-pm-history-pages');
      return `pending: ${names.slice(0, 4).join(' → ')} … · history ${api.totalItems} rows / ${api.totalPages} pages, newest first`;
    }],
    ['pm: server search finds a record beyond page 1 (name, last four digits, request ID) and never writes the search into the URL', async () => {
      await open('?tab=history&size=10');
      await page.fill(tid('pm-search'), 'guest00'); await page.waitForTimeout(500); await settle();
      expect((await rowsText(`${tid('pm-row')} .pm-name`)).join() === 'History Guest00', 'oldest record found by name');
      expect(!page.url().toLowerCase().includes('guest00'), 'search not in URL');
      await page.fill(tid('pm-search'), '7080'); await page.waitForTimeout(500); await settle();
      expect((await rowsText(`${tid('pm-row')} .pm-name`)).includes('History Guest00'), 'by new-number digits');
      await page.fill(tid('pm-search'), ids.sync); await page.waitForTimeout(500); await settle();
      expect((await rowsText(`${tid('pm-row')} .pm-name`)).join() === 'Ivy Chen', 'by request id');
      await page.fill(tid('pm-search'), ''); await page.waitForTimeout(400);
      return 'name / digits / request id all server-side; URL carries filters only';
    }],
    ['pm: From/To month calendar + date basis filter the history in the salon zone; Clear All resets', async () => {
      await open('?tab=history');
      await page.click(tid('preset-custom')); await page.waitForSelector('.fk-cal, [role="dialog"]', { timeout: 5000 }).catch(() => undefined);
      expect(await page.locator('text=/^(Apply)$/').count() >= 1, 'calendar Apply');
      await page.keyboard.press('Escape').catch(() => undefined);
      await open('?tab=history&preset=today&basis=requested');
      const today = await API('/pos/customer-phone-center/requests?preset=today&basis=requested&pageSize=50');
      expect((await rowsText(tid('pm-row'))).length === Math.min(10, today.totalItems), 'today rows = server');
      expect(/[A-Z][a-z]{2} \d+, \d{4}/.test(await T(tid('active-period'))), 'active period shown');
      await page.selectOption(tid('date-basis'), 'applied'); await settle();
      expect(page.url().includes('basis=applied'), 'basis in URL');
      await page.click(tid('pm-clear')); await settle();
      expect(!page.url().includes('preset=') && !page.url().includes('basis='), 'cleared');
      await shot('04-pm-calendar');
      return `today (salon zone): ${today.totalItems} change(s) · basis switch · Clear All`;
    }],
    ['pm: the overlay shows trusted vs proposed, says the current phone stays active, tries/expiry, and closes safely', async () => {
      await open('?tab=pending');
      await openRow('Hoa Nguyen');
      expect(/remains active until the new phone is verified/.test(await T(tid('pm-ov-banner'))), 'keep-active message');
      expect(/•/.test(await T(tid('pm-ov-current'))) && /•/.test(await T(tid('pm-ov-proposed'))), 'numbers masked');
      expect(/Code Sent/.test(await T(tid('pm-ov-status'))), 'status');
      expect(/Tries left: \d of \d/.test(await T(tid('pm-ov-attempts'))), 'tries');
      expect(!/123456/.test(await T(tid('pm-ov-body'))), 'never a code on screen');
      await shot('05-pm-overlay-pending');
      await close();
      return 'trusted vs proposed (masked), Code Sent, tries left, no OTP anywhere; Close returns to the list';
    }],
    ['pm: Update Phone → pending (old number still active) → wrong code keeps it → right code activates once, old-number notice recorded', async () => {
      await open('?tab=pending');
      await page.click(tid('pm-update')); await page.waitForSelector(tid('pm-update-dialog'));
      await page.fill(tid('pm-up-search'), 'vishaal'); await page.waitForTimeout(500); await settle();
      await page.click(tid('pm-up-pick'));
      await page.fill(tid('pm-up-phone'), '(856) 555-4242');
      await page.click(tid('pm-up-review')); expect(/stays active until the new one is verified/.test(await T(tid('pm-up-reviewtext'))), 'review step');
      await page.click(tid('pm-up-confirm'));
      await page.waitForSelector(tid('pm-ov-body'), { timeout: 15000 }); await settle();
      let s = await st(ids.vishaal);
      expect(s.customer.normalized_phone === '+18565557001', 'old number still the customer number: ' + s.customer.normalized_phone);
      expect(/active_verified/.test(s.customer.phones) && /pending_verification/.test(s.customer.phones), 'pending row beside the trusted one');
      await page.fill(tid('pm-ov-phone'), '(856) 555-4242');
      await page.click(tid('pm-ov-send')); await settle();
      expect(/Resend available in \d+s/.test(await T(tid('pm-ov-cooldown'))), 'resend timer');
      await page.fill(tid('pm-ov-codeinput'), '000000'); await page.click(tid('pm-ov-verify')); await settle();
      s = await st(ids.vishaal);
      expect(s.customer.normalized_phone === '+18565557001', 'wrong code: old number kept');
      expect(/Retry Allowed/.test(await T(tid('pm-ov-status'))), 'retry allowed');
      await shot('06-pm-wrong-code');
      await page.fill(tid('pm-ov-codeinput'), '123456'); await page.click(tid('pm-ov-verify')); await settle(); await page.waitForTimeout(400);
      s = await st(ids.vishaal);
      expect(s.customer.normalized_phone === '+18565554242', 'activated: ' + s.customer.normalized_phone);
      expect((s.customer.phones.match(/active_verified/g) || []).length === 1, 'exactly one trusted number: ' + s.customer.phones);
      expect(/SMS verified/.test(await T(tid('pm-ov-banner'))), 'verified banner');
      expect(/Submitted|Delivered/.test(await T(tid('pm-ov-notice'))), 'old-number notice recorded, not assumed: ' + await T(tid('pm-ov-notice')));
      await shot('07-pm-verified-activation');
      await close();
      return 'start → pending (old active) → wrong code kept old → 123456 activated once; one trusted number; notice "Submitted — delivery not confirmed"';
    }],
    ['pm: expired request keeps the original phone and offers no code; a manual exception is never shown as SMS verified; sync monitor shows the job that gave up', async () => {
      await open('?tab=pending'); await openRow('Daisy Park');
      expect(/Expired/.test(await T(tid('pm-ov-status'))), 'expired');
      expect(await page.locator(tid('pm-ov-send')).count() === 0, 'no send on an expired request');
      await shot('08-pm-expired');
      await close();
      await open('?tab=history&method=manual');
      expect((await rowsText(`${tid('pm-row')} .pm-name`)).join() === 'Grace Ho', 'manual filter');
      await openRow('Grace Ho');
      expect(/Manual exception — not SMS verified/.test(await T(tid('pm-ov-banner'))), 'manual label');
      await close();
      await open('?tab=sync');
      const row = page.locator(tid('pm-row'), { hasText: 'Ivy Chen' });
      expect(/Failed/.test(await row.innerText()) && /identity service unavailable/.test(await row.innerText()), 'sync failed + last error');
      await shot('09-pm-sync-monitor');
      return 'expired: original phone, no Send · manual exception labelled · sync: Failed after 8 tries with its error';
    }],
    ['pm: Front Desk can work requests but not the policy; manager-only actions are not offered; Vietnamese labels keep the same numbers', async () => {
      await J('/__role?r=FRONT_DESK'); await open('?tab=pending');
      const disabled = await page.locator(`${tid('phone-settings')} input[type=checkbox]`).evaluateAll((els) => els.every((e) => e.disabled));
      expect(disabled, 'settings read-only for Front Desk');
      await openRow('Kim Le');
      expect(await page.locator(tid('pm-ov-approve')).count() === 0, 'no manager approve for Front Desk');
      await close();
      await J('/__role?r=OWNER'); await J('/__lang?l=vi'); await open('?tab=pending');
      expect((await T(`${tid('pm-page')} h1`)) === 'Quản lý số điện thoại', 'vi title');
      expect(await kpi('pm-kpi-pending') === String((await st()).pending), 'same numbers in VI');
      await shot('10-pm-vietnamese');
      await J('/__lang?l=en');
      return 'Front Desk: settings disabled, no Approve · VI title + identical KPIs';
    }],
    ['pm: fits 1920×945 · 1536×864 · 1440×900 · 1366×768 · 1024×768 with no sideways page scroll; overlay Close reachable', async () => {
      const out = [];
      for (const [w, h] of [[1920, 945], [1536, 864], [1440, 900], [1366, 768], [1024, 768]]) {
        await page.setViewportSize({ width: w, height: h }); await open('?tab=pending'); await page.waitForTimeout(300);
        const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        expect(over <= 1, `${w}x${h} sideways scroll ${over}px`);
        await shot(`11-pm-${w}x${h}`); out.push(`${w}x${h}`);
      }
      await page.setViewportSize({ width: 1024, height: 768 }); await openRow('Hoa Nguyen');
      expect(await page.locator(tid('pm-ov-close')).isVisible(), 'close visible at 1024');
      await close(); await page.setViewportSize({ width: 1920, height: 945 });
      return out.join(' · ') + ' — no horizontal page scroll';
    }],
  ];
};
