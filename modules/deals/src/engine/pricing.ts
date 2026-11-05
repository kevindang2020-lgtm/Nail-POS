// pricing.ts — BUILD_PLAN Phase 5: the ONE promotional pricing engine. Pure (no I/O), integer cents, deterministic.
//
// Before Phase 5 discount math was written four times and the result of combining offers depended on the ORDER staff
// applied them (bug 3: a non-stackable deal and a coupon both landed if the deal went first; only the coupon if the
// coupon went first). Here the tenant's stacking POLICY decides, over the whole set of offers on the ticket, whatever
// order they arrived in:
//
//   • every combination of promotional offers (deals, coupons) the policy allows is priced, and the one that saves the
//     customer the most wins (ties → fewer offers → lower priority numbers → ids) — "best deal";
//   • within a combination the calculation order is FIXED: bundle → membership → deal → coupon → manual → loyalty; each
//     discount is taken from what the earlier steps left on the lines it applies to;
//   • the price floor (a minimum share of the subtotal the customer always pays) and the maximum total discount trim the
//     LAST discounts in that order, never a line below zero;
//   • every applied discount carries its per-line allocation, so a refund of one line knows exactly what was paid for it.
//
// Policies:
//   best_single  — at most ONE deal/coupon on a ticket (the default: the safest for the salon's margin)
//   stack_all    — every STACKABLE deal/coupon combines; a non-stackable one competes alone against the stacked set
//   stack_groups — like stack_all, but at most one offer per stack group (offers in the same group never combine)
//   exclusive    — at most one deal/coupon AND it never combines with a member discount or a loyalty reward
// allowWithMembership / allowWithLoyalty (tenant settings) decide whether a deal/coupon may sit on top of a member
// discount or a loyalty reward; when not, the engine prices both ways and keeps the better one for the customer.
// Prepaid membership credits (an included service the member already paid for) always apply — they are not a discount
// the salon can withdraw.

export type OfferCategory = 'bundle' | 'membership' | 'deal' | 'coupon' | 'manual' | 'loyalty';
export const CALCULATION_ORDER: readonly OfferCategory[] = ['bundle', 'membership', 'deal', 'coupon', 'manual', 'loyalty'];
const PROMOTIONAL = new Set<OfferCategory>(['deal', 'coupon']);
export const MAX_PROMOTIONAL_OFFERS = 8;

export type StackingMode = 'best_single' | 'stack_all' | 'stack_groups' | 'exclusive';
export const STACKING_MODES: readonly StackingMode[] = ['best_single', 'stack_all', 'stack_groups', 'exclusive'];

export interface StackingPolicy {
  mode: StackingMode;
  allowWithMembership: boolean;
  allowWithLoyalty: boolean;
  /** the share of the subtotal the customer always pays (0–100) */
  priceFloorPercent: number;
  /** the most a ticket may be discounted, as a share of the subtotal (1–100); null = no cap beyond the floor */
  maxTotalDiscountPercent?: number | null;
}
export const DEFAULT_POLICY: StackingPolicy = { mode: 'best_single', allowWithMembership: false, allowWithLoyalty: true, priceFloorPercent: 0, maxTotalDiscountPercent: null };

export interface PricingLine { lineId: string; priceCents: number }

export interface OfferRule { type: 'percent' | 'fixed' | 'fixed_price'; percent?: number | null; cents?: number | null; maxCents?: number | null }

export interface OfferRequest {
  id: string;
  category: OfferCategory;
  description: string;
  /** deals/coupons: may combine with other stackable deals/coupons (policy permitting) */
  stackable?: boolean;
  stackGroup?: string | null;
  priority?: number;
  /** a flat amount (membership, manual, loyalty, legacy) … */
  amountCents?: number;
  /** … or a rule computed on what the earlier steps left on its lines (deals, coupons) */
  rule?: OfferRule | null;
  /** the lines it applies to; null/undefined = every line */
  lineIds?: string[] | null;
  /** a prepaid membership credit: always applies, never traded away */
  prepaid?: boolean;
  /** pass-through references */
  dealId?: string | null; dealVersion?: number | null; redemptionId?: string | null; code?: string | null;
}

export interface LineAllocation { lineId: string; cents: number }
export interface PricedOffer {
  id: string; category: OfferCategory; description: string; appliedCents: number; lines: LineAllocation[];
  dealId?: string | null; dealVersion?: number | null; redemptionId?: string | null; code?: string | null;
}
export type RejectionReason = 'not_best' | 'not_stackable' | 'same_stack_group' | 'not_with_membership' | 'not_with_loyalty' | 'price_floor' | 'no_value' | 'too_many';
export interface RejectedOffer { id: string; category: OfferCategory; reason: RejectionReason; message: string; dealId?: string | null; redemptionId?: string | null }
export interface PricedLine { lineId: string; priceCents: number; discountCents: number; netCents: number }

export interface PricingResult {
  subtotalCents: number;
  totalDiscountCents: number;
  applied: PricedOffer[];
  rejected: RejectedOffer[];
  lines: PricedLine[];
  policy: StackingMode;
  /** what checkout stores on the ticket (tickets.discount_snapshot) — version 2: per-line, with deal ids/versions */
  snapshot: PricingSnapshot;
}
export interface PricingSnapshot {
  version: 2; subtotalCents: number; totalDiscountCents: number; policy: StackingMode;
  applied: PricedOffer[]; rejected: RejectedOffer[]; lines: PricedLine[];
}

const MESSAGES: Record<RejectionReason, string> = {
  not_best: 'A better offer is already on this ticket.',
  not_stackable: 'This offer cannot be combined with another deal or coupon.',
  same_stack_group: 'Only one offer from this group can be used on a ticket.',
  not_with_membership: 'This offer cannot be combined with the member discount — the better one was kept.',
  not_with_loyalty: 'This offer cannot be combined with the loyalty reward — the better one was kept.',
  price_floor: 'The ticket is already at the lowest price the salon allows.',
  no_value: 'This offer takes nothing off these services.',
  too_many: 'Too many offers on one ticket.',
};

const int = (n: unknown) => { const v = Math.floor(Number(n)); return Number.isFinite(v) ? v : 0; };
const nonNeg = (n: unknown) => Math.max(0, int(n));
const byIdOrder = (a: OfferRequest, b: OfferRequest) => (a.priority ?? 100) - (b.priority ?? 100) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** Spread `total` over `weights` (largest-remainder), never giving a line more than its weight. */
export function allocate(total: number, weights: { lineId: string; cents: number }[]): LineAllocation[] {
  const sum = weights.reduce((n, w) => n + w.cents, 0);
  const t = Math.min(nonNeg(total), sum);
  if (t === 0 || sum === 0) return weights.map((w) => ({ lineId: w.lineId, cents: 0 }));
  const raw = weights.map((w) => ({ lineId: w.lineId, exact: (t * w.cents) / sum, cap: w.cents }));
  const out = raw.map((r) => ({ lineId: r.lineId, cents: Math.min(r.cap, Math.floor(r.exact)), frac: r.exact - Math.floor(r.exact), cap: r.cap }));
  let left = t - out.reduce((n, o) => n + o.cents, 0);
  const order = out.map((o, i) => i).sort((a, b) => out[b].frac - out[a].frac || a - b);
  while (left > 0) {
    let moved = false;
    for (const i of order) { if (left === 0) break; if (out[i].cents < out[i].cap) { out[i].cents++; left--; moved = true; } }
    if (!moved) break;
  }
  return out.map((o) => ({ lineId: o.lineId, cents: o.cents }));
}

/** What a rule takes off `baseCents` (what is left on its lines). Never negative, never more than the base. */
export function ruleDiscount(rule: OfferRule, baseCents: number): number {
  const base = nonNeg(baseCents);
  if (base === 0) return 0;
  let d = 0;
  if (rule.type === 'percent') d = Math.floor((base * Math.min(100, nonNeg(rule.percent))) / 100);
  else if (rule.type === 'fixed') d = nonNeg(rule.cents);
  else if (rule.type === 'fixed_price') d = base - nonNeg(rule.cents);   // "this service for $30"
  if (rule.maxCents != null && rule.maxCents > 0) d = Math.min(d, int(rule.maxCents));
  return Math.max(0, Math.min(base, d));
}

interface Evaluated { applied: PricedOffer[]; clamped: Set<string>; zero: Set<string>; total: number; remaining: Map<string, number> }

function evaluate(lines: PricingLine[], offers: OfferRequest[], maxTotal: number): Evaluated {
  const remaining = new Map(lines.map((l) => [l.lineId, nonNeg(l.priceCents)]));
  const applied: PricedOffer[] = []; const clamped = new Set<string>(); const zero = new Set<string>();
  let total = 0;
  for (const cat of CALCULATION_ORDER) {
    for (const o of offers.filter((x) => x.category === cat).sort(byIdOrder)) {
      const target = (o.lineIds && o.lineIds.length ? lines.filter((l) => o.lineIds!.includes(l.lineId)) : lines)
        .map((l) => ({ lineId: l.lineId, cents: remaining.get(l.lineId) ?? 0 }));
      const base = target.reduce((n, t) => n + t.cents, 0);
      let amount = o.rule ? ruleDiscount(o.rule, base) : Math.min(base, nonNeg(o.amountCents));
      const room = Math.max(0, maxTotal - total);
      if (amount > room) { amount = room; clamped.add(o.id); }
      if (amount <= 0) { zero.add(o.id); continue; }
      const alloc = allocate(amount, target).filter((a) => a.cents > 0);
      for (const a of alloc) remaining.set(a.lineId, (remaining.get(a.lineId) ?? 0) - a.cents);
      total += amount;
      applied.push({ id: o.id, category: o.category, description: o.description, appliedCents: amount, lines: alloc,
        dealId: o.dealId ?? null, dealVersion: o.dealVersion ?? null, redemptionId: o.redemptionId ?? null, code: o.code ?? null });
    }
  }
  return { applied, clamped, zero, total, remaining };
}

function allowedCombination(set: OfferRequest[], mode: StackingMode): boolean {
  if (set.length <= 1) return true;
  if (mode === 'best_single' || mode === 'exclusive') return false;
  if (!set.every((o) => o.stackable)) return false;
  if (mode === 'stack_groups') {
    const groups = set.map((o) => o.stackGroup).filter((g): g is string => !!g);
    return new Set(groups).size === groups.length;
  }
  return true;
}

/**
 * Price a ticket: which offers apply, for how much, on which lines — under the tenant's stacking policy.
 * The result does not depend on the order of `offers`.
 */
export function priceTicket(lines: PricingLine[], offers: OfferRequest[], policy: StackingPolicy = DEFAULT_POLICY): PricingResult {
  const subtotal = lines.reduce((n, l) => n + nonNeg(l.priceCents), 0);
  const floorKeep = Math.ceil((subtotal * Math.min(100, nonNeg(policy.priceFloorPercent))) / 100);
  const capPct = policy.maxTotalDiscountPercent == null ? 100 : Math.min(100, Math.max(1, int(policy.maxTotalDiscountPercent)));
  const maxTotal = Math.max(0, Math.min(subtotal - floorKeep, Math.floor((subtotal * capPct) / 100)));

  // de-duplicate by id (a retried request must not count twice) and split promotional from the rest
  const seen = new Set<string>(); const unique: OfferRequest[] = [];
  for (const o of [...offers].sort(byIdOrder)) { if (!seen.has(o.id)) { seen.add(o.id); unique.push(o); } }
  const promoAll = unique.filter((o) => PROMOTIONAL.has(o.category));
  const promo = promoAll.slice(0, MAX_PROMOTIONAL_OFFERS);
  const tooMany = promoAll.slice(MAX_PROMOTIONAL_OFFERS);
  const base = unique.filter((o) => !PROMOTIONAL.has(o.category));
  const withMembershipOk = policy.mode !== 'exclusive' && policy.allowWithMembership;
  const withLoyaltyOk = policy.mode !== 'exclusive' && policy.allowWithLoyalty;

  let best: { set: OfferRequest[]; ev: Evaluated; offers: OfferRequest[] } | null = null;
  const n = promo.length;
  for (let mask = 0; mask < (1 << n); mask++) {
    const set = promo.filter((_, i) => mask & (1 << i));
    if (!allowedCombination(set, policy.mode)) continue;
    const others = base.filter((o) => {
      if (!set.length || o.prepaid) return true;
      if (o.category === 'membership') return withMembershipOk;
      if (o.category === 'loyalty') return withLoyaltyOk;
      return true;
    });
    const all = [...others, ...set];
    const ev = evaluate(lines, all, maxTotal);
    const better = !best
      || ev.total > best.ev.total
      || (ev.total === best.ev.total && set.length < best.set.length)
      || (ev.total === best.ev.total && set.length === best.set.length && key(set) < key(best.set));
    if (better) best = { set, ev, offers: all };
  }
  const chosen = best!;
  const appliedIds = new Set(chosen.ev.applied.map((a) => a.id));
  const rejected: RejectedOffer[] = [];
  for (const o of unique) {
    if (appliedIds.has(o.id)) continue;
    let reason: RejectionReason;
    if (tooMany.includes(o)) reason = 'too_many';
    else if (chosen.ev.clamped.has(o.id)) reason = 'price_floor';
    else if (chosen.offers.includes(o)) reason = chosen.ev.zero.has(o.id) && maxTotal - chosen.ev.total <= 0 && subtotal > 0 ? 'price_floor' : 'no_value';
    else if (PROMOTIONAL.has(o.category)) {
      if (evaluate(lines, [o], Number.MAX_SAFE_INTEGER).total === 0) reason = 'no_value';
      else if (allowedCombination([...chosen.set, o], policy.mode) && maxTotal - chosen.ev.total <= 0) reason = 'price_floor';
      else reason = rejectionFor(o, chosen.set, policy.mode);
    }
    else reason = o.category === 'membership' ? 'not_with_membership' : 'not_with_loyalty';
    rejected.push({ id: o.id, category: o.category, reason, message: MESSAGES[reason], dealId: o.dealId ?? null, redemptionId: o.redemptionId ?? null });
  }
  const perLine = new Map<string, number>();
  for (const a of chosen.ev.applied) for (const l of a.lines) perLine.set(l.lineId, (perLine.get(l.lineId) ?? 0) + l.cents);
  const pricedLines = lines.map((l) => { const d = perLine.get(l.lineId) ?? 0; return { lineId: l.lineId, priceCents: nonNeg(l.priceCents), discountCents: d, netCents: nonNeg(l.priceCents) - d }; });
  const snapshot: PricingSnapshot = { version: 2, subtotalCents: subtotal, totalDiscountCents: chosen.ev.total, policy: policy.mode, applied: chosen.ev.applied, rejected, lines: pricedLines };
  return { subtotalCents: subtotal, totalDiscountCents: chosen.ev.total, applied: chosen.ev.applied, rejected, lines: pricedLines, policy: policy.mode, snapshot };
}

function key(set: OfferRequest[]): string { return set.map((o) => String(o.priority ?? 100).padStart(6, '0') + o.id).sort().join('|'); }

function rejectionFor(o: OfferRequest, chosen: OfferRequest[], mode: StackingMode): RejectionReason {
  if (!chosen.length) return 'not_best';
  if (mode === 'stack_groups' && o.stackGroup && chosen.some((c) => c.stackGroup === o.stackGroup)) return 'same_stack_group';
  if ((mode === 'stack_all' || mode === 'stack_groups') && (!o.stackable || chosen.some((c) => !c.stackable))) return 'not_stackable';
  return 'not_best';
}

/** The refundable amount of each line: what the customer actually paid for it after its discounts. */
export function lineNetCents(snapshot: Pick<PricingSnapshot, 'lines'> | null | undefined, lineId: string, fallbackCents: number): number {
  const l = snapshot?.lines?.find((x) => x.lineId === lineId);
  return l ? l.netCents : nonNeg(fallbackCents);
}
