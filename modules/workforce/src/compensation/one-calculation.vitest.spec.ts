// one-calculation.vitest.spec.ts — ONE-PAY F3 (Oct 13 2026): the engine has ONE per-line commission formula
// (commission-basis.lineCommissionCents over @aipowersalon/money splitByPercent). Every path of the engine — single
// technician, retail, technician-funded discount — must agree with it, cent for cent.
import { describe, it, expect } from 'vitest';
import { splitByPercent, percentOfCents } from '@aipowersalon/money';
import { lineCommissionCents } from './commission-basis';
import { computeTicketCompensation, computeServiceLine } from './compensation-engine';

const cases: [number, 'percent' | 'fixed', number][] = [[4500, 'percent', 60], [1, 'percent', 50], [2, 'percent', 33], [8000, 'fixed', 1500], [1000, 'fixed', 1500], [12345, 'percent', 47.5], [0, 'percent', 60]];

describe('ONE per-line commission formula', () => {
  it.each(cases)('lineCommissionCents(%s, %s, %s) = splitByPercent / clamped fixed', (base, type, v) => {
    expect(lineCommissionCents(base, type, v)).toBe(type === 'percent' ? splitByPercent(base, v).shareCents : Math.min(base, Math.max(0, Math.round(v))));
  });
  it.each(cases)('engine service line (%s, %s, %s) == lineCommissionCents', (base, type, v) => {
    const l = computeServiceLine({ lineId: 'L', priceCents: base, commission: { type, value: v }, technicians: [{ technicianId: 'a', method: 'equal' }] }, []);
    expect(l.techServiceEarningsCents).toBe(lineCommissionCents(base, type, v));
    expect(l.salonServiceShareCents).toBe(base - lineCommissionCents(base, type, v));
  });
  it('engine retail line percent == percentOfCents', () => {
    const r = computeTicketCompensation({ tenantId: 't', branchId: 'b', ticketId: 'k', serviceLines: [{ lineId: 'R', priceCents: 2999, isRetail: true, commission: { type: 'percent', value: 10 }, technicians: [{ technicianId: 'a', method: 'equal' }] }] });
    expect(r.totals.retailCommissionCents).toBe(percentOfCents(2999, 10));
  });
  it('technician-funded: the salon keeps percentOfCents(eligible, 100 − rate)', () => {
    const l = computeServiceLine({ lineId: 'L', priceCents: 10001, discountCents: 1000, discountFunding: 'technician_funded', commission: { type: 'percent', value: 60 }, technicians: [{ technicianId: 'a', method: 'equal' }] }, []);
    expect(l.salonServiceShareCents).toBe(percentOfCents(10001, 40));
    expect(l.techServiceEarningsCents + l.salonServiceShareCents).toBe(9001);
  });
});
