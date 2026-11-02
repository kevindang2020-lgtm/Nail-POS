// interact-do.mjs — Marketing → Deals & Offers steps of the catalog E2E (Deals & Offers guide, Oct 30 2026): the REAL screen in
// Chromium against the REAL DealsCenterController / DealsController → SQL (do-extra.mjs + cp-extra.mjs). Nothing is sent or
// charged: the checker is read-only, the assistant and New Deal make DRAFTS, decisions are the server's.
// `node tooling/catalog-one-screen/interact.mjs <label> do`
export const STEPS_DO = ({ page, expect, settle, go, tid, noJunk, API, J, T, rowsText }) => {
  const URL0 = '/tenant/marketing/deals';
  const open = (qs = '') => go(URL0 + qs, tid('deals-screen'));
  const rows = () => rowsText(tid('deal-row'));
  const kpiV = async (t) => (await T(`${tid(t)} .fk-kpi-v`)).replace(/\s+/g, ' ').trim();
  const N = (s) => Number(String(s).replace(/[^0-9]/g, ''));
  const fit = async () => page.evaluate(() => { const se = document.scrollingElement; return { h: se.scrollWidth - innerWidth }; });
  const find = async (text) => { await page.fill(tid('search'), text); await page.waitForTimeout(450); await settle(); };
  const post = (path, body) => page.evaluate(async ([p, b]) => { const r = await fetch('/api/v1' + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }); let j = null; try { j = await r.json(); } catch { /* empty */ } return { status: r.status, body: j }; }, [path, body]);
  const rowOf = (name) => page.locator(tid('deal-row')).filter({ hasText: name }).first();
  const shot = (name) => page.screenshot({ path: `tooling/catalog-one-screen/results/do-e2e/${name}.png`, fullPage: false }).catch(() => undefined);
  return [
    ['do: the owner\'s screen kept — Spring time 5% ($10.00 → $9.50, Active) and vishal 20% with Pause; six cards = server; "Technician deals: On — manager approval required · Max 10%"', async () => {
      await J('/__tenant?name=pilot'); await J('/__role?r=OWNER'); await J('/__lang?l=en');
      await open(); await noJunk();
      const h1 = await T(`${tid('deals-screen')} h1`); expect(h1 === 'Deals & Offers', 'title ' + h1);
      const k = await API('/pos/deals-offers/kpis');
      expect(N(await kpiV('kpi-total')) === k.total && N(await kpiV('kpi-active')) === k.activeDiscounts && N(await kpiV('kpi-pending')) === k.pendingApproval && N(await kpiV('kpi-redemptions')) === k.ledger.confirmedEvents, 'cards = server ' + JSON.stringify(k).slice(0, 120));
      const all = await rows(); const sp = all.find((r) => /Spring time/.test(r)) ?? ''; const vi = all.find((r) => /vishal/.test(r) && !/\(copy\)/.test(r)) ?? '';   /* the original, not the Coupons section's draft copy */
      expect(/5% off/.test(sp) && /\$10\.00 → \$9\.50/.test(sp) && /Active/.test(sp) && /Pause/.test(sp), 'Spring time row ' + sp);
      expect(/20% off/.test(vi) && /Active/.test(vi), 'vishal row ' + vi);
      const pol = await T(tid('tech-policy'));
      expect(/On — manager approval required/.test(pol) && /Maximum technician discount: 10%/.test(pol), 'policy ' + pol);
      await shot('01-deals-library');
      return `total ${k.total} active ${k.activeDiscounts} pending ${k.pendingApproval} redemptions ${k.ledger.confirmedEvents} · ${sp.slice(0, 60)} · ${vi.slice(0, 40)} · ${pol.slice(0, 70)}`;
    }],
    ['do: Spring time is ONE record with the stored price pair 1000 → 950 cents; its one completed redemption is $0.50 on a paid ticket', async () => {
      const st = await J('/__do?state=1');
      expect(st.spring_rows === 1 && st.spring_original === 1000 && st.spring_final === 950 && st.spring_count === 1, 'db ' + JSON.stringify(st));
      const r = await API('/pos/deals-offers/redemptions?q=Spring%20time&state=all');
      expect(r.items.length === 1 && r.items[0].discountCents === 50 && r.items[0].status === 'redeemed', 'ledger ' + JSON.stringify(r.items[0] ?? {}));
      return `rows 1 · ${st.spring_original} → ${st.spring_final} · redeemed ${r.items[0].discountCents}¢ on ticket #${r.items[0].ticketNumber}`;
    }],
    ['do: Check deal eligibility — Spring time on ticket #77102 ($10.00 Polish change) → Eligible, takes $0.50 (Checkout\'s engine); a visit without that service → not eligible; nothing written', async () => {
      await open(); const before = await J('/__do?state=1');
      await rowOf('Spring time').locator(tid('deal-check')).click(); await page.waitForSelector(tid('dlg-check'));
      expect((await page.locator(tid('check-code')).count()) === 0, 'no code box for a deal');
      await page.fill(tid('check-ticket'), '77102'); await page.click(tid('check-run')); await page.waitForSelector(tid('check-result')); await settle();
      const v = await T(tid('check-verdict')); const d = await T(tid('check-discount'));
      expect(v === 'Eligible' && /\$0\.50/.test(d) && /\$10\.00/.test(d), `verdict ${v} · ${d}`);
      await page.fill(tid('check-ticket'), ''); await page.fill(tid('check-spend'), '50'); await page.click(tid('check-run')); await settle();   // a visit with no Polish change on it
      const v2 = await T(tid('check-verdict'));
      const after = await J('/__do?state=1'); expect(v2 !== 'Eligible' && after.redemptions === before.redemptions && after.holds === before.holds && after.spring_count === before.spring_count, `pedicure ${v2} · ${JSON.stringify([before.redemptions, after.redemptions])}`);
      await shot('02-check-eligibility'); await page.keyboard.press('Escape'); await page.waitForTimeout(250);
      return `${v}: ${d} · without the service: ${v2} · redemptions ${after.redemptions}, holds ${after.holds}, count ${after.spring_count} unchanged`;
    }],
    ['do: server search — technician "Lisa" finds her proposal (matched the technician); status Pending; customer email in Redemption History finds Spring time; pages 10/20/50; Clear All', async () => {
      await open(); await page.selectOption(tid('status'), 'all'); await settle(); await find('lisa tran');
      const r = await rows(); expect(r.length >= 1 && r.every((x) => /Lisa Tran/.test(x)) && /matched the technician/.test(r[0]), 'tech search ' + r);
      await find(''); await page.selectOption(tid('status'), 'pending'); await settle();
      const pend = await rows(); expect(pend.length === 2 && pend.every((x) => /Pending approval/.test(x)), 'pending ' + pend);
      await page.click(tid('clear-all')); await settle();
      await page.click(tid('tab-redemptions')); await settle(); await page.selectOption(tid('red-state'), 'all'); await find('ava.kim@example.test');
      const red = await T(tid('redemptions-list')); expect(/Spring time/.test(red) && /Ava Kim/.test(red) && /0101/.test(red) && !/2155550101/.test(red), 'email → ' + red.slice(0, 160));
      await find(''); await page.click(tid('tab-library')); await settle(); await page.selectOption(tid('status'), 'all'); await settle();
      const total = N(await T(`${tid('deals-list')} .fk-muted`));
      await page.selectOption(tid('page-size'), '50'); await settle(); const n50 = (await rows()).length;
      await page.selectOption(tid('page-size'), '10'); await settle();
      expect(n50 === Math.min(50, total), `50/page → ${n50} of ${total}`);
      await page.click(tid('clear-all')); await settle();
      return `"lisa tran" → ${r.length} (${r[0].slice(0, 40)}) · pending ${pend.length} · email → Spring time, phone masked · ${total} records, 50/page ${n50}`;
    }],
    ['do: From/To month calendar and explicit date basis — Redeemed this month shows only deals actually used this month (Spring time, not vishal or the proposals); Approved this month shows Spring time; custom opens a month grid', async () => {
      await open(); await page.selectOption(tid('status'), 'all'); await settle();
      await page.selectOption(tid('date-basis'), 'redeemed'); await page.click(tid('preset-month')); await settle();
      const red = await rows(); expect(red.some((x) => /Spring time/.test(x)) && !red.some((x) => /Lisa 8%|vishal|Minh 6%/.test(x)) && red.every((x) => !/ 0 used/.test(x)), 'redeemed basis ' + red);
      const shown = await T(tid('deals-list')); expect(/Redeemed/.test(shown), 'basis shown');
      await page.selectOption(tid('date-basis'), 'approved'); await settle();
      const apr = await rows(); expect(apr.some((x) => /Spring time/.test(x)) && !apr.some((x) => /Lisa 8%/.test(x)), 'approved basis ' + apr);
      await page.click(tid('preset-custom')); await page.waitForSelector(tid('range-calendar'));
      const cells = await page.locator(`${tid('range-calendar')} [data-ymd]`).count(); expect(cells >= 28, 'month grid ' + cells);
      await shot('03-calendar'); await page.keyboard.press('Escape').catch(() => undefined);
      await page.click(tid('preset-all')).catch(() => undefined); await page.selectOption(tid('date-basis'), 'created'); await page.selectOption(tid('status'), 'live'); await settle();
      return `redeemed → ${red.length} used this month incl. Spring time (not vishal / proposals) · approved → ${apr.length} (Spring time, not the pending proposal) · calendar ${cells} day cells`;
    }],
    ['do: Approvals — oldest waiting first (Lisa 2 days, then Minh 1 day), each compared with the 10% cap; the proposal the OWNER filed shows why they cannot decide it and the server refuses (DEAL_SELF_APPROVAL)', async () => {
      await open('?tab=approvals'); await page.waitForSelector(tid('approvals-table')); await settle();
      const r = await rowsText(tid('approval-row'));
      expect(r.length === 2 && /Lisa 8% polish/.test(r[0]) && /Minh 6% pedicure/.test(r[1]) && r.every((x) => /Within the 10% cap/.test(x)), 'order ' + r);
      await page.locator(tid('approval-row')).filter({ hasText: 'Minh 6%' }).locator(tid('approval-open')).click(); await page.waitForSelector(tid('decide-own'));
      const own = await T(tid('decide-own')); const noBtn = (await page.locator(tid('decide-approve')).count()) === 0;
      await shot('04-own-proposal'); await page.click(tid('decide-close'));
      const minhId = (await API('/pos/deals-offers/approvals?q=Minh')).items[0].id;
      const api = await post(`/pos/deals/${minhId}/approve`, {});
      const st = await J('/__do?state=1');
      expect(noBtn && /another manager/.test(own) && api.status === 403 && st.owner_filed_status === 'pending_approval', `own ${own} · api ${api.status} ${JSON.stringify(api.body).slice(0, 80)} · ${st.owner_filed_status}`);
      return `order: ${r.map((x) => x.slice(0, 30)).join(' → ')} · own proposal: "${own.slice(0, 60)}", no buttons · API approve ${api.status} · still ${st.owner_filed_status}`;
    }],
    ['do: Request Changes needs a note → Lisa\'s proposal goes back as a DRAFT with the note (audited); resubmitted; approved by the owner; published → Active', async () => {
      await open('?tab=approvals'); await page.waitForSelector(tid('approvals-table'));
      await page.locator(tid('approval-row')).filter({ hasText: 'Lisa 8%' }).locator(tid('approval-open')).click(); await page.waitForSelector(tid('decide-overview'));
      const pol = await T(tid('decide-policy')); expect(/8%/.test(pol) && /10%/.test(pol) && /Within/.test(pol), 'policy ' + pol);
      await shot('05-review-overlay');
      await page.click(tid('decide-changes')); const err = await T(tid('decide-error'));
      await page.fill(tid('decide-notes'), 'Please end it by Nov 30'); await page.click(tid('decide-changes')); await page.waitForSelector(tid('dlg-decide'), { state: 'detached' }); await settle();
      const st1 = await J('/__do?state=1');
      expect(/Say what needs to change/.test(err) && st1.lisa_status === 'draft' && st1.lisa_decisions.length === 1 && st1.lisa_decisions[0].decision === 'changes_requested' && st1.lisa_decisions[0].reason === 'Please end it by Nov 30', 'changes ' + JSON.stringify(st1));
      const lisaId = (await API('/pos/deals-offers/library?q=Lisa%208%25&status=all')).items[0].id;
      const sub = await post(`/pos/deals/${lisaId}/submit`, {});
      await open('?tab=approvals'); await page.locator(tid('approval-row')).filter({ hasText: 'Lisa 8%' }).locator(tid('approval-open')).click(); await page.waitForSelector(tid('decide-approve'));
      await page.click(tid('decide-approve')); await page.waitForSelector(tid('dlg-decide'), { state: 'detached' }); await settle();
      const pub = await post(`/pos/deals/${lisaId}/publish`, {});
      const st2 = await J('/__do?state=1');
      expect(sub.status < 300 && pub.status < 300 && st2.lisa_status === 'active' && st2.lisa_decisions.map((d) => d.decision).join(',') === 'changes_requested,approved', 'approved ' + JSON.stringify(st2.lisa_decisions));
      return `no note → "${err}" · with note → draft + changes_requested · resubmitted · approved (UI) · published → ${st2.lisa_status} · decisions ${st2.lisa_decisions.map((d) => d.decision).join(' → ')}`;
    }],
    ['do: the 10% cap is server-side — a 15% technician deal is REFUSED (not capped); widening Lisa\'s approved 8% needs a new review; the owner\'s 20% salon deal is unaffected', async () => {
      const r15 = await post('/pos/deals', { ownerType: 'technician', technicianId: 'd0ff3700-0000-4000-8000-000000000010', kind: 'deal', title: 'Lisa 15%', discountType: 'percent', discountPercent: 15, serviceIds: ['d0ff3700-0000-4000-8000-000000000051'] });
      const lisaId = (await API('/pos/deals-offers/library?q=Lisa%208%25&status=all')).items[0].id;
      const wider = await page.evaluate(async (id) => (await fetch('/api/v1/pos/deals/' + id, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ discountPercent: 9 }) })).status, lisaId);
      const vishal = (await API('/pos/deals-offers/library?q=vishal&status=all')).items.find((x) => !/\(copy\)/.test(x.name ?? x.title ?? ''));
      const none = (await API('/pos/deals-offers/library?q=Lisa%2015%25&status=all')).totalItems;
      expect(r15.status === 400 && /10% cap/.test(JSON.stringify(r15.body)) && none === 0 && wider === 409 && vishal.dealStatus === 'active' && vishal.discountPercent === 20, `15% ${r15.status} ${JSON.stringify(r15.body).slice(0, 90)} · widen ${wider} · vishal ${vishal.dealStatus}`);
      return `15% → ${r15.status} "${(r15.body?.error?.message ?? r15.body?.message ?? '').slice(0, 60)}" (nothing saved) · 8%→9% on approved → ${wider} · vishal 20% ${vishal.dealStatus}`;
    }],
    ['do: lifecycle — Pause Spring time from the row (history kept, checker says Paused), Resume brings it back', async () => {
      await open(); await rowOf('Spring time').locator(tid('deal-pause')).click(); await settle();
      const note = await T(tid('note')); const st = await J('/__do?state=1');
      const sid = (await API('/pos/deals-offers/library?q=Spring%20time&status=all')).items[0].id;
      const chk = await post(`/pos/deals-offers/${sid}/check`, { spendCents: 1000 });
      expect(/paused/.test(note) && st.spring_status === 'paused' && st.spring_count === 1 && chk.body?.verdict === 'PAUSED', `pause ${note} · ${st.spring_status} · check ${chk.body?.verdict}`);
      await rowOf('Spring time').locator(tid('deal-resume')).click(); await settle();
      const st2 = await J('/__do?state=1'); expect(st2.spring_status === 'active' && st2.spring_count === 1, 'resume ' + st2.spring_status);
      return `paused (${chk.body.verdict} at the checker, count kept ${st.spring_count}) → resumed ${st2.spring_status}`;
    }],
    ['do: Details overlay — Overview / Eligibility / Limits / Items / Redemptions / Approvals & policy / Performance / History, with Close', async () => {
      await open(); await rowOf('Spring time').locator(tid('deal-view')).click(); await page.waitForSelector(tid('dlg-discount')); await settle();
      for (const t of ['overview', 'eligibility', 'limits', 'items', 'redemptions', 'approvals', 'performance', 'history']) { await page.click(tid('dd-tab-' + t)); await settle(); }
      await page.click(tid('dd-tab-approvals')); await settle(); const ap = await T(tid('dd-approvals-body'));
      await page.click(tid('dd-tab-performance')); await settle(); const pf = await T(tid('dd-performance-body'));
      expect(/Approved/.test(ap) && /Salon deal/.test(ap) && /\$0\.50/.test(pf), `approvals ${ap.slice(0, 80)} · perf ${pf.slice(0, 80)}`);
      await shot('06-details'); await page.click(tid('dd-close')); await page.waitForSelector(tid('dlg-discount'), { state: 'detached' });
      return `approvals: ${ap.replace(/\s+/g, ' ').slice(0, 70)} · performance: ${pf.replace(/\s+/g, ' ').slice(0, 70)}`;
    }],
    ['do: Deals Assistant — a suggestion from the salon\'s own tickets saved as a DRAFT salon deal (no code); nothing activated or sent', async () => {
      const before = await J('/__do?state=1');
      await open(); await page.click(tid('assistant')); await page.waitForSelector(tid('dlg-assistant'));
      await page.selectOption(tid('assist-goal'), 'promote_service'); await page.click(tid('assist-suggest')); await page.waitForSelector(tid('assist-result'));
      expect((await page.locator(tid('assist-code')).count()) === 0, 'no code field');
      await page.fill(tid('assist-pct'), '10'); await page.click(tid('assist-save')); await page.waitForSelector(tid('dlg-assistant'), { state: 'detached' }); await settle();
      const after = await J('/__do?state=1'); const first = (await rows())[0] ?? '';
      expect(after.deal_drafts === before.deal_drafts + 1 && after.assistant_rows === before.assistant_rows + 1 && after.notifications === before.notifications, 'assistant ' + JSON.stringify([before, after]).slice(0, 160));
      return `draft deals ${before.deal_drafts} → ${after.deal_drafts} · audit rows ${after.assistant_rows} · notifications unchanged (${after.notifications}) · first row "${first.slice(0, 50)}"`;
    }],
    ['do: Check Deal System — verified checks only (Ready / Attention / Unknown), incl. approval backlog and technician policy', async () => {
      await open(); await page.click(tid('check-system')); await page.waitForSelector(tid('health-checks')); await settle();
      const o = await T(tid('health-overall')); const h = await API('/pos/deals-offers/health');
      expect(o === { ready: 'Ready', attention: 'Attention', unknown: 'Unknown', failed: 'Failed' }[h.overall] && h.checks.length === 7 && h.checks.some((c) => c.key === 'tech_policy') && h.checks.some((c) => c.key === 'approval_backlog'), `overall ${o} vs ${h.overall}`);
      await shot('07-health');
      return `overall ${o} · ${h.checks.map((c) => c.key + ':' + c.status).join(' · ')}`;
    }],
    ['do: Front Desk — no Marketing access in the role policy: the screen says so; library, decisions and drafts are refused by the server (403)', async () => {
      const lisaId = (await API('/pos/deals-offers/library?q=Lisa%208%25&status=all')).items[0].id;
      await J('/__role?r=FRONT_DESK'); await open();
      const lib = await page.evaluate(async () => (await fetch('/api/v1/pos/deals-offers/library')).status);
      const pause = await post(`/pos/deals/${lisaId}/pause`, {}); const draft = await post('/pos/deals-offers/assistant/draft', { goal: 'slow_weekdays' });
      const msg = await T(tid('deals-screen'));
      await J('/__role?r=OWNER');
      expect(lib === 403 && pause.status === 403 && draft.status === 403 && /permission|access/i.test(msg), `lib ${lib} pause ${pause.status} draft ${draft.status} msg ${msg.slice(0, 60)}`);
      return `library ${lib} · pause ${pause.status} · draft ${draft.status} · "${msg.replace(/\s+/g, ' ').slice(0, 60)}"`;
    }],
    ['do: Vietnamese — title, policy strip, tabs and cards in Vietnamese; the same $10.00 → $9.50', async () => {
      await open(); const en = await kpiV('kpi-total');
      await J('/__lang?l=vi'); await open(); await noJunk();
      const h1 = await T(`${tid('deals-screen')} h1`); const tab = await T(tid('tab-approvals')); const pol = await T(tid('tech-policy'));
      await find('Spring time');   // other harness sections add newer deals, so Spring time may not be on page 1
      const sp = (await rows()).find((r) => /Spring time/.test(r)) ?? '';
      await shot('08-vietnamese'); await find('');
      expect(/Ưu đãi/.test(h1) && /Duyệt/.test(tab) && /cần quản lý duyệt/.test(pol) && /\$10\.00 → \$9\.50/.test(sp) && (await kpiV('kpi-total')) === en, `vi ${h1} · ${tab} · ${pol.replace(/\s+/g, ' ').slice(0, 90)} · sp ${sp.replace(/\s+/g, ' ').slice(0, 80)}`);
      await J('/__lang?l=en');
      return `vi "${h1}" · "${tab}" · "${pol.slice(0, 60)}" · total ${en}`;
    }],
    ['do: layout — 1920×945 · 1366×768 · 1280×720 · 1024×768: vertical scroll only (no sideways page scroll), overlays fit with Close', async () => {
      const out = [];
      for (const [w, h] of [[1920, 945], [1366, 768], [1280, 720], [1024, 768]]) {
        await page.setViewportSize({ width: w, height: h }); await open(); await page.waitForTimeout(300);
        const f = await fit(); expect(f.h <= 0, `${w}×${h} sideways scroll ${f.h}px`);
        await shot(`do-${w}x${h}`); out.push(`${w}×${h} ok`);
      }
      await page.setViewportSize({ width: 1280, height: 720 }); await open('?tab=approvals'); await page.locator(tid('approval-open')).first().click().catch(() => undefined);
      const dlg = await page.locator(tid('dlg-decide')).count();
      if (dlg) { const b = await page.locator(tid('dlg-decide')).boundingBox(); expect(!b || b.height <= 720, 'dialog fits ' + b?.height); await page.click(tid('decide-close')); }
      await page.setViewportSize({ width: 1920, height: 945 });
      return out.join(' · ') + (dlg ? ' · review overlay fits 1280×720' : '');
    }],
  ];
};
