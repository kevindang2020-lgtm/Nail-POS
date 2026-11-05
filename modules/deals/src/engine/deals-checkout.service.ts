// deals-checkout.service.ts — BUILD_PLAN Phase 5: deals and coupons on a POS ticket. Checkout owns the ticket and its
// final price (it runs the one pricing engine over every discount on the ticket); this service owns the OFFERS: which
// deals/coupons this ticket may have (with every reason it may not), the place each one holds, the code lookups (hashed,
// rate-limited), and what happens to them when the ticket is paid, voided or refunded.
//
//   candidate()  — resolve a deal by id, a coupon code, a wallet coupon or the booked appointment, and judge it
//   reserve()    — put it on the ticket: one place, the budget, the code's use — atomically (the ledger)
//   release()    — take it off an unpaid ticket (everything comes back)
//   onPaid()     — the ticket is paid: applied → redeemed (deal.redeemed / coupon.redeemed), counts move
//   onRefunded() — void / refund: reversed (fully, or partly with the refunded lines), places come back
import type { DealContext } from '../deals/deals.dto';
import type { DealsService } from '../deals/deals.service';
import { evaluateEligibility, reason, type EligibilityResult, type Reason } from './eligibility';
import { priceTicket, type OfferRequest, type PricedOffer, type StackingPolicy, type PricingLine } from './pricing';
import { dealRule, termsSnapshot, LedgerRefusal, type KyselyDealsLedger, type DealRecord, type LiveApplication, type TicketFacts } from './deals-ledger.kysely';
import { hashCode, normalizeCode, lookupBlocked, LOOKUP_WINDOW_MS, parseWalletQr } from './coupons';
import type { OfferSummary } from '@aipowersalon/api-contracts/tenant';

export class DealRefusedError extends Error {
  constructor(message: string, public readonly status: 400 | 409 | 429, public readonly reasons: Reason[] = [], public readonly code = 'DEAL_REFUSED') { super(message); this.name = 'DealRefusedError'; }
}

export interface TicketOfferRequest { dealId?: string | null; code?: string | null; couponId?: string | null; fromAppointment?: boolean; source?: string | null }
export interface OfferCandidate {
  deal: DealRecord; offer: OfferRequest; couponCodeId: string | null; appointmentHoldId: string | null; appointmentId: string | null; kind: 'deal' | 'coupon' | 'automatic';
}
export type { OfferSummary };   // the API contract (the checkout deals panel)

const CONFLICT = new Set(['engine_off', 'tenant_disabled', 'suspended', 'not_active', 'not_started', 'ended', 'sold_out', 'budget_exhausted', 'per_customer_limit', 'tech_frozen', 'code_used']);
const statusFor = (reasons: Reason[]): 400 | 409 => (reasons.some((r) => CONFLICT.has(r.code)) ? 409 : 400);

/** The live application as an engine request: its LOCKED terms (the snapshot), on the ticket lines it covers. */
export function applicationOffer(a: LiveApplication, lines: TicketFacts['lines']): OfferRequest {
  const t: any = a.terms ?? {};
  const svc: string[] = Array.isArray(t.serviceIds) ? t.serviceIds : [];
  return {
    id: 'deal-' + a.redemptionId, category: a.kind === 'coupon' ? 'coupon' : 'deal', description: (a.kind === 'coupon' ? 'Coupon: ' : 'Deal: ') + (t.title ?? 'Deal'),
    rule: { type: t.discountType ?? 'percent', percent: t.discountPercent ?? null, cents: t.discountCents ?? null, maxCents: t.maxDiscountCents ?? null },
    lineIds: svc.length ? lines.filter((l) => l.serviceId && svc.includes(l.serviceId)).map((l) => l.lineId) : null,
    stackable: !!t.stackable, stackGroup: t.stackGroup ?? null, priority: Number(t.priority ?? 100),
    dealId: a.dealId, dealVersion: a.dealVersion, redemptionId: a.redemptionId,
  };
}

export class DealsCheckoutService {
  constructor(private readonly deals: DealsService, private readonly ledger: KyselyDealsLedger) {}

  policy(ctx: DealContext): Promise<StackingPolicy> { return this.deals.policy(ctx) as Promise<StackingPolicy>; }

  private async ticket(ctx: DealContext, ticketId: string): Promise<TicketFacts> {
    const t = await this.ledger.ticket(ctx.tenantId, ticketId);
    if (!t) throw new DealRefusedError('Ticket not found.', 400);
    return t;
  }

  /** The deals/coupons on this ticket, as engine requests with their locked terms. */
  async offersForPricing(ctx: DealContext, ticketId: string): Promise<OfferRequest[]> {
    const [t, apps] = await Promise.all([this.ledger.ticket(ctx.tenantId, ticketId), this.ledger.liveApplications(ctx.tenantId, ticketId)]);
    if (!t) return [];
    return apps.map((a) => applicationOffer(a, t.lines));
  }

  private offerFor(deal: DealRecord, t: TicketFacts, id: string): OfferRequest {
    return { id, category: deal.kind === 'coupon' ? 'coupon' : 'deal', description: (deal.kind === 'coupon' ? 'Coupon: ' : 'Deal: ') + deal.title, rule: dealRule(deal),
      lineIds: deal.serviceIds.length ? t.lines.filter((l) => l.serviceId && deal.serviceIds.includes(l.serviceId)).map((l) => l.lineId) : null,
      stackable: deal.stackable, stackGroup: deal.stackGroup, priority: deal.priority, dealId: deal.id, dealVersion: deal.version };
  }

  /** Judge a deal for THIS ticket at the POS (channel 'pos', now, the ticket's services and spend, its customer). */
  async judge(ctx: DealContext, deal: DealRecord, t: TicketFacts, codeProvided: boolean): Promise<EligibilityResult> {
    return this.deals.eligibilityFor(ctx, deal, t.customerId, {
      channel: 'pos', serviceIds: t.lines.map((l) => l.serviceId).filter((s): s is string => !!s), spendCents: t.lines.reduce((n, l) => n + l.priceCents, 0),
      codeProvided, excludeTicketId: t.ticketId,
    });
  }

  /** Resolve and judge what the cashier asked for. Throws DealRefusedError with every reason. Never writes. */
  async candidate(ctx: DealContext, ticketId: string, req: TicketOfferRequest): Promise<OfferCandidate> {
    const t = await this.ticket(ctx, ticketId);
    if (t.status === 'paid' || t.paymentStatus === 'paid') throw new DealRefusedError('This ticket is already paid.', 409);
    let deal: DealRecord | null = null; let couponCodeId: string | null = null; let hold: { holdId: string; dealId: string } | null = null;
    const wallet = req.couponId ?? parseWalletQr(req.code);
    if (wallet) {
      const c = await this.ledger.findCodeById(ctx.tenantId, wallet);
      if (!c || (c.customerId && c.customerId !== t.customerId)) throw new DealRefusedError('That coupon belongs to another customer.', 400);
      if (c.status !== 'active') throw new DealRefusedError(c.status === 'revoked' ? 'That coupon was cancelled.' : 'That coupon has already been used.', 409, [reason('code_used', 'Already used.')]);
      if (c.expiresAt && Date.parse(c.expiresAt) < Date.now()) throw new DealRefusedError('That coupon has expired.', 409, [reason('ended', 'Expired.')]);
      deal = await this.ledger.deal(ctx.tenantId, c.dealId); couponCodeId = c.id;
    } else if (req.code != null && String(req.code).trim()) {
      const actor = `user:${ctx.userId}`;
      const f = await this.ledger.lookupFailures(ctx.tenantId, actor, LOOKUP_WINDOW_MS);
      if (lookupBlocked(f.actor, f.tenant)) throw new DealRefusedError('Too many codes that did not match — wait a few minutes and try again.', 429, [], 'DEAL_CODE_LOOKUP_LIMITED');
      const norm = normalizeCode(req.code);
      const c = norm.length >= 4 ? await this.ledger.findCode(ctx.tenantId, hashCode(ctx.tenantId, norm)) : null;
      if (!c) { await this.ledger.recordLookupFailure(ctx.tenantId, actor); throw new DealRefusedError('That code isn’t valid here.', 400, [reason('unknown_code', 'Unknown code.')]); }
      if (c.customerId && c.customerId !== t.customerId) throw new DealRefusedError('That coupon belongs to another customer.', 400);
      if (c.status !== 'active') throw new DealRefusedError(c.status === 'revoked' ? 'That code was cancelled.' : 'That code has already been used.', 409, [reason('code_used', 'Already used.')]);
      if (c.expiresAt && Date.parse(c.expiresAt) < Date.now()) throw new DealRefusedError('That code has expired.', 409, [reason('ended', 'Expired.')]);
      deal = await this.ledger.deal(ctx.tenantId, c.dealId); couponCodeId = c.id;
    } else if (req.fromAppointment || (!req.dealId && t.appointmentId)) {
      if (!t.appointmentId) throw new DealRefusedError('No appointment is linked to this ticket.', 400);
      const h = await this.ledger.appointmentHold(ctx.tenantId, t.appointmentId);
      if (!h) throw new DealRefusedError('No deal reserved for this appointment.', 400, [reason('no_booked_deal', 'No deal was booked.')]);
      deal = await this.ledger.deal(ctx.tenantId, h.dealId); hold = h;
    } else if (req.dealId) {
      deal = await this.ledger.deal(ctx.tenantId, req.dealId);
      if (deal && t.appointmentId) {   // the deal this customer booked: its place is already held
        const h = await this.ledger.appointmentHold(ctx.tenantId, t.appointmentId);
        if (h && h.dealId === deal.id) hold = h;
      }
    }
    if (!deal || deal.kind === 'announcement') throw new DealRefusedError('Deal not found.', 400);
    if (hold) {
      // a BOOKED deal keeps the terms it was booked with (even if it ended since) unless it was withdrawn
      const why = await this.deals.bookedDealBlocked(ctx, deal);
      if (why) throw new DealRefusedError(why, 409, [reason('withdrawn', why)]);
      if (await this.deals.engineOff()) throw new DealRefusedError('Deals are temporarily paused.', 409, [reason('engine_off', 'Paused.')]);
    } else {
      const el = await this.judge(ctx, deal, t, !!couponCodeId || !deal.requiresCode);
      if (!el.eligible) throw new DealRefusedError(el.reasons.map((r) => r.message).join(' '), statusFor(el.reasons), el.reasons);
    }
    const kind: 'deal' | 'coupon' | 'automatic' = deal.kind === 'coupon' ? 'coupon' : deal.kind === 'automatic' ? 'automatic' : 'deal';
    return { deal, offer: this.offerFor(deal, t, 'candidate-' + deal.id), couponCodeId, appointmentHoldId: hold?.holdId ?? null, appointmentId: hold ? t.appointmentId : null, kind };
  }

  /** Put the candidate on the ticket with the amount the engine priced it at. Atomic; refusals roll back. */
  async reserve(ctx: DealContext, ticketId: string, c: OfferCandidate, priced: PricedOffer): Promise<LiveApplication> {
    const t = await this.ticket(ctx, ticketId);
    try {
      return await this.ledger.apply({ tenantId: ctx.tenantId, branchId: t.branchId, ticketId, customerId: t.customerId, dealId: c.deal.id, kind: c.kind,
        appointmentHoldId: c.appointmentHoldId, appointmentId: c.appointmentId, couponCodeId: c.couponCodeId, discountCents: priced.appliedCents, lines: priced.lines,
        terms: termsSnapshot(c.deal), dealVersion: c.deal.version, userId: ctx.userId },
      { maxRedemptions: c.appointmentHoldId ? null : c.deal.maxRedemptions ?? null, maxPerCustomer: c.appointmentHoldId ? null : c.deal.maxPerCustomer ?? null, budgetCents: c.deal.budgetCents ?? null });
    } catch (e) {
      if (e instanceof LedgerRefusal) throw new DealRefusedError(e.message, 409, [{ code: e.code, message: e.message }]);
      throw e;
    }
  }

  async release(ctx: DealContext, redemptionIds: string[], reason: string): Promise<number> {
    let n = 0;
    for (const id of redemptionIds) if (await this.ledger.release(ctx.tenantId, id, reason, ctx.userId)) n++;
    return n;
  }

  /** The engine re-priced the ticket: every application carries what it actually takes off, on which lines. */
  async syncAmounts(ctx: DealContext, applied: PricedOffer[], rejectedRedemptionIds: string[]): Promise<void> {
    for (const a of applied) if (a.redemptionId) await this.ledger.syncAmount(ctx.tenantId, a.redemptionId, a.appliedCents, a.lines).catch(() => undefined);
    for (const id of rejectedRedemptionIds) await this.ledger.syncAmount(ctx.tenantId, id, 0, []).catch(() => undefined);
  }

  async applications(ctx: DealContext, ticketId: string) { return this.ledger.applicationsForTicket(ctx.tenantId, ticketId); }

  /**
   * The POS checkout deals panel: what is on the ticket, what else this customer could have (with its estimated value
   * on this ticket), what they can't have and WHY, and the best combination under the salon's policy.
   */
  async panel(ctx: DealContext, ticketId: string, otherOffers: OfferRequest[]): Promise<{ applied: (LiveApplication & { title: string })[]; eligible: OfferSummary[]; notEligible: (OfferSummary & { reasons: Reason[] })[]; best: { dealIds: string[]; add: { dealId: string; couponId: string | null }[]; savingsCents: number; currentCents: number; better: boolean }; policy: StackingPolicy }> {
    const t = await this.ticket(ctx, ticketId);
    const policy = await this.policy(ctx);
    const apps = await this.ledger.liveApplications(ctx.tenantId, ticketId);
    const appliedDeals = new Set(apps.map((a) => a.dealId));
    const lines: PricingLine[] = t.lines.map((l) => ({ lineId: l.lineId, priceCents: l.priceCents }));
    const live = await this.ledger.liveDeals(ctx.tenantId);
    const booked = t.appointmentId ? await this.ledger.appointmentHold(ctx.tenantId, t.appointmentId) : null;
    const wallet = t.customerId ? (await this.ledger.walletFor(ctx.tenantId, t.customerId)).filter((w: any) => w.status === 'active' && w.deal_status === 'active') : [];
    const eligible: OfferSummary[] = []; const notEligible: (OfferSummary & { reasons: Reason[] })[] = [];
    const summary = (d: DealRecord, est: number, extra: Partial<OfferSummary> = {}): OfferSummary => ({ dealId: d.id, title: d.title, kind: d.kind, discountType: d.discountType, discountPercent: d.discountPercent, discountCents: d.discountCents, estimatedCents: est, endsAt: d.endsAt, terms: d.terms_text, ...extra });
    const candidates: OfferRequest[] = [];
    const consider = async (d: DealRecord, extra: Partial<OfferSummary>, judged: EligibilityResult | null) => {
      if (appliedDeals.has(d.id)) return;
      const offer = this.offerFor(d, t, 'suggest-' + d.id + (extra.couponId ? ':' + extra.couponId : ''));
      const est = priceTicket(lines, [offer], policy).totalDiscountCents;
      if (judged && !judged.eligible) { notEligible.push({ ...summary(d, est, extra), reasons: judged.reasons }); return; }
      if (est <= 0) { notEligible.push({ ...summary(d, 0, extra), reasons: [reason('no_value', 'Takes nothing off these services.')] }); return; }
      eligible.push(summary(d, est, extra)); candidates.push(offer);
    };
    if (booked && !appliedDeals.has(booked.dealId)) {
      const d = await this.ledger.deal(ctx.tenantId, booked.dealId);
      if (d) { const why = await this.deals.bookedDealBlocked(ctx, d); await consider(d, { booked: true }, why ? { eligible: false, reasons: [reason('withdrawn', why)], eligibleServiceIds: [] } : null); }
    }
    for (const w of wallet) {
      const d = await this.ledger.deal(ctx.tenantId, String(w.deal_id));
      if (d) await consider(d, { couponId: String(w.id), codeHint: String(w.code_hint) }, await this.judge(ctx, d, t, true));
    }
    for (const d of live) {
      if (d.requiresCode || (booked && d.id === booked.dealId)) continue;   // a code-only coupon is never offered without its code
      await consider(d, {}, await this.judge(ctx, d, t, false));
    }
    const current = await this.offersForPricing(ctx, ticketId);
    const now = priceTicket(lines, [...otherOffers, ...current], policy);
    const all = priceTicket(lines, [...otherOffers, ...current, ...candidates], policy);
    const winners = all.applied.filter((a) => a.id.startsWith('suggest-') || current.some((c) => c.id === a.id));
    return {
      applied: apps.map((a) => ({ ...a, title: String((a.terms as any)?.title ?? 'Deal') })), eligible: eligible.sort((a, b) => b.estimatedCents - a.estimatedCents), notEligible,
      best: { dealIds: winners.map((w) => w.dealId!).filter(Boolean),
        add: winners.filter((w) => w.id.startsWith('suggest-')).map((w) => { const [dealId, couponId] = w.id.slice('suggest-'.length).split(':'); return { dealId, couponId: couponId ?? null }; }),
        savingsCents: all.totalDiscountCents, currentCents: now.totalDiscountCents, better: all.totalDiscountCents > now.totalDiscountCents },
      policy,
    };
  }

  async onPaid(ctx: DealContext, ticketId: string) { return this.ledger.markTicketPaid(ctx.tenantId, ticketId); }
  async onRefunded(ctx: DealContext, ticketId: string, lineIds: string[] | null, reason: string) { return this.ledger.reverseForTicket(ctx.tenantId, ticketId, lineIds, reason, ctx.userId); }
}
