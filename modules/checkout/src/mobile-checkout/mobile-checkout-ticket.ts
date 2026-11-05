// mobile-checkout-ticket.ts — pure projection of the canonical CheckoutTicketDetail into the Owner & Manager Payment
// App ticket screen (second reference screen). No I/O, no second query: the detail comes straight from
// CheckoutService.detail(), so the app shows the SAME services, totals, and customer the POS shows.
//
// The phone is masked here (spec §11). Retail-product add, discounts, tip edits and split are WRITE actions that land
// in later units; this projection is read-only and surfaces only what the canonical detail already contains. Amount-
// already-paid / remaining-balance tracking arrives with the payment-attempt unit — until then totalDueCents is the due.

import type { MobileTicketService, MobileTicketDetail } from '@aipowersalon/api-contracts/tenant';
export type { MobileTicketService, MobileTicketDetail };   // owned by packages/api-contracts (Constitution 13 §13)
import type { CheckoutTicketDetail } from '../checkout/checkout.dto';
import { maskPhone } from './mobile-checkout-queue';
import { maskEmail } from '@aipowersalon/customers';
import { createHash } from 'node:crypto';

/**
 * Mandate §55: the checkout VERSION — a deterministic digest of everything that decides the amount (service lines,
 * their prices and quantities, the discount, tip, tax, surcharge and total). Any POS edit after the phone loaded the
 * ticket changes it; the capture path refuses to charge against a stale one (CHECKOUT_VERSION_CONFLICT). Pure.
 */
export function computeCheckoutVersion(d: CheckoutTicketDetail): string {
  const lines = (d.completedServices ?? []).map((s) => [s.serviceLineId, s.priceCents, s.qty ?? 1]);
  const t = d.totals;
  const body = JSON.stringify([lines, d.promotion?.amountCents ?? 0, (d.discounts ?? []).map((x) => [x.label, x.amountCents]), t.subtotalCents, t.tipCents, t.taxCents, t.surchargeCents, t.giftCardChargeCents ?? 0, t.totalDueCents]);
  return createHash('sha256').update(body).digest('hex').slice(0, 16);
}



/** Project the canonical ticket detail to the mobile ticket screen. Pure. Masks the phone; never exposes email/PII it doesn't need.
 *  `paidCents` is what the canonical payments rows already cover (approved + partial) — supplied by the service. */
export function mapMobileTicketDetail(d: CheckoutTicketDetail, opts: { paidCents?: number } = {}): MobileTicketDetail {
  const discountCents = d.promotion?.amountCents ?? 0;
  const paidCents = Math.max(0, Math.round(Number(opts.paidCents) || 0));
  return {
    version: computeCheckoutVersion(d),
    paidCents,
    balanceDueCents: Math.max(0, d.totals.totalDueCents - paidCents),
    ticketId: d.ticketId,
    ticketNumber: d.ticketNumber,
    finishedAt: d.finishedAt,
    stationLabel: d.stationLabel,
    customer: {
      fullName: d.customer.fullName,
      initials: d.customer.initials,
      phoneMasked: maskPhone(d.customer.phone),
      emailMasked: d.customer.email ? maskEmail(d.customer.email) : undefined,
      isVip: d.customer.isVip,
      loyaltyTier: d.customer.loyaltyTier,
      loyaltyPoints: d.customer.loyaltyPoints,
      visitCount: d.customer.visitCount,
      preferredTechName: d.customer.preferredTechName,
    },
    services: d.completedServices.map((s) => ({
      serviceLineId: s.serviceLineId,
      serviceName: s.serviceName,
      category: s.category,
      technicianName: s.technicianName,
      qty: s.qty ?? 1,
      priceCents: s.priceCents,
    })),
    primaryTechnicianName: d.technicians?.primary?.name,
    discount: d.promotion ? { code: d.promotion.code, amountCents: d.promotion.amountCents } : null,
    totals: {
      subtotalCents: d.totals.subtotalCents,
      discountCents,
      tipCents: d.totals.tipCents,
      taxCents: d.totals.taxCents,
      surchargeCents: d.totals.surchargeCents,
      totalDueCents: d.totals.totalDueCents,
    },
    serviceNotes: d.serviceNotes,
    receiptDeliveryOptions: d.receiptDeliveryOptions,
  };
}
