// e2e-payments.mjs — exercise the non-cash payment paths end-to-end in SANDBOX mode (PAYMENTS_SANDBOX=1): card (+refund),
// void, and a card+cash split. Each scenario drives a fresh ticket through the lifecycle to checkout, then pays.
// Honest: sandbox approvals carry clearly-marked test transaction ids (sbx_*). Run with PAYMENTS_SANDBOX=1.
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
async function freshCheckoutTicket(serviceId, technicianId, tag) {
  let r = await api('POST', '/pos/check-in/walk-in', { customerName: `Pay ${tag} ${rnd}`, customerPhone: '+1856' + rnd + '0' + Math.floor(Math.random()*900+100), serviceIds: [serviceId], technicianId, isNewCustomer: true });
  const ci = r.json?.checkInId; r = await api('POST', `/pos/check-in/${ci}/move-to-queue`); const q = r.json?.queueItemId;
  await api('POST', `/pos/queue/items/${q}/assign-technician`, { technicianId });
  r = await api('POST', `/pos/queue/items/${q}/start-service`); const t = r.json?.servingTicketId || q;
  await api('POST', `/pos/serving/tickets/${t}/mark-service-done`);
  await api('POST', `/pos/serving/tickets/${t}/send-to-service-done`);
  await api('POST', `/pos/service-done/tickets/${t}/quality-check`, { result: 'approved' });
  await api('POST', `/pos/service-done/tickets/${t}/send-to-checkout`);
  return t;
}
(async () => {
  let r = await api('POST', '/auth/login', { portal: 'tenant', salonCode: 'PALACE', identifier: 'owner@palace.test', password: 'Owner!2345' });
  mark('owner login', r.status === 200 && r.json?.outcome === 'SUCCESS', `${r.status}`);
  r = await api('POST', '/pos/services/categories', { name: 'Pay Nails ' + rnd, colorKey: 'gold' }); const categoryId = r.json?.categoryId || r.json?.id;
  r = await api('POST', '/pos/services', { name: 'Pay Mani ' + rnd, categoryId, durationMinutes: 30, priceCents: 5000, status: 'active' }); const serviceId = r.json?.serviceId || r.json?.id;
  r = await api('POST', '/pos/technicians', { firstName: 'Pay', lastName: 'Tech' + rnd, status: 'active', serviceIds: [serviceId] }); const technicianId = r.json?.technicianId || r.json?.id;
  mark('setup', !!(serviceId && technicianId), `svc=${!!serviceId} tech=${!!technicianId}`);

  // --- CARD (sandbox) + REFUND ---
  let t = await freshCheckoutTicket(serviceId, technicianId, 'card');
  r = await api('POST', `/pos/checkout/tickets/${t}/pay/card`, { tipCents: 0 });
  const cardOk = r.status < 300 && r.json?.status === 'approved' && String(r.json?.processorTransactionId || '').startsWith('sbx_');
  mark('CARD pay (sandbox approved, sbx_ txn)', cardOk, `${r.status} status=${r.json?.status} txn=${r.json?.processorTransactionId || snip(r.json)}`);
  const cardPaymentId = r.json?.paymentId;
  r = await api('POST', `/pos/checkout/payments/${cardPaymentId}/refund`, { reason: 'customer changed mind' });
  mark('REFUND card (sandbox)', r.status < 300 && r.json?.status === 'refunded', `${r.status} ${r.json?.status || snip(r.json)} refundId=${r.json?.refundId}`);

  // --- VOID (sandbox): pay a fresh ticket by card, then void it ---
  t = await freshCheckoutTicket(serviceId, technicianId, 'void');
  r = await api('POST', `/pos/checkout/tickets/${t}/pay/card`, { tipCents: 0 }); const voidPid = r.json?.paymentId;
  r = await api('POST', `/pos/checkout/payments/${voidPid}/void`, { reason: 'entered in error' });
  mark('VOID card (sandbox)', r.status < 300 && r.json?.status === 'voided', `${r.status} ${r.json?.status || snip(r.json)}`);

  // --- SPLIT (card + cash) ---
  t = await freshCheckoutTicket(serviceId, technicianId, 'split');
  r = await api('POST', `/pos/checkout/tickets/${t}/recalculate`, { paymentMethod: 'split' });
  const total = r.json?.totalDueCents ?? r.json?.totals?.totalDueCents;
  const cardPart = Math.floor((total || 0) / 2); const cashPart = (total || 0) - cardPart;
  mark('SPLIT total resolved', !!total, `total=${total} card=${cardPart} cash=${cashPart}`);
  r = await api('POST', `/pos/checkout/tickets/${t}/pay/split`, { segments: [{ method: 'card', amountCents: cardPart }, { method: 'cash', amountCents: cashPart }] });
  mark('SPLIT pay (card+cash → paid)', r.status < 300 && r.json?.status === 'paid' && (r.json?.payments || []).length === 2, `${r.status} status=${r.json?.status} segs=${(r.json?.payments||[]).length} ${r.status<300?'':snip(r.json)}`);

  console.log(`\n${fail === 0 ? '✅ ALL GREEN' : '❌ FAILURES'}: ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error('THREW:', e); process.exit(1); });
