// ai-checkout-upsell-core.ts — PURE recommendation logic for the AI Checkout Upsell Assistant. No I/O, no SQL, no
// tenant/branch selection, no price math. It takes already-tenant-scoped, already-priced records from the authoritative
// services (checkout ticket, services.getAddOns, inventory, memberships, loyalty, gift-cards, promotions) and produces
// ranked, capped, transparent recommendation cards. It NEVER mutates a cart, never computes a final total, and never
// invents a price — every figure here is passed in from an authorized read tool (§30). Confirmation + mutation happen
// elsewhere, in the service, against the existing domain services.

export type Confidence = 'high' | 'medium' | 'low';
export type RecommendationType = 'service_addon' | 'product' | 'membership' | 'loyalty_enrollment' | 'loyalty_redemption' | 'gift_card' | 'next_appointment' | 'promotion';

export interface RecommendationCard {
  type: RecommendationType;
  targetId: string;            // add-on id / product id / plan id / promotion id — validated server-side before any mutation
  title: string;
  description: string;
  priceCents: number | null;   // customer-facing price from an authorized tool; null when not a priced item (e.g. loyalty enroll)
  taxBehavior?: 'taxable' | 'not_taxed' | 'calculated_at_checkout';
  addedDurationMinutes?: number;
  inventoryStatus?: 'in_stock' | 'low_stock' | 'out_of_stock' | 'not_tracked';
  confidence: Confidence;
  reason: string;              // concise, privacy-safe explanation (§26)
  eligible: boolean;
}

// ---------------- service add-ons (§11/§12) ----------------

export interface AddOnCandidate {
  addOnId: string; name: string; priceCents: number; durationDeltaMinutes: number; isTaxable: boolean; isActive: boolean;
  sourceServiceId: string; sourceServiceName: string;
}

export interface AddOnRecoParams {
  candidates: AddOnCandidate[];   // approved add-ons flattened across the ticket's completed/in-cart services
  cartAddOnIds: string[];         // add-on ids already on the ticket (dedupe — §12/§47)
  sameVisitFeasible: boolean;     // false once the service is fully complete and the add-on can't be performed now (§11)
  maxAddOns: number;              // fatigue cap (§24)
  ticketSubtotalCents: number;    // anchors the percentage part of the added-value cap
  maxPriceCents?: number;         // Functional Decision 27: the visit's added-value cap from tenant settings (one add-on may not exceed it)
  /** Functional Decision 27: minutes until the ticket's technician's next appointment (null = nothing booked after this).
   *  An add-on that adds more time than that would run into the next customer — it is not suggested. */
  availableMinutes?: number | null;
}

/** The tightest gap before any of the ticket's technicians must start their next appointment; null when none is booked. */
export function addOnMinutesAvailable(next: ({ startsInMinutes: number } | null)[]): number | null {
  const gaps = next.filter((n): n is { startsInMinutes: number } => !!n && Number.isFinite(n.startsInMinutes)).map((n) => Math.max(0, Math.floor(n.startsInMinutes)));
  return gaps.length ? Math.min(...gaps) : null;
}
/** Would this add-on run into the next appointment? (Decision 27: never recommend — or add — one that does.) */
export function addOnConflictsWithSchedule(durationDeltaMinutes: number, availableMinutes: number | null | undefined): boolean {
  return availableMinutes !== null && availableMinutes !== undefined && Math.max(0, durationDeltaMinutes || 0) > availableMinutes;
}

/**
 * Rank + cap approved add-on recommendations. Eligibility: active, not already on the ticket, no duplicate id. When the
 * add-on cannot be performed this visit (`sameVisitFeasible=false`) it is marked ineligible for the current cart (the
 * caller surfaces it as a next-visit suggestion instead — §11). Ranking favors approved relevance then the smallest time
 * impact; NEVER price/margin (§25). Deterministic and stable.
 */
export function recommendAddOns(p: AddOnRecoParams): RecommendationCard[] {
  const inCart = new Set(p.cartAddOnIds);
  const seen = new Set<string>();
  const eligible: AddOnCandidate[] = [];
  // Functional Decision 27: one add-on may not exceed the visit's added-value cap — passed in from the tenant-configurable
  // settings (was a hard-coded min($30, 30%), not configurable). The fallback keeps the decision's defaults for direct callers.
  const maxPriceCents = p.maxPriceCents ?? Math.min(3000, Math.floor(p.ticketSubtotalCents * 0.30));
  
  for (const c of p.candidates) {
    if (!c.isActive) continue;
    if (inCart.has(c.addOnId)) continue;     // already on the ticket — never duplicate a line
    if (seen.has(c.addOnId)) continue;       // dedupe across source services
    if (c.priceCents > maxPriceCents) continue; // enforce max price constraint
    if (addOnConflictsWithSchedule(c.durationDeltaMinutes, p.availableMinutes)) continue;   // Decision 27: would run into the next appointment
    seen.add(c.addOnId);
    eligible.push(c);
  }
  // stable rank: smaller time impact first (more feasible), then name — relevance is equal (all are approved for a today service)
  eligible.sort((a, b) => (a.durationDeltaMinutes - b.durationDeltaMinutes) || a.name.localeCompare(b.name));
  const capped = eligible.slice(0, Math.max(0, Math.floor(p.maxAddOns)));
  return capped.map((c) => ({
    type: 'service_addon' as const,
    targetId: c.addOnId,
    title: c.name,
    description: `Add-on for ${c.sourceServiceName}`,
    priceCents: c.priceCents,
    taxBehavior: c.isTaxable ? 'taxable' : 'not_taxed',
    addedDurationMinutes: c.durationDeltaMinutes,
    confidence: 'high' as const, // tenant-approved add-on for a service on this ticket
    reason: p.sameVisitFeasible
      ? `Approved add-on for ${c.sourceServiceName} on this ticket`
      : `Suggested for the next visit — ${c.sourceServiceName} is already complete`,
    eligible: p.sameVisitFeasible, // when not feasible this visit, it's a next-visit suggestion, not a current-cart action
  }));
}

// ---------------- fatigue / global cap (§24) ----------------

export interface FatigueLimits {
  maxTotal: number; maxProduct: number; maxAddOn: number; maxMembership: number;
}

/**
 * Apply category + global fatigue caps across an already-ranked, mixed set of cards, and drop anything the customer/
 * checkout already dismissed (§24/§52). Order is preserved (callers pass cards in rank order). Never re-surfaces a
 * dismissed card in the same checkout.
 */
export function applyFatigueLimits(cards: RecommendationCard[], limits: FatigueLimits, dismissedTargetIds: string[] = []): RecommendationCard[] {
  const dismissed = new Set(dismissedTargetIds);
  const perType: Record<string, number> = {};
  const capFor = (t: RecommendationType) =>
    t === 'product' ? limits.maxProduct : t === 'service_addon' ? limits.maxAddOn : t === 'membership' ? limits.maxMembership : 1;
  const out: RecommendationCard[] = [];
  for (const c of cards) {
    if (dismissed.has(c.targetId)) continue;
    const used = perType[c.type] ?? 0;
    if (used >= capFor(c.type)) continue;
    if (out.length >= Math.max(0, Math.floor(limits.maxTotal))) break;
    perType[c.type] = used + 1;
    out.push(c);
  }
  return out;
}

// ---------------- retail products (§13/§14) ----------------

export interface ProductCandidate {
  productId: string; variantId?: string | null; name: string; priceCents: number;
  isActive: boolean; sellable: boolean;
  stockStatus: 'in_stock' | 'low_stock' | 'out_of_stock' | 'not_tracked';
  aftercareForServiceName?: string | null;   // tenant-approved aftercare mapping (§14) — NOT a medical claim
  replenishmentDueDaysAgo?: number | null;    // >0 when a prior purchase is past its replenishment interval
}

/**
 * Rank + cap retail product recommendations. Eligibility: active, sellable, in stock (out-of-stock excluded, never
 * silently substituted — §13/§48). Ranking favors an approved aftercare match for a service completed today, then
 * replenishment-due, then in-stock over low-stock — never price/margin. No therapeutic/medical claims (§14).
 */
export function recommendProducts(p: { candidates: ProductCandidate[]; max: number }): RecommendationCard[] {
  const eligible = p.candidates.filter((c) => c.isActive && c.sellable && c.stockStatus !== 'out_of_stock');
  const score = (c: ProductCandidate) => (c.aftercareForServiceName ? 2 : 0) + ((c.replenishmentDueDaysAgo ?? 0) > 0 ? 1 : 0);
  eligible.sort((a, b) => (score(b) - score(a)) || (a.stockStatus === 'low_stock' ? 1 : 0) - (b.stockStatus === 'low_stock' ? 1 : 0) || a.name.localeCompare(b.name));
  return eligible.slice(0, Math.max(0, Math.floor(p.max))).map((c) => ({
    type: 'product' as const,
    targetId: c.variantId || c.productId,
    title: c.name,
    description: c.aftercareForServiceName ? `Aftercare for ${c.aftercareForServiceName}` : 'Retail product',
    priceCents: c.priceCents,
    taxBehavior: 'calculated_at_checkout' as const,
    inventoryStatus: c.stockStatus,
    confidence: (c.aftercareForServiceName ? 'high' : 'medium') as Confidence,
    reason: c.aftercareForServiceName
      ? `Approved aftercare for ${c.aftercareForServiceName}; in stock at this branch`
      : (c.replenishmentDueDaysAgo ?? 0) > 0 ? 'Previously purchased and likely due for replenishment' : 'Relevant to today\u2019s services',
    eligible: true,
  }));
}

// ---------------- membership (§15/§16) ----------------

export interface MembershipCandidate {
  planId: string; name: string; recurringPriceCents: number; billingFrequency: string; includedBenefit: string;
  eligibleToday: boolean; customerAlreadyHasActive: boolean;
  todayEligibleServicePriceCents?: number | null; // customer-facing price of a today service the plan would cover
}

/** Membership recommendation with an HONEST, caveated value estimate (§15). Excludes existing active members and
 *  ineligible customers. Savings are computed ONLY from passed-in customer-facing prices, never fabricated, and always
 *  stated as an estimate with assumptions. Enrollment is confirmation-gated and runs through MembershipsService. */
export function recommendMembership(p: { candidates: MembershipCandidate[]; max: number }): RecommendationCard[] {
  const eligible = p.candidates.filter((c) => c.eligibleToday && !c.customerAlreadyHasActive);
  return eligible.slice(0, Math.max(0, Math.floor(p.max))).map((c) => {
    const svc = c.todayEligibleServicePriceCents ?? null;
    const estMonthly = svc != null && svc > c.recurringPriceCents ? svc - c.recurringPriceCents : null;
    const savings = estMonthly != null
      ? ` Based on today\u2019s service and one similar visit per month, this plan may reduce customer-facing cost by about $${(estMonthly / 100).toFixed(2)}/month. Actual value depends on future visits and plan usage.`
      : '';
    return {
      type: 'membership' as const,
      targetId: c.planId,
      title: c.name,
      description: `${c.includedBenefit} \u00b7 $${(c.recurringPriceCents / 100).toFixed(2)}/${c.billingFrequency}, renews automatically`,
      priceCents: c.recurringPriceCents,
      confidence: 'medium' as const,
      reason: `Today\u2019s services align with this plan\u2019s benefits.${savings}`,
      eligible: true,
    };
  });
}

// ---------------- loyalty enrollment + redemption (§17/§18) ----------------

export interface LoyaltyEnrollInput { programActive: boolean; branchParticipates: boolean; alreadyEnrolled: boolean; eligible: boolean; programName: string; earnFromTodayPoints?: number | null; }

export function recommendLoyaltyEnrollment(i: LoyaltyEnrollInput): RecommendationCard | null {
  if (!i.programActive || !i.branchParticipates || i.alreadyEnrolled || !i.eligible) return null;
  const earn = (i.earnFromTodayPoints ?? 0) > 0 ? ` Today\u2019s visit would earn about ${i.earnFromTodayPoints} points.` : '';
  return {
    type: 'loyalty_enrollment', targetId: 'loyalty_program', title: `Join ${i.programName}`,
    description: 'Earn points on visits and purchases', priceCents: null, confidence: 'medium',
    reason: `Customer isn\u2019t enrolled and is eligible.${earn}`, eligible: true,
  };
}

export interface LoyaltyReward { rewardId: string; label: string; pointsCost: number; valueCents: number; }
export interface LoyaltyRedeemInput { enrolled: boolean; balancePoints: number; rewards: LoyaltyReward[]; cartEligible: boolean; }

/** Suggest the best reward the customer can ACTUALLY afford from their authoritative balance. Never invents points or
 *  values (all passed in from the loyalty read). Application is confirmation-gated + revalidated against live balance. */
export function recommendLoyaltyRedemption(i: LoyaltyRedeemInput): RecommendationCard | null {
  if (!i.enrolled || !i.cartEligible) return null;
  const affordable = i.rewards.filter((r) => r.pointsCost <= i.balancePoints).sort((a, b) => b.valueCents - a.valueCents);
  const best = affordable[0];
  if (!best) return null;
  return {
    type: 'loyalty_redemption', targetId: best.rewardId, title: `Redeem: ${best.label}`,
    description: `${best.pointsCost} points \u2192 $${(best.valueCents / 100).toFixed(2)} reward`, priceCents: null,
    confidence: 'high', reason: `Customer has ${i.balancePoints} points, enough for this reward.`, eligible: true,
  };
}

// ---------------- gift card (§19) ----------------

export interface GiftCardInput { enabled: boolean; allowedAmountsCents: number[]; }
export function recommendGiftCard(i: GiftCardInput): RecommendationCard | null {
  if (!i.enabled || i.allowedAmountsCents.length === 0) return null;
  return {
    type: 'gift_card', targetId: 'gift_card', title: 'Add a gift card',
    description: `Amounts: ${i.allowedAmountsCents.map((a) => '$' + (a / 100).toFixed(0)).join(', ')}`,
    priceCents: null, confidence: 'low', reason: 'Gift cards are available for purchase at this salon.', eligible: true,
  };
}

// ---------------- next appointment (§20/§21) ----------------

export interface NextApptInput { hasEquivalentFutureAppointment: boolean; lastServiceName: string; suggestedReturnDays: number; preferredTechnicianName?: string | null; }

/** Decide WHETHER to suggest rebooking (suppress when an equivalent future appointment already exists — §20). Real
 *  availability, technician qualification, conflict + duplicate detection and creation are delegated to AI Booking. */
export function recommendNextAppointment(i: NextApptInput): RecommendationCard | null {
  if (i.hasEquivalentFutureAppointment) return null;
  const tech = i.preferredTechnicianName ? ` with ${i.preferredTechnicianName}` : '';
  return {
    type: 'next_appointment', targetId: 'next_appointment', title: `Book next ${i.lastServiceName}`,
    description: `Around ${i.suggestedReturnDays} days from now${tech}`, priceCents: null, confidence: 'medium',
    reason: `Customer usually returns about every ${i.suggestedReturnDays} days and has no upcoming appointment.`, eligible: true,
  };
}

/** Functional Decision 27 — keep add-on + product suggestions within the visit's added-value cap (highest-ranked first;
 *  a card that would exceed it is skipped, a cheaper later one may still fit). Memberships, loyalty, gift cards and
 *  rebooking are not added value to THIS visit and are governed by their own count limits. */
export function enforceAddedValueCap(cards: RecommendationCard[], capCents: number): RecommendationCard[] {
  let sum = 0; const out: RecommendationCard[] = [];
  for (const c of cards) {
    const counts = c.type === 'service_addon' || c.type === 'product';
    const price = counts ? (c.priceCents ?? 0) : 0;
    if (price > 0 && sum + price > capCents) continue;
    sum += price; out.push(c);
  }
  return out;
}


// ---------------- missed-service detection: TWO distinct workflows (Checkout Upsell 09) ----------------
// A service the customer asked for (booking / check-in) that is NOT on the ticket may have been PERFORMED and not recorded:
// that is a record discrepancy for a person to resolve — never a sales opportunity, never priced, never added or charged
// by the assistant. Sales suggestions (add-ons etc.) stay a separate list, and a service under record check is never
// offered back as an add-on card (that would bill the customer for a gap in our own records as if it were an upsell).
export interface RequestedService { serviceId: string | null; name: string }
export interface RecordCheck { kind: 'requested_not_on_ticket'; serviceId: string | null; serviceName: string; nextStep: 'confirm_with_technician' }
const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');
export function detectRecordChecks(requested: RequestedService[], onTicket: { serviceIds: string[]; serviceNames: string[] }): RecordCheck[] {
  const ids = new Set(onTicket.serviceIds.map(String));
  const names = new Set(onTicket.serviceNames.map(norm).filter(Boolean));
  const out: RecordCheck[] = []; const seen = new Set<string>();
  for (const r of requested) {
    const name = String(r.name ?? '').trim();
    if (!r.serviceId && !name) continue;
    if (r.serviceId ? ids.has(String(r.serviceId)) : names.has(norm(name))) continue;
    if (r.serviceId && !ids.has(String(r.serviceId)) && name && names.has(norm(name))) continue;   // same service on the ticket under an older id
    const k = r.serviceId ? 'id:' + r.serviceId : 'name:' + norm(name);
    if (seen.has(k)) continue; seen.add(k);
    out.push({ kind: 'requested_not_on_ticket', serviceId: r.serviceId ? String(r.serviceId) : null, serviceName: name || '—', nextStep: 'confirm_with_technician' });
  }
  return out;
}
