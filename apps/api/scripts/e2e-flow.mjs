// e2e-flow.mjs — drives the full POS money-path over HTTP against the running API (live Postgres):
// login → category → service → technician → walk-in → queue → serving → service-done → checkout → cash payment.
const BASE = process.env.E2E_BASE || 'http://127.0.0.1:3000';
let cookie = ''; let pass = 0, fail = 0;
const snip = (j) => { try { return JSON.stringify(j).slice(0, 140); } catch { return String(j); } };
const mark = (name, ok, extra = '') => { console.log(`${ok ? '✅' : '❌'} ${name}${extra ? ' — ' + extra : ''}`); ok ? pass++ : fail++; return ok; };
async function req(method, path, body) {
  const res = await fetch(BASE + path, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const sc = res.headers.get('set-cookie'); if (sc) { const m = sc.match(/aps_session=[^;]+/); if (m) cookie = m[0]; }
  let json = null; try { json = await res.json(); } catch { /* */ }
  return { status: res.status, json };
}
const rnd = Math.floor(1000 + Math.random() * 8999);
(async () => {
  let r = await req('POST', '/auth/login', { portal: 'tenant', salonCode: 'PALACE', identifier: 'owner@palace.test', password: 'Owner!2345' });
  if (!mark('owner login', r.status === 200 && r.json?.outcome === 'SUCCESS', `${r.status} ${r.json?.outcome || snip(r.json)}`) || !cookie) { console.log('\nABORT: no session'); process.exit(1); }

  r = await req('POST', '/pos/services/categories', { name: 'E2E Nails ' + rnd, colorKey: 'gold' });
  const categoryId = r.json?.categoryId || r.json?.id;
  mark('create category', r.status < 300 && !!categoryId, `${r.status} ${categoryId || snip(r.json)}`);

  r = await req('POST', '/pos/services', { name: 'E2E Manicure ' + rnd, categoryId, durationMinutes: 30, priceCents: 5000, status: 'active' });
  const serviceId = r.json?.serviceId || r.json?.id;
  mark('create service', r.status < 300 && !!serviceId, `${r.status} ${serviceId || snip(r.json)}`);

  r = await req('POST', '/pos/technicians', { firstName: 'E2E', lastName: 'Tech' + rnd, status: 'active', serviceIds: [serviceId] });
  const technicianId = r.json?.technicianId || r.json?.id;
  mark('create technician', r.status < 300 && !!technicianId, `${r.status} ${technicianId || snip(r.json)}`);

  r = await req('POST', '/pos/check-in/walk-in', { customerName: 'E2E Customer ' + rnd, customerPhone: '+1609' + rnd + '0123', serviceIds: [serviceId], technicianId, isNewCustomer: true });
  const checkInId = r.json?.checkInId;
  mark('walk-in check-in', r.status < 300 && !!checkInId, `${r.status} ${checkInId || snip(r.json)}`);

  r = await req('POST', `/pos/check-in/${checkInId}/move-to-queue`);
  const queueItemId = r.json?.queueItemId;
  mark('move to queue', r.status < 300 && !!queueItemId, `${r.status} ${queueItemId || snip(r.json)}`);

  r = await req('POST', `/pos/queue/items/${queueItemId}/assign-technician`, { technicianId });
  mark('assign technician (queue)', r.status < 300, `${r.status} ${r.status < 300 ? '' : snip(r.json)}`);

  r = await req('POST', `/pos/queue/items/${queueItemId}/start-service`);
  const servingTicketId = r.json?.servingTicketId || queueItemId;
  mark('start service (→ serving)', r.status < 300, `${r.status} serving=${servingTicketId} ${r.status < 300 ? '' : snip(r.json)}`);

  r = await req('POST', `/pos/serving/tickets/${servingTicketId}/mark-service-done`);
  mark('mark service done', r.status < 300, `${r.status} ${r.status < 300 ? '' : snip(r.json)}`);

  r = await req('POST', `/pos/serving/tickets/${servingTicketId}/send-to-service-done`);
  const serviceDoneTicketId = r.json?.serviceDoneTicketId || servingTicketId;
  mark('send to service-done', r.status < 300, `${r.status} sd=${serviceDoneTicketId} ${r.status < 300 ? '' : snip(r.json)}`);

  r = await req('POST', `/pos/service-done/tickets/${serviceDoneTicketId}/quality-check`, { result: 'approved' });
  mark('quality check (approved)', r.status < 300, `${r.status} ${r.status < 300 ? '' : snip(r.json)}`);

  r = await req('POST', `/pos/service-done/tickets/${serviceDoneTicketId}/send-to-checkout`);
  const checkoutTicketId = r.json?.checkoutTicketId || serviceDoneTicketId;
  mark('send to checkout', r.status < 300, `${r.status} co=${checkoutTicketId} ${r.status < 300 ? '' : snip(r.json)}`);

  r = await req('POST', `/pos/checkout/tickets/${checkoutTicketId}/apply-tip`, { tipType: 'custom', tipAmountCents: 500, source: 'front_desk' });
  mark('apply tip ($5)', r.status < 300, `${r.status} ${r.status < 300 ? '' : snip(r.json)}`);

  r = await req('POST', `/pos/checkout/tickets/${checkoutTicketId}/pay/cash`, { amountReceivedCents: 100000 });
  const paid = r.json?.payment?.status === 'approved';
  mark('pay cash (approved)', r.status < 300 && paid, `${r.status} status=${r.json?.payment?.status || snip(r.json)} amount=${r.json?.payment?.amountCents} change=${r.json?.changeDueCents}`);

  console.log(`\n${fail === 0 ? '✅ ALL GREEN' : '❌ FAILURES'}: ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error('THREW:', e); process.exit(1); });
