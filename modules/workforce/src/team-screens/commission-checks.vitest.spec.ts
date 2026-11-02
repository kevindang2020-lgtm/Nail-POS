// commission-checks — the two pure F2 detectors (Finish the Five, 30 Oct 2026): the guide's worked examples and the
// special cases (override, history, missing evidence, tier plans, technician-funded discount, multi-technician split;
// policy missing / none / pro-rata, partial line refunds, replayed webhooks, duplicates, misattribution, already paid).
import { describe, it, expect } from 'vitest';
import { checkRateLine, checkRefundTicket, postedRefunds, rateFingerprint, refundFingerprint, type RateLineInput, type RateHistory, type RefundTicketInput } from './commission-checks';

const T = 't1';
const ver = (o: Partial<any> = {}) => ({ policy_id: 'p1', version_id: 'v1', version: 1, branch_id: null, technician_id: null, service_id: null, service_category: null, ticket_id: null,
  commission_type: 'percent', commission_value: 40, supply_method: 'none', supply_value: 0, discount_funding: 'proportional', effective_start: '2026-01-01T00:00:00Z', effective_end: null, approved: true,
  created_at: '2026-01-01T00:00:00Z', ...o });
const hist = (o: Partial<RateHistory> = {}): RateHistory => ({ versions: [ver()], service: { commission_type: 'none', commission_value: null, updated_at: '2026-01-01T00:00:00Z' }, tenantDefault: { percent: 50, updatedAt: '2026-01-01T00:00:00Z' }, ...o });
const line = (o: Partial<RateLineInput> = {}): RateLineInput => ({ tenantId: T, ticketId: 'tk1', serviceLineId: 'l1', branchId: null, serviceId: 's1', serviceCategory: null, technicianId: 'm',
  pricedAt: '2026-10-20T15:00:00Z', recordedType: 'percent', recordedValue: 40, ruleSource: 'Salon Default', policyId: 'p1', policyVersion: 1, discountCents: 0, discountFunding: 'proportional',
  rows: [{ snapshotId: 's', technicianId: 'm', commissionableCents: 10000, earningsCents: 4000 }], ...o });

describe('rate vs historical configuration', () => {
  it('the guide example: verified 40% on $100 expects $40; $30 recorded is a $10 finding', () => {
    const r = checkRateLine(line({ recordedValue: 30, rows: [{ snapshotId: 's', technicianId: 'm', commissionableCents: 10000, earningsCents: 3000 }] }), hist());
    expect(r).toMatchObject({ state: 'MISMATCH', expectedCents: 4000, recordedCents: 3000, deltaCents: -1000 });
  });
  it('an authorised 30% ticket override is honoured', () => {
    const h = hist({ versions: [ver(), ver({ policy_id: 'p2', version_id: 'v9', ticket_id: 'tk1', commission_value: 30 })] });
    expect(checkRateLine(line({ recordedValue: 30, ruleSource: 'Ticket Override', rows: [{ snapshotId: 's', technicianId: 'm', commissionableCents: 10000, earningsCents: 3000 }] }), h).state).toBe('OK');
  });
  it('a rate changed after the service is history, not an error; a rule authored later with a back-dated start does not count', () => {
    const h = hist({ versions: [ver({ effective_end: '2026-10-28T00:00:00Z' }), ver({ version_id: 'v2', version: 2, commission_value: 30, effective_start: '2026-10-28T00:00:00Z', created_at: '2026-10-28T00:00:00Z' }),
      ver({ policy_id: 'p3', version_id: 'v3', technician_id: 'm', commission_value: 20, effective_start: '2026-01-01T00:00:00Z', created_at: '2026-10-29T00:00:00Z' })] });
    expect(checkRateLine(line(), h).state).toBe('OK');
  });
  it('missing evidence is UNABLE_TO_VERIFY, never a mismatch', () => {
    expect(checkRateLine(line({ recordedValue: null }), hist()).state).toBe('UNABLE_TO_VERIFY');
    expect(checkRateLine(line({ ruleSource: 'Tier plan' }), hist()).state).toBe('UNABLE_TO_VERIFY');
    expect(checkRateLine(line({ policyId: 'gone' }), hist()).state).toBe('UNABLE_TO_VERIFY');
    // the service's own rate decided, and the service row changed after the service (no rate history table)
    const svc = hist({ versions: [], service: { commission_type: 'percent', commission_value: 35, updated_at: '2026-10-25T00:00:00Z' } });
    expect(checkRateLine(line({ ruleSource: 'Service default', policyId: null, recordedValue: 45, rows: [{ snapshotId: 's', technicianId: 'm', commissionableCents: 10000, earningsCents: 4500 }] }), svc).state).toBe('UNABLE_TO_VERIFY');
    // the salon default decided and changed afterwards
    expect(checkRateLine(line({ ruleSource: 'Tenant default rate', policyId: null }), hist({ versions: [], tenantDefault: { percent: 40, updatedAt: '2026-10-29T00:00:00Z' } })).state).toBe('UNABLE_TO_VERIFY');
  });
  it('multi-technician shared revenue is checked per line (largest-remainder cent tolerated)', () => {
    const rows = [{ snapshotId: 'a', technicianId: 'm', commissionableCents: 5001, earningsCents: 2001 }, { snapshotId: 'b', technicianId: 'n', commissionableCents: 5000, earningsCents: 2000 }];
    expect(checkRateLine(line({ rows }), hist()).state).toBe('OK');
  });
  it('a technician-funded discount uses the technician-funded split', () => {
    // $100 service, $10 technician-funded discount, 40%: salon keeps 60% of $100 = $60, technician gets $90 − $60 = $30
    const h = hist();
    expect(checkRateLine(line({ discountCents: 1000, discountFunding: 'technician_funded', rows: [{ snapshotId: 's', technicianId: 'm', commissionableCents: 9000, earningsCents: 3000 }] }), h).state).toBe('OK');
    expect(checkRateLine(line({ discountCents: 1000, discountFunding: 'technician_funded', rows: [{ snapshotId: 's', technicianId: 'm', commissionableCents: 9000, earningsCents: 3600 }] }), h).state).toBe('MISMATCH');
  });
  it('fingerprints are stable for the same source and version', () => {
    const r = checkRateLine(line({ recordedValue: 30, rows: [{ snapshotId: 's', technicianId: 'm', commissionableCents: 10000, earningsCents: 3000 }] }), hist());
    expect(rateFingerprint('l1', r)).toBe(rateFingerprint('l1', checkRateLine(line({ recordedValue: 30, rows: [{ snapshotId: 's', technicianId: 'm', commissionableCents: 10000, earningsCents: 3000 }] }), hist())));
  });
});

const rows = [{ service_line_id: 'l1', technician_id: 'm', tech_service_earnings_cents: 4000, salon_service_share_cents: 6000, supply_cents: 0, card_tip_cents: 0, cash_tip_cents: 0, retail_commission_cents: 0 }];
const tick = (o: Partial<RefundTicketInput> = {}): RefundTicketInput => ({ ticketId: 'tk1', capturedCents: 10000, nonCommissionableCents: 0, rows, recorded: [], policy: 'PRO_RATA', periodPaid: false,
  refunds: [{ id: 'r1', amountCents: 5000, status: 'refunded', dedupeKey: 'evt1', createdAt: '2026-10-28T00:00:00Z' }], ...o });

describe('refund reversal verification', () => {
  it('the guide example: $50 posted refund of $100, pro-rata → $20 expected; none recorded → MISSING (never a deduction)', () => {
    expect(checkRefundTicket(tick())).toEqual([expect.objectContaining({ kind: 'MISSING', technicianId: 'm', expectedCents: 2000, recordedCents: 0 })]);
  });
  it('a recorded pro-rata reversal reconciles', () => {
    expect(checkRefundTicket(tick({ recorded: [{ id: 'a', technicianId: 'm', serviceLineId: 'l1', category: 'refund_reversal', amountCents: -2000, status: 'posted', refundPaymentId: 'r1', targetsFuturePeriod: false }] }))).toEqual([]);
  });
  it('no policy → POLICY_NOT_CONFIGURED; NO_REVERSAL → a recorded reversal is excessive', () => {
    expect(checkRefundTicket(tick({ policy: null }))[0]).toMatchObject({ kind: 'POLICY_NOT_CONFIGURED', expectedCents: null });
    const rec = [{ id: 'a', technicianId: 'm', serviceLineId: 'l1', category: 'refund_reversal', amountCents: -2000, status: 'posted', refundPaymentId: 'r1', targetsFuturePeriod: false }];
    expect(checkRefundTicket(tick({ policy: 'NO_REVERSAL', recorded: rec }))[0]).toMatchObject({ kind: 'EXCESSIVE', expectedCents: 0, recordedCents: 2000 });
    expect(checkRefundTicket(tick({ policy: 'NO_REVERSAL' }))).toEqual([]);
  });
  it('a replayed webhook is counted once; requested / failed / voided refunds are ignored', () => {
    const replay = [{ id: 'r1', amountCents: 5000, status: 'refunded', dedupeKey: 'evt1', createdAt: '2026-10-28T00:00:00Z' }, { id: 'r2', amountCents: 5000, status: 'refunded', dedupeKey: 'evt1', createdAt: '2026-10-28T00:00:01Z' },
      { id: 'r3', amountCents: 5000, status: 'failed', dedupeKey: 'evt2', createdAt: '2026-10-28T00:00:02Z' }, { id: 'r4', amountCents: 5000, status: 'pending', dedupeKey: null, createdAt: '2026-10-28T00:00:03Z' }];
    expect(postedRefunds(replay).map((r) => r.id)).toEqual(['r1']);
    expect(checkRefundTicket(tick({ refunds: replay }))[0]).toMatchObject({ expectedCents: 2000 });
  });
  it('multiple partial refunds summing to the capture → full reversal; a named-line refund reverses that line only', () => {
    const two = [{ id: 'r1', amountCents: 5000, status: 'refunded', dedupeKey: 'e1', createdAt: '2026-10-28T00:00:00Z' }, { id: 'r2', amountCents: 5000, status: 'refunded', dedupeKey: 'e2', createdAt: '2026-10-29T00:00:00Z' }];
    expect(checkRefundTicket(tick({ refunds: two }))[0]).toMatchObject({ expectedCents: 4000 });
    const r2 = [...rows, { ...rows[0], service_line_id: 'l2', technician_id: 'n', tech_service_earnings_cents: 3000 }];
    const f = checkRefundTicket(tick({ rows: r2, capturedCents: 17500, refunds: [{ id: 'r1', amountCents: 7500, status: 'refunded', dedupeKey: 'e', createdAt: 'x', serviceLineIds: ['l2'] }] }));
    expect(f).toEqual([expect.objectContaining({ kind: 'MISSING', technicianId: 'n', expectedCents: 3000 })]);
  });
  it('duplicates, misattribution and an already-paid commission are named', () => {
    const e = { id: 'a', technicianId: 'm', serviceLineId: 'l1', category: 'refund_reversal', amountCents: -2000, status: 'posted', refundPaymentId: 'r1', targetsFuturePeriod: false };
    const f = checkRefundTicket(tick({ recorded: [e, { ...e, id: 'b' }, { ...e, id: 'c', technicianId: 'x', refundPaymentId: 'r9' }], periodPaid: true }));
    expect(f.map((x) => x.kind).sort()).toEqual(['DUPLICATE', 'EXCESSIVE', 'MISATTRIBUTED']);
    expect(f.every((x) => x.paidAlready)).toBe(true);
    expect(refundFingerprint('tk1', f[0])).toBe(refundFingerprint('tk1', checkRefundTicket(tick({ recorded: [e, { ...e, id: 'b' }, { ...e, id: 'c', technicianId: 'x', refundPaymentId: 'r9' }], periodPaid: true }))[0]));
  });
});
