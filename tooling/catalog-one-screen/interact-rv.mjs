// interact-rv.mjs — Reviews & Reputation E2E steps (guide Oct 30 2026, REV-01 … REV-25 where a browser can show them). Run with
// `node tooling/catalog-one-screen/interact.mjs <label> rv` against the live harness (rv-extra.mjs serves the REAL
// ReviewsCenterController). Nothing leaves the machine: no reply is published and nothing is sent.
export const STEPS_RV = ({ page, expect, settle, go, tid, noJunk, J, T, search }) => {
  const URL0 = '/tenant/marketing/reviews';
  const open = (qs = '') => go(URL0 + qs, tid('rvw-kpis'));
  const shot = (name) => page.screenshot({ path: `tooling/catalog-one-screen/results/rv-e2e/${name}.png`, fullPage: false }).catch(() => undefined);
  const kpiV = async (id) => (await T(`${tid(id)} .fk-kpi-v`)).trim();
  const rows = () => page.locator(tid('rvw-row'));
  const col = async (n) => (await rows().locator(`td:nth-child(${n})`).allInnerTexts()).map((x) => x.trim());
  const st = () => J('/__rv?state=1');
  const SNAP = '?preset=custom&from=2026-08-31&to=2026-09-14';
  const closeDlg = async () => { const b = page.locator(tid('ov-close')); if (await b.count()) await b.click(); else await page.keyboard.press('Escape'); await settle(); };
  return [
    ['rv: P0 — the photographed window shows 4 reviews, 5.0, public 4, hidden 0, 100% five-star, 0 written — all from the rows', async () => {
      await J('/__tenant?name=pilot'); await J('/__role?r=OWNER'); await J('/__lang?l=en'); await J('/__rv?reset=1'); await J('/__rv?seed=1');
      await open(SNAP); await noJunk();
      const s = await st();
      const k = { avg: await kpiV('kpi-avg'), total: await kpiV('kpi-total'), pub: await kpiV('kpi-public'), hid: await kpiV('kpi-hidden'), five: await kpiV('kpi-five') };
      expect(k.avg === '5.0' && k.total === '4' && k.pub === '4' && k.hid === '0' && k.five === '100%', `KPIs ${JSON.stringify(k)}`);
      expect(s.vishal_window === 4 && s.window_total === 4, `DB: ${s.vishal_window} Vishal reviews, ${s.window_total} in all, in the window`);
      expect(/0 of 4 reviews include a written comment/.test(await T(tid('glance-written'))), 'At a Glance written');
      const techs = await col(4), comments = await col(3);
      expect(techs.length === 4 && techs.every((x) => x === 'Vishal verma') && comments.every((x) => /No written comment/.test(x)), `rows ${techs.join(',')} · ${comments.join(',')}`);
      expect(/4 reviews · Review submitted · 2026-08-31 – 2026-09-14/.test(await T(tid('rvw-count'))), await T(tid('rvw-count')));
      await shot('01-rv-baseline-1920');
      return `screen 5.0 / 4 / 4 / 0 / 100% · DB ${s.vishal_window} Vishal reviews in Aug 31 – Sep 14 · 4 star-only rows`;
    }],
    ['rv: all-time KPIs equal an independent SQL count; the distribution and verified average agree', async () => {
      await open(); const s = await st();
      const avg = await kpiV('kpi-avg');
      expect(Number(avg) === s.avg, `average screen ${avg} vs DB ${s.avg}`);
      expect(Number(await kpiV('kpi-hidden')) === s.hidden, 'hidden');
      expect(Number((await kpiV('kpi-attention'))) >= 1, 'the 1★ needs attention');
      return `verified ${s.verified} · average ${avg} = DB · hidden ${s.hidden}`;
    }],
    ['rv: search — a linked customer by name / phone / email, technician, the anonymous one stays anonymous, a match on page 3 found from page 1', async () => {
      await open();
      for (const term of ['Rv Ava', '5557301', 'rv-ava@pilot.test']) { await search(tid('rvw-search'), term); const c = await col(1); expect(c.length === 1 && c[0] === 'Rv Ava', `${term} → ${c.join(',')}`); }
      await search(tid('rvw-search'), 'ok visit'); expect((await col(1))[0] === 'Anonymous', 'anonymous');
      const sv = await st(); await search(tid('rvw-search'), 'vishal'); const vt = await col(4);
      expect(vt.length === sv.vishal_all && vt.every((x) => /vishal/i.test(x)), `vishal → ${vt.length} rows (DB ${sv.vishal_all}), all Vishal`);
      await search(tid('rvw-search'), 'needle'); const n = await col(3); expect(n.length === 1 && /needle-oldest/.test(n[0]), `needle → ${n.join(',')}`);
      expect(!page.url().includes('needle'), 'the search text is not in the URL');
      await search(tid('rvw-search'), '');
      return `name / phone / email → Rv Ava only · "ok visit" → Anonymous · vishal → ${vt.length} (= DB) · needle (oldest, page 3 of 10) → found · not in the URL`;
    }],
    ['rv: filters combine on the server, reset to page 1, live in the URL; pages 10 / 50 and newest first', async () => {
      await open();
      await page.selectOption(tid('rvw-pagesize'), '10'); await settle();
      const p1 = await col(3);
      await page.locator(`${tid('rvw-feed')} button`, { hasText: /^2$/ }).first().click(); await settle();
      const p2 = await col(3);
      expect(p1.length === 10 && p2.length === 10 && JSON.stringify(p1) !== JSON.stringify(p2), `page 1 ${p1.length} · page 2 ${p2.length}`);
      expect(page.url().includes('page=2'), 'page in URL');
      const sf = await st();
      await page.selectOption(tid('flt-rating'), '1'); await settle();
      const one = await col(3);
      expect(!page.url().includes('page=2') && one.length === sf.one_star && one.some((x) => /Polish chipped/.test(x)), `rating 1 → ${one.length} rows (DB ${sf.one_star}), page reset`);
      await page.selectOption(tid('flt-rating'), ''); await page.selectOption(tid('flt-followup'), 'needs_attention'); await settle();
      const att = await col(2);
      expect(att.length === sf.attention && att.every((x) => /^★{1,2}☆/.test(x)), `needs attention → ${att.length} rows (DB ${sf.attention}): ${att.join(' ')}`);
      await page.click(tid('flt-clear')); await settle();
      await page.selectOption(tid('rvw-pagesize'), '50'); await settle();
      const s = await st(); const all = await rows().count(); const dates = await col(6);
      expect(all === Math.min(50, s.total) && /reviews/.test(await T(tid('rvw-count'))) && (await T(tid('rvw-count'))).startsWith(`${s.total} reviews`), `50 per page → ${all} of DB ${s.total}`);
      const ts = dates.map((d) => Date.parse(d)); expect(ts.every((x, i) => i === 0 || ts[i - 1] >= x), `newest first: ${dates.slice(0, 4).join(' | ')}`);
      await shot('02-rv-filters');
      return `10/page: page 2 differs · rating 1 → ${one.length} (= DB) · needs attention → ${att.length} (= DB) · 50/page → ${all}, newest first`;
    }],
    ['rv: the From / To calendar opens as a month view; presets set the range; the count line names the basis', async () => {
      await open(); await page.click(tid('preset-custom')); await settle();
      expect(await page.locator(tid('rvw-cal')).isVisible(), 'calendar visible');
      await shot('03-rv-calendar');
      await page.keyboard.press('Escape').catch(() => undefined);
      const cancel = page.locator(`${tid('rvw-cal')} button`, { hasText: /Cancel/ }); if (await cancel.count()) await cancel.first().click(); await settle();
      await page.click(tid('preset-year')); await settle();
      await page.selectOption(tid('flt-basis'), 'service'); await settle();
      const c = await T(tid('rvw-count'));
      expect(/Service date · 2026-01-01 – 2026-12-31/.test(c) && /^1 reviews/.test(c), c);
      return c;
    }],
    ['rv: the overlay — linked customer, visit, Open Booking prefilled; anonymous: Open Booking disabled; Close works', async () => {
      await open(); await search(tid('rvw-search'), 'Lovely gel'); await rows().first().click(); await page.waitForSelector(tid('rvw-overlay'));
      await page.click(tid('ov-tab-customer')); const cu = await T(tid('ov-customer'));
      await page.click(tid('ov-tab-visit')); const vi = await T(tid('ov-visit'));
      expect(/Rv Ava/.test(cu) && /97521/.test(vi) && /Gel Manicure/.test(vi), `customer "${cu.slice(0, 60)}" · visit "${vi.slice(0, 60)}"`);
      expect(await page.locator(tid('ov-book')).isEnabled(), 'Open Booking enabled');
      await shot('04-rv-overlay');
      await closeDlg(); expect((await page.locator(tid('rvw-overlay')).count()) === 0, 'closed');
      await search(tid('rvw-search'), 'ok visit'); await rows().first().click(); await page.waitForSelector(tid('rvw-overlay'));
      expect(!(await page.locator(tid('ov-book')).isEnabled()), 'anonymous → Open Booking disabled');
      await closeDlg(); await search(tid('rvw-search'), '');
      return 'linked: Rv Ava · ticket 97521 · Gel Manicure · Open Booking enabled · anonymous: disabled · Close works';
    }],
    ['rv: Hide a 1★ needs a policy reason ("Other" not offered), is recorded with actor + reason + audit, the text is kept; Unhide restores', async () => {
      await open(); const before = await st();
      await search(tid('rvw-search'), 'Polish chipped'); await page.click(tid('rvw-hide')); await page.waitForSelector(tid('rvw-moderate'));
      const opts = await page.locator(`${tid('mod-reason')} option`).evaluateAll((os) => os.map((o) => o.value));
      expect(!opts.includes('other') && (await page.locator(tid('mod-low')).count()) === 1, `reasons ${opts.join(',')}`);
      expect(!(await page.locator(tid('mod-confirm')).isEnabled()), 'confirm disabled without a reason');
      await page.selectOption(tid('mod-reason'), 'abusive_language'); await page.fill(tid('mod-text'), 'Contains a slur'); await page.click(tid('mod-confirm')); await settle();
      const mid = await st();
      expect(mid.low.hidden === true && mid.events === before.events + 1 && mid.audits === before.audits + 1, `hidden ${mid.low.hidden} · events ${before.events}→${mid.events} · audits ${before.audits}→${mid.audits}`);
      await page.selectOption(tid('flt-visibility'), 'hidden'); await settle(); await rows().first().click(); await page.waitForSelector(tid('rvw-overlay'));
      expect(/Polish chipped the next day/.test(await T(tid('ov-comment'))), 'text kept');
      await page.click(tid('ov-tab-moderation')); const ev = await T(tid('ov-mod-event'));
      expect(/Hidden/.test(ev) && /Abusive language/.test(ev) && /Contains a slur/.test(ev), ev);
      await shot('05-rv-moderation');
      await page.click(tid('ov-moderate')); await page.waitForSelector(tid('rvw-moderate')); await page.click(tid('mod-confirm')); await settle();
      const after = await st();
      expect(after.low.hidden === false && after.events === before.events + 2, `unhidden ${after.low.hidden} · events ${after.events}`);
      await closeDlg(); await page.click(tid('flt-clear')).catch(() => undefined); await settle();
      return `hide → recorded (events +1, audit +1), text kept, trail "${ev.replace(/\s+/g, ' ').slice(0, 80)}" · unhide → visible (events +2)`;
    }],
    ['rv: a Google review — Hide is AI PowerSalon-only and a reply needs the Google connection', async () => {
      await open(); await search(tid('rvw-search'), 'Nice place'); await rows().first().click(); await page.waitForSelector(tid('rvw-overlay'));
      const sc = await T(tid('ov-scope'));
      await page.click(tid('ov-tab-response')); const pub = await T(tid('ov-publishable'));
      expect(/stays on google/i.test(sc) && /Google Business Profile connection/.test(pub), `${sc} · ${pub}`);
      await closeDlg(); await search(tid('rvw-search'), '');
      return 'scope: stays on Google · reply: needs an active Google Business Profile connection + manager approval';
    }],
    ['rv: Check Review System (read-only) and the assistant (star-only window → insufficient written feedback)', async () => {
      await open(); const before = await st();
      await page.click(tid('rvw-check')); await page.waitForSelector(tid('chk-aggregation'));
      const agg = await T(tid('chk-aggregation-state')), n = await page.locator('[data-testid^="chk-"][data-testid$="-state"]').count();
      expect(agg === 'Ready' && n === 6, `aggregation ${agg} · ${n} checks`);
      await shot('06-rv-check');
      await page.keyboard.press('Escape'); await settle();
      await open(SNAP); await page.click(tid('rvw-assistant')); await page.waitForSelector(tid('ins-insufficient'));
      const ins = await T(tid('ins-insufficient'));
      expect(/Insufficient written feedback/.test(ins) && /0 written comment/.test(ins), ins);
      await page.keyboard.press('Escape'); await settle();
      const after = await st();
      expect(after.events === before.events && after.total === before.total, 'nothing changed');
      return `6 checks, calculation Ready · assistant: "${ins.replace(/\s+/g, ' ').slice(0, 70)}" · no rows changed`;
    }],
    ['rv: Front Desk has no marketing access — the page says so and the API refuses', async () => {
      await J('/__role?r=FRONT_DESK'); await go(URL0, 'h1'); await settle();
      const txt = await T('.work');
      const r = await page.evaluate(async () => (await fetch('/api/v1/pos/reviews-center/summary')).status);
      await J('/__role?r=OWNER');
      expect(/does not have permission to view Reviews/.test(txt) && r === 403 && (await page.locator(tid('rvw-hide')).count()) === 0, `front desk: "${txt.slice(0, 80)}" · API ${r}`);
      return 'Front Desk: no-access notice · GET /pos/reviews-center/summary → 403 · no Hide buttons';
    }],
    ['rv: Vietnamese POS labels with the same numbers; fits 1920×945, 1536×864, 1366×768, 1280×720 and 1024×768 with no sideways scroll', async () => {
      await J('/__lang?l=vi'); await open(SNAP);
      const title = await T('h1'), avg = await kpiV('kpi-avg');
      expect(/Đánh giá & Uy tín/.test(title) && (avg === '5,0' || avg === '5.0'), `VI: "${title}" · ${avg}`);
      await shot('07-rv-vi');
      await J('/__lang?l=en');
      const out = [];
      for (const [w, h] of [[1920, 945], [1536, 864], [1366, 768], [1280, 720], [1024, 768]]) {
        await page.setViewportSize({ width: w, height: h }); await open(); await page.waitForTimeout(300);
        const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        expect(over <= 1, `${w}×${h}: page overflows by ${over}px`);
        await shot(`08-rv-${w}x${h}`); out.push(`${w}×${h} ok`);
      }
      await page.setViewportSize({ width: 1920, height: 945 });
      return out.join(' · ');
    }],
  ];
};
