// e2e-receipts.mjs — receipts end-to-end. With no Twilio/SendGrid env, the SMS/email senders are Mock (clearly-marked
// 'simulated' delivery) so the full flow is verifiable; real providers engage automatically when their env vars are set.
// Covers SMS, email, in-app, and send-all, and confirms receipts persist.
const BASE = process.env.E2E_BASE || 'http://127.0.0.1:3000';
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
(async () => {
  let r = await api('POST', '/auth/login', { portal: 'tenant', salonCode: 'PALACE', identifier: 'owner@palace.test', password: 'Owner!2345' });
  mark('owner login', r.status === 200 && r.json?.outcome === 'SUCCESS', `${r.status}`);
  r = await api('POST', '/pos/services/categories', { name: 'Rcpt Nails ' + rnd, colorKey: 'gold' }); const categoryId = r.json?.categoryId || r.json?.id;
  r = await api('POST', '/pos/services', { name: 'Rcpt Mani ' + rnd, categoryId, durationMinutes: 30, priceCents: 5000, status: 'active' }); const serviceId = r.json?.serviceId || r.json?.id;
  r = await api('POST', '/pos/technicians', { firstName: 'Rcpt', lastName: 'Tech' + rnd, status: 'active', serviceIds: [serviceId] }); const technicianId = r.json?.technicianId || r.json?.id;
  // a customer WITH phone + email so all channels are reachable
  r = await api('POST', '/pos/check-in/create-customer', { fullName: 'Rcpt Cust ' + rnd, phone: '+1856' + rnd + '0123', email: `rcpt${rnd}@example.com` });
  const customerId = r.json?.customerId || r.json?.id;
  mark('setup (service, skilled tech, customer w/ phone+email)', !!(serviceId && technicianId && customerId), `svc=${!!serviceId} tech=${!!technicianId} cust=${!!customerId}`);

  // drive a ticket to checkout + pay
  r = await api('POST', '/pos/check-in/walk-in', { customerId, customerName: 'Rcpt Cust ' + rnd, customerPhone: '+1856' + rnd + '0123', serviceIds: [serviceId], technicianId, isNewCustomer: false });
  const ci = r.json?.checkInId; r = await api('POST', `/pos/check-in/${ci}/move-to-queue`); const q = r.json?.queueItemId;
  await api('POST', `/pos/queue/items/${q}/assign-technician`, { technicianId });
  r = await api('POST', `/pos/queue/items/${q}/start-service`); const t = r.json?.servingTicketId || q;
  await api('POST', `/pos/serving/tickets/${t}/mark-service-done`);
  await api('POST', `/pos/serving/tickets/${t}/send-to-service-done`);
  await api('POST', `/pos/service-done/tickets/${t}/quality-check`, { result: 'approved' });
  await api('POST', `/pos/service-done/tickets/${t}/send-to-checkout`);
  r = await api('POST', `/pos/checkout/tickets/${t}/pay/cash`, { amountReceivedCents: 100000 });
  mark('ticket paid', r.status < 300 && r.json?.payment?.status === 'approved', `${r.status} ${r.json?.payment?.status || snip(r.json)}`);

  // receipts
  r = await api('POST', `/pos/checkout/tickets/${t}/receipt/sms`);
  mark('SMS receipt (simulated, ref)', r.status < 300 && r.json?.configured === true && r.json?.delivery === 'simulated' && !!r.json?.receiptNumber, `${r.status} configured=${r.json?.configured} delivery=${r.json?.delivery} ref=${r.json?.receiptNumber}`);
  r = await api('POST', `/pos/checkout/tickets/${t}/receipt/email`);
  mark('email receipt (simulated, ref)', r.status < 300 && r.json?.configured === true && r.json?.delivery === 'simulated' && !!r.json?.receiptNumber, `${r.status} configured=${r.json?.configured} delivery=${r.json?.delivery} ref=${r.json?.receiptNumber}`);
  r = await api('POST', `/pos/checkout/tickets/${t}/receipt/app`);
  mark('in-app receipt (saved)', r.status < 300 && r.json?.configured === true && r.json?.delivery === 'saved' && !!r.json?.receiptNumber, `${r.status} configured=${r.json?.configured} delivery=${r.json?.delivery} ref=${r.json?.receiptNumber}`);
  r = await api('POST', `/pos/checkout/tickets/${t}/receipt/send-all`, { channels: ['sms', 'email', 'app'] });
  const allOk = r.status < 300 && Array.isArray(r.json?.results) && r.json.results.length === 3 && r.json.results.every((x) => x.configured === true);
  mark('send-all (sms+email+app all configured)', allOk, `${r.status} results=${(r.json?.results || []).map((x) => x.channel + ':' + (x.delivery || x.disabledReason)).join(',')}`);

  console.log(`\n${fail === 0 ? '✅ ALL GREEN' : '❌ FAILURES'}: ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error('THREW:', e); process.exit(1); });
