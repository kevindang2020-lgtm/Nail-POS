// compensation-guarantee.vitest.spec.ts — §6 daily/weekly top-ups, §7 eligibility + proration, tips/tax excluded,
// no top-up when over, nonrecoverable default.
import { describe, it, expect } from 'vitest';
import { computeGuarantee, assessEligibility, DEFAULT_INCLUSIONS, type GuaranteePolicy } from './compensation-guarantee';

const policy = (over: Partial<GuaranteePolicy> = {}): GuaranteePolicy => ({
  period: 'day', guaranteedCents: 18000, proration: 'none', type: 'nonrecoverable', include: DEFAULT_INCLUSIONS, ...over,
});

describe('guaranteed earnings (§6/§7)', () => {
  it('§6 daily: $180 guarantee, $140 commission, $60 tips → $40 top-up; tips separate; total $240', () => {
    const r = computeGuarantee(policy(), { clockedIn: true }, { serviceCommissionCents: 14000, cardTipCents: 6000 });
    expect(r.salonCoverTopUpCents).toBe(4000);
    expect(r.tipsCents).toBe(6000);
    expect(r.totalBeforeOtherPayrollItemsCents).toBe(24000); // 14000 + 4000 + 6000
  });

  it('§6 weekly: $1000 guarantee, $870 commission, $325 tips → $130 top-up; total $1325', () => {
    const r = computeGuarantee(policy({ period: 'week', guaranteedCents: 100000 }), { clockedIn: true }, { serviceCommissionCents: 87000, cardTipCents: 32500 });
    expect(r.salonCoverTopUpCents).toBe(13000);
    expect(r.totalBeforeOtherPayrollItemsCents).toBe(132500);
  });

  it('no top-up when eligible earnings exceed the guarantee', () => {
    expect(computeGuarantee(policy(), { clockedIn: true }, { serviceCommissionCents: 20000 }).salonCoverTopUpCents).toBe(0);
  });

  it('tips never reduce the top-up (huge tips, low commission still tops up)', () => {
    const r = computeGuarantee(policy(), { clockedIn: true }, { serviceCommissionCents: 14000, cardTipCents: 99999 });
    expect(r.salonCoverTopUpCents).toBe(4000);
  });

  it('§7 proration by hours: $200 daily, 6 of 8 scheduled → $150 prorated guarantee', () => {
    const r = computeGuarantee(policy({ guaranteedCents: 20000, proration: 'by_hours_worked' }), { clockedIn: true, eligibleHours: 6, scheduledHours: 8 }, { serviceCommissionCents: 0 });
    expect(r.proratedGuaranteeCents).toBe(15000);
    expect(r.salonCoverTopUpCents).toBe(15000); // earned 0 against prorated 150
  });

  it('§7 eligibility: not clocked in → ineligible, no top-up; manager exception overrides', () => {
    const p = policy({ requireClockedIn: true });
    const off = computeGuarantee(p, { clockedIn: false }, { serviceCommissionCents: 0 });
    expect(off.eligible).toBe(false);
    expect(off.salonCoverTopUpCents).toBe(0);
    const exc = computeGuarantee(p, { clockedIn: false, managerApprovedException: true }, { serviceCommissionCents: 0 });
    expect(exc.eligible).toBe(true);
    expect(exc.salonCoverTopUpCents).toBe(18000);
  });

  it('§7 minimum hours + probation gating', () => {
    expect(assessEligibility(policy({ minHoursRequired: 4 }), { hoursWorked: 3 }).eligible).toBe(false);
    expect(assessEligibility(policy({ probationExcluded: true }), { isProbation: true }).eligible).toBe(false);
    expect(assessEligibility(policy(), { clockedIn: true }).eligible).toBe(true);
  });

  it('retail/bonus excluded by default but countable when configured', () => {
    const earn = { serviceCommissionCents: 14000, retailCommissionCents: 3000, bonusCents: 2000 };
    expect(computeGuarantee(policy(), { clockedIn: true }, earn).eligibleCompensationCents).toBe(14000); // default excludes retail+bonus
    const withRetail = computeGuarantee(policy({ include: { ...DEFAULT_INCLUSIONS, retailCommission: true, bonus: true } }), { clockedIn: true }, earn);
    expect(withRetail.eligibleCompensationCents).toBe(19000);
  });

  it('nonrecoverable by default (top-up not a draw)', () => {
    expect(computeGuarantee(policy(), { clockedIn: true }, { serviceCommissionCents: 0 }).recoverable).toBe(false);
  });
});

describe('proration fail-safe — no scheduled data must never silently zero a guarantee (Jul 28, 2026)', () => {
  const earn = { serviceCommissionCents: 5000 };

  it('by_hours_worked with no scheduled hours on record → FULL guarantee + note', () => {
    const r = computeGuarantee(policy({ guaranteedCents: 20000, proration: 'by_hours_worked' }), { clockedIn: true, hoursWorked: 6 }, earn);
    expect(r.proratedGuaranteeCents).toBe(20000);
    expect(r.salonCoverTopUpCents).toBe(15000);
    expect(r.prorationNote).toMatch(/not on record/i);
  });

  it('by_scheduled_hours with no scheduled hours on record → FULL guarantee + note', () => {
    const r = computeGuarantee(policy({ guaranteedCents: 20000, proration: 'by_scheduled_hours' }), { clockedIn: true }, earn);
    expect(r.proratedGuaranteeCents).toBe(20000);
    expect(r.prorationNote).toMatch(/not on record/i);
  });

  it('by_eligible_days with no scheduled days on record → FULL guarantee + note (was silently $0)', () => {
    const r = computeGuarantee(policy({ guaranteedCents: 20000, proration: 'by_eligible_days' }), { clockedIn: true, eligibleDays: 2 }, earn);
    expect(r.proratedGuaranteeCents).toBe(20000);
    expect(r.prorationNote).toMatch(/not on record/i);
  });

  it('by_eligible_days with REAL data still prorates (3 of 5 days → 60%) and carries no note', () => {
    const r = computeGuarantee(policy({ guaranteedCents: 20000, proration: 'by_eligible_days' }), { clockedIn: true, eligibleDays: 3, scheduledDays: 5 }, earn);
    expect(r.proratedGuaranteeCents).toBe(12000);
    expect(r.prorationNote).toBeUndefined();
  });

  it('by_hours_worked with REAL data still prorates and carries no note', () => {
    const r = computeGuarantee(policy({ guaranteedCents: 20000, proration: 'by_hours_worked' }), { clockedIn: true, eligibleHours: 6, scheduledHours: 8 }, earn);
    expect(r.proratedGuaranteeCents).toBe(15000);
    expect(r.prorationNote).toBeUndefined();
  });

  it("none / manual are untouched by the fail-safe (no note; manual amount respected)", () => {
    expect(computeGuarantee(policy({ guaranteedCents: 20000, proration: 'none' }), {}, earn).prorationNote).toBeUndefined();
    const m = computeGuarantee(policy({ guaranteedCents: 20000, proration: 'manual' }), {}, earn, 9000);
    expect(m.proratedGuaranteeCents).toBe(9000);
    expect(m.prorationNote).toBeUndefined();
  });

  it('eligibility levers still withhold: min_hours_required with real low hours → ineligible, $0 top-up', () => {
    const r = computeGuarantee(policy({ guaranteedCents: 20000, proration: 'by_hours_worked', minHoursRequired: 4 }), { clockedIn: true, hoursWorked: 2 }, earn);
    expect(r.eligible).toBe(false);
    expect(r.salonCoverTopUpCents).toBe(0);
  });
});
