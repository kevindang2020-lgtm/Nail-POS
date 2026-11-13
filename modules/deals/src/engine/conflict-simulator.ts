// conflict-simulator.ts — Extras · Promotions Management 15 "Checkout Conflict Simulator: use staging fixtures to test
// coupons, membership, loyalty, split payment, refund and gift cards".
//
// A fixture is one hypothetical ticket: its lines, the offers on it (coupon / deal / membership / loyalty / manual), the
// salon's stacking policy, how it is paid (tenders: card / cash / gift card) and an optional refund of some lines. The
// simulator runs it through the REAL engines only — priceTicket (stacking, floor, caps) and refundOutcome (what a refund
// does to each paid deal / coupon) — and reports the outcome and every conflict it found. It is pure: no database, no
// ticket, no ledger, no provider; nothing is charged, redeemed or refunded. The tenders are only compared with the amount
// the engine says is due (a fixture whose tenders do not add up is reported, never "fixed"); gift-card balances, card
// rules and the payment path itself stay with checkout and are covered by its own tests.
import { priceTicket, type OfferRequest, type PricingLine, type StackingPolicy, type PricingResult } from './pricing';
import { refundOutcome, type RefundOutcome } from './refund-outcome';

export type SimTenderKind = 'card' | 'cash' | 'gift_card';
export interface ConflictFixture {
  name: string;
  lines: PricingLine[];
  offers: OfferRequest[];
  policy: StackingPolicy;
  tenders: { kind: SimTenderKind; cents: number }[];
  /** refund these lines after payment (null = the whole ticket); omit for no refund */
  refundLineIds?: string[] | null;
}
export type ConflictCode = 'offer_rejected' | 'tenders_short' | 'tenders_over' | 'negative_tender' | 'refund_reverses_offer' | 'refund_partial_offer';
export interface SimConflict { code: ConflictCode; offerId?: string; reason?: string; cents?: number }
export interface SimResult {
  name: string; pricing: Pick<PricingResult, 'subtotalCents' | 'totalDiscountCents' | 'applied' | 'rejected'>;
  dueCents: number; tenderedCents: number; byTender: Record<SimTenderKind, number>;
  refund: { offerId: string; outcome: RefundOutcome }[] | null;
  conflicts: SimConflict[];
}

export function simulateConflicts(f: ConflictFixture): SimResult {
  const p = priceTicket(f.lines, f.offers, f.policy);
  const due = p.subtotalCents - p.totalDiscountCents;
  const byTender: Record<SimTenderKind, number> = { card: 0, cash: 0, gift_card: 0 };
  const conflicts: SimConflict[] = p.rejected.map((r) => ({ code: 'offer_rejected' as const, offerId: r.id, reason: r.reason }));
  for (const t of f.tenders) { if (t.cents < 0 || !Number.isInteger(t.cents)) conflicts.push({ code: 'negative_tender', cents: t.cents }); else byTender[t.kind] += t.cents; }
  const tendered = byTender.card + byTender.cash + byTender.gift_card;
  if (tendered < due) conflicts.push({ code: 'tenders_short', cents: due - tendered });
  if (tendered > due) conflicts.push({ code: 'tenders_over', cents: tendered - due });
  let refund: SimResult['refund'] = null;
  if (f.refundLineIds !== undefined) {
    // the applied deals / coupons as the ledger holds them once the ticket is paid (redeemed, nothing reversed yet)
    refund = p.applied.filter((a) => a.category === 'deal' || a.category === 'coupon').map((a) => ({ offerId: a.id,
      outcome: refundOutcome({ status: 'redeemed', amount_discounted_cents: a.appliedCents, reversed_cents: 0, line_allocations: a.lines }, f.refundLineIds ?? null) }));
    for (const r of refund) {
      if (r.outcome.kind === 'reverse') conflicts.push({ code: 'refund_reverses_offer', offerId: r.offerId, cents: r.outcome.shareCents });
      if (r.outcome.kind === 'partial') conflicts.push({ code: 'refund_partial_offer', offerId: r.offerId, cents: r.outcome.shareCents });
    }
  }
  return { name: f.name, pricing: { subtotalCents: p.subtotalCents, totalDiscountCents: p.totalDiscountCents, applied: p.applied, rejected: p.rejected },
    dueCents: due, tenderedCents: tendered, byTender, refund, conflicts };
}

const POL = (o: Partial<StackingPolicy> = {}): StackingPolicy => ({ mode: 'best_single', allowWithMembership: false, allowWithLoyalty: true, priceFloorPercent: 0, maxTotalDiscountPercent: null, ...o });
const L2: PricingLine[] = [{ lineId: 'gel', priceCents: 5000 }, { lineId: 'pedi', priceCents: 3000 }];
const COUPON20: OfferRequest = { id: 'coupon-20', category: 'coupon', description: 'Coupon 20%', rule: { type: 'percent', percent: 20 } };
const DEAL10: OfferRequest = { id: 'deal-10', category: 'deal', description: 'Deal $10', rule: { type: 'fixed', cents: 1000 } };
const MEMBER: OfferRequest = { id: 'member-15', category: 'membership', description: 'Member $15', amountCents: 1500 };
const LOYALTY: OfferRequest = { id: 'loyalty-5', category: 'loyalty', description: 'Reward $5', amountCents: 500 };

/** The staging fixtures: the combinations that conflict at the desk. Hypothetical tickets only — never real data. */
export const CHECKOUT_CONFLICT_FIXTURES: ConflictFixture[] = [
  { name: 'coupon_alone_card', lines: L2, offers: [COUPON20], policy: POL(), tenders: [{ kind: 'card', cents: 6400 }] },
  { name: 'coupon_vs_deal_best_single', lines: L2, offers: [COUPON20, DEAL10], policy: POL(), tenders: [{ kind: 'card', cents: 6400 }] },
  { name: 'coupon_with_membership_blocked', lines: L2, offers: [MEMBER, COUPON20], policy: POL({ allowWithMembership: false }), tenders: [{ kind: 'card', cents: 6400 }] },
  { name: 'coupon_with_membership_allowed', lines: L2, offers: [MEMBER, COUPON20], policy: POL({ allowWithMembership: true }), tenders: [{ kind: 'cash', cents: 5200 }] },
  { name: 'coupon_with_loyalty_split_gift_card', lines: L2, offers: [COUPON20, LOYALTY], policy: POL(), tenders: [{ kind: 'gift_card', cents: 2500 }, { kind: 'card', cents: 3400 }] },
  { name: 'price_floor_caps_stack', lines: L2, offers: [COUPON20, DEAL10], policy: POL({ mode: 'stack_all', priceFloorPercent: 80 }), tenders: [{ kind: 'card', cents: 6400 }] },
  { name: 'split_tenders_short', lines: L2, offers: [COUPON20], policy: POL(), tenders: [{ kind: 'gift_card', cents: 2000 }, { kind: 'cash', cents: 4000 }] },
  { name: 'refund_one_line_partial', lines: L2, offers: [COUPON20], policy: POL(), tenders: [{ kind: 'card', cents: 6400 }], refundLineIds: ['pedi'] },
  { name: 'refund_whole_ticket_reverses', lines: L2, offers: [COUPON20], policy: POL(), tenders: [{ kind: 'card', cents: 6400 }], refundLineIds: null },
];
