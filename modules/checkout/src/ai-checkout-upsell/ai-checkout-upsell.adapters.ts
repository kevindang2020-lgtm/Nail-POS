// ai-checkout-upsell.adapters.ts — binds the upsell service's narrow ports to the REAL domain services. Grounded in the
// repo's actual shapes: add-ons are catalog services added as ticket lines with isAddOn=true (via ServingService.
// techAddService by serviceId); the serving detail carries serviceId + isAddOn per line (the checkout ServiceLine does
// not), so the read adapter sources the ticket from the serving detail. Money is always priced + totalled by the domain
// services — these adapters never pass a price. Defensive projection is used where a detail field name can't be proven
// from types alone; the exact field access is the one thing to confirm under tsc in the monorepo.
import { type MembershipEnrollService, type MembershipsService } from '@aipowersalon/memberships';
import type { AiCheckoutUpsellContext, CheckoutTicketView } from './ai-checkout-upsell.dto';
import type {
  CheckoutReadPort, AddOnCatalogPort, ServiceAddOnLite, AddOnMutationPort, MembershipMutationPort,
  LoyaltyMutationPort, PromotionMutationPort, NextAppointmentMutationPort, RecalcPort, MembershipRecoPort,
} from './ai-checkout-upsell.service';
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

// --- honest gaps (advisory-only until a write path is confirmed) ---
/** Loyalty exposes getState but no redeem() service method — redemption stays advisory until its path is confirmed. */
export class UnavailableLoyaltyMutationAdapter implements LoyaltyMutationPort {
  async enroll(): Promise<{ enrolled: true }> { throw new Error('LOYALTY_ENROLL_NOT_AVAILABLE'); }
  async redeem(): Promise<{ redemptionId: string }> { throw new Error('LOYALTY_REDEEM_NOT_AVAILABLE'); }
}
/** Booking open path is owned by AI Booking; wire when its draft/open method is confirmed. */
export class UnavailableBookingMutationAdapter implements NextAppointmentMutationPort {
  async openBooking(): Promise<{ bookingDraftId: string }> { throw new Error('BOOKING_OPEN_NOT_AVAILABLE'); }
}
