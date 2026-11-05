import { taxCents as taxOf } from '@aipowersalon/money';
import { centsToUsd, taxCents } from '@aipowersalon/money';
export { centsToUsd };   // owned by @aipowersalon/money (Constitution 13 §86)
import type { PaymentMethod, Money } from '@aipowersalon/api-contracts/tenant';
export type { PaymentMethod, Money };   // owned by packages/api-contracts (Constitution 13 §13)
// checkout-display.dto.ts — AIPowerSalon dual-screen checkout.
// Front-desk POS (/pos/checkout) + customer iPad Mini display (/customer-display/checkout/:sessionId).
// BACKEND IS THE SOURCE OF TRUTH for all money. Context resolved from session; display bound by paired token.

 // integer cents

// DisplayState, CheckoutTotals, TipOption and CustomerDisplayState are the wire contract in
// @aipowersalon/api-contracts/customer — the customer-display app imports the same definitions (Constitution 13 §15).
export type { DisplayState, CheckoutTotals, TipOption, CustomerDisplayState } from '@aipowersalon/api-contracts/customer';
import type { DisplayState, CheckoutTotals, TipOption, CustomerDisplayState } from '@aipowersalon/api-contracts/customer';

// ===== POS Checkout =====
export interface CheckoutKpis {
  readyForCheckoutCount: number; todaySubtotalCents: Money; tipsTodayCents: Money; cardSurchargeCollectedCents: Money;
}
export interface CheckoutTicketDetail {
  ticketId: string; ticketNumber: string; customerId: string; customerName: string; customerPhone: string;
  isVip?: boolean; loyaltyLabel?: string; stationCode: string;
  services: { name: string; priceCents: Money }[];
  primaryTechName?: string; helperTechName?: string; finishedAtLabel?: string;
  qualityApproved: boolean; notes?: string;
  totals: CheckoutTotals;
}

// ===== Settings (§12 / §14) — surcharge is configurable; default 3% per Kevin =====
export interface CheckoutSettings {
  creditCardSurchargeEnabled: boolean;
  creditCardSurchargePercent: number;   // DEFAULT 3.0 (picture showed 2.5 — tenant-configurable)
  surchargeLabel: string;                // "Card Surcharge"
  taxRatePercent: number;                // e.g. 7.75
  cashDiscountEnabled: boolean;
  defaultTipPercents: number[];          // e.g. [15, 18, 20]
  customerDisplayPayButtonEnabled: boolean;
  /** Who captures after the customer taps Pay: the front desk on the POS (default) or the paired physical terminal. */
  customerDisplayCaptureMode: 'front_desk' | 'terminal';
  maxTipPercent: number;                 // tip above this needs manager approval
  checkoutCompleteTimeoutSeconds: number; // display-side: seconds the 'Payment Complete' screen shows before returning to Go Check-In
  /** G4 Split Tips (Nov 5 2026): the customer tips each performing technician separately on the display (default OFF —
   *  the guide's default-off rollout; tips.perTechnicianTips) and the dollar presets shown beside the percents */
  perTechnicianTips?: boolean;
  tipPresetCents?: number[];
}
export const DEFAULT_CHECKOUT_SETTINGS: CheckoutSettings = {
  creditCardSurchargeEnabled: true, creditCardSurchargePercent: 3.0, surchargeLabel: "Card Surcharge",
  taxRatePercent: 7.75, cashDiscountEnabled: false, defaultTipPercents: [15, 18, 20],
  customerDisplayPayButtonEnabled: false, customerDisplayCaptureMode: 'front_desk', maxTipPercent: 100, checkoutCompleteTimeoutSeconds: 5,
  perTechnicianTips: false, tipPresetCents: [300, 500, 1000],
};

// Gift-card SALE rules enforced server-side at issuance (from the 'gift-card-settings' block). Defaults mirror the
// settings module's defaults so a tenant that hasn't customized anything behaves predictably.
export interface GiftCardSaleSettings { enabled: boolean; posSalesEnabled: boolean; minAmountCents: Money; maxAmountCents: Money;
  /** Gift Cards mandate §16 (Oct 29 2026): a card sold at one location redeems at the salon's other locations unless the salon
   *  turned this off (gift-card-settings.crossBranchRedemption, default on) — the setting existed but nothing enforced it, and
   *  every read was this-location-only, so a card sold at Branch A was "not found" at Branch B. */
  crossBranchRedemption: boolean; }
export const DEFAULT_GIFT_CARD_SALE_SETTINGS: GiftCardSaleSettings = { enabled: true, posSalesEnabled: true, minAmountCents: 1000, maxAmountCents: 50000, crossBranchRedemption: true };

// ===== Customer display =====

// ===== pure helpers (unit-testable) — BACKEND TRUTH =====

// tip computed on the service subtotal (pre-tax, pre-surcharge)
export function tipForPercent(subtotalCents: Money, percent: number): Money {
  return Math.round(subtotalCents * (percent / 100));
}
export function tipOptions(subtotalCents: Money, percents: number[], selectedCents: Money): TipOption[] {
  const opts: TipOption[] = percents.map(function (p) { const a = tipForPercent(subtotalCents, p); return { label: p + "%", tipType: "percent", percent: p, amountCents: a, selected: a === selectedCents }; });
  opts.push({ label: "No Tip", tipType: "none", amountCents: 0, selected: selectedCents === 0 });
  return opts;
}
// THE checkout calculation. Surcharge applies to card only, on (subtotal + tip + tax); cash/gift = 0.
//
// SPLIT TENDERS — surcharge the CARD PORTION ("Option A", implemented). For a single-method "split" this helper
// returns 0 (the breakdown isn't known here); the real per-segment card surcharge is computed by splitCardSurchargeCents
// below from the actual card segments and is captured + disclosed at payment time (see CheckoutService.paySplit and the
// POS split screen disclosure line). This closes the prior loophole where splitting a sale avoided the card surcharge:
// the card dollars in a split now carry the same surcharge they would as a straight card payment.
export function computeTotals(subtotalCents: Money, tipCents: Money, settings: CheckoutSettings, method: PaymentMethod, giftCardChargeCents: Money = 0, taxableCents?: Money): CheckoutTotals {
  // D2 Services (Nov 4 2026): tax on the TAXABLE part (a service marked not taxable is left out); omitted = the whole subtotal
  const taxCents = taxOf(taxableCents == null ? subtotalCents : Math.max(0, Math.min(taxableCents, subtotalCents)), settings.taxRatePercent);
  const isCard = method === "card";
  // One source of truth for the surcharge: the compliance-capped engine below (≤3% network cap; debit/prepaid
  // exclusion applies at capture when the processor reports funding).
  const surchargeCents = isCard ? splitCardSurchargeCents(subtotalCents + tipCents + taxCents, settings.creditCardSurchargeEnabled, settings.creditCardSurchargePercent) : 0;
  // Gift-card sale/reload value on this ticket: added to what the customer owes but NOT taxed (a card is taxed when it's
  // redeemed for services, not when sold) and NOT surcharged (face value passes at par). Defaults to 0, so every caller
  // that doesn't sell a gift card gets exactly the previous total.
  const gc = Math.max(0, Math.round(giftCardChargeCents || 0));
  return { subtotalCents: subtotalCents, tipCents: tipCents, taxCents: taxCents, surchargeCents: surchargeCents, giftCardChargeCents: gc, totalDueCents: subtotalCents + tipCents + taxCents + surchargeCents + gc, paymentMethod: method };
}

// Card-portion surcharge for a split tender ("Option A"). The segments of a split sum to the BASE due
// (subtotal+tip+tax, surcharge-free); this returns the surcharge owed on the card dollars only, added on top of the
// base and collected on the card segment. cardBaseCents = sum of the card segments' base amounts. Cash/gift dollars are
// never surcharged. Returns 0 when surcharge is disabled or no dollars go on card — so a split that pays entirely by
// cash/gift owes nothing, exactly as before. Disclosure of this amount before payment is legally required and is shown
// on the split screen + returned in the split response. Takes primitives so it works from either settings shape
// (checkout-display `creditCardSurcharge*` or checkout `cardSurcharge*`).
//
// COMPLIANCE (card-network surcharge rules): (1) the applied rate is HARD-CAPPED at CARD_SURCHARGE_CAP_PCT (3%) —
// enforced here at calculation, so a mis-set tenant percentage can never overcharge a customer; (2) debit and prepaid
// cards may NEVER be surcharged — pass the card's funding type when the processor reports it and the surcharge is 0.
// Funding is 'unknown' until a processor supplies it (BIN/capture data), in which case the configured credit-card
// surcharge applies as before. Refund coupling is inherent: the surcharge is part of the card payment's amount, so
// refunding the payment returns the surcharge with it.
export const CARD_SURCHARGE_CAP_PCT = 3;
export type CardFunding = 'credit' | 'debit' | 'prepaid' | 'unknown';
export function splitCardSurchargeCents(cardBaseCents: Money, surchargeEnabled: boolean, surchargePercent: number, cardFunding: CardFunding = 'unknown'): Money {
  if (!(cardBaseCents > 0) || !surchargeEnabled || !(surchargePercent > 0)) return 0;
  if (cardFunding === 'debit' || cardFunding === 'prepaid') return 0; // never surcharge debit/prepaid
  const pct = Math.min(surchargePercent, CARD_SURCHARGE_CAP_PCT);     // network cap, enforced at calc time
  return Math.round(cardBaseCents * (pct / 100));
}
// validate a custom tip: non-negative, integer cents, within max% of subtotal (else manager approval)
export function validateCustomTip(tipCents: Money, subtotalCents: Money, maxPercent: number): { ok: boolean; reason?: string } {
  if (tipCents < 0) return { ok: false, reason: "TIP_NEGATIVE" };
  if (!Number.isInteger(tipCents)) return { ok: false, reason: "TIP_NOT_INTEGER" };
  if (subtotalCents > 0 && tipCents > Math.round(subtotalCents * (maxPercent / 100))) return { ok: false, reason: "TIP_EXCEEDS_MAX" };
  return { ok: true };
}
