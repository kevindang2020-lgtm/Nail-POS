// ai-checkout-upsell.adapters.ts — binds the upsell service's narrow ports to the REAL domain services. Grounded in the
// repo's actual shapes: add-ons are catalog services added as ticket lines with isAddOn=true (via ServingService.
// techAddService by serviceId); the serving detail carries serviceId + isAddOn per line (the checkout ServiceLine does
// not), so the read adapter sources the ticket from the serving detail. Money is always priced + totalled by the domain
// services — these adapters never pass a price. Defensive projection is used where a detail field name can't be proven
// from types alone; the exact field access is the one thing to confirm under tsc in the monorepo.
import { type MembershipEnrollService, type MembershipsService } from '@aipowersalon/memberships';
import { LoyaltyProgramError, type LoyaltyProgramRepository, type LoyaltyProgramContext } from '@aipowersalon/customers';
import { logException } from '@aipowersalon/observability';
import { createHash } from 'node:crypto';
import { sql, type Kysely } from 'kysely';
import { rewardCodeDiscountCents } from '../checkout/loyalty-reward-code';
import type { AiCheckoutUpsellContext, CheckoutTicketView } from './ai-checkout-upsell.dto';
import type {
  CheckoutReadPort, AddOnCatalogPort, ServiceAddOnLite, AddOnMutationPort, MembershipMutationPort,
  LoyaltyMutationPort, PromotionMutationPort, NextAppointmentMutationPort, RecalcPort, MembershipRecoPort, LoyaltyRecoPort,
} from './ai-checkout-upsell.service';
import type { LoyaltyEnrollInput, LoyaltyRedeemInput } from './ai-checkout-upsell-core';
import type { ServingService } from '@aipowersalon/queue';
import type { ServicesService } from '@aipowersalon/catalog';
import type { CheckoutService } from '../checkout/checkout.service';

// ServingContext / EnrollContext / CheckoutContext / ServicesContext are all { tenantId, branchId, userId, role, permissions }.
const asCtx = (c: AiCheckoutUpsellContext): any => ({ tenantId: c.tenantId, branchId: c.branchId, userId: c.userId, role: c.role, permissions: c.permissions });

/** Read the ticket from the SERVING detail, which (unlike the checkout ServiceLine) carries serviceId + isAddOn. */
export class ServingCheckoutReadAdapter implements CheckoutReadPort {
  constructor(private readonly serving: ServingService) {}
  async getTicket(ctx: AiCheckoutUpsellContext, checkoutId: string): Promise<CheckoutTicketView | null> {
    const d: any = await this.serving.detail(asCtx(ctx), checkoutId).catch(() => null);
    if (!d) return null;
    const lines: any[] = d.lines || d.services || d.serviceLines || [];
    const serviceLines = lines.filter(l => !l.isAddOn && l.serviceId).map(l => ({ serviceId: String(l.serviceId), serviceName: String(l.serviceName || '') }));
    const cartAddOnIds = lines.filter(l => l.isAddOn && l.serviceId).map(l => String(l.serviceId));
    return {
      checkoutId, branchId: ctx.branchId,
      customerId: d.customerId ?? d.customer?.customerId ?? null,
      status: String(d.status || d.workflowStatus || 'open'),
      serviceLines, cartAddOnIds,
      subtotalCents: Number(d.totals?.subtotalCents ?? d.subtotalCents ?? 0),
      // Decision 27: whoever works this ticket — their next appointment limits how much time an add-on may add.
      technicianIds: [...new Set([d?.technicians?.primary?.technicianId, d?.primaryTechnicianId, d?.technicians?.helper?.technicianId, ...lines.map((l) => l.technicianId)].filter(Boolean).map(String))],
    };
  }
  /** primary technician for add-on attribution (techAddService needs a technicianId). */
  async primaryTechnicianId(ctx: AiCheckoutUpsellContext, checkoutId: string): Promise<string | null> {
    const d: any = await this.serving.detail(asCtx(ctx), checkoutId).catch(() => null);
    return d?.technicians?.primary?.technicianId ?? d?.primaryTechnicianId ?? (d?.lines || [])[0]?.technicianId ?? null;
  }
}

export class ServicesAddOnCatalogAdapter implements AddOnCatalogPort {
  constructor(private readonly services: ServicesService) {}
  async getAddOns(ctx: AiCheckoutUpsellContext, serviceId: string): Promise<ServiceAddOnLite[]> {
    const a: any[] = await this.services.getAddOns(asCtx(ctx), serviceId).catch(() => []);
    return (a || []).map(x => ({ addOnId: String(x.addOnId), name: String(x.name), priceCents: Number(x.priceCents), durationDeltaMinutes: Number(x.durationDeltaMinutes || 0), isTaxable: !!x.isTaxable, isActive: x.isActive !== false }));
  }
}

/** Add an add-on as a ticket service line (add-ons are catalog services; addOnId IS the add-on service's serviceId). */
export class ServingAddOnMutationAdapter implements AddOnMutationPort {
  constructor(private readonly serving: ServingService, private readonly read: ServingCheckoutReadAdapter) {}
  async addServiceLine(ctx: AiCheckoutUpsellContext, checkoutId: string, input: { addOnId: string; sourceServiceId: string }): Promise<{ lineId: string }> {
    const technicianId = (await this.read.primaryTechnicianId(ctx, checkoutId)) || ctx.userId; // attribution; domain re-validates
    const res: any = await this.serving.techAddService(asCtx(ctx), checkoutId, { serviceId: input.addOnId }, technicianId);
    return { lineId: String(res?.serviceLineId || '') };
  }
}

/** Membership recommendations: active plan catalog minus plans the customer already actively holds. Savings left null
 *  (honest) — no fabricated estimate unless a real service-price match is provided. */
export class MembershipRecoAdapter implements MembershipRecoPort {
  constructor(private readonly memberships: MembershipsService, private readonly enrollSvc: MembershipEnrollService) {}
  async candidates(ctx: AiCheckoutUpsellContext, ticket: CheckoutTicketView) {
    const plans: any[] = await this.memberships.listPlans(asCtx(ctx), ctx.branchId).catch(() => []);
    let activePlanIds = new Set<string>();
    if (ticket.customerId) {
      const cm: any = await this.enrollSvc.listCustomerMemberships(asCtx(ctx), ticket.customerId).catch(() => null);
      const list: any[] = cm?.memberships || [];
      activePlanIds = new Set(list.filter(m => (m.status ? m.status === 'active' : m.active !== false)).map(m => String(m.planId)));
    }
    return (plans || []).filter(p => String(p.status) === 'active').map(p => ({
      planId: String(p.planId), name: String(p.name),
      recurringPriceCents: Number(p.priceCents || 0),
      billingFrequency: String(p.billingInterval || 'month'),
      includedBenefit: String(p.description || p.name || ''),
      eligibleToday: true,
      customerAlreadyHasActive: activePlanIds.has(String(p.planId)),
      todayEligibleServicePriceCents: null,
    }));
  }
}

export class MembershipMutationAdapter implements MembershipMutationPort {
  constructor(private readonly enrollSvc: MembershipEnrollService) {}
  async enroll(ctx: AiCheckoutUpsellContext, input: { customerId: string; planId: string; checkoutId: string }): Promise<{ membershipId: string }> {
    const res: any = await this.enrollSvc.enroll(asCtx(ctx), { customerId: input.customerId, planId: input.planId });
    return { membershipId: String(res?.membershipId || res?.id || '') };
  }
}

export class CheckoutRecalcAdapter implements RecalcPort {
  constructor(private readonly checkout: CheckoutService) {}
  async recalculate(ctx: AiCheckoutUpsellContext, checkoutId: string): Promise<{ totalCents: number; subtotalCents: number; taxCents: number }> {
    const t: any = await this.checkout.recalculate(asCtx(ctx), checkoutId);
    return { totalCents: Number(t?.totalDueCents ?? 0), subtotalCents: Number(t?.subtotalCents ?? 0), taxCents: Number(t?.taxCents ?? 0) };
  }
}

/**
 * BUILD_PLAN Phase 5, bug 9: this passed an OBJECT where applyPromotion expected a redeemer FUNCTION — every AI-applied
 * promotion was a TypeError. The AI applies a deal BY ID through the same offer path as the cashier (eligibility,
 * stacking policy, capacity, budget); a refusal surfaces as an error, never a silent success.
 */
export class CheckoutPromotionMutationAdapter implements PromotionMutationPort {
  constructor(private readonly checkout: Pick<CheckoutService, 'applyOffer'>) {}
  async apply(ctx: AiCheckoutUpsellContext, checkoutId: string, promotionId: string): Promise<{ applied: true }> {
    await this.checkout.applyOffer(asCtx(ctx), checkoutId, { dealId: promotionId, source: 'ai_checkout_upsell' });
    return { applied: true };
  }
}

// --- Checkout Upsell Assistant Settings 05: loyalty redemption on the authoritative path ---
const loyaltyCtx = (c: AiCheckoutUpsellContext): LoyaltyProgramContext => ({ tenantId: c.tenantId, branchId: c.branchId, userId: c.userId, role: c.role, permissions: c.permissions });

/** A loyalty redemption id is a UUID (the loyalty ledger's idempotency key). Derive it from the upsell's own request key so
 *  a retried or double-tapped redeem reaches the SAME redemption and points are never taken twice. */
export function redemptionIdFor(requestKey: string): string {
  const h = createHash('sha256').update('ai-upsell-loyalty:' + requestKey).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${((parseInt(h.slice(16, 17), 16) & 0x3) | 0x8).toString(16)}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/** Reads what the customer can redeem from the LOYALTY module's redeem picker: the authoritative points balance and tier
 *  from the loyalty profile, the salon-funded rewards, and each reward's exclusions decided by the same redeemBlock() the
 *  redemption transaction enforces (dates, stock, per-member limit, tier, points). Only unblocked rewards become cards.
 *  One reward per ticket: a ticket that already carries a reward code gets no loyalty card. Values are computed by the
 *  checkout's own reward rule on today's subtotal (a percent reward's real amount is set at checkout, after earlier steps). */
export class LoyaltyProgramRecoAdapter implements LoyaltyRecoPort {
  constructor(private readonly repo: Pick<LoyaltyProgramRepository, 'redeemOptions'>, private readonly db: Kysely<any>) {}
  async state(ctx: AiCheckoutUpsellContext, ticket: CheckoutTicketView): Promise<{ enroll: LoyaltyEnrollInput; redeem: LoyaltyRedeemInput }> {
    const enroll: LoyaltyEnrollInput = { programActive: false, branchParticipates: false, alreadyEnrolled: true, eligible: false, programName: '' };   // enrolment suggestions stay dormant
    if (!ticket.customerId) return { enroll, redeem: { enrolled: false, balancePoints: 0, rewards: [], cartEligible: false } };
    const opts = await this.repo.redeemOptions(loyaltyCtx(ctx), ticket.customerId);
    const onTicket = (await sql<{ n: number }>`select count(*)::int as n from loyalty_redemptions where tenant_id = ${ctx.tenantId} and ticket_id = ${ticket.checkoutId}::uuid and status = 'applied'`.execute(this.db)).rows[0];
    const subtotal = Math.max(0, Math.round(ticket.subtotalCents));
    return {
      enroll,
      redeem: {
        enrolled: opts.enrolled, balancePoints: opts.balancePoints,
        cartEligible: subtotal > 0 && Number(onTicket?.n ?? 0) === 0,
        rewards: opts.rewards.filter((r) => r.blockedBy === null)
          .map((r) => ({ rewardId: r.rewardId, label: r.title, pointsCost: r.pointsCost, valueCents: rewardCodeDiscountCents({ rewardType: r.rewardType, valueCents: r.valueCents, percent: r.percent }, subtotal) }))
          .filter((r) => r.valueCents > 0),
      },
    };
  }
}

/** The loyalty transaction's refusal in the upsell's own error taxonomy (the controller maps these to HTTP). */
export function upsellLoyaltyError(e: unknown): unknown {
  if (!(e instanceof LoyaltyProgramError)) return e;
  if (e.code === 'LOYALTY_INSUFFICIENT_POINTS') return new Error('LOYALTY_BALANCE_INSUFFICIENT');
  if (e.code === 'CUSTOMER_NOT_FOUND') return new Error('CUSTOMER_NOT_FOUND');
  if (e.code === 'LOYALTY_INVALID_ENTRY' || e.code === 'IDEMPOTENCY_KEY_REQUIRED') return new Error('IDEMPOTENCY_CONFLICT');
  return new Error('LOYALTY_NOT_ELIGIBLE');   // dates, stock, per-member limit, tier, inactive, not enrolled
}

/** Redeem = the loyalty module's ONE redemption transaction (points off through the ledger, exactly once per key, all
 *  rules re-checked under the customer lock) and then the checkout's ONE reward-code path (applyRewardCode: this
 *  ticket's customer, one reward per ticket, a 'loyalty' discount through the stacking engine, used only when paid).
 *  If the ticket refuses the code, the redemption is voided through the loyalty module so the points come back — the
 *  customer never loses points for a reward that did not reach the bill. The code text is never logged. */
export class LoyaltyProgramMutationAdapter implements LoyaltyMutationPort {
  constructor(private readonly repo: Pick<LoyaltyProgramRepository, 'redeem' | 'voidRedemption'>, private readonly checkout: Pick<CheckoutService, 'applyRewardCode'>) {}
  async enroll(): Promise<{ enrolled: true }> { throw new Error('LOYALTY_ENROLL_NOT_AVAILABLE'); }
  async redeem(ctx: AiCheckoutUpsellContext, input: { customerId: string; rewardId: string; checkoutId: string; requestKey?: string }): Promise<{ redemptionId: string }> {
    if (!input.requestKey) throw new Error('IDEMPOTENCY_KEY_REQUIRED');
    const r = await this.repo.redeem(loyaltyCtx(ctx), { customerId: input.customerId, rewardId: input.rewardId, idempotencyKey: redemptionIdFor(input.requestKey) })
      .catch((e: unknown) => { throw upsellLoyaltyError(e); });
    const redemptionId = String(r.redemption.id);
    try {
      await this.checkout.applyRewardCode(asCtx(ctx), input.checkoutId, r.code);
    } catch (e) {
      if (!r.duplicate) {
        await this.repo.voidRedemption(loyaltyCtx(ctx), redemptionId, 'Could not be applied to the ticket at checkout').catch((ve: unknown) => {
          logException(ve, { where: 'ai-upsell.loyalty.void-after-apply-failed', tenantId: ctx.tenantId, redemptionId });
        });
      }
      throw e;
    }
    return { redemptionId };
  }
}

// --- honest gaps (advisory-only until a write path is confirmed) ---
/** Kept for builds without a database: redemption stays advisory there. */
export class UnavailableLoyaltyMutationAdapter implements LoyaltyMutationPort {
  async enroll(): Promise<{ enrolled: true }> { throw new Error('LOYALTY_ENROLL_NOT_AVAILABLE'); }
  async redeem(): Promise<{ redemptionId: string }> { throw new Error('LOYALTY_REDEEM_NOT_AVAILABLE'); }
}
/** Booking open path is owned by AI Booking; wire when its draft/open method is confirmed. */
export class UnavailableBookingMutationAdapter implements NextAppointmentMutationPort {
  async openBooking(): Promise<{ bookingDraftId: string }> { throw new Error('BOOKING_OPEN_NOT_AVAILABLE'); }
}
