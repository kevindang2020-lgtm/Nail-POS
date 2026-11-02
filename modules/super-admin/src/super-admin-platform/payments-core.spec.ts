import { deriveTxnStatus, maskCard, totalChargedCents, pct, assemblePaymentKpis } from './payments-core';

let pass = 0, fail = 0;
const ok = (c: boolean, m: string) => { if (c) pass++; else { fail++; console.error('FAIL:', m); } };
const eq = (a: unknown, b: unknown, m: string) => ok(JSON.stringify(a) === JSON.stringify(b), `${m} — got ${JSON.stringify(a)}`);

// status derivation: failed_at wins; approved/settled/refunded/void tones
eq(deriveTxnStatus({ status: 'completed', approved: true }), { label: 'Approved', tone: 'ok' }, 'approved capture');
eq(deriveTxnStatus({ status: 'completed', approved: true, failed: false }), { label: 'Approved', tone: 'ok' }, 'approved not failed');
eq(deriveTxnStatus({ status: 'declined', failed: true }), { label: 'Declined', tone: 'danger' }, 'declined + failed');
eq(deriveTxnStatus({ status: 'completed', failed: true }), { label: 'Approved', tone: 'danger' }, 'failed_at overrides an approved-looking status → danger');
eq(deriveTxnStatus({ status: 'pending' }), { label: 'Pending', tone: 'muted' }, 'pending muted');
eq(deriveTxnStatus({ status: 'refunded' }), { label: 'Refunded', tone: 'warn' }, 'refunded warn');
eq(deriveTxnStatus({ status: 'voided' }), { label: 'Voided', tone: 'warn' }, 'voided warn');
eq(deriveTxnStatus({ status: 'settled' }), { label: 'Settled', tone: 'ok' }, 'settled ok');
eq(deriveTxnStatus({ status: 'weird' }), { label: 'Pending', tone: 'muted' }, 'unknown → pending muted');

// masking: brand+last4 only, never a PAN; digits sanitized; method fallback
eq(maskCard('Mastercard', '5588'), 'Mastercard •••• 5588', 'brand + last4');
eq(maskCard('Visa', '4111111111111111'), 'Visa •••• 1111', 'only last 4 kept even if a long value slips in');
eq(maskCard(null, '1234'), '•••• 1234', 'last4 only');
eq(maskCard(null, null, 'Apple Pay'), 'Apple Pay', 'no card → method name');
eq(maskCard('', '', 'cash'), 'cash', 'no card, cash method');
eq(maskCard(null, null, null), '—', 'nothing → dash');
ok(!maskCard('Visa', '4242').includes('4242') === false && maskCard('Visa', '4242') === 'Visa •••• 4242', 'exposes only last4');

// total charged reconciles from integer-cent parts
eq(totalChargedCents({ amountCents: 15600, tipCents: 2000, taxCents: 1180, discountCents: 0, surchargeCents: 352 }), 19132, 'amount+tip+tax+surcharge-discount');
eq(totalChargedCents({ amountCents: 10000, discountCents: 500 }), 9500, 'discount subtracts');
eq(totalChargedCents({}), 0, 'empty → 0');

// pct
eq(pct(22631, 24812), 91.2, 'approval rate rounded to 0.1');
eq(pct(5, 0), 0, 'no divide-by-zero');

// KPI assembly: real values pass through; missing → honest gap
{ const k = assemblePaymentKpis({ total: 24812, volumeCents: 41276842, approved: 22631, failed: 1248, refundVoidCount: 812, settledCount: 21987, processingFeesCents: 1284700, duplicateAlerts: 36 });
  eq(k.totalTransactions, { value: 24812, available: true }, 'total kpi');
  eq(k.grossVolumeCents, { value: 41276842, available: true }, 'gross volume kpi');
  eq(k.duplicateAlerts, { value: 36, available: true }, 'duplicate alerts kpi'); }
{ const k = assemblePaymentKpis({ total: 10, approved: 9 });
  eq(k.failedDeclined, { value: null, available: false }, 'missing failed → honest gap');
  eq(k.settled, { value: null, available: false }, 'missing settled → honest gap'); }

// masking helpers
import { maskEmail, maskPhone, refundStatusLabel, settlementStatusLabel } from './payments-core';
eq(maskEmail('michael.t@example.com'), 'm•••@example.com', 'email masked to first char + domain');
eq(maskEmail(''), '—', 'empty email dash');
eq(maskEmail('bad'), '•••', 'no-@ email fully masked');
eq(maskPhone('+1 (555) 345-6789'), '•••• 89', 'phone masked to last 2');
eq(maskPhone(''), '—', 'empty phone dash');
eq(refundStatusLabel(0, 15600), 'No Refund', 'no refund');
eq(refundStatusLabel(15600, 15600), 'Fully Refunded', 'full refund');
eq(refundStatusLabel(20000, 15600), 'Fully Refunded', 'over-refund capped to full');
eq(refundStatusLabel(5000, 15600), 'Partially Refunded', 'partial refund');
eq(settlementStatusLabel('settled', false), 'Settled', 'settled status');
eq(settlementStatusLabel('completed', true), 'Unsettled', 'approved not settled → unsettled');
eq(settlementStatusLabel('pending', false), 'Unknown', 'unknown settlement');

// event history label + tone (§22)
import { normalizeEventLabel, eventTone } from './payments-core';
eq(normalizeEventLabel('payment_succeeded'), 'Authorization approved', 'known event label');
eq(normalizeEventLabel('refund.completed'), 'Refund completed', 'dotted event label');
eq(normalizeEventLabel('settlement_failed'), 'Settlement failed', 'failed settlement label');
eq(normalizeEventLabel('some_new_event'), 'Some new event', 'unknown event title-cased');
eq(normalizeEventLabel(''), 'Processor event', 'empty → generic');
eq(eventTone('captured'), 'ok', 'capture ok');
eq(eventTone('settlement_failed'), 'danger', 'failed danger');
eq(eventTone('chargeback_received'), 'danger', 'chargeback danger');
eq(eventTone('refund_reversal'), 'warn', 'reversal warn');
eq(eventTone('sync_retried'), 'warn', 'retried warn');
eq(eventTone('mystery'), 'muted', 'unknown muted');

console.log(`payments-core: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
