// e2e-rbac.mjs — verify a non-owner FRONT_DESK user can run the operational money-path (owner does setup), and is
// correctly DENIED a management-only action. Exercises the capability-mapping fix over real HTTP.
const BASE = process.env.E2E_BASE || 'http://127.0.0.1:3000';
let pass = 0, fail = 0;
const snip = (j) => { try { return JSON.stringify(j).slice(0, 140); } catch { return String(j); } };
const mark = (n, ok, extra = '') => { console.log(`${ok ? '✅' : '❌'} ${n}${extra ? ' — ' + extra : ''}`); ok ? pass++ : fail++; return ok; };
function mkClient() {
  let cookie = '';
  return async function req(method, path, body) {
    const res = await fetch(BASE + path, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const sc = res.headers.get('set-cookie'); if (sc) { const m = sc.match(/aps_session=[^;]+/); if (m) cookie = m[0]; }
    let json = null; try { json = await res.json(); } catch { /* */ }
    return { status: res.status, json, hasCookie: () => !!cookie };
  };
}
const rnd = Math.floor(1000 + Math.random() * 8999);
(async () => {
  // ---- OWNER: setup (create the service + technician a non-owner is not allowed to create) ----
  const owner = mkClient();
  let r = await owner('POST', '/auth/login', { portal: 'tenant', salonCode: 'PALACE', identifier: 'owner@palace.test', password: 'Owner!2345' });
  mark('owner login', r.status === 200 && r.json?.outcome === 'SUCCESS', `${r.status}`);
  r = await owner('POST', '/pos/services/categories', { name: 'RBAC Nails ' + rnd, colorKey: 'gold' }); const categoryId = r.json?.categoryId || r.json?.id;
  r = await owner('POST', '/pos/services', { name: 'RBAC Mani ' + rnd, categoryId, durationMinutes: 30, priceCents: 5000, status: 'active' }); const serviceId = r.json?.serviceId || r.json?.id;
  r = await owner('POST', '/pos/technicians', { firstName: 'RBAC', lastName: 'Tech' + rnd, status: 'active', serviceIds: [serviceId] }); const technicianId = r.json?.technicianId || r.json?.id;
  mark('owner setup (category/service/technician)', !!(categoryId && serviceId && technicianId), `svc=${!!serviceId} tech=${!!technicianId}`);

  // ---- FRONT_DESK: must be able to run the operational money-path ----
  const fd = mkClient();
  r = await fd('POST', '/auth/login', { portal: 'tenant', salonCode: 'PALACE', identifier: 'frontdesk@palace.test', password: 'Front!2345' });
  if (!mark('front-desk login', r.status === 200 && r.json?.outcome === 'SUCCESS', `${r.status} role=${r.json?.principal?.role} perms=${(r.json?.principal?.permissions||[]).length}`) || !r.hasCookie()) { console.log('\nABORT: no FD session'); process.exit(1); }

  // negative test FIRST: FRONT_DESK may NOT create a service (needs services.edit, which it lacks)
  r = await fd('POST', '/pos/services', { name: 'Should Fail', categoryId, durationMinutes: 10, priceCents: 100, status: 'active' });
  mark('front-desk DENIED create-service (expect 403)', r.status === 403, `${r.status} ${r.status === 403 ? '' : snip(r.json)}`);

  // operational money-path as FRONT_DESK
  r = await fd('POST', '/pos/check-in/walk-in', { customerName: 'RBAC Cust ' + rnd, customerPhone: '+1856' + rnd + '0123', serviceIds: [serviceId], technicianId, isNewCustomer: true }); const checkInId = r.json?.checkInId;
  mark('FD walk-in', r.status < 300 && !!checkInId, `${r.status} ${checkInId || snip(r.json)}`);
  r = await fd('POST', `/pos/check-in/${checkInId}/move-to-queue`); const queueItemId = r.json?.queueItemId;
  mark('FD move-to-queue', r.status < 300 && !!queueItemId, `${r.status} ${queueItemId || snip(r.json)}`);
  r = await fd('POST', `/pos/queue/items/${queueItemId}/assign-technician`, { technicianId });
  mark('FD assign-technician', r.status < 300, `${r.status} ${r.status < 300 ? '' : snip(r.json)}`);
  r = await fd('POST', `/pos/queue/items/${queueItemId}/start-service`); const servingTicketId = r.json?.servingTicketId || queueItemId;
  mark('FD start-service', r.status < 300, `${r.status} ${r.status < 300 ? '' : snip(r.json)}`);
  r = await fd('POST', `/pos/serving/tickets/${servingTicketId}/mark-service-done`);
  mark('FD mark-service-done', r.status < 300, `${r.status} ${r.status < 300 ? '' : snip(r.json)}`);
  r = await fd('POST', `/pos/serving/tickets/${servingTicketId}/send-to-service-done`); const serviceDoneTicketId = r.json?.serviceDoneTicketId || servingTicketId;
  mark('FD send-to-service-done', r.status < 300, `${r.status} ${r.status < 300 ? '' : snip(r.json)}`);
  r = await fd('POST', `/pos/service-done/tickets/${serviceDoneTicketId}/quality-check`, { result: 'approved' });
  mark('FD quality-check', r.status < 300, `${r.status} ${r.status < 300 ? '' : snip(r.json)}`);
  r = await fd('POST', `/pos/service-done/tickets/${serviceDoneTicketId}/send-to-checkout`); const checkoutTicketId = r.json?.checkoutTicketId || serviceDoneTicketId;
  mark('FD send-to-checkout', r.status < 300, `${r.status} ${r.status < 300 ? '' : snip(r.json)}`);
  r = await fd('POST', `/pos/checkout/tickets/${checkoutTicketId}/apply-tip`, { tipType: 'custom', tipAmountCents: 500, source: 'front_desk' });
  mark('FD apply-tip', r.status < 300, `${r.status} ${r.status < 300 ? '' : snip(r.json)}`);
  r = await fd('POST', `/pos/checkout/tickets/${checkoutTicketId}/pay/cash`, { amountReceivedCents: 100000 });
  mark('FD pay-cash (approved)', r.status < 300 && r.json?.payment?.status === 'approved', `${r.status} status=${r.json?.payment?.status || snip(r.json)} change=${r.json?.changeDueCents}`);

  console.log(`\n${fail === 0 ? '✅ ALL GREEN' : '❌ FAILURES'}: ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error('THREW:', e); process.exit(1); });
