// Constitution 7 §18–§19 — the suspension policy table.
import { describe, it, expect } from 'vitest';
import { SUSPENSION_POLICY, SUSPENSION_REASON_CODES, SUSPENSION_CAPABILITIES, suspensionPolicyFor } from './suspension-policy';

describe('suspension policy', () => {
  it('answers all six §19 questions for every reason code', () => {
    for (const c of SUSPENSION_REASON_CODES) expect(Object.keys(SUSPENSION_POLICY[c]).sort()).toEqual([...SUSPENSION_CAPABILITIES].sort());
  });
  it('staff sign-in, bookings and customer messages stop for every cause', () => {
    for (const c of SUSPENSION_REASON_CODES) expect([SUSPENSION_POLICY[c].employeeLogin, SUSPENSION_POLICY[c].customerBooking, SUSPENSION_POLICY[c].scheduledCommunications]).toEqual([false, false, false]);
  });
  it('different causes, different restrictions: BILLING keeps owner billing + settlements; FRAUD / SECURITY freeze everything', () => {
    expect(SUSPENSION_POLICY.BILLING).toMatchObject({ ownerBillingAccess: true, paymentSettlements: true, dataExport: true });
    for (const c of ['FRAUD', 'SECURITY'] as const) expect(Object.values(SUSPENSION_POLICY[c]).every((v) => v === false)).toBe(true);
  });
  it('an unknown code gets the most restrictive policy, and each line says honestly whether it is enforced today', () => {
    expect(suspensionPolicyFor('LATE').every((l) => l.allowed === false)).toBe(true);
    const billing = Object.fromEntries(suspensionPolicyFor('BILLING').map((l) => [l.capability, l]));
    expect(billing.customerBooking).toMatchObject({ allowed: false, enforced: true });
    expect(billing.scheduledCommunications).toMatchObject({ allowed: false, enforced: true });
    expect(billing.ownerBillingAccess).toMatchObject({ allowed: true, effective: true, enforced: true });      // billing-only owner session
    const fraud = Object.fromEntries(suspensionPolicyFor('FRAUD').map((l) => [l.capability, l]));
    expect(fraud.ownerBillingAccess).toMatchObject({ allowed: false, effective: false, enforced: true });
    expect(billing.paymentSettlements).toMatchObject({ effective: null, enforced: false });                   // not gated by the platform
  });
});
