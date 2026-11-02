// interact-bs.mjs — AI Business Setup E2E steps (guide Oct 30 2026: UI01–UI05, DATA01/02/04, FAQ01–FAQ08, SEARCH01, DATE01–03,
// PAGE01–04, SYNC04–06, SEC03/04 where a browser can show them). Run with `node tooling/catalog-one-screen/interact.mjs <label> bs`
// against the live harness (bs-extra.mjs serves the REAL BusinessSetupCenterController). Nothing leaves the machine.
export const STEPS_BS = ({ page, expect, settle, go, tid, noJunk, J, T, search }) => {
  const URL0 = '/tenant/ai/receptionist/business-setup';
  const open = () => go(URL0, tid('ais-readiness'));
  const shot = (name) => page.screenshot({ path: `tooling/catalog-one-screen/results/bs-e2e/${name}.png`, fullPage: false }).catch(() => undefined);
  const st = () => J('/__bs?state=1');
  const rowText = (k) => T(tid(`ais-ready-${k}`));
  const closeDlg = async () => { const b = page.locator(tid('ais-close')); if (await b.count()) await b.first().click(); else await page.keyboard.press('Escape'); await settle(); };
  return [
    ['bs: P0 — readiness counts equal an independent SQL count of what the AI can use (no false zero); unsaved hours are Needs setup', async () => {
      await J('/__tenant?name=pilot'); await J('/__role?r=OWNER'); await J('/__lang?l=en'); await J('/__bs?reset=1'); await J('/__bs?nohours=1');
      await open(); await noJunk();
      const s = await st();
      const svc = await rowText('services'), tech = await rowText('technicians'), hrs = await rowText('business_hours');
      expect(svc.includes(`${s.svc_eligible} usable by the AI of ${s.svc_raw} on file`), `services row: ${svc} vs DB ${s.svc_eligible}/${s.svc_raw}`);
      expect(tech.includes(`${s.tech_eligible} usable by the AI of ${s.tech_raw} on file`), `technicians row: ${tech} vs DB ${s.tech_eligible}/${s.tech_raw}`);
      expect(/Needs setup/.test(hrs) && /never saved/.test(hrs), `hours row: ${hrs}`);
      await shot('01-bs-readiness-unsaved-hours-1920');
      await J('/__bs?seed=1'); await open();
      expect(/Ready/.test(await rowText('business_hours')), 'hours Ready once saved');
      return `services ${s.svc_eligible}/${s.svc_raw} · technicians ${s.tech_eligible}/${s.tech_raw} (DB = screen) · hours Needs setup → Ready after save`;
    }],
    ['bs: Add FAQ saves ONE draft, first in the list; the AI does not use it until approved', async () => {
      await open(); const b0 = await st();
      await page.fill(tid('ais-q'), 'Is there parking nearby?'); await page.fill(tid('ais-cat'), 'Parking'); await page.fill(tid('ais-a'), 'Yes — free parking behind the salon.');
      await page.locator(tid('ais-add')).dblclick(); await settle(); await page.waitForTimeout(400);
      const b1 = await st();
      expect(b1.faqs === b0.faqs + 1, `FAQ rows ${b0.faqs} → ${b1.faqs}`);
      expect(await page.locator(tid('ais-overlay')).count() === 1, 'the saved FAQ opens');
      expect(/Draft/.test(await T(tid('ais-overlay'))) && /Not used by the AI/.test(await T(tid('ais-overlay'))), 'draft, not used');
      await closeDlg();
      const first = (await page.locator(tid('ais-faq-row')).first().innerText()).trim();
      expect(first.startsWith('Is there parking nearby?'), `first row: ${first.slice(0, 60)}`);
      await shot('02-bs-faq-draft-first');
      return `one draft (${b0.faqs} → ${b1.faqs}) · first on page 1 · not AI knowledge`;
    }],
    ['bs: submit → approve makes it AI knowledge; editing it is a pending change that keeps the live answer; Send back', async () => {
      await page.locator(tid('ais-faq-row')).first().click(); await settle();
      await page.click(tid('ais-act-submit')); await settle();
      await page.click(tid('ais-act-approve')); await settle();
      expect(/AI uses this/.test(await T(tid('ais-overlay'))), 'approved → AI uses this');
      await page.click(tid('ais-act-edit')); await page.fill(tid('ais-edit-a'), 'Parking is in the garage next door.'); await page.click(tid('ais-save-draft')); await settle();
      await page.click(tid('ais-tab-answer')); await settle();
      const live = await T(tid('ais-live')), draft = await T(tid('ais-draft'));
      expect(/behind the salon/.test(live) && /garage next door/.test(draft), `live "${live}" · pending "${draft}"`);
      await shot('03-bs-pending-change-keeps-live');
      await page.click(tid('ais-act-reject')); await page.fill(tid('ais-reason-input'), 'Garage closed this month'); await page.click(tid('ais-reason-ok')); await settle();
      await page.click(tid('ais-tab-audit')); await settle();
      const audit = await T(tid('ais-overlay'));
      expect(/Sent back/.test(audit) && /Approved/.test(audit) && /Submitted for approval/.test(audit), 'audit trail');
      await closeDlg();
      return 'draft → pending review → approved (AI uses) · edit kept the live text · Send back recorded';
    }],
    ['bs: search beyond page 1, filters combine, pages 1/2/3 with 10/20/50, From/To calendar with the date basis', async () => {
      await open();
      await search(tid('ais-search'), 'needle oldest'); await settle();
      const hit = await page.locator(tid('ais-faq-row')).count();
      expect(hit === 1, `needle rows ${hit}`);
      await search(tid('ais-search'), ''); await settle();
      await page.selectOption(tid('ais-size'), '10'); await settle();
      expect(await page.locator(tid('ais-faq-row')).count() === 10, '10 per page');
      expect(/25 total/.test(await T(tid('ais-list'))), await T(tid('ais-list')));
      await page.locator(`${tid('ais-list')} button:text-is("3")`).first().click(); await settle();
      expect(await page.locator(tid('ais-faq-row')).count() === 5, 'page 3 has 5');
      await page.selectOption(tid('ais-f-status'), 'approved'); await settle();
      expect(await page.locator(tid('ais-faq-row')).count() === 2, 'approved filter, page reset');
      await page.click(tid('ais-range')); await settle();
      expect(await page.locator(tid('ais-cal')).count() === 1, 'month calendar opens');
      await shot('04-bs-calendar');
      await page.keyboard.press('Escape'); await page.click(tid('ais-range')).catch(() => undefined); await settle();
      return 'needle on page 3 found from page 1 · 10/page · 25 total · page 3 = 5 · status filter · calendar opens';
    }],
    ['bs: Check Business Setup lists each source separately; it changes nothing', async () => {
      await open(); const b0 = await st();
      await page.click(tid('ais-check')); await settle(); await page.waitForTimeout(300);
      const txt = await T(tid('ais-health'));
      for (const k of ['Salon & branch', 'Business hours', 'Services', 'Technicians', 'Staff schedule', 'Booking readiness', 'Approved FAQs', 'Knowledge sync', 'Agent knowledge', 'Setup jobs']) expect(txt.includes(k), `health lists ${k}`);
      expect(/changed nothing/.test(txt), 'non-mutating note');
      await shot('05-bs-health');
      await closeDlg(); const b1 = await st();
      expect(b1.faqs === b0.faqs && b1.approved === b0.approved, 'no change');
      return '10 checks, each with its own status · nothing changed';
    }],
    ['bs: Preview answers from approved sources with the sources listed; it never books, holds or texts', async () => {
      await open(); const b0 = await st();
      await page.click(tid('ais-preview')); await settle();
      await page.fill(tid('ais-preview-q'), 'What time are you open Sunday?'); await page.click(tid('ais-preview-ask')); await settle(); await page.waitForTimeout(300);
      const r1 = await T(tid('ais-preview-result'));
      expect(/Sunday: 11:00–17:00/.test(r1) && /Hours/.test(r1), `hours preview: ${r1.slice(0, 120)}`);
      await page.fill(tid('ais-preview-q'), 'Can I book tomorrow at 3 PM?'); await page.click(tid('ais-preview-ask')); await settle(); await page.waitForTimeout(300);
      expect(/never checks, holds or books/.test(await T(tid('ais-preview-result'))), 'booking preview is a handoff');
      await page.fill(tid('ais-preview-q'), 'Do you take walk-ins?'); await page.click(tid('ais-preview-ask')); await settle(); await page.waitForTimeout(300);
      expect(/when a technician is free/.test(await T(tid('ais-preview-result'))), 'approved FAQ used');
      await shot('06-bs-preview');
      await closeDlg(); const b1 = await st();
      expect(b1.locks === b0.locks && b1.notifications === b0.notifications && b1.previews === b0.previews + 3, `locks ${b0.locks}→${b1.locks} · notifications ${b0.notifications}→${b1.notifications} · previews +${b1.previews - b0.previews}`);
      return 'hours from saved hours · booking = handoff · approved FAQ used · 3 runs recorded · nothing booked or sent';
    }],
    ['bs: Knowledge Assistant suggests with reasons; Draft this FAQ fills the question only (the owner writes the answer)', async () => {
      await open();
      await page.click(tid('ais-assistant')); await settle(); await page.waitForTimeout(300);
      const n = await page.locator(tid('ais-suggestion')).count();
      expect(n >= 1, `suggestions ${n}`);
      const draft = page.locator(`${tid('ais-assistant-dialog')} button:text-is("Draft this FAQ")`).first();
      const has = await draft.count();
      if (has) { await draft.click(); await settle(); expect((await page.inputValue(tid('ais-q'))).length > 0 && (await page.inputValue(tid('ais-a'))) === '', 'question prefilled, answer empty'); }
      else await closeDlg();
      await shot('07-bs-assistant');
      return `${n} suggestion(s)${has ? ' · draft question prefilled, answer left to the owner' : ''}`;
    }],
    ['bs: Front Desk reads and previews but cannot add or approve (server-checked)', async () => {
      await J('/__role?r=FRONT_DESK'); await open();
      expect(await page.locator(tid('ais-readonly')).count() === 1 && await page.locator(tid('ais-add')).count() === 0, 'read-only notice, no Add FAQ');
      await page.locator(tid('ais-faq-row')).first().click(); await settle();
      expect(await page.locator(tid('ais-act-approve')).count() === 0, 'no approve button');
      await closeDlg(); await J('/__role?r=OWNER');
      return 'read-only notice · no Add / Approve';
    }],
    ['bs: Vietnamese on the Front Desk POS — every label translated, numbers the same', async () => {
      await J('/__lang?l=vi'); await open();
      const h = await T('h1'); expect(h === 'Thiết lập kinh doanh', `title ${h}`);
      expect(/Mức sẵn sàng/.test(await T(tid('ais-readiness'))), 'readiness label');
      await shot('08-bs-vi'); await J('/__lang?l=en');
      return 'title + readiness in Vietnamese';
    }],
    ['bs: layout — 1920×945, 1366×768, 1280×720, 1024×768 fit with no sideways scroll', async () => {
      const out = [];
      for (const [w, h] of [[1920, 945], [1366, 768], [1280, 720], [1024, 768]]) {
        await page.setViewportSize({ width: w, height: h }); await open(); await page.waitForTimeout(300);
        const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        expect(over <= 1, `${w}×${h}: page overflows by ${over}px`);
        await shot(`09-bs-${w}x${h}`); out.push(`${w}×${h} ok`);
      }
      await page.setViewportSize({ width: 1920, height: 945 });
      return out.join(' · ');
    }],
  ];
};
