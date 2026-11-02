// membership-benefits.ts — Functional Decision 15 (membership step of the discount sequence): what a member's plan takes
// off THIS ticket. Feeds the one discount engine as 'membership' discounts (bundle → membership → deal → coupon → manual
// → loyalty), so the snapshot records every one.
//
// Fixed Oct 2 2026 (first written by a concurrent session as e20f370, lost in a container reset, rebuilt here):
//   • a DOLLAR-CREDIT redemption took the whole service price off while the member's balance was charged only the
//     credit's value ($25 credit on a $60 service gave $60 off). It now takes off what the balance paid: min(line, credit).
//   • PERCENT and FIXED member discounts (membership_benefits percent_discount / fixed_discount) were listed to the POS
//     but never reached the bill. They now apply to the member's eligible service lines automatically.
// Rules: service lines only (retail needs a product_discount benefit — not applied here); a line already covered by a
// membership redemption is not discounted again; a benefit scoped to a service or category applies only there; when a
// plan has several percent/fixed benefits, the member gets the BEST one for this ticket, never a stack of them.
import type { DiscountRequest } from './checkout-discount-engine';

export interface MemberRedemption {
  redemptionId: string; serviceLineId: string | null; standardValueCents: number; upgradeChargeCents: number;
  benefitType?: string | null; allocatedValueCents?: number;
}
export interface MemberDiscountBenefit {
  benefitId: string; benefitType: string; label: string; percent: number; valueCents: number;
  serviceId: string | null; categoryName: string | null;
}
export interface MemberLine { serviceLineId: string; serviceName?: string; serviceId: string | null; categoryName: string | null; isRetail: boolean; priceCents: number }

const cents = (v: unknown) => (Number.isFinite(Number(v)) ? Math.max(0, Math.round(Number(v))) : 0);

export function membershipDiscountRequests(lines: MemberLine[], redemptions: MemberRedemption[], benefits: MemberDiscountBenefit[]): DiscountRequest[] {
  const byLine = new Map(lines.map((l) => [l.serviceLineId, l]));
  const out: DiscountRequest[] = [];
  const covered = new Set<string>();

  for (const r of redemptions) {
    const line = r.serviceLineId ? byLine.get(r.serviceLineId) : undefined;
    if (r.serviceLineId) covered.add(r.serviceLineId);
    const linePrice = line ? cents(line.priceCents) : Infinity;
    const value = r.benefitType === 'dollar_credit' ? cents(r.allocatedValueCents) : cents(r.standardValueCents || (line ? line.priceCents : 0));
    const amount = Math.max(0, Math.min(linePrice, value) - cents(r.upgradeChargeCents));
    if (amount > 0) out.push({ id: 'membership-' + r.redemptionId, category: 'membership', amountCents: amount, stackable: true, priority: 2, description: 'Membership: ' + (line?.serviceName ?? 'included service') });
  }

  const eligibleTotal = (b: MemberDiscountBenefit) => lines
    .filter((l) => !l.isRetail && !covered.has(l.serviceLineId))
    .filter((l) => (b.serviceId ? l.serviceId === b.serviceId : b.categoryName ? (l.categoryName ?? '').trim().toLowerCase() === b.categoryName.trim().toLowerCase() : true))
    .reduce((a, l) => a + cents(l.priceCents), 0);
  let best: DiscountRequest | null = null;
  for (const b of benefits) {
    const base = eligibleTotal(b);
    if (base <= 0) continue;
    let amount = 0;
    if (b.benefitType === 'percent_discount') { const p = Math.min(100, Math.max(0, Number(b.percent) || 0)); amount = Math.round((base * p) / 100); }
    else if (b.benefitType === 'fixed_discount') amount = Math.min(base, cents(b.valueCents));
    else continue;
    if (amount > 0 && (!best || amount > best.amountCents)) best = { id: 'membership-benefit-' + b.benefitId, category: 'membership', amountCents: amount, stackable: true, priority: 3, description: 'Member discount: ' + b.label };
  }
  if (best) out.push(best);
  return out;
}
