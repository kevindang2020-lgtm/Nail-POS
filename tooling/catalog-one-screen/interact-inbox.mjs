// interact-inbox.mjs — Communications / SMS Inbox steps of the catalog E2E (Communications guide + Addendum, Oct 30 2026): the REAL
// screen in Chromium against the REAL inbox controller / service / SQL, the real messenger (fake Twilio only) and the real signed
// webhook. `node tooling/catalog-one-screen/interact.mjs <label> inbox`
export const STEPS_INBOX = ({ page, expect, settle, go, tid, noJunk, API, SQL, J, BASE, today, addDays, T, rowsText }) => {
  const open = (qs = '') => go('/tenant/communications/sms' + qs, tid('comms-inbox'));
  const threads = () => rowsText(`${tid('ci-thread')} .ci-name`);
  const ids = async () => page.locator(tid('ci-thread')).evaluateAll((els) => els.map((e) => e.getAttribute('data-thread-id')));
  const seeded = async () => J('/__seeded');
  // a conversation is opened by its id in the URL (the same state a click writes) — it may sit on another page of the list
  const openThread = async (id) => { const u = new URL(page.url()); u.searchParams.set('thread', id); await page.goto(u.toString(), { waitUntil: 'load' }); await page.waitForSelector(tid('ci-conv-head')); await settle(); };
  const bubbles = () => page.locator(tid('ci-bubble')).count();
  const waitFor = async (fn, ms = 8000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return true; await page.waitForTimeout(250); } return false; };
  return [
    ['inbox: the original modules stay — 13 KPI tiles, the split inbox, 6 lower modules, 7 quick actions; counts = the server', async () => {
      await J('/__tenant?name=pilot'); await J('/__role?r=OWNER'); await open(); await noJunk();
      const tiles = await page.locator('.ci-kpi').count(); expect(tiles === 13, 'tiles ' + tiles);
      const s = await API('/pos/communications/inbox/summary');
      const v = async (t) => (await T(`${tid(t)} .ci-kpi-v`)).trim();
      expect(await v('kpi-open') === String(s.conversations.open), 'open'); expect(await v('kpi-unread') === String(s.conversations.unreadThreads), 'unread'); expect(await v('kpi-total') === String(s.conversations.total), 'total');
      expect(await page.locator('.ci-mods .ci-card').count() === 6, 'lower modules'); expect(await page.locator(`${tid('ci-quick')} button`).count() === 7, 'quick actions');
      expect(await page.locator(tid('ci-list')).count() === 1 && await page.locator(tid('ci-conv')).count() === 1, 'split');
      return `open ${s.conversations.open} · unread ${s.conversations.unreadThreads} · total ${s.conversations.total} · waiting ${s.conversations.awaiting}`;
    }],
    ['inbox: newest activity first; 10 per page → pages 1 / 2 / 3 disjoint; page + size in the URL, search text never', async () => {
      await open('?size=10'); const p1 = await ids(); expect(p1.length === 10, 'p1 ' + p1.length);
      const api = await API('/pos/communications/inbox/threads?pageSize=10'); expect(api.items[0].id === p1[0], 'newest first = server');
      const acts = api.items.map((x) => Date.parse(x.lastActivityAt)); expect(acts.every((a, i) => i === 0 || a <= acts[i - 1]), 'activity descending');
      await page.click(tid('pg-2')); await settle(); const p2 = await ids(); await page.click(tid('pg-3')); await settle(); const p3 = await ids();
      expect(new Set([...p1, ...p2, ...p3]).size === p1.length + p2.length + p3.length, 'disjoint'); expect(/page=3/.test(page.url()) && /size=10/.test(page.url()), 'url ' + page.url());
      await page.fill(tid('ci-search'), '8565551200'); await page.waitForTimeout(500); await settle();
      expect(!/8565551200|555/.test(page.url()), 'search text in URL ' + page.url()); expect(/page=/.test(page.url()) === false, 'search resets to page 1');
      await page.goBack(); await settle();
      return `p1 ${p1.length} · p2 ${p2.length} · p3 ${p3.length}`;
    }],
    ['inbox: one search box — name, phone in 3 formats, message text; another salon never appears', async () => {
      const out = [];
      for (const term of ['Mai Le', '8565551200', '(856) 555-1200', '+1 856 555 1200', 'gel manicure']) {
        await open(); await page.fill(tid('ci-search'), term); await page.waitForTimeout(500); await settle();
        const r = await threads(); expect(r.length >= 1 && r[0] === 'Mai Le', term + ' → ' + r.join('|')); out.push(`${term}→${r.length}`);
      }
      const body = await page.locator('body').innerText(); expect(!/OTHER SALON PRIVATE TEXT|Mai Elsewhere/.test(body), 'other salon leaked');
      return out.join(' · ');
    }],
    ['inbox: Longest unanswered puts the oldest waiting customer first; an answered conversation never outranks it', async () => {
      await open('?sort=oldest_unanswered&size=10');
      const api = await API('/pos/communications/inbox/threads?sort=oldest_unanswered&pageSize=10');
      const firstUi = (await ids())[0]; expect(firstUi === api.items[0].id, 'ui = server');
      const w = api.items.filter((x) => x.awaitingSince).map((x) => Date.parse(x.awaitingSince)); expect(w.every((a, i) => i === 0 || a >= w[i - 1]), 'waiting ascending');
      const firstAnswered = api.items.findIndex((x) => !x.awaitingSince); const lastWaiting = api.items.map((x) => !!x.awaitingSince).lastIndexOf(true);
      expect(firstAnswered === -1 || firstAnswered > lastWaiting, 'answered after every waiting one');
      const chip = (await T(`${tid('ci-thread')} .ci-wait`)).trim();
      return `first: ${api.items[0].displayName ?? api.items[0].identity} (${chip})`;
    }],
    ['inbox: Mai Le — identity, appointment, chronological messages with evidence-based delivery; the timeline joins every source in order', async () => {
      const s = await seeded(); await open(); await openThread(s.inboxMai);
      expect(/phone match/i.test(await T(tid('ci-conv-head'))), 'identity'); expect(/Next appointment/.test(await T(tid('ci-conv-head'))), 'appointment');
      const dl = await page.locator(`${tid('ci-bubble')}[data-delivery="delivered"]`).count(); expect(dl >= 1, 'a delivered reply');
      await page.click(tid('tab-timeline')); await page.waitForSelector(tid('ci-event')); await settle();
      const types = await page.locator(tid('ci-event')).evaluateAll((els) => els.map((e) => e.getAttribute('data-type')));
      for (const t of ['customer_message', 'staff_reply', 'appointment_reminder', 'review_request', 'ai_call', 'appointment_booked']) expect(types.includes(t), 'missing ' + t + ' in ' + types);
      const tl = await API(`/pos/communications/inbox/threads/${s.inboxMai}/timeline`); const at = tl.events.map((e) => Date.parse(e.at)); expect(at.every((a, i) => i === 0 || a >= at[i - 1]), 'chronological');
      expect(/gel removal/.test(await T(tid('ci-timeline'))), 'call summary');
      await page.selectOption(tid('ci-tl-source'), 'call'); await settle(); expect((await page.locator(tid('ci-event')).count()) === 1, 'source filter');
      await page.click(tid('tab-conversation')); await settle();
      return types.join(' → ');
    }],
    ['inbox: a customer text arrives while staff type — the draft, the selection and the reading position stay; the new message appears', async () => {
      const s = await seeded(); await open(); await openThread(s.inboxMai);
      await page.fill(tid('ci-text'), 'Typing a reply that must survive'); const before = await bubbles();
      const r = await J('/__inbox?inbound=' + encodeURIComponent('+18565551200') + '&body=' + encodeURIComponent('One more question — can I add a pedicure?'));
      expect(r.inbound?.status === 'recorded', 'webhook ' + JSON.stringify(r));
      expect(await waitFor(async () => (await bubbles()) > before, 10000), 'live update did not arrive');
      expect((await page.inputValue(tid('ci-text'))) === 'Typing a reply that must survive', 'draft lost'); expect(/thread=/.test(page.url()) && page.url().includes(s.inboxMai), 'selection lost');
      return `${before} → ${await bubbles()} messages · draft kept · live mode ${await page.locator(tid('live-indicator')).getAttribute('data-mode')}`;
    }],
    ['inbox: sending is truthfully BLOCKED while carrier registration is pending (Pilot fixtures) — no provider call', async () => {
      const s = await seeded(); await J('/__inbox?ready=0'); await open(); await openThread(s.inboxMai);
      await page.waitForSelector(tid('ci-composer-blocked')); const why = (await T(tid('ci-composer-blocked'))).trim();
      expect(await page.locator(tid('ci-send')).isDisabled(), 'send disabled');
      return why.slice(0, 110);
    }],
    ['inbox: template fills an editable draft (never sends); one Send = one message even on a double click; Submitted → Delivered only from the signed callback', async () => {
      const s = await seeded(); await J('/__inbox?ready=1'); await open(); await openThread(s.inboxMai);
      const out0 = (await SQL('inboxOutCount'))[0].n;
      await page.fill(tid('ci-text'), ''); await page.click(tid('ci-templates')); await page.waitForSelector(tid('ci-tpl')); await page.locator(tid('ci-tpl')).first().click();
      // 740: the template is filled in for this conversation's customer by the server first (a round-trip), then lands in the draft
      await waitFor(async () => (await page.inputValue(tid('ci-text'))).length > 10, 5000);
      const filled = await page.inputValue(tid('ci-text')); expect(filled.length > 10, 'template text'); expect((await SQL('inboxOutCount'))[0].n === out0, 'template sent something');
      await page.fill(tid('ci-text'), filled + ' See you soon!');
      await page.locator(tid('ci-send')).dblclick(); await page.waitForSelector(tid('ci-note')); await settle();
      const n1 = (await SQL('inboxOutCount'))[0].n; expect(n1 === out0 + 1, 'messages ' + out0 + ' → ' + n1); const out = await SQL('inboxOut');
      expect(out[0].keyed && out[0].purpose === 'conversation' && out[0].ledger === 'sent', 'row ' + JSON.stringify(out[0]));
      const last = page.locator(tid('ci-bubble')).last(); expect((await last.getAttribute('data-delivery')) === 'submitted', 'submitted');
      const cb = await J('/__inbox?status=' + out[0].provider_id + '&s=delivered'); expect(cb.status?.status === 'recorded', 'callback ' + JSON.stringify(cb));
      expect(await waitFor(async () => (await page.locator(tid('ci-bubble')).last().getAttribute('data-delivery')) === 'delivered', 10000), 'Delivered did not appear');
      await J('/__inbox?ready=0');
      return `one message · ${out[0].provider_id.slice(0, 8)}… submitted → delivered (callback)`;
    }],
    ['inbox: the carrier-failed reply says so (30007) and the customer still counts as waiting', async () => {
      const s = await seeded(); await open(); await openThread(s.inboxFailed);
      const d = await T(`${tid('ci-bubble')}[data-delivery="undelivered"] ${tid('ci-delivery')}`); expect(/30007/.test(d), 'reason ' + d);
      const api = await API(`/pos/communications/inbox/threads/${s.inboxFailed}`); expect(api.thread.awaitingSince, 'still waiting');
      return d.trim();
    }],
    ['inbox: Unknown contact — Book asks for the verified customer first; linking is audited; Book then opens New Appointment with only the id', async () => {
      const s = await seeded(); await open(); await openThread(s.inboxUnknown);
      expect(/Not linked/.test(await T(tid('ci-conv-head'))), 'unknown identity');
      const before = (await SQL('inboxAppts'))[0].n;
      await page.click(tid('ci-book')); await page.waitForSelector(tid('ci-dlg-link')); expect(page.url().includes('/tenant/communications/sms'), 'did not navigate');
      await page.fill(tid('ci-cust-q'), 'Tina'); await page.waitForSelector(tid('ci-cust')); await page.locator(tid('ci-cust')).first().click(); await settle();
      expect(/linked by staff/.test(await T(tid('ci-conv-head'))), 'manual link');
      const ev = await SQL('inboxEvents'); expect(ev.some((e) => e.event_type === 'customer_linked'), 'event'); expect((await SQL('inboxAudit')).some((a) => a.action === 'inbox.customer_linked'), 'audit');
      await page.click(tid('ci-book')); await page.waitForURL(/\/booking\/new/); const url = page.url();
      expect(/customerId=[0-9a-f-]{36}/.test(url) && /from=communications/.test(url) && /conversationId=/.test(url) && !/2675550142|%2B1|\+1|phone=|name=/i.test(url), 'url ' + url);
      expect((await SQL('inboxAppts'))[0].n === before, 'an appointment was created by opening');
      return url.replace(BASE, '').replace(/[0-9a-f-]{36}/g, ':id');
    }],
    ['inbox: possible match (shared number) is never linked by guess; email and call conversations explain why they cannot be answered', async () => {
      const s = await seeded(); const out = [];
      for (const [tidv, want] of [[s.inboxAmbiguous, null], [s.inboxEmail, 'EMAIL_NOT_CONFIGURED'], [s.inboxCall, 'CALL_THREAD']]) {
        await open(); await openThread(tidv);
        if (!want) { expect(/2 customers share/.test(await T(tid('ci-conv-head'))), 'ambiguous'); out.push('ambiguous'); continue; }
        expect((await page.locator(tid('ci-composer-blocked')).getAttribute('data-reason')) === want, want); out.push(want);
      }
      return out.join(' · ');
    }],
    ['inbox: assign, follow-up and close are version-checked, evented and audited; Follow-up due sort brings it first', async () => {
      const s = await seeded(); await open(); await openThread(s.inboxAmbiguous);
      await page.click(tid('ci-assign')); await page.waitForSelector(tid('ci-staff')); await page.locator(tid('ci-staff')).filter({ hasText: 'Vy' }).first().click(); await settle();
      expect(/Vy Front Desk/.test(await T(tid('ci-conv-head'))), 'assigned');
      await page.click(tid('ci-follow')); await page.waitForSelector(tid('ci-dlg-follow')); await page.click('text=In 1 hour'); await page.click(tid('ci-follow-save')); await settle();
      await page.click(tid('ci-close')); await settle(); expect(/Reopen/.test(await T(tid('ci-close'))), 'closed');
      // a stale version (someone else changed it) is refused, not overwritten
      const d = await API(`/pos/communications/inbox/threads/${s.inboxAmbiguous}`);
      const stale = await fetch(BASE + `/api/v1/pos/communications/inbox/threads/${s.inboxAmbiguous}/status`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status: 'open', expectedVersion: d.thread.version - 1 }) }).then((r) => r.json());
      expect(stale.code === 'INBOX_VERSION_CONFLICT', 'stale ' + JSON.stringify(stale));
      await page.click(tid('ci-close')); await settle();
      const evs = (await SQL('inboxEvents')).map((e) => e.event_type); for (const e of ['assigned', 'snoozed', 'status_changed']) expect(evs.includes(e), e);
      await open('?sort=follow_up_due'); expect((await ids())[0] === s.inboxAmbiguous, 'follow-up due first');
      return `events ${[...new Set(evs)].join(', ')} · stale write → ${stale.code}`;
    }],
    ['inbox: custom From/To month calendar in the salon zone; end before start impossible; filter + page reset', async () => {
      await open('?page=2&size=10'); await page.selectOption(tid('ci-preset'), 'custom'); await page.waitForSelector(tid('range-calendar'));
      const from = addDays(today, -2);
      const cell = async (d) => { for (let i = 0; i < 4 && !(await page.locator(`${tid('range-calendar')} [data-ymd="${d}"]`).count()); i++) await page.locator(`${tid('range-calendar')} button[aria-label*="revious"]`).first().click(); return page.locator(`${tid('range-calendar')} [data-ymd="${d}"]`).first(); };
      await (await cell(from)).click(); await (await cell(today)).click(); await page.click(tid('range-apply')); await settle();
      expect(/preset=custom/.test(page.url()) && page.url().includes('from=' + from) && !/page=/.test(page.url()), 'url ' + page.url());
      const api = await API(`/pos/communications/inbox/threads?preset=custom&from=${from}&to=${today}&pageSize=50`);
      expect(api.period.tz === 'America/New_York' && api.period.from === from, 'period'); expect(/conversations/.test(await T(tid('ci-count'))), 'count');
      const bad = await fetch(BASE + `/api/v1/pos/communications/inbox/threads?preset=custom&from=${today}&to=${from}`).then((r) => r.json());
      expect(bad.code === 'DATE_RANGE_INVALID', 'reversed ' + JSON.stringify(bad));
      return `${from} → ${today}: ${api.total} conversations (America/New_York)`;
    }],
    ['inbox: New Message opens (or reuses) the customer conversation without sending anything', async () => {
      await open(); const out0 = (await SQL('inboxOutCount'))[0].n;
      await page.click(tid('ci-new')); await page.waitForSelector(tid('ci-dlg-new')); await page.fill(tid('ci-cust-q'), 'Rosa'); await page.waitForSelector(tid('ci-cust'));
      await page.locator(tid('ci-cust')).first().click(); await page.waitForSelector(tid('ci-conv-head')); await settle();
      expect(/Rosa/.test(await T(tid('ci-conv-name'))), 'opened'); expect((await SQL('inboxOutCount'))[0].n === out0, 'nothing sent');
      return (await T(tid('ci-conv-name'))).trim();
    }],
    ['inbox: the seven quick actions go to the real screens', async () => {
      const out = [];
      for (const [t, path] of [['qa-campaign', '/tenant/marketing/campaigns'], ['qa-reminder', '/tenant/communications/reminders'], ['qa-ai', '/tenant/communications/ai-receptionist'], ['qa-review', '/tenant/ai/reviews'], ['qa-template', '/tenant/communications/templates'], ['qa-reports', '/reports']]) {
        await open(); await page.click(tid(t)); await page.waitForURL((u) => u.pathname === path, { timeout: 8000 }); out.push(path);
      }
      await open(); await page.click(tid('qa-new')); await page.waitForSelector(tid('ci-dlg-new')); await page.keyboard.press('Escape'); out.push('New Message dialog');
      return out.join(' · ');
    }],
    ['inbox: an empty salon shows a guided empty state with real zeros; a technician is refused', async () => {
      await J('/__tenant?name=empty'); await open(); await page.waitForSelector(tid('ci-empty'));
      const v = (await T(`${tid('kpi-total')} .ci-kpi-v`)).trim(); expect(v === '0', 'total ' + v);
      expect(await page.locator(`${tid('ci-empty')} button`).count() === 2, 'New Message + Setup');
      await J('/__tenant?name=pilot'); await J('/__role?r=TECHNICIAN');
      const r = await fetch(BASE + '/api/v1/pos/communications/inbox/threads').then((x) => x.status); expect(r === 403, 'tech ' + r);
      await J('/__role?r=FRONT_DESK'); const f = await fetch(BASE + '/api/v1/pos/communications/inbox/threads').then((x) => x.status); expect(f === 200, 'desk ' + f);
      await J('/__role?r=OWNER');
      return `empty salon total ${v} · technician ${r} · front desk ${f}`;
    }],
    ['inbox: Vietnamese — the same screen, every label translated, no English codes', async () => {
      await J('/__lang?l=vi'); const s = await seeded(); await open(); await openThread(s.inboxMai); await noJunk();
      const body = await page.locator('.ci-page').innerText();
      expect(/Hộp thư SMS|Cuộc trò chuyện/.test(body), 'vi'); expect(!/\bci\.[a-z]/.test(body), 'raw key'); expect(!/oldest_unanswered|not_tracked|appointment_booked/.test(body), 'raw code');
      await J('/__lang?l=en');
      return 'vi ok';
    }],
  ];
};
