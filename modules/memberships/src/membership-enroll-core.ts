// membership-enroll-core.ts — pure helpers for enrollment and redemption. The credit-ledger balance + reservation safety
// live in memberships-core (creditBalance / canReserveServiceCredit); this file adds the commission-basis snapshot math
// used when a benefit is redeemed, the set of credits to issue at enrollment, and member-number generation. No I/O.
import { splitMembershipRevenue } from './memberships-core';

export type CommissionBasis = 'allocated' | 'standard' | 'fixed';

/** The pre-tax amount eligible for the technician/owner split when a membership benefit is redeemed, per the plan's
 * configured basis. 'standard' uses the menu price, 'fixed' a flat amount, 'allocated' the configured membership value. */
export function eligibleForBasis(basis: string, standardCents: number, allocatedCents: number, fixedCents: number): number {
  const b: CommissionBasis = basis === 'standard' || basis === 'fixed' ? basis : 'allocated';
  if (b === 'standard') return Math.max(0, Math.round(standardCents));
  if (b === 'fixed') return Math.max(0, Math.round(fixedCents));
  return Math.max(0, Math.round(allocatedCents));
}

export interface CommissionSnapshot { basis: string; techSplitPct: number; standardCents: number; allocatedCents: number; eligibleCents: number; techCents: number; ownerCents: number }
/** A self-contained record of how a redemption should split — frozen onto the immutable redemption row so payroll
 * (Phase 6) computes from the terms in force at redemption time, not whatever the plan says later. */
export function commissionSnapshot(basis: string, techSplitPct: number, standardCents: number, allocatedCents: number, fixedCents = 0): CommissionSnapshot {
  const eligibleCents = eligibleForBasis(basis, standardCents, allocatedCents, fixedCents);
  const split = splitMembershipRevenue(eligibleCents, techSplitPct);
  return { basis, techSplitPct, standardCents: Math.max(0, Math.round(standardCents)), allocatedCents: Math.max(0, Math.round(allocatedCents)), eligibleCents, techCents: split.techCents, ownerCents: split.ownerCents };
}

export interface BenefitSeed { benefitId: string; benefitType: string; serviceId: string | null; creditsPerCycle: number; valueCents: number }
export interface IssuedEntry { benefitId: string; serviceId: string | null; quantity: number; amountCents: number }
/** Credits to grant at the start of a billing cycle: one ledger 'issued' entry per crediting benefit. Service/add-on
 * benefits issue service-credit quantity; dollar-credit benefits issue a dollar amount. Percent/fixed discounts are not
 * credits (they apply at checkout) and issue nothing. Magnitudes are POSITIVE — creditBalance applies the signs. */
export function initialIssuedEntries(benefits: BenefitSeed[]): IssuedEntry[] {
  const out: IssuedEntry[] = [];
  for (const b of benefits) {
    if ((b.benefitType === 'service_credit' || b.benefitType === 'addon') && b.creditsPerCycle > 0) out.push({ benefitId: b.benefitId, serviceId: b.serviceId, quantity: b.creditsPerCycle, amountCents: 0 });
    else if (b.benefitType === 'dollar_credit' && b.valueCents > 0) out.push({ benefitId: b.benefitId, serviceId: b.serviceId, quantity: 0, amountCents: b.valueCents });
  }
  return out;
}

export function memberNumber(seed?: string): string {
  const base = (seed || Date.now().toString(36) + Math.random().toString(36).slice(2, 8)).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(-8);
  return `M-${base}`;
}
