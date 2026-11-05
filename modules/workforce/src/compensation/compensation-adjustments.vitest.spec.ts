// compensation-adjustments.vitest.spec.ts — §21 refund/void/chargeback reversals + §24 manual adjustments.
import { describe, it, expect } from 'vitest';
import { buildRefundReversal, buildManualAdjustment, type ReversibleRow } from './compensation-adjustments';

const rows: ReversibleRow[] = [
  { service_line_id: 'L1', technician_id: 'a', tech_service_earnings_cents: 5400, salon_service_share_cents: 3600, supply_cents: 1000, card_tip_cents: 2000, cash_tip_cents: 0, retail_commission_cents: 0 },
  { service_line_id: 'L2', technician_id: 'b', tech_service_earnings_cents: 2500, salon_service_share_cents: 2500, supply_cents: 500, card_tip_cents: 0, cash_tip_cents: 500, retail_commission_cents: 300 },
];
const opts = { reason: 'customer refund', requestedBy: 'u_owner' };

describe('refund / void / chargeback reversals (§21)', () => {
  it('full refund reverses every technician\'s commission as NEGATIVE entries (snapshot untouched)', () => {
    const e = buildRefundReversal('tk1', rows, { type: 'full' }, opts);
    const aCommission = e.find((x) => x.technicianId === 'a' && x.category === 'refund_reversal')!;
    expect(aCommission.amountCents).toBe(-5400);
    // RE-PINNED (wave 2, mandate §33): the retail part is its own RETAIL_COMMISSION_REVERSAL category — on one line it used
    // to share the service category and the 588 idempotency index dropped it (retail commission never reversed)
    expect(e.filter((x) => x.category === 'refund_reversal').reduce((s, x) => s + x.amountCents, 0)).toBe(-7900);
    expect(e.filter((x) => x.category === 'retail_reversal').reduce((s, x) => s + x.amountCents, 0)).toBe(-300);
    expect(e.every((x) => x.amountCents < 0)).toBe(true);
    // RE-PINNED (merge Oct 12 2026, mandate §51): auto reversals are 'posted' (counted immediately); 'applied' is the legacy label.
    expect(e.every((x) => x.status === 'posted')).toBe(true);
  });

  // Mandate §52: partial refund WITHOUT line detail reverses PRO-RATA (refunded/captured), exact cents.
  it('partial refund without lines reverses pro-rata across every line, largest-remainder exact (§52)', () => {
    // $100 ticket (two lines), tech a earned $54, b $25 (+$3 retail); customer refunded $25 of $100 → ratio 0.25
    const e = buildRefundReversal('tk1', rows, { type: 'partial', refundedCents: 2500, capturedCents: 10000, refundPaymentId: 'rp1' }, opts);
    const comm = e.filter((x) => x.category === 'refund_reversal');
    expect(comm.reduce((s, x) => s + x.amountCents, 0)).toBe(-Math.round((5400 + 2500) * 0.25));   // Σ == round(ratio × Σ original)
    expect(e.filter((x) => x.category === 'retail_reversal').reduce((s, x) => s + x.amountCents, 0)).toBe(-Math.round(300 * 0.25));   // retail separately (§33)
    expect(comm.find((x) => x.technicianId === 'a')!.amountCents).toBe(-1350);
    expect(e.every((x) => x.refundPaymentId === 'rp1' && x.status === 'posted')).toBe(true);
    expect(e.some((x) => x.category === 'tip_correction')).toBe(false);   // tip stays unless tipRefunded
    // the mandate's own example: $100 eligible, 60% → +$60; $25 refund → −$15; a $0 refund reverses nothing
    const one: ReversibleRow[] = [{ service_line_id: 'L', technician_id: 'a', tech_service_earnings_cents: 6000, salon_service_share_cents: 4000, supply_cents: 0, card_tip_cents: 0, cash_tip_cents: 0, retail_commission_cents: 0 }];
    expect(buildRefundReversal('tk', one, { type: 'partial', refundedCents: 2500, capturedCents: 10000 }, opts)[0].amountCents).toBe(-1500);
    expect(buildRefundReversal('tk', one, { type: 'partial', refundedCents: 0, capturedCents: 10000 }, opts)).toHaveLength(0);
    // odd cents never appear or vanish: $21.01 of commission at ratio 1/3 across two lines
    const odd: ReversibleRow[] = [
      { service_line_id: 'L1', technician_id: 'a', tech_service_earnings_cents: 1051, salon_service_share_cents: 0, supply_cents: 0, card_tip_cents: 0, cash_tip_cents: 0, retail_commission_cents: 0 },
      { service_line_id: 'L2', technician_id: 'b', tech_service_earnings_cents: 1050, salon_service_share_cents: 0, supply_cents: 0, card_tip_cents: 0, cash_tip_cents: 0, retail_commission_cents: 0 },
    ];
    const r = buildRefundReversal('tk', odd, { type: 'partial', refundedCents: 1000, capturedCents: 3000 }, opts);
    expect(r.reduce((s, x) => s + x.amountCents, 0)).toBe(-Math.round(2101 / 3));
  });

  // Oct 13 2026 (live money-chain proof): the pro-rata denominator is the COMMISSIONABLE money captured — tips and tax
  // are not commission basis, so a $45.00 refund of a $45.00 service paid as $60.24 (tax $5.24 + tip $10.00) reverses
  // the WHOLE $27.00, not 45/60.24 of it. The tip is still only reversed when tipRefunded says so.
  it('pro-rata partial refund measures against the commissionable captured money (captured − tips − tax), capped at 1 (§52)', () => {
    const one: ReversibleRow[] = [{ service_line_id: 'L', technician_id: 'a', tech_service_earnings_cents: 2700, salon_service_share_cents: 1800, supply_cents: 0, card_tip_cents: 1000, cash_tip_cents: 0, retail_commission_cents: 0 }];
    const full = buildRefundReversal('tk', one, { type: 'partial', refundedCents: 4500, capturedCents: 6024, nonCommissionableCents: 1524 }, opts);
    expect(full.map((x) => [x.category, x.amountCents])).toEqual([['refund_reversal', -2700]]);
    // half of the $60.00 pedicure (captured $69.65 = 60.00 + tax 4.65 + tip 5.00): exactly half the commission
    const ped: ReversibleRow[] = [{ service_line_id: 'L', technician_id: 'a', tech_service_earnings_cents: 3000, salon_service_share_cents: 3000, supply_cents: 0, card_tip_cents: 0, cash_tip_cents: 500, retail_commission_cents: 0 }];
    expect(buildRefundReversal('tk', ped, { type: 'partial', refundedCents: 3000, capturedCents: 6965, nonCommissionableCents: 965 }, opts)[0].amountCents).toBe(-1500);
    // a refund LARGER than the commissionable money (the customer also got tax/tip back) never reverses more than 100 %
    expect(buildRefundReversal('tk', ped, { type: 'partial', refundedCents: 6500, capturedCents: 6965, nonCommissionableCents: 965, tipRefunded: true }, opts).map((x) => [x.category, x.amountCents]))
      .toEqual([['refund_reversal', -3000], ['tip_correction', -500]]);
    // a nonsense denominator (non-commissionable ≥ captured) falls back to the captured amount, never divides by zero
    expect(buildRefundReversal('tk', ped, { type: 'partial', refundedCents: 3000, capturedCents: 6000, nonCommissionableCents: 6000 }, opts)[0].amountCents).toBe(-1500);
  });

  it('a paid prior period or the tenant review flag parks the reversal as pending (never a rewrite of the locked period)', () => {
    expect(buildRefundReversal('tk1', rows, { type: 'full' }, { ...opts, priorPeriodPaid: true }).every((x) => x.status === 'pending' && x.targetsFuturePeriod)).toBe(true);
    expect(buildRefundReversal('tk1', rows, { type: 'full' }, { ...opts, requireApproval: true }).every((x) => x.status === 'pending')).toBe(true);
  });

  it('tips reverse ONLY when the tip was refunded', () => {
    const noTip = buildRefundReversal('tk1', rows, { type: 'full', tipRefunded: false }, opts);
    expect(noTip.some((x) => x.category === 'tip_correction')).toBe(false);
    const withTip = buildRefundReversal('tk1', rows, { type: 'full', tipRefunded: true }, opts);
    const aTip = withTip.find((x) => x.technicianId === 'a' && x.category === 'tip_correction')!;
    expect(aTip.amountCents).toBe(-2000);
  });

  it('supply reverses only when policy says so (salon keeps supply by default)', () => {
    expect(buildRefundReversal('tk1', rows, { type: 'full' }, opts).some((x) => x.category === 'supply_correction')).toBe(false);
    expect(buildRefundReversal('tk1', rows, { type: 'full', supplyReversible: true }, opts).some((x) => x.category === 'supply_correction')).toBe(true);
  });

  it('partial refund touches only the named line', () => {
    const e = buildRefundReversal('tk1', rows, { type: 'partial', lines: [{ serviceLineId: 'L2', refundTip: true }] }, opts);
    expect(e.every((x) => x.serviceLineId === 'L2')).toBe(true);
    expect(e.find((x) => x.category === 'tip_correction')!.amountCents).toBe(-500);
  });

  it('void reverses commission AND tip (a void unwinds the whole sale)', () => {
    const e = buildRefundReversal('tk1', rows, { type: 'void' }, opts);
    expect(e.some((x) => x.category === 'void_reversal')).toBe(true);
    expect(e.some((x) => x.category === 'tip_correction')).toBe(true);
  });

  it('chargeback is NOT auto-applied — it becomes a pending-review exception (§21)', () => {
    const e = buildRefundReversal('tk1', rows, { type: 'chargeback' }, opts);
    expect(e.every((x) => x.status === 'pending_review')).toBe(true);
  });

  it('refund after a PAID period targets a future period + stays pending (never rewrites the locked period)', () => {
    const e = buildRefundReversal('tk1', rows, { type: 'full' }, { ...opts, priorPeriodPaid: true });
    expect(e.every((x) => x.targetsFuturePeriod && x.status === 'pending')).toBe(true);
  });
});

describe('manual adjustments (§24)', () => {
  it('requires the mandatory fields', () => {
    expect(buildManualAdjustment({}).errors.length).toBeGreaterThan(0);
    expect(buildManualAdjustment({ technicianId: 'a', ticketId: 'tk1', amountCents: 500, category: 'bonus', reason: 'spiff', requestedBy: 'u' }).entry).toBeTruthy();
  });
  it('large adjustments require owner approval', () => {
    const big = buildManualAdjustment({ technicianId: 'a', periodId: 'p1', amountCents: 25000, category: 'commission_correction', reason: 'fix', requestedBy: 'u' });
    expect(big.errors.some((e) => /owner approval/.test(e))).toBe(true);
    const approved = buildManualAdjustment({ technicianId: 'a', periodId: 'p1', amountCents: 25000, category: 'commission_correction', reason: 'fix', requestedBy: 'u', approvedBy: 'owner' });
    expect(approved.entry!.status).toBe('approved');
  });
  it('a zero amount is rejected (no silent no-op entries)', () => {
    expect(buildManualAdjustment({ technicianId: 'a', ticketId: 't', amountCents: 0, category: 'bonus', reason: 'x', requestedBy: 'u' }).errors.some((e) => /non-zero/.test(e))).toBe(true);
  });
});
