// Permanent vitest wrapper for the canonical compensation engine (spec §28/§11/§6/§7/§25).
import { describe, it, expect } from 'vitest';
import { computeTicketCompensation, computeGuaranteeTopUp, prorateGuarantee, allocateByLargestRemainder } from './compensation-engine';
import type { TicketCompensationInput } from './compensation.types';

const base = (over: Partial<TicketCompensationInput>): TicketCompensationInput => ({ tenantId: 't1', branchId: 'b1', ticketId: 'tk1', serviceLines: [], ...over });

describe('canonical compensation engine', () => {
  it('§28 Ex1 standard: $100, $10 supply, 60/40, $6 tax, $20 tip', () => {
    const r = computeTicketCompensation(base({ serviceLines: [{ lineId: 'L1', priceCents: 10000, taxCents: 600, supply: { method: 'fixed', value: 1000 }, commission: { type: 'percent', value: 60 }, technicians: [{ technicianId: 'sam', method: 'equal' }] }], tip: { method: 'equal', cardTipCents: 2000 } }));
    expect(r.totals.commissionableCents).toBe(9000);
    expect(r.totals.techServiceEarningsCents).toBe(5400);
    expect(r.totals.salonServiceShareCents).toBe(3600);
    expect(r.totals.supplyCents).toBe(1000);
    expect(r.totals.taxCents).toBe(600);
    expect(r.salonTipCents).toBe(0);
    expect(r.perTechnician[0].cardTipCents).toBe(2000);
    expect(r.reconciliation.splitsReconcile).toBe(true);
  });
  it('§28 Ex2 discount → commissionable $80, tech $48', () => {
    const r = computeTicketCompensation(base({ serviceLines: [{ lineId: 'L1', priceCents: 10000, discountCents: 1000, supply: { method: 'fixed', value: 1000 }, commission: { type: 'percent', value: 60 }, technicians: [{ technicianId: 'sam', method: 'equal' }] }] }));
    expect(r.totals.commissionableCents).toBe(8000);
    expect(r.totals.techServiceEarningsCents).toBe(4800);
    expect(r.totals.salonServiceShareCents).toBe(3200);
  });
  it('§10 technician-funded discount: tech absorbs it, salon keeps full share', () => {
    // $100, $10 tech-funded discount, 60/40, no supply → commissionable $90; salon keeps $40 (on full $100), tech $50
    const r = computeTicketCompensation(base({ serviceLines: [{ lineId: 'L1', priceCents: 10000, discountCents: 1000, discountFunding: 'technician_funded', commission: { type: 'percent', value: 60 }, technicians: [{ technicianId: 'sam', method: 'equal' }] }] }));
    expect(r.totals.commissionableCents).toBe(9000);
    expect(r.totals.salonServiceShareCents).toBe(4000);            // unchanged — salon keeps its full 40%
    expect(r.totals.techServiceEarningsCents).toBe(5000);          // 60% of 100 ($60) minus the $10 they funded
    expect(r.reconciliation.splitsReconcile).toBe(true);
  });

  it('§10 salon-funded discount keeps commission on full value', () => {
    const r = computeTicketCompensation(base({ serviceLines: [{ lineId: 'L1', priceCents: 10000, discountCents: 2000, discountFunding: 'salon_funded', commission: { type: 'percent', value: 60 }, technicians: [{ technicianId: 'sam', method: 'equal' }] }] }));
    expect(r.totals.commissionableCents).toBe(10000);
    expect(r.totals.techServiceEarningsCents).toBe(6000);
  });
  it('§11 two techs on one service: $60 pool → lead $48 / asst $12', () => {
    const r = computeTicketCompensation(base({ serviceLines: [{ lineId: 'L1', priceCents: 10000, commission: { type: 'percent', value: 60 }, technicians: [{ technicianId: 'lead', method: 'percent', value: 80 }, { technicianId: 'asst', method: 'percent', value: 20 }] }] }));
    expect(r.perTechnician.find((t) => t.technicianId === 'lead')!.serviceEarningsCents).toBe(4800);
    expect(r.perTechnician.find((t) => t.technicianId === 'asst')!.serviceEarningsCents).toBe(1200);
  });
  it('§12 tips: salon keeps 0, card/cash separate, reconcile', () => {
    const r = computeTicketCompensation(base({ serviceLines: [{ lineId: 'L1', priceCents: 10000, supply: { method: 'fixed', value: 5000 }, commission: { type: 'percent', value: 60 }, technicians: [{ technicianId: 'a', method: 'equal' }, { technicianId: 'b', method: 'equal' }] }], tip: { method: 'equal', cardTipCents: 1000, cashTipCents: 500 } }));
    expect(r.totals.cardTipCents).toBe(1000);
    expect(r.totals.cashTipCents).toBe(500);
    expect(r.reconciliation.tipsReconcile).toBe(true);
    expect(r.reconciliation.salonTipIsZero).toBe(true);
  });
  it('§6 guarantee top-up (tips/tax excluded by caller)', () => {
    expect(computeGuaranteeTopUp(18000, 14000)).toBe(4000);
    expect(computeGuaranteeTopUp(100000, 87000)).toBe(13000);
    expect(computeGuaranteeTopUp(18000, 20000)).toBe(0);
  });
  it('§7 proration $200 × 6/8h = $150', () => { expect(prorateGuarantee(20000, 6, 8)).toBe(15000); });
  it('fail-safe: a zero/unknown denominator pays the FULL guarantee, never $0', () => {
    expect(prorateGuarantee(20000, 0, 0)).toBe(20000);
    expect(prorateGuarantee(20000, 6, 0)).toBe(20000);
    expect(prorateGuarantee(20000, 0, Number.NaN)).toBe(20000);
  });
  it('proration still clamps at 100% (worked more than scheduled)', () => { expect(prorateGuarantee(20000, 10, 8)).toBe(20000); });
  it('§25 deterministic cents allocation sums exactly', () => {
    expect(allocateByLargestRemainder(100, [1, 1, 1])).toEqual([34, 33, 33]);
    expect(allocateByLargestRemainder(1000, [1, 2]).reduce((a, b) => a + b, 0)).toBe(1000);
  });
  it('guard: supply > price clamps commissionable to 0 + warns', () => {
    const r = computeTicketCompensation(base({ serviceLines: [{ lineId: 'L1', priceCents: 5000, supply: { method: 'fixed', value: 9000 }, commission: { type: 'percent', value: 60 }, technicians: [{ technicianId: 'a', method: 'equal' }] }] }));
    expect(r.totals.commissionableCents).toBe(0);
    expect(r.reconciliation.noNegativeCommissionable).toBe(true);
    expect(r.warnings.some((w) => w.includes('exceeds service price'))).toBe(true);
  });
});
