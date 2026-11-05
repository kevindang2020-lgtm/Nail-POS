// checkout-core.spec.ts — Nest-free harness for the (async) checkout service + repository + pure dto helpers.
import { InMemoryCheckoutRepository, CheckoutContext } from './checkout.repository';
import { CheckoutService, ForbiddenError, ValidationError } from './checkout.service';
import { computeTotals, validateCustomTip, tipForPercent, tipOptions, DEFAULT_CHECKOUT_SETTINGS } from './checkout-display.dto';
import { applyGiftCard, buildIdempotencyKey, isTotalLocked, searchReadyTickets, CustomerDisplayError } from './checkout.dto';

let pass = 0, fail = 0;
const ok = (n: string, c: boolean) => { if (c) pass++; else { fail++; console.error('FAIL:', n); } };
const throwsAsync = async (n: string, fn: () => Promise<unknown>, t?: any) => {
  try { await fn(); fail++; console.error('FAIL (no throw):', n); }
  catch (e) { if (t && !(e instanceof t)) { fail++; console.error('FAIL (wrong type):', n); } else pass++; }
};

const svc = () => new CheckoutService(new InMemoryCheckoutRepository());
// checkout.approve_refund: a real OWNER/MANAGER holds it (rbac catalog, Constitution 12 M9). The harness owner lacked it
// after M9 landed, so every refund past the approval limit threw here — the harness had been failing on exactly that.
const PERMS = ['pos.checkout.view','pos.checkout.take_payment','pos.checkout.cash_payment','pos.checkout.card_payment','pos.checkout.gift_card_payment','pos.checkout.split_payment','pos.checkout.apply_discount','pos.checkout.add_tip','pos.checkout.override_total','pos.checkout.refund','pos.checkout.void','pos.checkout.reopen_service','pos.customer_display.operate','pos.receipts.send','pos.reports.financial_view','checkout.approve_refund'];
const DESK_PERMS = PERMS.filter((p) => p !== 'checkout.approve_refund');
const owner = (over: Partial<CheckoutContext> = {}): CheckoutContext => ({ tenantId: 'luxe001', branchId: 'br_cherryhill', userId: 'u_owner', role: 'OWNER', permissions: PERMS, ...over });

// ---- pure helpers (synchronous) ----
const s = DEFAULT_CHECKOUT_SETTINGS;
const cardT = computeTotals(10000, 2000, s, 'card');
const cashT = computeTotals(10000, 2000, s, 'cash');
ok('tax computed on subtotal', cardT.taxCents === Math.round(10000 * (s.taxRatePercent / 100)));
ok('surcharge applies to card only', cardT.surchargeCents > 0 && cashT.surchargeCents === 0);
ok('cash total has no surcharge', cashT.totalDueCents === 10000 + 2000 + cashT.taxCents);
ok('validateCustomTip rejects negative', !validateCustomTip(-1, 10000, 100).ok);
ok('validateCustomTip rejects over-max', !validateCustomTip(999999, 10000, 100).ok);
// tip math behind the kiosk's tip buttons: tipForPercent rounds to the nearest cent; tipOptions marks the matching
// percent selected and always appends a "No Tip" option (selected only when no tip is chosen).
ok('tipForPercent 20% of $100', tipForPercent(10000, 20) === 2000);
ok('tipForPercent rounds to nearest cent', tipForPercent(9999, 15) === Math.round(9999 * 0.15));
ok('tipForPercent of zero subtotal is zero', tipForPercent(0, 20) === 0);
const tOpts = tipOptions(10000, [15, 20, 25], 2000);
ok('tipOptions yields each percent + a No Tip', tOpts.length === 4 && tOpts[3].tipType === 'none' && tOpts[3].amountCents === 0);
ok('tipOptions marks the matching percent selected', tOpts.find((o) => o.percent === 20)?.selected === true && tOpts.find((o) => o.percent === 15)?.selected === false);
ok('tipOptions No Tip selected only at zero', tipOptions(10000, [20], 0).find((o) => o.tipType === 'none')?.selected === true && tOpts[3].selected === false);
ok('applyGiftCard partial', applyGiftCard(10000, 4000).remainingDueCents === 6000 && applyGiftCard(10000, 4000).giftRemainingCents === 0);
ok('applyGiftCard full caps', applyGiftCard(5000, 9000).appliedCents === 5000 && applyGiftCard(5000, 9000).giftRemainingCents === 4000);
ok('idempotency stable per total', buildIdempotencyKey('t1', 'card', 1234) === 't1:card:1234');
ok('isTotalLocked exact match', isTotalLocked(1234, 1234) && !isTotalLocked(1234, 9999) && !isTotalLocked(null, 1234));
ok('searchReadyTickets filters', searchReadyTickets([{ ticketId: 'a', ticketNumber: '#1', customerId: 'c', customerName: 'Grace', customerInitials: 'G', isVip: false, completedServiceCount: 1, finishedAt: '', estimatedTotalCents: 0, status: 'ready_checkout' }], 'grace').length === 1);

(async () => {
  // ---- access ----
  await throwsAsync('customer blocked', () => svc().getState(owner({ role: 'CUSTOMER' })), ForbiddenError);
  await throwsAsync('customer_display blocked', () => svc().getState(owner({ role: 'CUSTOMER_DISPLAY' })), ForbiddenError);
  await throwsAsync('super_admin blocked', () => svc().getState(owner({ role: 'SUPER_ADMIN' })), ForbiddenError);
  await throwsAsync('missing view blocked', () => svc().getState(owner({ permissions: [] })), ForbiddenError);

  // ---- isolation ----
  const other = await svc().getState(owner({ tenantId: 'other999' }));
  ok('tenant isolation: other tenant empty', other.kpisFull.ticketsReadyForPayment === 0 && other.tickets.items.length === 0);

  // ---- state + KPIs + settings honesty ----
  const st = await svc().getState(owner());
  ok('seed has ready tickets', st.kpisFull.ticketsReadyForPayment >= 4);
  ok('rows carry totals (tax + surcharge for card)', st.tickets.items.every((t) => t.taxCents! >= 0) && st.tickets.items.some((t) => (t.surchargeCents || 0) > 0));
  ok('fiserv honest not_configured', st.paymentSettings.fiservStatus === 'not_configured');
  ok('payment methods enabled', st.paymentSettings.cardEnabled && st.paymentSettings.cashEnabled && st.paymentSettings.giftCardEnabled && st.paymentSettings.splitPaymentEnabled);
  ok('paired display devices present', st.customerDisplay.pairedDevices.length >= 1);
  ok('facets present', st.filters.paymentMethods.includes('split') && st.filters.statuses.includes('paid'));

  // ---- filters ----
  ok('filter status=sent_to_customer_display', (await svc().tickets(owner(), { status: 'sent_to_customer_display' })).items.every((t) => t.status === 'sent_to_customer_display'));
  ok('search by customer', (await svc().tickets(owner(), { search: 'Grace' })).items.length >= 1);
  const paged = await svc().getState(owner(), { page: 1, pageSize: 2 });
  ok('pagination respected', paged.tickets.items.length === 2 && paged.tickets.pagination.totalPages >= 2);

  // ---- detail ----
  const d = await svc().detail(owner(), 'tk_2041');
  ok('detail has completed services + totals', d.completedServices.length >= 1 && d.totals.totalDueCents > 0);

  // ---- tips / discount / recalc ----
  const s2 = svc();
  const tipT = (await s2.applyTip(owner(), 'tk_2041', { tipType: 'percent', tipPercent: 20, source: 'front_desk' }))!;
  ok('tip 20% applied', tipT.tipCents === Math.round(7000 * 0.20));
  await throwsAsync('tip needs add_tip', () => svc().applyTip(owner({ permissions: ['pos.checkout.view'] }), 'tk_2041', { tipType: 'percent', tipPercent: 20, source: 'front_desk' }), ForbiddenError);
  await throwsAsync('custom tip over max rejected', () => svc().applyTip(owner(), 'tk_2041', { tipType: 'custom', tipAmountCents: 9999999, source: 'front_desk' }), ValidationError);
  const s2b = svc();
  const discT = (await s2b.applyDiscount(owner(), 'tk_2041', { discountCents: 1000 }))!;
  ok('discount reduces total', discT.subtotalCents === 6000);
  await throwsAsync('big discount needs override', () => svc().applyDiscount(owner({ permissions: ['pos.checkout.view','pos.checkout.apply_discount'] }), 'tk_2041', { discountCents: 6000 }), ForbiddenError);
  ok('recalculate returns totals for method', (await svc().recalculate(owner(), 'tk_2041', 'cash'))!.surchargeCents === 0);

  // ---- cash payment ----
  const s3 = svc();
  const cashTotals = (await s3.recalculate(owner(), 'tk_2042', 'cash'))!;
  await throwsAsync('insufficient cash rejected', () => svc().payCash(owner(), 'tk_2042', { amountReceivedCents: 1 }), ValidationError);
  const cashPay = await s3.payCash(owner(), 'tk_2042', { amountReceivedCents: cashTotals.totalDueCents + 500 });
  ok('cash payment approved', cashPay.payment.status === 'approved' && cashPay.changeDueCents === 500);
  ok('cash closes ticket as paid', (await s3.tickets(owner(), { status: 'paid' })).items.some((t) => t.ticketId === 'tk_2042'));
  ok('audit: cash payment', s3.auditLog().some((l) => l.actionType === 'pos_checkout_cash_payment_created'));
  await throwsAsync('cash needs cash_payment perm', () => svc().payCash(owner({ permissions: ['pos.checkout.view','pos.checkout.take_payment'] }), 'tk_2042', { amountReceivedCents: 100000 }), ForbiddenError);

  // ---- card payment: honest not_configured, never fake ----
  const s4 = svc();
  const cardOut: any = await s4.payCard(owner(), 'tk_2041', {});
  ok('card NOT faked — not configured', cardOut.configured === false && /not configured/i.test(cardOut.disabledReason));
  ok('card ticket not marked paid', !(await s4.tickets(owner(), { status: 'paid' })).items.some((t) => t.ticketId === 'tk_2041'));
  ok('audit: card attempted (not approved)', s4.auditLog().some((l) => l.actionType === 'pos_checkout_card_payment_attempted') && !s4.auditLog().some((l) => l.actionType === 'pos_checkout_card_payment_approved'));
  await throwsAsync('card needs card_payment perm', () => svc().payCard(owner({ permissions: ['pos.checkout.view','pos.checkout.take_payment'] }), 'tk_2041', {}), ForbiddenError);

  // ---- gift card payment ----
  const s5 = svc();
  await throwsAsync('invalid gift card rejected', () => svc().payGiftCard(owner(), 'tk_2044', { giftCardCode: 'NOPE' }), ValidationError);
  await throwsAsync('empty gift card rejected', () => svc().payGiftCard(owner(), 'tk_2044', { giftCardCode: 'GIFT-EMPTY' }), ValidationError);
  const giftPartial = await s5.payGiftCard(owner(), 'tk_2041', { giftCardCode: 'GIFT-50' });
  ok('gift partial leaves remaining due', giftPartial.remainingDueCents > 0 && giftPartial.payment.status === 'partial');
  const giftFull = await s5.payGiftCard(owner(), 'tk_2044', { giftCardCode: 'GIFT-200' });
  ok('gift full pays ticket', giftFull.remainingDueCents === 0 && giftFull.payment.status === 'approved');
  ok('audit: gift payment', s5.auditLog().some((l) => l.actionType === 'pos_checkout_gift_card_payment_created'));

  // ---- split payment ----
  const s6 = svc();
  const splitTotals = (await s6.recalculate(owner(), 'tk_2043', 'split'))!;
  await throwsAsync('split must equal total', () => svc().paySplit(owner(), 'tk_2043', { segments: [{ method: 'cash', amountCents: 1 }] }), ValidationError);
  const splitCardOut: any = await s6.paySplit(owner(), 'tk_2043', { segments: [{ method: 'card', amountCents: splitTotals.totalDueCents }] });
  ok('split with card honest not configured', splitCardOut.configured === false);
  const splitOk: any = await s6.paySplit(owner(), 'tk_2043', { segments: [{ method: 'cash', amountCents: splitTotals.totalDueCents - 5000 }, { method: 'gift_card', amountCents: 5000, giftCardCode: 'GIFT-50' }] });
  ok('split cash+gift completes', splitOk.status === 'paid' && splitOk.payments.length === 2);
  ok('audit: split payment segments', s6.auditLog().filter((l) => l.actionType === 'pos_checkout_split_payment_created').length === 2);

  // ---- receipts (honest provider status) ----
  const s7 = svc();
  const sms = await s7.receiptSms(owner(), 'tk_2041'); ok('sms receipt not configured (honest)', sms.configured === false);
  const email = await s7.receiptEmail(owner(), 'tk_2041'); ok('email receipt not configured (honest)', email.configured === false);
  const app = await s7.receiptApp(owner(), 'tk_2041'); ok('app receipt saved', app.configured === true);
  await throwsAsync('receipt needs receipts.send', () => svc().receiptSms(owner({ permissions: ['pos.checkout.view'] }), 'tk_2041'), ForbiddenError);
  const all = await s7.receiptSendAll(owner(), 'tk_2041', { channels: ['sms','email','app'] }); ok('send-all aggregates 3', all.results.length === 3);
  ok('audit: receipt events', s7.auditLog().some((l) => l.actionType === 'pos_checkout_receipt_app_saved'));

  // ---- reopen ----
  const s8 = svc();
  await throwsAsync('reopen needs reason', () => svc().reopen(owner(), 'tk_2041', { reason: '' }), ValidationError);
  await throwsAsync('reopen needs permission', () => svc().reopen(owner({ permissions: ['pos.checkout.view'] }), 'tk_2041', { reason: 'redo' }), ForbiddenError);
  await s8.reopen(owner(), 'tk_2041', { reason: 'Customer wants a change' });
  ok('reopen moves ticket to reopened', (await s8.tickets(owner(), { status: 'reopened' })).items.some((t) => t.ticketId === 'tk_2041'));
  const s8b = svc(); await s8b.payCash(owner(), 'tk_2044', { amountReceivedCents: 100000 });
  await throwsAsync('cannot reopen a paid ticket (use refund)', () => s8b.reopen(owner(), 'tk_2044', { reason: 'x' }), ValidationError);
  ok('audit: reopened', s8.auditLog().some((l) => l.actionType === 'pos_checkout_service_reopened'));

  // ---- refund / void (honest not configured, require reason+perm) ----
  const s9 = svc(); const cp = await s9.payCash(owner(), 'tk_2042', { amountReceivedCents: 100000 });
  await throwsAsync('refund needs reason', () => svc().refund(owner(), cp.payment.paymentId, { reason: '' }), ValidationError);
  await throwsAsync('refund needs permission', () => svc().refund(owner({ permissions: ['pos.checkout.view'] }), cp.payment.paymentId, { reason: 'x' }), ForbiddenError);
  // M9: without the approval capability, a refund past the limit is refused (and the owner below may do it)
  await throwsAsync('front desk cannot refund past the approval limit', () => s9.refund(owner({ role: 'FRONT_DESK', permissions: DESK_PERMS }), cp.payment.paymentId, { reason: 'Customer complaint' }), ForbiddenError);
  const refundOut: any = await s9.refund(owner(), cp.payment.paymentId, { reason: 'Customer complaint' });
  ok('cash refund recorded without a card gateway + original ticket preserved', refundOut.status === 'refunded' && (await s9.tickets(owner(), { status: 'paid' })).items.some((t) => t.ticketId === 'tk_2042'));
  await throwsAsync('cannot void a payment that was already refunded', () => s9.void(owner(), cp.payment.paymentId, { reason: 'Wrong ticket' }), ValidationError);
  const s9b = svc(); const cp2 = await s9b.payCash(owner(), 'tk_2043', { amountReceivedCents: 100000 });
  const voidOut: any = await s9b.void(owner(), cp2.payment.paymentId, { reason: 'Wrong ticket' });
  ok('void honest not configured', voidOut.configured === false);
  ok('audit: refund + void', s9.auditLog().some((l) => l.actionType === 'pos_checkout_refund_created') && s9b.auditLog().some((l) => l.actionType === 'pos_checkout_void_created'));

  // ---- customer display ----
  const s10 = svc();
  ok('devices list', (await s10.devices(owner())).length >= 1);
  // 23-inch spec §10: this POS's register ('Station 3') has a DEDICATED display — the checkout goes there
  const session = await s10.sendToCustomerDisplay(owner(), 'tk_2041', { stationId: 'Station 3' });
  ok('send to display creates session', !!session.sessionId && session.state === 'showing_ticket' && session.deviceId === 'disp_st3');
  ok('ticket marked sent_to_customer_display', (await s10.tickets(owner(), { status: 'sent_to_customer_display' })).items.some((t) => t.ticketId === 'tk_2041'));
  // a register with no display of its own, and no shared display in the branch: refused (never another register's display)
  // Dual-Screen §104 (Oct 12 2026): the refusal is a typed CustomerDisplayError carrying a standard code (was ValidationError).
  await throwsAsync('no display for this register errors', () => svc().sendToCustomerDisplay(owner(), 'tk_2043', { stationId: 'Station 2' }), CustomerDisplayError);
  ok('no display for this register → a standard §104 code', await svc().sendToCustomerDisplay(owner(), 'tk_2043', { stationId: 'Station 2' }).then(() => false, (e: any) => ['CUSTOMER_DISPLAY_NOT_CONFIGURED', 'DISPLAY_CONTEXT_MISMATCH', 'CUSTOMER_DISPLAY_OFFLINE'].includes(e?.code)));
  await throwsAsync('display needs the operate perm', () => svc().devices(owner({ permissions: ['pos.checkout.view'] })), ForbiddenError);
  ok('update session tip', (await s10.updateSession(owner(), session.sessionId, { selectedTipCents: 500 })).selectedTipCents === 500);
  ok('close session', (await s10.closeSession(owner(), session.sessionId)).closed === true);
  ok('audit: sent to display', s10.auditLog().some((l) => l.actionType === 'pos_checkout_sent_to_customer_display'));

  // ---- audit base ----
  const sV = svc(); await sV.getState(owner());
  ok('audit: viewed tenant-scoped', sV.auditLog().some((l) => l.actionType === 'pos_checkout_viewed' && l.tenantId === 'luxe001'));

  console.log(`\ncheckout-core: ${pass}/${pass + fail} passed` + (fail ? ` (${fail} FAILED)` : ' OK'));
  if (fail) process.exit(1);
})();
