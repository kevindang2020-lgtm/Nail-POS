// e2e-giftcard.mjs — gift cards end-to-end on Postgres: issue, balance lookup, full redemption, partial redemption, and a
// split (gift + card) payment. Verifies balances decrement and the redeem ledger. Boot with PAYMENTS_SANDBOX=1 (the split's
// card segment needs the sandbox processor); gift-card payment itself needs no processor.
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
  let r = await api('POST', '/pos/check-in/walk-in', { customerName: `GC ${tag} ${rnd}`, customerPhone: '+1856' + rnd + '0' + Math.floor(Math.random()*900+100), serviceIds: [serviceId], technicianId, isNewCustomer: true });
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
  r = await api('POST', '/pos/services/categories', { name: 'GC Nails ' + rnd, colorKey: 'gold' }); const categoryId = r.json?.categoryId || r.json?.id;
  r = await api('POST', '/pos/services', { name: 'GC Mani ' + rnd, categoryId, durationMinutes: 30, priceCents: 5000, status: 'active' }); const serviceId = r.json?.serviceId || r.json?.id;
  r = await api('POST', '/pos/technicians', { firstName: 'GC', lastName: 'Tech' + rnd, status: 'active', serviceIds: [serviceId] }); const technicianId = r.json?.technicianId || r.json?.id;
  mark('setup', !!(serviceId && technicianId), `svc=${!!serviceId} tech=${!!technicianId}`);

  // --- ISSUE + BALANCE ---
  r = await api('POST', '/pos/checkout/gift-cards', { amountCents: 10000 }); const codeA = r.json?.code;
  mark('issue gift card A ($100)', r.status < 300 && !!codeA && r.json?.balanceCents === 10000, `${r.status} code=${codeA} bal=${r.json?.balanceCents}`);
  r = await api('GET', `/pos/checkout/gift-cards/${codeA}`);
  mark('balance lookup A', r.status < 300 && r.json?.balanceCents === 10000 && r.json?.status === 'active', `${r.status} bal=${r.json?.balanceCents} status=${r.json?.status}`);

  // --- FULL redemption (total < balance) ---
  let t = await freshCheckoutTicket(serviceId, technicianId, 'full');
  r = await api('POST', `/pos/checkout/tickets/${t}/pay/gift-card`, { giftCardCode: codeA });
  const full = r.status < 300 && r.json?.payment?.status === 'approved' && r.json?.remainingDueCents === 0;
  mark('FULL gift redemption (approved, 0 due)', full, `${r.status} pStatus=${r.json?.payment?.status} due=${r.json?.remainingDueCents} giftLeft=${r.json?.giftRemainingCents}`);
  const appliedA = r.json?.payment?.amountCents || 0;
  r = await api('GET', `/pos/checkout/gift-cards/${codeA}`);
  mark('A balance decremented', r.status < 300 && r.json?.balanceCents === 10000 - appliedA, `bal=${r.json?.balanceCents} (expected ${10000 - appliedA})`);

  // --- PARTIAL redemption (balance < total) ---
  r = await api('POST', '/pos/checkout/gift-cards', { amountCents: 2000 }); const codeB = r.json?.code;
  t = await freshCheckoutTicket(serviceId, technicianId, 'partial');
  r = await api('POST', `/pos/checkout/tickets/${t}/pay/gift-card`, { giftCardCode: codeB });
  const partial = r.status < 300 && r.json?.payment?.status === 'partial' && r.json?.remainingDueCents > 0 && r.json?.giftRemainingCents === 0;
  mark('PARTIAL gift redemption (partial, due remains, gift drained)', partial, `${r.status} pStatus=${r.json?.payment?.status} due=${r.json?.remainingDueCents} giftLeft=${r.json?.giftRemainingCents}`);
  r = await api('GET', `/pos/checkout/gift-cards/${codeB}`);
  mark('B drained → status redeemed', r.status < 300 && r.json?.balanceCents === 0 && r.json?.status === 'redeemed', `bal=${r.json?.balanceCents} status=${r.json?.status}`);

  // --- SPLIT (gift + card) ---
  r = await api('POST', '/pos/checkout/gift-cards', { amountCents: 3000 }); const codeC = r.json?.code;
  t = await freshCheckoutTicket(serviceId, technicianId, 'split');
  r = await api('POST', `/pos/checkout/tickets/${t}/recalculate`, { paymentMethod: 'split' });
  const total = r.json?.totalDueCents ?? r.json?.totals?.totalDueCents;
  const giftPart = Math.min(3000, total); const cardPart = total - giftPart;
  r = await api('POST', `/pos/checkout/tickets/${t}/pay/split`, { segments: [{ method: 'gift_card', amountCents: giftPart, giftCardCode: codeC }, { method: 'card', amountCents: cardPart }] });
  mark('SPLIT gift+card → paid', r.status < 300 && r.json?.status === 'paid' && (r.json?.payments || []).length === 2, `${r.status} status=${r.json?.status} segs=${(r.json?.payments||[]).length} total=${total} gift=${giftPart} card=${cardPart} ${r.status<300?'':snip(r.json)}`);
  r = await api('GET', `/pos/checkout/gift-cards/${codeC}`);
  mark('C decremented by split gift segment', r.status < 300 && r.json?.balanceCents === 3000 - giftPart, `bal=${r.json?.balanceCents} (expected ${3000 - giftPart})`);

  // --- RELOAD (add funds to an existing card) ---
  r = await api('POST', '/pos/checkout/gift-cards', { amountCents: 2000 }); const codeR = r.json?.code;
  r = await api('POST', `/pos/checkout/gift-cards/${codeR}/reload`, { amountCents: 5000 });
  mark('RELOAD adds funds', r.status < 300 && r.json?.balanceCents === 7000 && r.json?.status === 'active', `${r.status} bal=${r.json?.balanceCents} status=${r.json?.status}`);
  t = await freshCheckoutTicket(serviceId, technicianId, 'reload');
  r = await api('POST', `/pos/checkout/tickets/${t}/pay/gift-card`, { giftCardCode: codeR });
  mark('reloaded card pays (covers total)', r.status < 300 && r.json?.payment?.status === 'approved' && r.json?.remainingDueCents === 0, `${r.status} pStatus=${r.json?.payment?.status} due=${r.json?.remainingDueCents}`);

  // --- VOID (cancel a card; cannot be used to pay) ---
  r = await api('POST', '/pos/checkout/gift-cards', { amountCents: 5000 }); const codeV = r.json?.code;
  r = await api('POST', `/pos/checkout/gift-cards/${codeV}/void`);
  mark('VOID zeroes + marks void', r.status < 300 && r.json?.status === 'void' && r.json?.balanceCents === 0, `${r.status} status=${r.json?.status} bal=${r.json?.balanceCents}`);
  t = await freshCheckoutTicket(serviceId, technicianId, 'voided');
  r = await api('POST', `/pos/checkout/tickets/${t}/pay/gift-card`, { giftCardCode: codeV });
  mark('voided card REJECTED for payment (expect 400)', r.status === 400, `${r.status} ${r.status === 400 ? '' : snip(r.json)}`);

  console.log(`\n${fail === 0 ? '✅ ALL GREEN' : '❌ FAILURES'}: ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error('THREW:', e); process.exit(1); });
