// pilot-recovery.mjs — pilot day phase 14 (Remaining Production §68, Oct 27 2026): the money RECOVERY flows, end to end over
// real HTTP on the real PostgreSQL, with the salon's own CardPointe gateway answered by the pilot's loopback fake. Each flow
// loses the processor's answer on purpose and then proves the recovery path settles it exactly once:
//   14a WALLET TOP-UP: the customer tops up with a saved card; the charge goes through at the processor but the answer is
//       lost (socket cut) → the app is told "being confirmed" (never declined); the same tap again charges nothing; the
//       front desk's Verify finds the approval → ONE credit; another Verify and the customer's Check status add nothing.
//   14b SKIP-THE-LINE: the guest pays her bill in the app; the answer is lost → payment_status_unknown; the app retries the
//       same intent → refused before the processor; the POS "Verify payment" finds the approval → ONE approved payment and
//       the ticket paid; the app is then told already paid.
//   14c SPLIT CARD: a cash + card split whose card answer is lost → PAYMENT_STATUS_UNKNOWN; cash, a gift card and another
//       card on the ticket are refused while it is open (the processor is never reached); the stranded sweep (the server's
//       own background job) finds no record of the card and releases it → one cash tender then pays the ticket.
//   14d REFUND TIMEOUT: a card refund whose answer is lost → REFUND_STATUS_UNKNOWN; the sweep finds the refund at the
//       processor → reconciled ONCE (one refund payment, the hold finalized); a manager's manual settle afterwards is
//       refused (nothing is waiting) and further sweeps change nothing.
// Time: the sweep only takes attempts older than the stranded window (15 min). Instead of waiting, the phase AGES the one
// attempt it created (created_at − 30 min) — a clock change, not a user action — and the API runs its sweep every 15 s
// (PAYMENT_ATTEMPT_SWEEP_EVERY_MS, honoured outside production only). PILOT_SKIP=14 skips the phase.

export async function recoveryPhase(env) {
  const { own, rec, pub, session, check, info, q, numbers, ctx, B, T, tag, SALON_CODE, short, ok2, serve, LISA, MARY, CP_TOKENS, cpCalls, cpControl, CARD, OWNER_PW, sleep } = env;
  const R = numbers.recovery = {};
  const auths = () => cpCalls.filter((c) => c.method === 'PUT' && c.path.endsWith('/auth')).length;
  const until = async (fn, ms = 60_000) => { const t0 = Date.now(); let v; while (Date.now() - t0 < ms) { v = await fn(); if (v) return v; await sleep(1000); } return v; };

  // a customer-app guest of THIS salon, with a saved card the gateway will "lose" the answer for
  const email = `recover.${tag}@pilot-day.test`, pw = 'Pilot!Rec-' + tag, phone = `+1609557${tag.slice(-4)}`;
  const reg = await pub.post('/customer/auth/register', { salonCode: SALON_CODE, firstName: 'Rhea', lastName: 'Recover', email, phone, password: pw });
  const cust = session('customer-recovery');
  const cl = await cust.post('/auth/login', { portal: 'customer', identifier: email, password: pw });
  const customerId = (await q(`select c.id from customers c join users u on u.id = c.user_id where c.tenant_id = $1 and lower(u.email) = lower($2) limit 1`, [T, email]))[0]?.id ?? null;
  if (!ok2(cl.status) || !customerId) info(`recovery customer: register ${reg.status} ${short(reg.body)} login ${cl.status} customer ${customerId}`);

  // ── 14a WALLET TOP-UP: lost answer → staff Verify → one credit ─────────────────────────────────────────────────────
  // Fiserv §8D (Nov 4 2026): saving a card needs the customer's explicit stored-credential consent for the CURRENT terms version
  // (the app reads it from the tokenizer endpoint) — the card is then stored as a CardPointe profile by the salon's own gateway
  const consentVersion = (await cust.get('/customer/payment-methods/tokenizer')).body?.consentVersion;
  const pm = await cust.post('/customer/payment-methods', { token: CP_TOKENS.lostApproved, brand: 'visa', last4: '0505', expMonth: 12, expYear: 2030, isDefault: true, consent: true, consentVersion });
  const pmId = pm.body?.id ?? pm.body?.paymentMethodId;
  const a0 = auths();
  const tu = await cust.post('/customer/wallet/top-up', { amountCents: 5000, paymentMethodId: pmId, clientKey: `pilot-topup-${tag}` });
  const tuAgain = await cust.post('/customer/wallet/top-up', { amountCents: 5000, paymentMethodId: pmId, clientKey: `pilot-topup-${tag}` });   // the app's retry of the same tap
  const a1 = auths();
  const intentId = tu.body?.intentId;
  const walletBefore = (await cust.get('/customer/wallet')).body?.balanceCents;
  const ver = intentId ? await rec.post(`/pos/customers/${customerId}/wallet/top-ups/${intentId}/verify`, {}) : { status: 0 };
  const ver2 = intentId ? await rec.post(`/pos/customers/${customerId}/wallet/top-ups/${intentId}/verify`, {}) : { status: 0 };
  const check2 = intentId ? await cust.post(`/customer/wallet/top-ups/${intentId}/verify`, {}) : { status: 0 };
  const walletAfter = (await cust.get('/customer/wallet')).body?.balanceCents;
  const credits = (await q(`select count(*)::int n, coalesce(sum(amount_cents), 0)::int s from customer_wallet_ledger where tenant_id = $1 and customer_id = $2 and idempotency_key = $3`, [T, customerId, `topup:${intentId}`]))[0];
  const intentRow = intentId ? (await q(`select status, settled_by, attempt from wallet_topup_intents where id = $1`, [intentId]))[0] : null;
  R.topUp = { add: pm.status, addError: ok2(pm.status) ? undefined : (pm.body?.code ?? pm.body?.error?.code),  topUp: [tu.status, tu.body?.status, tu.body?.declined ?? null], retry: [tuAgain.status, tuAgain.body?.status], processorCalls: a1 - a0, walletBefore, verify: [ver.status, ver.body?.status], verify2: [ver2.status, ver2.body?.status], customerCheck: [check2.status, check2.body?.status], walletAfter, credits, intent: intentRow };
  check('WALLET TOP-UP RECOVERY (§15/§16/§68): the charge went through but its answer was lost → "being confirmed" (UNKNOWN, never declined); the same tap again reaches the processor 0 more times; the front desk\'s Verify finds the approval → the wallet is credited $50.00 ONCE; a second Verify and the customer\'s Check status add nothing',
    ok2(pm.status) && tu.body?.status === 'UNKNOWN' && !tu.body?.declined && tuAgain.body?.status === 'UNKNOWN' && a1 - a0 === 1 && walletBefore === 0
      && ok2(ver.status) && ver.body?.status === 'APPROVED' && ver2.body?.status === 'APPROVED' && check2.body?.status === 'APPROVED'
      && walletAfter === 5000 && credits?.n === 1 && credits?.s === 5000 && intentRow?.status === 'APPROVED' && intentRow?.settled_by === 'verify' && intentRow?.attempt === 1,
    short(R.topUp));

  // a gel ticket that reached Service Done through the queue + Tech App, for `customerId` (or a walk-in)
  const ticketFor = async (name, i, forCustomer = null) => {
    const r = await rec.post('/pos/queue/items', { customerName: name, customerPhone: `+1609552${String((Number(tag) + i * 41) % 10000).padStart(4, '0')}`, serviceIds: [ctx.services.gel], source: 'walk_in', ...(forCustomer ? { customerId: forCustomer } : {}) });
    const G = r.body?.queueItemId ?? r.body?.id;
    const a = G ? await rec.post(`/pos/queue/items/${G}/assign-technician`, { technicianId: i % 2 ? MARY : LISA, reason: 'Pilot §68: recovery flows' }) : { status: 0 };
    const s = G ? await serve(G) : { ok: false };
    if (!s.ticketId) info(`recovery ticket for ${name}: queue ${r.status} ${short(r.status >= 300 ? r.body : null)} assign ${a.status} ${short(a.status >= 300 ? a.body : null)} serve ${short(s)}`);
    return s.ticketId ?? null;
  };
  const due = async (t) => { const d = (await rec.get(`/pos/checkout/tickets/${t}`)).body; return d?.totals?.totalDueCents ?? d?.totalDueCents ?? d?.totals?.totalCents ?? null; };
  const pays = async (t) => q(`select method, status, amount_cents::int as amt from payments where tenant_id = $1 and ticket_id = $2 order by created_at`, [T, t]);

  // ── 14b SKIP-THE-LINE: lost answer → POS Verify payment → one payment ─────────────────────────────────────────────
  const slSet = await own.patch('/pos/settings/skip-line-checkout', { featureEnabled: true });
  const TS = await ticketFor('Rhea Recover', 1, customerId);
  const bill = await cust.get('/customer/me/active-bill');
  const st = TS ? await cust.post(`/customer/payments/${TS}/start`, { method: 'card' }) : { status: 0 };
  const slIntent = st.body?.intentId;
  const b0 = auths();
  const conf = slIntent ? await cust.post(`/customer/payments/${TS}/confirm`, { intentId: slIntent, method: 'card', token: CP_TOKENS.lostApproved, expiry: '1230' }) : { status: 0 };
  const confAgain = slIntent ? await cust.post(`/customer/payments/${TS}/confirm`, { intentId: slIntent, method: 'card', token: CP_TOKENS.lostApproved, expiry: '1230' }) : { status: 0 };   // the app reconnects and retries
  const b1 = auths();
  const posState = TS ? await rec.get(`/pos/tickets/${TS}/payment-status`) : { status: 0 };
  const posVer = TS ? await rec.post(`/pos/tickets/${TS}/verify-app-payment`, {}) : { status: 0 };
  const after = TS ? await cust.post(`/customer/payments/${TS}/confirm`, { intentId: slIntent, method: 'card', token: CP_TOKENS.lostApproved, expiry: '1230' }) : { status: 0 };
  const status = slIntent ? await cust.get(`/customer/payments/${slIntent}/status`) : { status: 0 };
  const slPays = TS ? await pays(TS) : [];
  const slTicket = TS ? (await q(`select status from tickets where id = $1`, [TS]))[0]?.status : null;
  R.skipLine = { settings: slSet.status, ticket: !!TS, bill: [bill.status, bill.body?.bill?.ticketId === TS], start: st.status, confirm: [conf.status, conf.body?.code], retry: [confAgain.status, confAgain.body?.code], processorCalls: b1 - b0, posState: posState.status, posVerify: [posVer.status, short(posVer.body?.results?.map?.((x) => x.outcome ?? x.status))], afterVerify: [after.status, after.body?.code], status: status.body?.status, payments: slPays, ticketStatus: slTicket };
  check('SKIP-THE-LINE RECOVERY (§59/§68): the guest pays in the app, the answer is lost → payment_status_unknown (409); the app\'s retry of the same intent never reaches the processor; the POS "Verify payment" finds the approval → ONE approved payment and the ticket paid; the app is then told already paid and reads "succeeded"',
    ok2(slSet.status) && !!TS && ok2(st.status) && conf.status === 409 && conf.body?.code === 'payment_status_unknown' && confAgain.status === 409 && confAgain.body?.code === 'payment_status_unknown' && b1 - b0 === 1
      && ok2(posVer.status) && slPays.filter((p) => p.status === 'approved').length === 1 && slPays.every((p) => p.status !== 'processing') && slTicket === 'paid'
      && after.status === 409 && after.body?.code === 'already_paid' && status.body?.status === 'succeeded',
    short(R.skipLine));

  // ── 14c SPLIT CARD: lost answer → cash / gift card / another card refused → the sweep releases it → one tender pays ──
  const TP = await ticketFor('Sam Split', 2);
  if (TP) await rec.post(`/pos/checkout/tickets/${TP}/recalculate`, { paymentMethod: 'split' });   // as the POS does on "Split"
  const dueP = TP ? await due(TP) : null;
  const c0 = auths();
  const split = TP && dueP ? await rec.post(`/pos/checkout/tickets/${TP}/pay/split`, { segments: [{ method: 'cash', amountCents: 1000 }, { method: 'card', amountCents: dueP - 1000 }], cardToken: CP_TOKENS.dropped, expiry: '1230' }, { 'idempotency-key': `pilot-rec-split-${tag}` }) : { status: 0 };
  const c1 = auths();
  const attempt = TP ? (await q(`select id, status from payment_attempts where tenant_id = $1 and ticket_id = $2 order by created_at desc limit 1`, [T, TP]))[0] : null;
  const [cash, gift, card2] = TP ? await Promise.all([
    rec.post(`/pos/checkout/tickets/${TP}/pay/cash`, { amountReceivedCents: 20000 }, { 'idempotency-key': `pilot-rec-cash-${tag}` }),
    rec.post(`/pos/checkout/tickets/${TP}/pay/gift-card`, { giftCardCode: ctx.giftCard ?? 'GC-NONE' }, { 'idempotency-key': `pilot-rec-gift-${tag}` }),
    rec.post(`/pos/checkout/tickets/${TP}/pay/card`, { idempotencyKey: `pilot-rec-card2-${tag}`, ...CARD }),
  ]) : [{ status: 0 }, { status: 0 }, { status: 0 }];
  // one at a time as well (at once, two of them may meet the ticket's checkout lock first — 409 PAYMENT_IN_PROGRESS — which
  // is a refusal too; one at a time each must meet the unsettled card itself)
  const cashOne = TP ? await rec.post(`/pos/checkout/tickets/${TP}/pay/cash`, { amountReceivedCents: 20000 }, { 'idempotency-key': `pilot-rec-cash1-${tag}` }) : { status: 0 };
  const giftOne = TP ? await rec.post(`/pos/checkout/tickets/${TP}/pay/gift-card`, { giftCardCode: ctx.giftCard ?? 'GC-NONE' }, { 'idempotency-key': `pilot-rec-gift1-${tag}` }) : { status: 0 };
  const c2 = auths();
  const unsettled = TP ? await rec.get(`/pos/checkout/tickets/${TP}/unsettled-tenders`) : { status: 0 };
  const REFUSED = new Set(['PAYMENT_STATUS_UNKNOWN', 'PAYMENT_IN_PROGRESS', 'CHECKOUT_ALREADY_IN_PROGRESS']);
  const refusedAll = [cash, gift, card2].every((r) => r.status === 409 && REFUSED.has(r.body?.code)) && [cashOne, giftOne].every((r) => r.status === 409 && r.body?.code === 'PAYMENT_STATUS_UNKNOWN')
    && (TP ? (await pays(TP)).length === 0 : false);
  if (attempt?.id) await q(`update payment_attempts set created_at = now() - interval '30 minutes' where id = $1`, [attempt.id]);   // the clock, not a user
  const swept = attempt?.id ? await until(async () => { const r = (await q(`select status, resolution from payment_attempts where id = $1`, [attempt.id]))[0]; return r && r.status !== 'processing' ? r : null; }) : null;
  const payNow = TP ? await rec.post(`/pos/checkout/tickets/${TP}/pay/cash`, { amountReceivedCents: 20000 }, { 'idempotency-key': `pilot-rec-cash-after-${tag}` }) : { status: 0 };
  const spPays = TP ? await pays(TP) : [];
  const spTicket = TP ? (await q(`select status from tickets where id = $1`, [TP]))[0]?.status : null;
  R.split = { ticket: !!TP, due: dueP, split: [split.status, split.body?.code], processorCalls: [c1 - c0, c2 - c1], attempt: attempt?.status, refused: [cash.status, cash.body?.code, gift.status, gift.body?.code, card2.status, card2.body?.code], oneAtATime: [cashOne.status, cashOne.body?.code, giftOne.status, giftOne.body?.code], unsettled: [unsettled.status, Array.isArray(unsettled.body) ? unsettled.body.length : unsettled.body?.tenders?.length ?? unsettled.body?.items?.length], swept, payAfter: [payNow.status, payNow.body?.payment?.status ?? payNow.body?.status], payments: spPays, ticketStatus: spTicket };
  check('SPLIT CARD RECOVERY (§22/§60/§68): a cash + card split whose card answer is lost → PAYMENT_STATUS_UNKNOWN, the card reservation stays processing; CASH, a GIFT CARD and ANOTHER CARD tried at once are all refused (409 — the unsettled card, or the ticket\'s checkout lock when two meet at once) and so are cash and the gift card one at a time (PAYMENT_STATUS_UNKNOWN); the processor is not reached and no payment is written; the stranded sweep (the server\'s own job) finds no record and releases it → one cash tender pays the ticket — one approved payment, nothing double',
    !!TP && split.status === 409 && split.body?.code === 'PAYMENT_STATUS_UNKNOWN' && c1 - c0 === 1 && attempt?.status === 'processing' && refusedAll && c2 === c1
      && swept && swept.status !== 'processing' && /not_found|declined|release/i.test(String(swept.resolution ?? swept.status)) && ok2(payNow.status) && spTicket === 'paid'
      && spPays.filter((p) => p.status === 'approved').length === 1,
    short(R.split));

  // ── 14d REFUND TIMEOUT: lost refund answer → the sweep reconciles it ONCE ─────────────────────────────────────────
  const TR = await ticketFor('Rory Refund', 3);
  const card = TR ? await rec.post(`/pos/checkout/tickets/${TR}/pay/card`, { idempotencyKey: `pilot-rec-refund-pay-${tag}`, ...CARD }) : { status: 0 };
  const paid = TR ? (await q(`select id, processor_transaction_id as retref from payments where tenant_id = $1 and ticket_id = $2 and method = 'card' and status = 'approved' limit 1`, [T, TR]))[0] : null;
  if (paid?.retref) cpControl.loseRefundFor.add(String(paid.retref));
  await own.post('/auth/step-up', { password: OWNER_PW });
  const rf = TR ? await own.post(`/pos/checkout/tickets/${TR}/refund`, { reason: 'Pilot §68: the refund answer is lost', amountCents: 1000 }, { 'idempotency-key': `pilot-rec-refund-${tag}` }) : { status: 0 };
  const rfRow = paid ? (await q(`select id, status from payment_refunds where tenant_id = $1 and payment_id = $2 order by created_at desc limit 1`, [T, paid.id]))[0] : null;
  const waiting = TR ? await rec.get(`/pos/checkout/tickets/${TR}/refunds/unsettled`) : { status: 0 };
  if (rfRow?.id) await q(`update payment_refunds set created_at = now() - interval '30 minutes' where id = $1`, [rfRow.id]);   // the clock, not a user
  const reconciled = rfRow?.id ? await until(async () => { const r = (await q(`select status, processor_refund_id from payment_refunds where id = $1`, [rfRow.id]))[0]; return r && r.status !== 'processing' ? r : null; }) : null;
  await sleep(16_000);   // one more sweep tick: it must change nothing
  const refundPays = TR ? await q(`select count(*)::int n, coalesce(sum(amount_cents), 0)::int s from payments where tenant_id = $1 and ticket_id = $2 and status = 'refunded'`, [T, TR]) : [{}];
  const waitingAfter = TR ? await rec.get(`/pos/checkout/tickets/${TR}/refunds/unsettled`) : { status: 0 };
  await own.post('/auth/step-up', { password: OWNER_PW });
  const manual = rfRow?.id ? await own.post(`/pos/checkout/tickets/${TR}/refunds/${rfRow.id}/settle`, { outcome: 'refunded', note: 'pilot: settle again by hand' }, { 'idempotency-key': `pilot-rec-refund-manual-${tag}` }) : { status: 0 };
  const rfTender = (rf.body?.tenders ?? rf.body?.results ?? []).find?.((x) => x.method === 'card') ?? null;
  R.refund = { ticket: !!TR, pay: [card.status, card.body?.status], refund: [rf.status, rf.body?.code ?? rfTender?.status], row: rfRow?.status, waiting: [waiting.status, waiting.body?.refunds?.length], reconciled, refundPayments: refundPays[0], waitingAfter: waitingAfter.body?.refunds?.length, manualAfter: [manual.status, manual.body?.code ?? manual.body?.message] };
  check('REFUND TIMEOUT RECOVERY (§68): a $10.00 card refund whose answer is lost → the card tender says "verifying" (REFUND_STATUS_UNKNOWN — never failed, never retried), the hold waits in "processing" and the POS lists it; the stranded sweep finds the refund at the processor → reconciled ONCE (one refund payment of $10.00, the processor\'s refund id kept); another sweep changes nothing and a manual settle afterwards is refused',
    !!TR && ok2(card.status) && ((rf.status === 409 && rf.body?.code === 'REFUND_STATUS_UNKNOWN') || (ok2(rf.status) && rfTender?.status === 'verifying')) && rfRow?.status === 'processing' && (waiting.body?.refunds?.length ?? 0) >= 1
      && reconciled?.status && reconciled.status !== 'processing' && !!reconciled.processor_refund_id && refundPays[0]?.n === 1 && refundPays[0]?.s === 1000
      && (waitingAfter.body?.refunds?.length ?? 0) === 0 && manual.status >= 400,
    short(R.refund));
  return R;
}
