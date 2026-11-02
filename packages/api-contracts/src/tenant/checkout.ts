// GENERATED FROM apps/api by tooling/contracts/move-contracts.py, then OWNED HERE (Constitution 13 §13).
// Realm: tenant. Declaration file: types only, never emitted (see packages/api-contracts/README.md).

export type ReadyStatus = "ready_checkout" | "ready_for_payment" | "payment_processing" | "payment_failed";

export type PaymentMethod = "card" | "cash" | "gift_card" | "split" | "deposit" | "global_reward";   // deposit: D11 (Oct 21 2026) — a booking deposit applied to the ticket

export interface CheckoutFilters { search?: string; status?: string; station?: string; technicianId?: string; paymentMethod?: string; page?: number; pageSize?: number; }

// request payloads
export interface SetTipRequest { tipType: "none" | "percent" | "custom"; tipPercent?: number; tipAmountCents?: Money; source: "front_desk" | "customer_display"; }

export interface ApplyDiscountRequest { discountCents: Money; reason?: string; managerPin?: string; }

// payment request bodies (§12)
export interface CashPaymentRequest { amountReceivedCents: Money; tipCents?: Money; lockedTotalCents?: Money; }

export interface CardPaymentRequest { tipCents?: Money; lockedTotalCents?: Money; idempotencyKey?: string; cardToken?: string; expiry?: string; terminalId?: string; }   // terminalId: pay on a named terminal (developer, Sep 2026)

export interface GiftCardPaymentRequest { giftCardCode: string; pin?: string; tipCents?: Money; lockedTotalCents?: Money; }

export interface SplitPaymentRequest { segments: { method: PaymentMethod; amountCents: Money; giftCardCode?: string; pin?: string; terminalId?: string }[]; tipCents?: Money; cardToken?: string; expiry?: string; terminalId?: string; }   // terminalId: developer, Sep 2026

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

