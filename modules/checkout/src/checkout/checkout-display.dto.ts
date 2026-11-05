import { centsToUsd } from '@aipowersalon/money';
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
export interface ReadyTicket {
  ticketId: string; ticketNumber: string; customerName: string; isVip?: boolean;
  stationCode: string; serviceCount: number; finishedAtLabel: string; totalCents: Money; status: "ready_checkout";
}
export interface CheckoutTicketDetail {
  ticketId: string; ticketNumber: string; customerId: string; customerName: string; customerPhone: string;
  isVip?: boolean; loyaltyLabel?: string; stationCode: string;
  services: { name: string; priceCents: Money }[];
  primaryTechName?: string; helperTechName?: string; finishedAtLabel?: string;
  qualityApproved: boolean; notes?: string;
  totals: CheckoutTotals;
}
export interface QualitySummary { serviceCompleted: boolean; customerReady: boolean; qualityChecked: boolean; noOpenIssues: boolean; }

// ===== Settings (§12 / §14) — surcharge disclosure settings; the fee itself is provider-assessed (Fiserv §9) =====
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
}
export const DEFAULT_CHECKOUT_SETTINGS: CheckoutSettings = {
  // Fiserv master build §9 (Nov 4 2026): OFF by default. A surcharge exists only for a MID Fiserv has enrolled in the
  // Merchant Surcharge Program, and the PROVIDER assesses it (fee_amount) — never a flat local 3%.
  creditCardSurchargeEnabled: false, creditCardSurchargePercent: 3.0, surchargeLabel: "Card Surcharge",
  taxRatePercent: 7.75, cashDiscountEnabled: false, defaultTipPercents: [15, 18, 20],
  customerDisplayPayButtonEnabled: false, customerDisplayCaptureMode: 'front_desk', maxTipPercent: 100, checkoutCompleteTimeoutSeconds: 5,
};

// Gift-card SALE rules enforced server-side at issuance (from the 'gift-card-settings' block). Defaults mirror the
// settings module's defaults so a tenant that hasn't customized anything behaves predictably.
export interface GiftCardSaleSettings { enabled: boolean; posSalesEnabled: boolean; minAmountCents: Money; maxAmountCents: Money; }
export const DEFAULT_GIFT_CARD_SALE_SETTINGS: GiftCardSaleSettings = { enabled: true, posSalesEnabled: true, minAmountCents: 1000, maxAmountCents: 50000 };


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
// THE checkout calculation. The amount the customer authorizes is subtotal + tip + tax (+ gift-card sale value).
// Fiserv §9: no local surcharge is added for ANY method — card funding is unknown until the card is read, and an
// enrolled merchant's surcharge is assessed by the provider on the authorization itself (recorded from fee_amount).
export function computeTotals(subtotalCents: Money, tipCents: Money, settings: CheckoutSettings, method: PaymentMethod, giftCardChargeCents: Money = 0): CheckoutTotals {
  const taxCents = Math.round(subtotalCents * (settings.taxRatePercent / 100));
  const isCard = method === "card";
  // Funding is 'unknown' before the card is read → the estimate is 0; nothing local is ever added to the charge.
  const surchargeCents = isCard ? splitCardSurchargeCents(subtotalCents + tipCents + taxCents, settings.creditCardSurchargeEnabled, settings.creditCardSurchargePercent, 'unknown') : 0;
  // Gift-card sale/reload value on this ticket: added to what the customer owes but NOT taxed (a card is taxed when it's
  // redeemed for services, not when sold) and NOT surcharged (face value passes at par). Defaults to 0, so every caller
  // that doesn't sell a gift card gets exactly the previous total.
  const gc = Math.max(0, Math.round(giftCardChargeCents || 0));
  return { subtotalCents: subtotalCents, tipCents: tipCents, taxCents: taxCents, surchargeCents: surchargeCents, giftCardChargeCents: gc, totalDueCents: subtotalCents + tipCents + taxCents + surchargeCents + gc, paymentMethod: method };
}

// Card surcharge ESTIMATE — disclosure only (Fiserv master build §9, P0 fix Nov 4 2026).
//
// The previous version defaulted funding to 'unknown' and still returned a 3% fee, which computeTotals added to the
// card total and paySplitNow added to the authorization amount. Under the Fiserv Merchant Surcharge Program the
// PROVIDER adds the fee to eligible credit cards itself, so that path could double-surcharge, and it surcharged cards
// whose funding was never known (debit/prepaid must never be surcharged). Now:
//   • unknown / debit / prepaid funding → 0. Funding is never presumed to be credit.
//   • 'credit' → an ESTIMATE at min(configured %, 3%) for a pre-payment disclosure screen. It is never added to an
//     authorization amount and never recorded in the ledger.
//   • What the ledger records is the provider-assessed fee_amount from the authorization response
//     (AuthorizeResult.surchargeCents), see CheckoutService.payCardNow / paySplitNow.
export const CARD_SURCHARGE_CAP_PCT = 3;
export type CardFunding = 'credit' | 'debit' | 'prepaid' | 'unknown';
export function splitCardSurchargeCents(cardBaseCents: Money, surchargeEnabled: boolean, surchargePercent: number, cardFunding: CardFunding = 'unknown'): Money {
  if (!(cardBaseCents > 0) || !surchargeEnabled || !(surchargePercent > 0)) return 0;
  if (cardFunding !== 'credit') return 0;                            // unknown is NOT credit; debit/prepaid never
  const pct = Math.min(surchargePercent, CARD_SURCHARGE_CAP_PCT);     // network cap, enforced at calc time
  return Math.round(cardBaseCents * (pct / 100));
}
/** Disclosure estimate name for new callers — same rules as splitCardSurchargeCents. Never charged. */
export const estimateCardSurchargeCents = splitCardSurchargeCents;
// validate a custom tip: non-negative, integer cents, within max% of subtotal (else manager approval)
export function validateCustomTip(tipCents: Money, subtotalCents: Money, maxPercent: number): { ok: boolean; reason?: string } {
  if (tipCents < 0) return { ok: false, reason: "TIP_NEGATIVE" };
  if (!Number.isInteger(tipCents)) return { ok: false, reason: "TIP_NOT_INTEGER" };
  if (subtotalCents > 0 && tipCents > Math.round(subtotalCents * (maxPercent / 100))) return { ok: false, reason: "TIP_EXCEEDS_MAX" };
  return { ok: true };
}
export function isCardMethod(method: PaymentMethod): boolean { return method === "card"; }
