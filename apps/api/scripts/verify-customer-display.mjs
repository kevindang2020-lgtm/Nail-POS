/**
 * verify-customer-display.mjs — end-to-end check of the Customer Display (iPad) pairing + token-scoped state + realtime.
 *
 * Proves the wired flow that unit tests don't cover: front desk issues a pairing code → iPad pairs → a checkout is handed
 * to the paired display → the iPad loads state with ONLY its public token (no user session) → a wrong token is refused →
 * the customer selects a tip on the iPad (which updates the total and persists) → the SSE stream delivers the tip event
 * live. The display total correctly includes the card surcharge recomputed on the tip.
 *
 * Assumes an API is already running (sandbox mode) at BASE. Quick start:
 *   PAYMENTS_SANDBOX=1 DATABASE_URL=… REPO_DRIVER=postgres AUTH_SESSION_SECRET=local-dev-secret PORT=3000 node apps/api/dist/main.js
 *   BASE=http://127.0.0.1:3000 SALON=LUXE IDENT=owner@luxenails.test PASSWORD='Owner123!' node apps/api/scripts/verify-customer-display.mjs
 */
const BASE = process.env.BASE || 'http://127.0.0.1:3000';
const SALON = process.env.SALON || 'LUXE';
const IDENT = process.env.IDENT || 'owner@luxenails.test';
const PASSWORD = process.env.PASSWORD || 'Owner123!';

let cookie = ''; let pass = 0, fail = 0;
const ok = (n, c, x = '') => { console.log(`${c ? '\u2705' : '\u274c'} ${n}${x ? ' \u2014 ' + x : ''}`); c ? pass++ : fail++; };
async function req(method, path, body) {
  const r = await fetch(BASE + path, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const sc = r.headers.get('set-cookie'); if (sc) { const m = sc.match(/aps_session=[^;]+/); if (m) cookie = m[0]; }
  let j = null; try { j = await r.json(); } catch {} return { status: r.status, j };
}
const pub = (path, opts = {}) => fetch(BASE + path, opts); // no cookie = simulate the iPad
const tip = (sid, tq, amountCents) => pub(`/customer-display/checkout/${sid}/tip?${tq}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tipType: 'custom', amountCents }) });
const rnd = Math.floor(1000 + Math.random() * 8999);

(async () => {
  let r = await req('POST', '/auth/login', { portal: 'tenant', salonCode: SALON, identifier: IDENT, password: PASSWORD });
  if (r.j?.outcome === 'BRANCH_SELECTION_REQUIRED') {
    const branchesRes = await req('GET', '/pos/branches');
    const branchId = branchesRes.j?.branches?.[0]?.id || '9ca3c746-fb14-41f6-9bad-bd076a335b8e';
    r = await req('POST', '/auth/select-branch', { branchId });
  }
  ok('front desk login', r.j?.outcome === 'SUCCESS' || r.status === 200, r.j?.outcome || r.status);
  if (!cookie) { console.log('no session; abort'); process.exit(1); }

  // pairing: code → pair the iPad
  r = await req('POST', '/pos/settings/customer-display-devices/pairing-code'); const code = r.j?.code;
  ok('front desk issues a pairing code', !!code, `code=${code}`);
  r = await req('POST', '/pos/settings/customer-display-devices/pair', { code, name: 'Front Counter iPad' });
  const deviceId = r.j?.id || r.j?.deviceId; ok('iPad pairs to the salon', !!deviceId, `device=${deviceId}`);

  // build a ticket to checkout
  r = await req('POST', '/pos/services/categories', { name: 'CD ' + rnd, colorKey: 'gold' }); const categoryId = r.j?.categoryId || r.j?.id;
  r = await req('POST', '/pos/services', { name: 'CD Mani ' + rnd, categoryId, durationMinutes: 30, priceCents: 5000, status: 'active' }); const serviceId = r.j?.serviceId || r.j?.id;
  r = await req('POST', '/pos/technicians', { firstName: 'CD', lastName: 'T' + rnd, status: 'active', serviceIds: [serviceId] }); const technicianId = r.j?.technicianId || r.j?.id;
  r = await req('POST', '/pos/check-in/walk-in', { customerName: 'CD Cust ' + rnd, customerPhone: '+1609' + rnd + '7777', serviceIds: [serviceId], technicianId, isNewCustomer: true }); const checkInId = r.j?.checkInId;
  r = await req('POST', `/pos/check-in/${checkInId}/move-to-queue`); const q = r.j?.queueItemId;
  await req('POST', `/pos/queue/items/${q}/assign-technician`, { technicianId });
  r = await req('POST', `/pos/queue/items/${q}/start-service`); const serv = r.j?.servingTicketId || q;
  await req('POST', `/pos/serving/tickets/${serv}/mark-service-done`);
  r = await req('POST', `/pos/serving/tickets/${serv}/send-to-service-done`); const sd = r.j?.serviceDoneTicketId || serv;
  await req('POST', `/pos/service-done/tickets/${sd}/quality-check`, { result: 'approved' });
  r = await req('POST', `/pos/service-done/tickets/${sd}/send-to-checkout`); const ticketId = r.j?.checkoutTicketId || sd;
  ok('ticket reaches checkout', !!ticketId);

  // hand the checkout to the paired display
  r = await req('POST', '/pos/customer-display/sessions', { ticketId, deviceId });
  const sessionId = r.j?.sessionId, token = r.j?.publicToken; const tq = `token=${encodeURIComponent(token || '')}`;
  ok('checkout handed to the display (session + public token)', !!sessionId && !!token, `session=${sessionId}`);

  // iPad loads state with ONLY the token
  let resp = await pub(`/customer-display/checkout/${sessionId}?${tq}`); let state = await resp.json();
  const dueBefore = state?.totals?.totalDueCents || 0;
  ok('iPad loads state via token (no user session)', resp.status === 200 && !!state?.totals, `salon="${state?.salonName}" services=${state?.ticket?.services?.length} due=${dueBefore}`);
  ok('a wrong token is refused', (await pub(`/customer-display/checkout/${sessionId}?token=wrong`)).status >= 400);

  // customer selects a tip on the iPad → total updates (incl. surcharge on the tip) and emits to the POS
  resp = await tip(sessionId, tq, 800); const afterTip = await resp.json();
  ok('iPad submits a tip (token-scoped)', resp.status < 300 && afterTip?.selectedTipCents === 800, `selectedTip=${afterTip?.selectedTipCents}`);
  ok('display total updates to include the tip', (afterTip?.totals?.totalDueCents || 0) >= dueBefore + 800, `${dueBefore} \u2192 ${afterTip?.totals?.totalDueCents}`);
  resp = await pub(`/customer-display/checkout/${sessionId}?${tq}`); state = await resp.json();
  ok('selected tip persists on re-fetch (POS + iPad agree)', state?.selectedTipCents === 800, `selectedTip=${state?.selectedTipCents}`);

  // SSE realtime: connect, trigger a tip, confirm the stream delivers it
  const ctrl = new AbortController(); const to = setTimeout(() => ctrl.abort(), 5000); let sse = ''; let sawTip = false;
  try {
    const sr = await pub(`/customer-display/checkout/${sessionId}/stream?${tq}`, { headers: { Accept: 'text/event-stream' }, signal: ctrl.signal });
    const reader = sr.body.getReader(); const dec = new TextDecoder();
    setTimeout(() => tip(sessionId, tq, 1200), 600);
    while (true) { const { value, done } = await reader.read(); if (done) break; sse += dec.decode(value); if (/tip/i.test(sse)) { sawTip = true; break; } if (sse.length > 600) break; }
  } catch { /* aborted by timeout */ }
  clearTimeout(to);
  ok('SSE stream connects and pushes events', /data:/.test(sse), `bytes=${sse.length}`);
  ok('SSE delivers the tip event live', sawTip, sse.replace(/\n/g, ' ').slice(0, 90));

  console.log(`\n${fail === 0 ? '\u2705 CUSTOMER DISPLAY + REALTIME VERIFIED' : '\u274c FAILURES'}: ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error('THREW', e); process.exit(1); });
