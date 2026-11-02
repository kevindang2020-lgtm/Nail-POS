// interact-seg.mjs — Marketing & Growth → Customer Segments steps of the catalog E2E (Customer Segments Complete Build Guide,
// Oct 30 2026): the REAL screen in Chromium against the REAL SegmentsController → SegmentsRepository → SQL (seg-extra.mjs).
// Nothing is sent: the Audience Builder makes a draft; Campaign Center's create is a test stand-in that writes a DRAFT row.
// `node tooling/catalog-one-screen/interact.mjs <label> seg`
export const STEPS_SEG = ({ page, expect, settle, go, tid, noJunk, API, J, T, rowsText, customRange, today }) => {
  const URL0 = '/tenant/marketing/segments';
  const open = (qs = '') => go(URL0 + qs, tid('segments-screen'));
  const rows = () => rowsText(tid('sg-row'));
  const kpiV = async (t) => (await T(`${tid(t)} .fk-kpi-v`)).replace(/\s+/g, ' ').trim();
  const fit = async () => page.evaluate(() => { const se = document.scrollingElement; return { h: se.scrollWidth - innerWidth }; });
  const waitFor = async (fn, ms = 9000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return true; await page.waitForTimeout(250); } return false; };
  const N = (s) => Number(String(s).replace(/[^0-9]/g, ''));
  return [
    ['seg: the original Returning view is preserved — Vishaal kumar, 15 visits, Regular, $440.76, Last Visit formatted in salon time; counts = the server', async () => {
      await J('/__tenant?name=pilot'); await J('/__role?r=OWNER'); await J('/__lang?l=en');
      await open(); await noJunk();
      expect(await page.locator(`${tid('sg-tab-returning')}[aria-selected="true"]`).count() === 1, 'Returning selected by default');
      const sum = await API('/pos/marketing/segments/summary');
      for (const [k, c] of [['kpi-total', 'all'], ['kpi-new', 'new'], ['kpi-returning', 'returning'], ['kpi-vip', 'vip'], ['kpi-never', 'never'], ['kpi-inactive', 'inactive']]) expect(N(await kpiV(k)) === sum.counts[c], `${k} ${await kpiV(k)} ≠ ${sum.counts[c]}`);
      expect(sum.counts.never + sum.counts.new + sum.counts.returning === sum.counts.all, 'partition');
      const st = await J('/__seg?state=1'); expect(st.visitClasses.returning === sum.counts.returning && st.visitClasses.new === sum.counts.new && st.visitClasses.never === sum.counts.never, 'SQL truth ' + JSON.stringify(st.visitClasses));
      // newest account first (guide §09): Vishaal's profile is 420 days old, so he is on page 2 of Returning — find him by search
      await page.fill(tid('sg-search'), 'Vishaal'); await page.waitForTimeout(500); await settle();
      const r = (await rows()).find((x) => /Vishaal kumar/.test(x)); expect(!!r, 'Vishaal row');
      expect(/\b15\b/.test(r) && /Regular/.test(r) && /\$440\.76/.test(r), 'row ' + r);
      expect(/(Oct|Nov) \d{1,2}, 2026/.test(r), 'last visit formatted: ' + r);
      await page.fill(tid('sg-search'), ''); await page.waitForTimeout(500); await settle();
      return `counts all ${sum.counts.all} = never ${sum.counts.never} + new ${sum.counts.new} + returning ${sum.counts.returning} · VIP ${sum.counts.vip} · ${r.slice(0, 90)}`;
    }],
    ['seg: New = exactly 1 settled visit, Never Visited = 0, VIP overlaps New (two chips), Inactive needs a visit', async () => {
      await page.click(tid('sg-tab-new')); await settle();
      const nr = await rows(); expect(nr.length > 0 && nr.every((x) => / 1 /.test(' ' + x.split('\n').join(' ') + ' ')), 'new rows: ' + nr.join(' | ').slice(0, 300));
      expect(!nr.some((x) => /Neve Ha/.test(x)), 'never-visited profile is not New');
      await page.click(tid('sg-tab-never')); await settle();
      const nv = await rows(); expect(nv.some((x) => /Neve Ha/.test(x)) && nv.every((x) => /Never Visited/.test(x)), 'never rows');
      await page.click(tid('sg-tab-vip')); await settle();
      const v = await rows(); expect(v.length >= 1 && /Vera Ngo/.test(v.join(' ')) && /New/.test(v[0]) && /VIP/.test(v[0]), 'vip row ' + v[0]);
      await page.click(tid('sg-tab-inactive')); await settle();
      const ia = await rows(); expect(ia.some((x) => /Ines Lo/.test(x)) && !ia.some((x) => /Neve Ha/.test(x)), 'inactive');
      expect(/segment=inactive/.test(page.url()), 'segment in the URL ' + page.url());
      return `new ${nr.length} rows all 1 visit · never ${nv.length} · VIP "${v[0].replace(/\s+/g, ' ').slice(0, 60)}" · inactive ${ia.length}`;
    }],
    ['seg: server search over every page — phone digits, e-mail, a customer beyond page 1; the search text never goes into the URL', async () => {
      await open('?segment=all'); await page.fill(tid('sg-search'), '7762599624'); await page.waitForTimeout(500); await settle();
      expect((await rows()).length === 1 && /Vishaal/.test((await rows())[0]), 'phone');
      await page.fill(tid('sg-search'), 'oona@exa'); await page.waitForTimeout(500); await settle();
      expect((await rows()).length === 1 && /Oona Tran/.test((await rows())[0]), 'email');
      await page.fill(tid('sg-search'), 'Guest 24'); await page.waitForTimeout(500); await settle();
      expect((await rows()).length === 1, 'guest 24 (created 223 days ago — not on page 1)');
      expect(!/Guest|7762|oona/i.test(page.url()), 'no search text in the URL: ' + page.url());
      await page.fill(tid('sg-search'), ''); await page.waitForTimeout(500); await settle();
      return 'phone · email · beyond page 1 · URL clean';
    }],
    ['seg: numbered pages 1 · 2 · 3, 10 / 20 / 50 rows, newest account first, exact count', async () => {
      await open('?segment=all');
      const p1 = await rows(); expect(p1.length === 10, 'page size ' + p1.length); const newest = (await J('/__seg?state=1')).newest; expect(newest && p1[0].includes(newest), `newest first: ${p1[0]} vs DB ${newest}`);
      const range = await T('.fk-pager-range'); const total = (await API('/pos/marketing/segments/members?segment=all')).totalItems;
      expect(range.includes(String(total)), `range ${range} total ${total}`);
      await page.click('.fk-pager .fk-pbtn.num >> text="2"'); await settle();
      const p2 = await rows(); expect(p2.length === 10 && p2[0] !== p1[0], 'page 2'); expect(/page=2/.test(page.url()), 'page in URL');
      await page.selectOption(tid('sg-size'), '20'); await settle();
      expect((await rows()).length === 20, '20 rows'); expect(!/page=2/.test(page.url()), 'size change → page 1');
      await page.selectOption(tid('sg-size'), '50'); await settle(); expect((await rows()).length === Math.min(50, total), '50 rows');
      await page.selectOption(tid('sg-size'), '10'); await settle();
      return `${total} customers · page 1 → 2 · 20 · 50 · back to 10`;
    }],
    ['seg: From/To month calendar + date basis — salon days, the active basis is stated, page resets to 1', async () => {
      await open('?segment=all&page=2');
      await page.selectOption(`${tid('segments-screen')} .fn-basis select`, 'created');
      await settle();
      await customRange(today.slice(0, 8) + '01', today);
      const b = await T(tid('sg-basis-active')); expect(/Customer created/.test(b), 'basis line ' + b);
      expect(!/page=2/.test(page.url()), 'page reset');
      const r = await rows(); expect(r.some((x) => /Neve Ha|Oona Tran/.test(x)) && !r.some((x) => /Vishaal/.test(x)), 'created this month: ' + r.join(' | ').slice(0, 200));
      return b;
    }],
    ['seg: Why this segment? — the facts, the ruleset, the thresholds; a Regular tier is a loyalty tier, not VIP', async () => {
      await open('?segment=returning'); await page.fill(tid('sg-search'), 'Vishaal'); await page.waitForTimeout(500); await settle();
      await page.click(tid('sg-why')); await page.waitForSelector(tid('sg-why-dialog')); await settle();
      const facts = await T(tid('sg-why-facts')); expect(/15 settled visits/.test(facts) && /\$440\.76/.test(facts), 'facts ' + facts);
      expect(/Matches/.test(await T(tid('sg-why-returning'))), 'returning met');
      expect(/Does not match/.test(await T(tid('sg-why-vip'))) && /loyalty tier, not a marketing segment/.test(await T(tid('sg-why-vip'))), 'vip text');
      expect(/segments-v1/.test(await T(tid('sg-why-dialog'))), 'ruleset shown');
      await page.click(tid('sg-why-close')); await settle(); expect(await page.locator(tid('sg-why-dialog')).count() === 0, 'closed');
      return facts;
    }],
    ['seg: customer history & marketing overlay — masked contact, tabs, Close, and Open Booking with the customer preselected', async () => {
      await page.click(tid('sg-open-customer')); await page.waitForSelector(tid('sg-customer-dialog')); await settle();
      const body = await T(tid('sg-customer-dialog'));
      expect(/•••/.test(body) && !/7762599624|vishaal@example/.test(body), 'masked: ' + body.slice(0, 200));
      await page.click(tid('sg-ov-visits')); await settle(); expect((await page.locator(`${tid('sg-customer-dialog')} .sg-list li`).count()) >= 10, 'visits listed');
      await page.click(tid('sg-ov-contact')); await settle(); expect(/Marketing SMS consent: Yes/.test(await T(tid('sg-customer-dialog'))), 'consent shown');
      const audits = (await J('/__seg?state=1')).audits; expect(audits >= 1, 'overlay view audited');
      await page.click(tid('sg-ov-book')); await page.waitForTimeout(800);
      expect(/\/booking\/new\?customerId=c5e93600-0000-4000-8000-000000000001&from=segments/.test(page.url()), 'booking url ' + page.url());
      return `masked · tabs · audited (${audits}) · ${page.url().replace(/^https?:\/\/[^/]+/, '')}`;
    }],
    ['seg: Audience Builder — consent checked, reasons shown, a DRAFT handed to Campaign Center; nothing is sent', async () => {
      const before = await J('/__seg?state=1');
      await open('?segment=new');
      await page.click(tid('sg-select-page')); await settle();
      await page.click(tid('sg-build-audience')); await page.waitForSelector(tid('sg-audience-dialog'));
      expect(/Nothing is sent/.test(await T(tid('sg-aud-nosend'))), 'no-send note');
      await page.click(tid('sg-aud-build')); await page.waitForSelector(tid('sg-aud-result')); await settle();
      const res = await T(tid('sg-aud-result'));
      expect(/eligible of \d+ selected/.test(res) && /Opted out: 1/.test(res) && /Shares a number/.test(res), 'reasons: ' + res.slice(0, 300));
      await page.click(tid('sg-aud-recheck')); await page.waitForSelector(tid('sg-aud-recheck-result')); await settle();
      await page.click(tid('sg-aud-campaign')); await page.waitForTimeout(600); await settle();
      expect(/Handed to Campaign Center \(draft, not sent\)/.test(await T(tid('sg-audience-dialog'))), 'linked');
      const after = await J('/__seg?state=1');
      expect(after.drafts === before.drafts + 1 && after.campaign_drafts === before.campaign_drafts + 1 && after.campaigns_not_draft === 0, 'draft rows ' + JSON.stringify(after));
      expect(after.notifications === before.notifications, `notifications ${before.notifications} → ${after.notifications}`);
      expect(after.audits >= before.audits + 2, 'audited create + link');
      await page.click(tid('sg-aud-close')); await settle();
      return `${res.split('\n')[0]} · drafts ${after.drafts} · campaign drafts ${after.campaign_drafts} · notifications unchanged (${after.notifications})`;
    }],
    ['seg: Front Desk can read segments but cannot build an audience', async () => {
      await J('/__role?r=FRONT_DESK'); await open();
      const viewOk = (await rows()).length > 0;
      const disabled = await page.locator(tid('sg-create-campaign')).isDisabled();
      const r = await fetch(new URL('/api/v1/pos/marketing/segments/audience-drafts', page.url()).href, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ channel: 'sms', selectionMode: 'all_matching', idempotencyKey: 'fd-attempt-001' }) }).then((x) => x.status);
      await J('/__role?r=OWNER');
      expect(viewOk && disabled && r === 403, `view ${viewOk} disabled ${disabled} api ${r}`);
      return `rows visible · Create Campaign disabled · API ${r}`;
    }],
    ['seg: Vietnamese — tabs, KPI labels and the explanation in Vietnamese; the numbers are the same', async () => {
      const en = await kpiV('kpi-returning');
      await J('/__lang?l=vi'); await open(); await noJunk();
      const tabs = await T(tid('sg-tab-returning')); expect(/Khách quay lại/.test(tabs), 'vi tab ' + tabs);
      expect(await kpiV('kpi-returning') === en, 'same number');
      expect(/Tìm tên, số điện thoại/.test(await page.getAttribute(tid('sg-search'), 'placeholder')), 'vi placeholder');
      await J('/__lang?l=en');
      return `vi: ${tabs.replace(/\s+/g, ' ')} = ${en}`;
    }],
    ['seg: layout — 1920×945 · 1366×768 · 1280×720 · 1024×768: the page scrolls vertically only (no sideways page scroll)', async () => {
      const out = [];
      for (const [w, h] of [[1920, 945], [1366, 768], [1280, 720], [1024, 768]]) {
        await page.setViewportSize({ width: w, height: h }); await open(); await page.waitForTimeout(300);
        const f = await fit(); expect(f.h <= 0, `${w}×${h} sideways scroll ${f.h}px`);
        await page.screenshot({ path: `tooling/catalog-one-screen/results/seg-e2e/seg-${w}x${h}.png`, fullPage: false }).catch(() => undefined);
        out.push(`${w}×${h} ok`);
      }
      await page.setViewportSize({ width: 1920, height: 945 });
      return out.join(' · ');
    }],
  ];
};
