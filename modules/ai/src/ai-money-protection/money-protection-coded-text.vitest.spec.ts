// money-protection-coded-text.vitest.spec.ts — Vietnamese POS §21 / §120 (Oct 27 2026): every sentence Money Protection
// writes into an alert's evidence, and the deterministic fallback explanation, re-codes losslessly (mpTextCoded /
// mpFallbackCoded, api-contracts): rendered with the POS English catalogue they equal what the server wrote. Also: the
// contract table and the POS English catalogue (srv.MP.*) are the same text.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { mpTextCoded, mpFallbackCoded, MONEY_PROTECTION_TEXT } from '@aipowersalon/api-contracts/tenant';
import type { CodedText } from '@aipowersalon/api-contracts';
import { detectDuplicateCharge, detectRefundExceedsCapture, detectRefundMethodMismatch, detectExcessiveDiscount, detectNonPositiveCapture, detectMultipleReversals, detectFailedPaymentRetryLoop, detectPaidTicketNoCapture, detectCaptureOnCancelledTicket, type NormalizedPayment, type NormalizedRefund } from './ai-money-protection-rules';
import { reconcileMembershipPayments, reconcileGiftCards, reconcileCashDrawers } from './ai-money-protection-reconciliation';
import { scoreReversalRateOutliers } from './ai-money-protection-baselines';
import { deterministicFallback } from './ai-money-protection-explain';

const cat: Record<string, string> = {};
for (const m of readFileSync(new URL('../../../../apps/pos-web/src/i18n/ns/srv.en.ts', import.meta.url), 'utf8').matchAll(/^\s*'([^']+)':\s*'((?:[^'\\]|\\.)*)',/gm)) cat[m[1]] = m[2].replace(/\\'/g, "'").replace(/\\\\/g, '\\');
const fill = (s: string, v: Record<string, string>) => s.replace(/\{(\w+)\}/g, (_, k) => v[k] ?? `{${k}}`);
function ref(spec: string, raw: Record<string, string>): string {
  const [key, prefix] = spec.split('#'); let vars = raw;
  if (prefix) { vars = {}; for (const [k, v] of Object.entries(raw)) if (k.startsWith(prefix + '_')) vars[k.slice(prefix.length + 1)] = v; }
  if (!(key in cat)) throw new Error('missing ' + key); return fill(cat[key], vars);
}
function en(ct: CodedText): string {
  const raw: Record<string, string> = {}; for (const [k, v] of Object.entries(ct.vars ?? {})) if (v != null) raw[k] = String(v);
  const vars: Record<string, string> = {}; for (const [k, v] of Object.entries(raw)) vars[k] = v.startsWith('@') ? ref(v.slice(1), raw) : v;
  if (!('srv.' + ct.code in cat)) throw new Error('missing srv.' + ct.code); return fill(cat['srv.' + ct.code], vars);
}
const T = Date.parse('2026-07-07T10:00:00Z');
const pay = (o: Partial<NormalizedPayment> & { id: string }): NormalizedPayment => ({ branchId: 'b1', ticketId: 't1', amountCents: 5000, method: 'card', status: 'approved', idempotencyKey: null, processorTxnId: null, createdByUserId: 'u1', createdAtMs: T, ...o });
const ref$ = (o: Partial<NormalizedRefund> & { id: string }): NormalizedRefund => ({ branchId: 'b1', ticketId: 't1', amountCents: 1000, status: 'refunded', createdAtMs: T, ...o });

function allCandidates() {
  const peers = (u: string, c: number, r: number) => ({ p: Array.from({ length: c }, (_, i) => pay({ id: `p_${u}_${i}`, ticketId: `t_${u}_${i}`, createdByUserId: u })), r: Array.from({ length: r }, (_, i) => ref$({ id: `r_${u}_${i}`, ticketId: `t_${u}_${i}`, amountCents: 5000, byUserId: u })) });
  const act = [peers('u1', 50, 1), peers('u2', 50, 1), peers('u3', 50, 1), peers('u4', 50, 1), peers('bad', 50, 15)];
  return [
    ...detectDuplicateCharge([pay({ id: 'a', processorTxnId: 'X' }), pay({ id: 'b', processorTxnId: 'X' })]),
    ...detectDuplicateCharge([pay({ id: 'c', idempotencyKey: 'K', ticketId: 't9' }), pay({ id: 'd', idempotencyKey: 'K', ticketId: 't9' })]),
    ...detectDuplicateCharge([pay({ id: 'e', ticketId: 't2' }), pay({ id: 'f', ticketId: 't2', createdAtMs: T + 30_000 })]),
    ...detectRefundExceedsCapture([pay({ id: 'g', ticketId: 't3', amountCents: 1000 })], [ref$({ id: 'h', ticketId: 't3', amountCents: 3000 })]),
    ...detectRefundMethodMismatch([pay({ id: 'i', ticketId: 't4', method: 'card' })], [ref$({ id: 'j', ticketId: 't4', method: 'cash' })]),
    ...detectExcessiveDiscount([{ id: 't5', branchId: 'b1', subtotalCents: 1000, discountCents: 2000, totalCents: 0, status: 'paid' }]),
    ...detectNonPositiveCapture([pay({ id: 'k', amountCents: -500 })]),
    ...detectMultipleReversals([ref$({ id: 'l', ticketId: 't6' }), ref$({ id: 'm', ticketId: 't6' }), ref$({ id: 'n', ticketId: 't6' })]),
    ...detectFailedPaymentRetryLoop(Array.from({ length: 6 }, (_, i) => ({ id: 'x' + i, branchId: 'b1', ticketId: 't7', status: 'declined', method: 'card', createdAtMs: T + i * 1000 }))),
    ...detectPaidTicketNoCapture([], [{ id: 't8', branchId: 'b1', subtotalCents: 1000, discountCents: 0, totalCents: 1000, status: 'paid' }]),
    ...detectCaptureOnCancelledTicket([pay({ id: 'o', ticketId: 't10' })], [], [{ id: 't10', branchId: 'b1', subtotalCents: 5000, discountCents: 0, totalCents: 5000, status: 'cancelled' }]),
    ...reconcileMembershipPayments([{ id: 'mp1', branchId: 'b1', customerId: 'c', amountCents: 3000, status: 'approved', processorRef: 'R', idempotencyKey: null, createdAtMs: T }, { id: 'mp2', branchId: 'b1', customerId: 'c', amountCents: 3000, status: 'approved', processorRef: 'R', idempotencyKey: null, createdAtMs: T }]),
    ...reconcileMembershipPayments([{ id: 'mp3', branchId: 'b1', customerId: 'c', amountCents: 3000, status: 'approved', processorRef: null, idempotencyKey: 'I', createdAtMs: T }, { id: 'mp4', branchId: 'b1', customerId: 'c', amountCents: 3000, status: 'approved', processorRef: null, idempotencyKey: 'I', createdAtMs: T }]),
    ...reconcileGiftCards([{ id: 'g1', branchId: 'b1', balanceCents: -100, status: 'active' }], [{ id: 'gt', giftCardId: 'g1', branchId: 'b1', type: 'redeem', amountCents: 500, balanceAfterCents: -100 }]),
    ...reconcileCashDrawers([{ id: 's1', branchId: 'b1', businessDate: '2026-10-01', varianceCents: -900, countedCents: null, expectedCents: null, status: 'closed' }, { id: 's2', branchId: 'b1', businessDate: '2026-10-02', varianceCents: 900, countedCents: null, expectedCents: null, status: 'closed' }]),
    ...scoreReversalRateOutliers(act.flatMap((a) => a.p), act.flatMap((a) => a.r)),
  ];
}

describe('Money Protection evidence re-codes losslessly', () => {
  const cands = allCandidates();
  it('the fixtures raise every rule', () => {
    const rules = new Set(cands.map((c) => c.ruleId));
    for (const r of ['MP_DUP_CHARGE_EXACT', 'MP_DUP_CHARGE_LIKELY', 'MP_REFUND_EXCEEDS_CAPTURE', 'MP_REFUND_METHOD_MISMATCH', 'MP_DISCOUNT_EXCEEDS_SUBTOTAL', 'MP_NEGATIVE_CAPTURE', 'MP_MULTIPLE_REVERSALS',
      'MP_FAILED_PAYMENT_RETRY_LOOP', 'MP_PAID_NO_CAPTURE', 'MP_CAPTURE_ON_CANCELLED', 'MP_MEMBERSHIP_DUP_CHARGE', 'MP_GIFTCARD_NEGATIVE_BALANCE', 'MP_GIFTCARD_REDEEM_EXCEEDS', 'MP_CASH_DRAWER_VARIANCE', 'MP_REVERSAL_RATE_OUTLIER']) expect(rules.has(r), r).toBe(true);
  });
  it('every summary, suggested review and benign explanation', () => {
    let n = 0;
    for (const c of cands) for (const s of [c.evidence.summary, ...(c.evidence.recommendedReview ?? []), ...(c.evidence.alternativeExplanations ?? [])]) {
      const ct = mpTextCoded(s); expect(ct, s).not.toBeNull(); expect(en(ct!)).toBe(s); n++;
    }
    expect(n).toBeGreaterThan(50);
  });
  it('the deterministic fallback explanation', () => {
    for (const c of cands) {
      const alert = { ...c, amountCents: c.amountCents } as any;
      const parts = mpFallbackCoded(alert); expect(parts, c.ruleId).not.toBeNull();
      expect(parts!.map(en).join(' ')).toBe(deterministicFallback(alert));
    }
  });
  it('the contract table equals the POS English catalogue', () => {
    for (const [code, tpl] of Object.entries(MONEY_PROTECTION_TEXT)) expect(cat['srv.MP.' + code], code).toBe(tpl);
  });
  it('another sentence → null', () => { expect(mpTextCoded('Mia took the money')).toBeNull(); });
});
