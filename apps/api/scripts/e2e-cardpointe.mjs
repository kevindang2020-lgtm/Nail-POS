// e2e-cardpointe.mjs — exercises the REAL CardPointeClient code path end-to-end against a local CardPointe-shaped mock
// gateway (scripts/cardpointe-mock-server.mjs). The API must be booted with CARDPOINTE_* pointing at the mock, so
// resolvePaymentStatus() => 'connected' and card auth/refund/void route through the live client (NOT the sandbox synth).
// Proof of the real path: approved card payments carry the mock's retref ('MOCK-AUTH-…'), refunds/voids succeed, and a
// canonical decline PAN returns status 'declined' with a 'MOCK-DECL-…' ref. The only thing not exercised here is the real
// Fiserv host.
const BASE = process.env.E2E_BASE || 'http://127.0.0.1:3000';
const DECLINE_ACCOUNT = '4000000000000002';
let pass = 0, fail = 0;
const snip = (j) => { try { return JSON.stringify(j).slice(0, 160); } catch { return String(j); } };
const mark = (n, ok, extra = '') => { console.log(`${ok ? '✅' : '❌'} ${n}${extra ? ' — ' + extra : ''}`); ok ? pass++ : fail++; return ok; };
function mkClient() { let cookie = '';
  return async (method, path, body) => {
    const res = await fetch(BASE + path, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const sc = res.headers.get('set-cookie'); if (sc) { const m = sc.match(/aps_session=[^;]+/); if (m) cookie = m[0]; }
    let json = null; try { json = await res.json(); } catch {}
    return { status: res.status, json }; };
}
const rnd = Math.floor(1000 + Math.random() * 8999);
const api = mkClient();

let ticketSeq = 0;
async function newPaidCardTicket(token) {
  ticketSeq += 1;
  const phone = '+1856' + (rnd * 100 + ticketSeq);
  let r = await api('POST', '/pos/check-in/walk-in', { customerName: `CP Cust ${rnd}-${ticketSeq}`, customerPhone: phone, serviceIds: [serviceId], technicianId, isNewCustomer: true });
  const ci = r.json?.checkInId; r = await api('POST', `/pos/check-in/${ci}/move-to-queue`); const q = r.json?.queueItemId;
  await api('POST', `/pos/queue/items/${q}/assign-technician`, { technicianId });
  r = await api('POST', `/pos/queue/items/${q}/start-service`); const t = r.json?.servingTicketId || q;
  await api('POST', `/pos/serving/tickets/${t}/mark-service-done`);
  await api('POST', `/pos/serving/tickets/${t}/send-to-service-done`);
  await api('POST', `/pos/service-done/tickets/${t}/quality-check`, { result: 'approved' });
  await api('POST', `/pos/service-done/tickets/${t}/send-to-checkout`);
  return api('POST', `/pos/checkout/tickets/${t}/pay/card`, { cardToken: token, expiry: '1229' });
}

let serviceId, technicianId;
(async () => {
  let r = await api('POST', '/auth/login', { portal: 'tenant', salonCode: 'PALACE', identifier: 'owner@palace.test', password: 'Owner!2345' });
  mark('owner login', r.status === 200 && r.json?.outcome === 'SUCCESS', `${r.status}`);
  r = await api('POST', '/pos/services/categories', { name: 'CP Nails ' + rnd, colorKey: 'gold' }); const categoryId = r.json?.categoryId || r.json?.id;
  r = await api('POST', '/pos/services', { name: 'CP Mani ' + rnd, categoryId, durationMinutes: 30, priceCents: 5000, status: 'active' }); serviceId = r.json?.serviceId || r.json?.id;
  r = await api('POST', '/pos/technicians', { firstName: 'CP', lastName: 'Tech' + rnd, status: 'active', serviceIds: [serviceId] }); technicianId = r.json?.technicianId || r.json?.id;
  mark('setup (service + skilled tech)', !!(serviceId && technicianId), `svc=${!!serviceId} tech=${!!technicianId}`);

  // 1) approved card sale via the real client -> carries the mock retref (proves NOT sandbox 'sbx_')
  r = await newPaidCardTicket('9418594164541111');
  const payId = r.json?.paymentId; const txn = r.json?.processorTransactionId;
  mark('card sale approved via live client', r.status < 300 && r.json?.status === 'approved' && typeof txn === 'string' && txn.startsWith('MOCK-AUTH'), `${r.status} status=${r.json?.status} txn=${txn}`);

  // 2) refund that payment via the real client
  r = await api('POST', `/pos/checkout/payments/${payId}/refund`, { reason: 'customer changed mind' });
  mark('refund processed via live client', r.status < 300 && r.json?.status === 'refunded', `${r.status} ${r.json?.status || snip(r.json)}`);

  // 3) a fresh card sale, then void it via the real client
  r = await newPaidCardTicket('9418594164541111');
  const payId2 = r.json?.paymentId;
  mark('second card sale approved', r.status < 300 && r.json?.status === 'approved', `${r.status} status=${r.json?.status}`);
  r = await api('POST', `/pos/checkout/payments/${payId2}/void`, { reason: 'entered in error' });
  mark('void processed via live client', r.status < 300 && r.json?.status === 'voided', `${r.status} ${r.json?.status || snip(r.json)}`);

  // 4) a declined card (canonical decline PAN) -> declined, with the mock decline ref; ticket NOT marked paid
  r = await newPaidCardTicket(DECLINE_ACCOUNT);
  const dtxn = r.json?.processorTransactionId;
  mark('declined card handled honestly', r.status < 300 && r.json?.status === 'declined' && typeof dtxn === 'string' && dtxn.startsWith('MOCK-DECL'), `${r.status} status=${r.json?.status} txn=${dtxn}`);

  console.log(`\n${fail === 0 ? '✅ ALL GREEN' : '❌ FAILURES'}: ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error('THREW:', e); process.exit(1); });
