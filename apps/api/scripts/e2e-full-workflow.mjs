// e2e-full-workflow.mjs — the COMPLETE cross-surface workflow over HTTP against a running API (sandbox payments on):
//   login → create service+technician → walk-in check-in → queue → assign → start serving → mark done →
//   service-done → quality check → checkout → tip → CARD payment (sandbox) → then assert the sale PROPAGATES to
//   checkout KPIs (paid tickets, surcharge collected, tax collected), reports revenue, and the technician's credit.
//
// Parameterized by env so it runs against any seeded tenant (defaults to the e2e PALACE tenant):
//   E2E_BASE, E2E_SALON, E2E_OWNER_EMAIL, E2E_OWNER_PASSWORD
// Requires the API to be running with PAYMENTS_SANDBOX=1 (so card payments approve in test mode).
const BASE = process.env.E2E_BASE || 'http://127.0.0.1:3000';
const SALON = process.env.E2E_SALON || 'PALACE';
const OWNER_EMAIL = process.env.E2E_OWNER_EMAIL || 'owner@palace.test';
const OWNER_PW = process.env.E2E_OWNER_PASSWORD || 'Owner!2345';

let cookie = ''; let pass = 0, fail = 0;
const snip = (j) => { try { return JSON.stringify(j).slice(0, 160); } catch { return String(j); } };
const mark = (name, ok, extra = '') => { console.log(`${ok ? '✅' : '❌'} ${name}${extra ? ' — ' + extra : ''}`); ok ? pass++ : fail++; return ok; };
async function req(method, path, body) {
  const res = await fetch(BASE + path, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const sc = res.headers.get('set-cookie'); if (sc) { const m = sc.match(/aps_session=[^;]+/); if (m) cookie = m[0]; }
  let json = null; try { json = await res.json(); } catch { /* */ }
  return { status: res.status, json };
}
const num = (v) => (typeof v === 'number' ? v : 0);
const rnd = Math.floor(1000 + Math.random() * 8999);

(async () => {
  // 0) login
  let r = await req('POST', '/auth/login', { portal: 'tenant', salonCode: SALON, identifier: OWNER_EMAIL, password: OWNER_PW });
  if (!mark('owner login', r.status === 200 && r.json?.outcome === 'SUCCESS', `${r.status} ${r.json?.outcome || snip(r.json)}`) || !cookie) { console.log('\nABORT: no session'); process.exit(1); }

  // 1) confirm sandbox payments are ON (card testable)
  r = await req('GET', '/pos/checkout/settings');
  const sandboxOn = r.json?.fiservStatus === 'sandbox' || r.json?.fiservStatus === 'connected';
  mark('card processing available (sandbox/connected)', sandboxOn, `fiservStatus=${r.json?.fiservStatus}`);

  // 2) BEFORE snapshot — checkout KPIs + reports revenue
  const beforeK = (await req('GET', '/pos/checkout/kpis')).json || {};
  const beforeRResp = (await req('GET', '/pos/reports/kpis')).json || {};
  const revOfBefore = (o) => num(o.grossSalesCents) || num(o.netSalesCents) || num(o.totalRevenueCents);
  const before = {
    paidTickets: num(beforeK.paidTicketsToday), surcharge: num(beforeK.cardSurchargeCollectedCents),
    tax: num(beforeK.taxCollectedCents), revenue: revOfBefore(beforeRResp),
  };
  mark('baseline snapshot captured', true, `paid=${before.paidTickets} surcharge=${before.surcharge} tax=${before.tax} revenue=${before.revenue}`);

  // 3) build a service + technician
  r = await req('POST', '/pos/services/categories', { name: 'E2E WF ' + rnd, colorKey: 'gold' });
  const categoryId = r.json?.categoryId || r.json?.id; mark('create category', r.status < 300 && !!categoryId, `${r.status}`);
  r = await req('POST', '/pos/services', { name: 'E2E WF Mani ' + rnd, categoryId, durationMinutes: 30, priceCents: 6000, status: 'active' });
  const serviceId = r.json?.serviceId || r.json?.id; mark('create service ($60)', r.status < 300 && !!serviceId, `${r.status}`);
  r = await req('POST', '/pos/technicians', { firstName: 'E2E', lastName: 'WF' + rnd, status: 'active', serviceIds: [serviceId] });
  const technicianId = r.json?.technicianId || r.json?.id; mark('create technician', r.status < 300 && !!technicianId, `${r.status}`);

  // 4) walk-in → queue → assign → serve → done → service-done → QC → checkout
  r = await req('POST', '/pos/check-in/walk-in', { customerName: 'E2E WF Cust ' + rnd, customerPhone: '+1609' + rnd + '0123', serviceIds: [serviceId], technicianId, isNewCustomer: true });
  const checkInId = r.json?.checkInId; mark('walk-in check-in', r.status < 300 && !!checkInId, `${r.status}`);
  r = await req('POST', `/pos/check-in/${checkInId}/move-to-queue`); const queueItemId = r.json?.queueItemId; mark('move to queue', r.status < 300 && !!queueItemId, `${r.status}`);
  r = await req('POST', `/pos/queue/items/${queueItemId}/assign-technician`, { technicianId }); mark('assign technician', r.status < 300, `${r.status}`);
  r = await req('POST', `/pos/queue/items/${queueItemId}/start-service`); const servingTicketId = r.json?.servingTicketId || queueItemId; mark('start service (→ serving)', r.status < 300, `${r.status}`);
  r = await req('POST', `/pos/serving/tickets/${servingTicketId}/mark-service-done`); mark('mark service done', r.status < 300, `${r.status}`);
  r = await req('POST', `/pos/serving/tickets/${servingTicketId}/send-to-service-done`); const sdId = r.json?.serviceDoneTicketId || servingTicketId; mark('send to service-done', r.status < 300, `${r.status}`);
  r = await req('POST', `/pos/service-done/tickets/${sdId}/quality-check`, { result: 'approved' }); mark('quality check (approved)', r.status < 300, `${r.status}`);
  r = await req('POST', `/pos/service-done/tickets/${sdId}/send-to-checkout`); const coId = r.json?.checkoutTicketId || sdId; mark('send to checkout', r.status < 300, `${r.status}`);

  // 5) tip + CARD payment (sandbox)
  r = await req('POST', `/pos/checkout/tickets/${coId}/apply-tip`, { tipType: 'custom', tipAmountCents: 800, source: 'front_desk' }); mark('apply tip ($8)', r.status < 300, `${r.status}`);
  r = await req('POST', `/pos/checkout/tickets/${coId}/pay/card`, {});
  const payStatus = r.json?.status || r.json?.payment?.status;
  const txn = r.json?.processorTransactionId || r.json?.payment?.processorTransactionId || '';
  const cardOk = r.status < 300 && payStatus === 'approved';
  mark('pay CARD (sandbox → approved)', cardOk, `${r.status} status=${payStatus} txn=${txn} amount=${r.json?.approvedAmountCents}`);
  mark('card payment labeled sandbox (sbx_)', txn.startsWith('sbx_'), `txn=${txn}`);

  // 6) AFTER snapshot — assert the sale propagated
  const afterK = (await req('GET', '/pos/checkout/kpis')).json || {};
  const afterRResp = (await req('GET', '/pos/reports/kpis')).json || {};
  const revOf = (o) => num(o.grossSalesCents) || num(o.netSalesCents) || num(o.totalRevenueCents);
  const after = {
    paidTickets: num(afterK.paidTicketsToday), surcharge: num(afterK.cardSurchargeCollectedCents),
    tax: num(afterK.taxCollectedCents), revenue: revOf(afterRResp),
  };
  mark('PROPAGATION: paid tickets +1', after.paidTickets === before.paidTickets + 1, `${before.paidTickets} → ${after.paidTickets}`);
  mark('PROPAGATION: card surcharge collected increased', after.surcharge > before.surcharge, `${before.surcharge} → ${after.surcharge} (+${after.surcharge - before.surcharge})`);
  mark('PROPAGATION: tax collected increased', after.tax > before.tax, `${before.tax} → ${after.tax} (+${after.tax - before.tax})`);
  mark('PROPAGATION: reports revenue increased', after.revenue > before.revenue, `${before.revenue} → ${after.revenue} (+${after.revenue - before.revenue})`);

  // 7) technician earnings/credit propagated (owner-side reports/technicians leaderboard)
  r = await req('GET', '/pos/reports/technicians');
  const rows = Array.isArray(r.json) ? r.json : (r.json?.technicians || r.json?.rows || r.json?.items || []);
  const techRow = rows.find((t) => (t.technicianId || t.id) === technicianId);
  mark('PROPAGATION: technician credited (reports/technicians)', !!techRow && (num(techRow.completedServices) >= 1 || num(techRow.revenueCents) > 0),
    techRow ? `services=${techRow.completedServices} revenue=${techRow.revenueCents}` : 'tech row not found');

  console.log(`\n${fail === 0 ? '✅ FULL WORKFLOW GREEN' : '❌ FAILURES'}: ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error('THREW:', e); process.exit(1); });
