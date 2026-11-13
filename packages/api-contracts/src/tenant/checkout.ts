// GENERATED FROM apps/api by tooling/contracts/move-contracts.py, then OWNED HERE (Constitution 13 §13).
// Realm: tenant. Declaration file: types only, never emitted (see packages/api-contracts/README.md).

export type ReadyStatus = "ready_checkout" | "ready_for_payment" | "payment_processing" | "payment_failed";

export type PaymentMethod = "card" | "cash" | "gift_card" | "split" | "deposit" | "global_reward";   // deposit: D11 (Oct 21 2026) — a booking deposit applied to the ticket

export interface CheckoutFilters { search?: string; status?: string; station?: string; technicianId?: string; paymentMethod?: string; page?: number; pageSize?: number; }

// request payloads
export interface SetTipRequest { tipType: "none" | "percent" | "custom"; tipPercent?: number; tipAmountCents?: Money; source: "front_desk" | "customer_display"; }

export interface ApplyDiscountRequest { discountCents: Money; reason?: string; managerPin?: string; }

// payment request bodies (§12)
/** G4 follow-up (Nov 5 2026): the cashier confirms the customer's per-technician tips ON THEIR BEHALF (recorded, attributed). */
export interface StaffTipConfirmationRequest { reason: string }
export interface CashPaymentRequest { amountReceivedCents: Money; tipCents?: Money; lockedTotalCents?: Money; staffTipConfirmation?: StaffTipConfirmationRequest | null; }

export interface CardPaymentRequest { tipCents?: Money; lockedTotalCents?: Money; idempotencyKey?: string; cardToken?: string; expiry?: string; terminalId?: string; staffTipConfirmation?: StaffTipConfirmationRequest | null; }   // terminalId: pay on a named terminal (developer, Sep 2026)

export interface GiftCardPaymentRequest { giftCardCode: string; pin?: string; tipCents?: Money; lockedTotalCents?: Money; staffTipConfirmation?: StaffTipConfirmationRequest | null; }

export interface SplitPaymentRequest { segments: { method: PaymentMethod; amountCents: Money; giftCardCode?: string; pin?: string; terminalId?: string }[]; tipCents?: Money; cardToken?: string; expiry?: string; terminalId?: string; staffTipConfirmation?: StaffTipConfirmationRequest | null; }   // terminalId: developer, Sep 2026

export interface SendReceiptRequest { channels: ("sms" | "email" | "app" | "print")[]; }

export interface ReopenServiceRequest { reason: string; managerPin?: string; }

export type Money = number;   // WIRE form of @aipowersalon/money's Money (integer cents); a declaration file cannot depend on the runtime package

export interface CashMovement { id: string; direction: 'in' | 'out'; amountCents: number; reason: string | null; note: string | null; createdAt: string | null; voided: boolean }
export interface MovementList { businessDate: string; movements: CashMovement[] }

/** GET /pos/checkout/tickets/:ticketId/unsettled-tenders — B-81 (Oct 23 2026): every card charge still mid-air on the
 *  ticket. kind: 'payment' = a POS card answer lost (Verify) · 'attempt' = a split reservation / Tap to Pay attempt ·
 *  'app_intent' = a guest's Skip-the-Line card sent to the processor. Money is integer cents; no card data. */
export interface UnsettledTender { kind: 'payment' | 'attempt' | 'app_intent'; id: string; method: string; status: string; amountCents: Money; createdAt: string; idempotencyKey?: string | null }
/** POST /pos/tickets/:ticketId/verify-app-payment — B-80: one result per charged app intent on the ticket. */
export interface AppPaymentVerifyResult { intentId: string; ticketId: string; status: string; outcome: 'approved' | 'declined' | 'released' | 'pending' | 'unknown' | 'review'; reason?: string; paymentId?: string }
export interface AppPaymentVerifyResponse { ticketId: string; results: AppPaymentVerifyResult[] }


// ── SERVICE PRICING 08 — Live Price Preview (GET /pos/checkout/price-preview, pos.services.view). How a service (at its catalog
//    price or a proposed one) with chosen add-ons would ring up at Checkout for a walk-in: the deals the ONE engine would apply
//    under the salon's stacking policy, the tax on the taxable lines at the salon's rate, the total due. Nothing is charged,
//    reserved, counted or written. Integer cents.
export interface PricePreviewLine { kind: 'service' | 'add_on'; key: string | null; name: string; priceCents: number; taxable: boolean; discountCents: number; netCents: number }
export interface PricePreviewResponse {
  service: { id: string; name: string; catalogPriceCents: number; previewPriceCents: number };
  lines: PricePreviewLine[];
  addOnsAvailable: { key: string; name: string; priceCents: number; taxable: boolean }[];
  discounts: { available: boolean; policy: string | null; totalCents: number; applied: { dealId: string; title: string; appliedCents: number }[]; notForWalkIn: { dealId: string; title: string; reason: string | null }[] };
  tax: { ratePercent: number; taxableCents: number; taxCents: number };
  totals: { grossCents: number; subtotalCents: number; totalDueCents: number; cardSurcharge: 'off' | 'decided_when_card_is_read' };
  chargesAnyone: false;
}
