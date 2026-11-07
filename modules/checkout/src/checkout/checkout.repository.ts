import { attemptStatusUnsettled, type UnsettledTender, type BranchUnsettledTender } from './unsettled-tenders';
import { boardSignals } from './checkout-board-signals';
export type { UnsettledTender } from './unsettled-tenders';
import { taxCents } from '@aipowersalon/money';
import { couponOf, itemizedDiscounts } from './checkout-discount-items';
// checkout.repository.ts — persistence port + in-memory adapter for POS Checkout & Payment.
// Tenant-scoped tickets, payment records, gift cards, and customer-display devices/sessions. All money math
// flows through the dto helpers (computeTotals / totalsForMethod / applyGiftCard) so totals never drift. A
// different tenant sees its own (empty) data — isolation. Sessions are station/device scoped and expire.
import type { MemberRedemption, MemberLine, MemberDiscountBenefit } from './membership-benefits';
import type { RewardCodeRow } from './loyalty-reward-code';
import { secureString } from '@aipowersalon/security';
import { InMemoryTerminalLeases, type TerminalLeasePort } from './terminal-lease';
import { refundNeedsApprover, refundThresholds, type RefundThresholds } from './refund-approval';
import {
  Money, PaymentMethod, CheckoutSettings, CheckoutTotals, DEFAULT_CHECKOUT_SETTINGS, GiftCardSaleSettings, DEFAULT_GIFT_CARD_SALE_SETTINGS,
} from './checkout-display.dto';
import {
  POSCheckoutFullState, POSCheckoutTicketRow, POSCheckoutKpisFull, buildCheckoutAnalytics, POSCheckoutPaymentSettingsFull, CheckoutKpis,
  POSCustomerDisplayDevice, POSCustomerDisplaySession, PaymentRecord, CheckoutFilters, TicketStatus, FiservStatus,
  CheckoutTicketDetail, totalsForMethod, subtotalFromLines, taxableSubtotal, GiftCard, GiftCardDetail, IssueGiftCardRequest, CheckoutInProgressError, DisplayBusyError, type OpenDisplaySession } from './checkout.dto';
import { clampPageSize, clampPage, withCode } from '@aipowersalon/api-contracts';
import { generateCardNumber, lastFour, maskFromLast4 } from '@aipowersalon/gift-cards';
import type { CustomerDisplayCheckout } from '@aipowersalon/api-contracts/customer';
import { buildCustomerDisplayCheckout } from './customer-display-projection';

export interface CheckoutContext { tenantId: string; branchId: string; userId: string; role: string; permissions: string[]; }

// Thrown inside recordSplitAtomic when a segment's guarded gift redemption fails, so the surrounding DB transaction
// rolls back. The service maps it to a user-facing ValidationError.
export class SplitRedemptionError extends Error { constructor(message: string) { super(message); this.name = 'SplitRedemptionError'; } }

// Thrown by recordPayment when the payment INSERT does not persist a row AND there is no legitimate row to recover
// (i.e. not an idempotency replay). Surfacing this is what stops a caller from flipping a ticket to 'paid' with no
// payment row behind it (silent missing revenue), and rolls back the recordSplitAtomic transaction.
export class PaymentPersistenceError extends Error { constructor(message: string, cause?: unknown) { super(message); this.name = 'PaymentPersistenceError'; if (cause !== undefined) (this as any).cause = cause; } }

export interface ServiceLine {
  serviceLineId: string; serviceName: string; technicianId?: string; technicianName?: string; priceCents: Money;
  /** line_kind (service / add_on / retail / upgrade), the quantity, the catalog unit price and the product, when known —
   *  the customer display shows add-ons, products, quantities and original-vs-charged prices from them (23-inch spec §32). */
  kind?: string; quantity?: number; catalogCents?: Money; productId?: string | null;
  /** D2 Services (Nov 4 2026): false = this line is not taxed (its service's setting, copied when it was rung up) */
  taxable?: boolean;
}
export interface Ticket {
  ticketId: string; ticketNumber: string; customerId: string; customerName: string; customerInitials: string; customerPhone?: string;
  customerEmail?: string; isVip: boolean; loyaltyTier?: string; station?: string; registerId?: string; lines: ServiceLine[];
  primaryTechName?: string; helperTechName?: string; finishedAt: string; qualityApproved: boolean; notes?: string;
  tipCents: Money; tipType?: 'none' | 'percent' | 'custom'; tipPercent?: number | null; discountCents: Money; discountSnapshot?: any; method: PaymentMethod; lockedTotalCents: Money | null; status: TicketStatus; createdAt: string;
  giftCardChargeCents?: Money; // pending gift-card sale/reload value on this ticket (populated at load; added to the total, untaxed)
}

/** Mandate P0 §228: a card refund whose processor answer was lost (payment_refunds.status = 'processing'). */
export interface UnknownRefund {
  refundId: string; paymentId: string; ticketId: string; method: string; amountCents: Money; reason: string | null;
  originalRetref: string | null; createdAt: string; strandedAt: string | null; reviewReason: string | null;
  requestDetail: RefundRequestDetail | null; createdByUserId: string | null;
}
export interface RefundRequestDetail { serviceLineIds?: string[]; tipRefunded?: boolean }

/** one card's share of the stored value a ticket created (see giftCardValueOnTicket) */
export interface GiftCardTicketValue { giftCardId: string; last4: string | null; status: string; balanceCents: Money; creditedCents: Money; reversedCents: Money; kind: 'sale' | 'reload' }
export interface CheckoutRepositoryPort {
  /** Constitution 8: true when the repository writes domain events in its transactions — the service then leaves realtime to the projection consumer. */
  emitsDomainEvents?(): boolean;
  settings(ctx: CheckoutContext): Promise<POSCheckoutPaymentSettingsFull>;
  giftCardSaleSettings(ctx: CheckoutContext): Promise<GiftCardSaleSettings>;
  query(ctx: CheckoutContext, f: CheckoutFilters): Promise<POSCheckoutFullState>;
  ticket(ctx: CheckoutContext, id: string): Promise<Ticket | null>;
  detail(ctx: CheckoutContext, id: string): Promise<CheckoutTicketDetail | null>;
  totalsFor(ctx: CheckoutContext, id: string, method?: PaymentMethod): Promise<CheckoutTotals | null>;
  setTip(ctx: CheckoutContext, id: string, tipCents: Money, meta?: { tipType: 'none' | 'percent' | 'custom'; tipPercent: number | null }): Promise<boolean>;
  setDiscount(ctx: CheckoutContext, id: string, discountCents: Money, discountSnapshot?: any): Promise<boolean>;
  /** BUILD_PLAN Phase 5, bug 13: the checkout audit, persisted (audit_logs). Optional: the in-memory port keeps it in memory. */
  persistAudit?(entry: { tenantId: string; branchId?: string; userId: string; role: string; actionType: string; entityType: string; entityId?: string; before?: unknown; after?: unknown; metadata?: unknown }): Promise<void>;
  setMethod(ctx: CheckoutContext, id: string, method: PaymentMethod): Promise<boolean>;
  setStatus(ctx: CheckoutContext, id: string, status: TicketStatus): Promise<boolean>;
  /** Hold Ticket / Resume (Oct 6 2026). */
  setHold?(ctx: CheckoutContext, id: string, held: boolean): Promise<boolean>;
  /** Move to Front Desk (Oct 6 2026): the register the ticket is to be paid at — null when it is not this branch's. */
  moveToRegister?(ctx: CheckoutContext, id: string, registerId: string): Promise<{ registerId: string; name: string } | null>;
  lockTotal(ctx: CheckoutContext, id: string, totalCents: Money): Promise<void>;
  giftBalance(ctx: CheckoutContext, code: string): Promise<Money | null>;
  decrementGift(ctx: CheckoutContext, code: string, by: Money, pin?: string): Promise<boolean>;
  issueGiftCard(ctx: CheckoutContext, req: { code: string; amountCents: Money; customerId?: string; idempotencyKey?: string; cardNumber?: string }): Promise<GiftCard>;
  // Payment-first sale: create a pending card tied to a ticket; activate all of a ticket's pending cards on payment.
  createPendingGiftCardSale(ctx: CheckoutContext, req: { code: string; amountCents: Money; customerId?: string; ticketId: string; reference: string; cardNumber: string; recipient?: { name?: string; phone?: string; email?: string; message?: string } }): Promise<{ code: string; reference: string }>;
  /** §21 sell a PHYSICAL card: atomically claim it from stock (available → activated) and create the pending sale on
   * that pre-printed number, linking the two. Returns null when the number isn't an available stock card. */
  createPhysicalGiftCardSale(ctx: CheckoutContext, req: { code: string; amountCents: Money; customerId?: string; ticketId: string; reference: string; cardNumber: string; pin?: string; recipient?: { name?: string; phone?: string; email?: string; message?: string } }): Promise<{ code: string; reference: string } | null>;
  activatePendingGiftCardSales(ctx: CheckoutContext, ticketId: string): Promise<{ activated: number }>;
  createPendingGiftCardReload(ctx: CheckoutContext, req: { code: string; amountCents: Money; ticketId: string; reference: string }): Promise<{ reference: string; amountCents: Money }>;
  activatePendingGiftCardReloads(ctx: CheckoutContext, ticketId: string): Promise<{ activated: number }>;
  voidGiftCard(ctx: CheckoutContext, code: string): Promise<GiftCardDetail>;
  /** Gift Cards mandate (Oct 29 2026): the Gift Cards screen's payment-first Issue / Reload (each opens its own ticket) and
   *  the reasoned void by card id. Optional: the in-memory adapter answers "needs the database". */
  issueGiftCardOnNewTicket?(ctx: CheckoutContext, req: { idempotencyKey: string; customerId: string; amountCents: Money; code: string; reference: string; cardNumber: string; physical: boolean; pin?: string; recipient?: { name?: string; phone?: string; email?: string; message?: string } }): Promise<{ ok: true; existing: boolean; ticketId: string; ticketNumber: string; cardId: string; reference: string; last4: string | null } | { ok: false; reason: 'customer_not_found' | 'not_in_stock' | 'no_location' }>;
  reloadGiftCardOnNewTicket?(ctx: CheckoutContext, req: { cardId: string; customerId: string | null; amountCents: Money; idempotencyKey: string }): Promise<{ ok: true; existing: boolean; ticketId: string; ticketNumber: string; reference: string } | { ok: false; reason: 'not_found' | 'not_reloadable' | 'customer_required' | 'customer_not_found' | 'no_location' }>;
  /** Gift Cards guide (Nov 4 2026): the stored value a ticket put on gift cards (cards SOLD on it, RELOADS credited by it),
   *  less what earlier refunds already took back — per card, with the card's balance and status. Optional (database only). */
  giftCardValueOnTicket?(ctx: CheckoutContext, ticketId: string): Promise<GiftCardTicketValue[]>;
  /** takes `amountCents` of that value back off the cards (oldest credit first), never below a zero balance; one transaction,
   *  idempotent per refund payment. Returns what was taken and what could not be (already spent). */
  reverseGiftCardValueForRefund?(ctx: CheckoutContext, ticketId: string, amountCents: Money, refundPaymentId: string, reason: string): Promise<{ reversedCents: Money; shortCents: Money }>;
  /** a reload hold on this card whose ticket is not paid yet (a void would leave that payment with nothing to credit) */
  pendingGiftCardReloadTicket?(ctx: CheckoutContext, cardId: string): Promise<string | null>;
  /** Gift Cards guide (Nov 4 2026): a manager's signed balance adjustment with a reason — card lock, balance, 'adjust' ledger row and the
   *  before/after adjustment record in one transaction; never below zero, never on an ended or unpaid card */
  adjustGiftCardById?(ctx: CheckoutContext, cardId: string, amountCents: Money, reason: string): Promise<{ ok: true; beforeCents: Money; afterCents: Money; status: string } | { ok: false; reason: 'not_found' | 'not_adjustable' | 'below_zero' }>;
  voidGiftCardById?(ctx: CheckoutContext, cardId: string, reason: string): Promise<{ ok: true; priorBalanceCents: Money } | { ok: false; reason: 'not_found' }>;
  getGiftCard(ctx: CheckoutContext, code: string): Promise<GiftCardDetail | null>;
  /** Resolve a receptionist-entered value to a redeemable code: a 16-digit number maps to its card's code; anything
   * else is treated as a code already. Returns null when a 16-digit number matches no card. */
  resolveGiftCardCode(ctx: CheckoutContext, input: string): Promise<string | null>;
  /** §15 read-only cross-tenant recognition: resolve a card by number/code ACROSS tenants and report whether the
   * current (redeeming) tenant may redeem it under the card's program scope + membership. Does not move money. */
  resolveCrossTenantGiftCard(ctx: CheckoutContext, input: string): Promise<{ found: boolean; eligible?: boolean; crossTenant?: boolean; reason?: string; code?: string; id?: string; issuingTenantId?: string; programId?: string | null; balanceCents?: Money; status?: string }>;
  /** §22 replace a lost/stolen card: mint a new card, move the balance via 'transfer' ledger entries, and retire the
   * original ('replaced' + lineage). Returns the new card's masked reference and the raw new number once (for print). */
  replaceGiftCardByCode(ctx: CheckoutContext, code: string): Promise<{ ok: boolean; reason?: string; newCode?: string; newCardNumber?: string; newReference?: string; newCardNumberMasked?: string; balanceCents?: Money }>;
  recordReceipt(ctx: CheckoutContext, rec: { ticketId: string; paymentId?: string; totalCents: Money; emailedTo?: string }): Promise<{ receiptId: string; receiptNumber: string }>;
  recordSatisfaction(ctx: CheckoutContext, ticketId: string, rating: number): Promise<boolean>;
  recordPayment(ctx: CheckoutContext, rec: PaymentRecord): Promise<PaymentRecord>;
  /** Smooth Refresh spec §76/§107: record a payment ONLY if the ticket's paid-so-far is still what the caller saw.
   *  The ticket row is locked for the transaction, so two stations paying one visit cannot both succeed; the loser gets
   *  CheckoutInProgressError. Optional so other repositories keep compiling; payCash falls back to recordPayment. */
  recordPaymentIfUnchanged?(ctx: CheckoutContext, rec: PaymentRecord, expectedPaidCents: number): Promise<PaymentRecord>;
  /** Gift-card debit + payment row in one transaction under the visit lock and paid-amount check (null = card not redeemed). */
  redeemGiftAndRecordIfUnchanged?(ctx: CheckoutContext, code: string, by: Money, pin: string | undefined, rec: PaymentRecord, expectedPaidCents: number): Promise<PaymentRecord | null>;
  recordSplitAtomic(ctx: CheckoutContext, ticketId: string, segments: { method: PaymentMethod; amountCents: Money; giftCardCode?: string; pin?: string }[], opts: { cardRetref?: string; cardSurchargeCents?: Money; expectedPaidCents?: number }): Promise<PaymentRecord[]>;
  payments(ctx: CheckoutContext): Promise<PaymentRecord[]>;
  findPayment(ctx: CheckoutContext, paymentId: string): Promise<PaymentRecord | null>;
  findPaymentByIdempotencyKey(ctx: CheckoutContext, idempotencyKey: string): Promise<PaymentRecord | null>;
  // Claim-first idempotency for the live card-capture path: atomically reserve an idempotency key by inserting an
  // in-flight ('processing') payment row. The partial unique index on (tenant, idempotency_key) means only ONE
  // concurrent request wins the claim; losers get claimed:false and must NOT charge the gateway. finalizePayment
  // settles the claimed row to approved/declined (and releases the key on a decline so the card can be re-attempted).
  claimPayment(ctx: CheckoutContext, rec: { paymentId: string; ticketId: string; method: PaymentMethod; amountCents: Money; tipCents: Money; surchargeCents?: Money; idempotencyKey: string }): Promise<{ claimed: boolean; paymentId: string; existing: PaymentRecord | null }>;
  finalizePayment(ctx: CheckoutContext, paymentId: string, patch: { status: PaymentRecord['status']; processorTransactionId?: string }): Promise<PaymentRecord | null>;
  /** Phase 15 round 3: an APPROVED card charge becomes a completed payment in ONE transaction — the claimed row → approved
   *  (+ payment.captured), the ticket → paid (+ checkout.completed, visit.completed). THROWS on any failure, which rolls all
   *  of it back (the row stays 'processing' for Verify / the stranded-attempt sweep). `completed` is false when the row
   *  was not 'processing' any more (already completed by another verification) — then nothing is written. Optional: a
   *  repository without it gets the old finalizePayment + setStatus. */
  completeCardPayment?(ctx: CheckoutContext, ticketId: string, paymentId: string, processorTransactionId?: string): Promise<{ payment: PaymentRecord | null; completed: boolean }>;
  /** Phase 15 round 3: is the ticket paid in the STORE (not a status this process cached)? Optional; else ticket().status. */
  isPaid?(ctx: CheckoutContext, ticketId: string): Promise<boolean>;
  /** developer merge (Oct 6 2026): the customer's app account behind a ticket (push target for an app-saved receipt). */
  customerUserIdForTicket?(ctx: CheckoutContext, ticketId: string): Promise<string | null>;
  /** WP-I (§118): the ticket's customer's communication language (customers.preferred_language: 'en' / 'vi' / null). */
  customerLanguageForTicket?(ctx: CheckoutContext, ticketId: string): Promise<string | null>;
  /** Every CARD payment row of one ticket (any status) with its processor reference — Functional Decision 22 verification. */
  cardPaymentsForTicket(ctx: CheckoutContext, ticketId: string): Promise<PaymentRecord[]>;
  /** Every payment row of one ticket (all methods, any status) — Functional Decision 20 ticket-level refunds. */
  paymentsForTicket(ctx: CheckoutContext, ticketId: string): Promise<PaymentRecord[]>;
  /** B-81 (Oct 23 2026): every card charge still mid-air on the ticket — payments 'processing', payment_attempts in flight
   *  (split reservation / Tap to Pay), skip-line app intents whose card was sent. The one read behind "no other tender
   *  while a card attempt is unsettled". */
  unsettledTendersForTicket?(ctx: CheckoutContext, ticketId: string, opts?: { exceptPaymentId?: string | null }): Promise<UnsettledTender[]>;
  /** 23-inch spec §30–§39: the customer-safe checkout for the customer display (buildCustomerDisplayCheckout). */
  customerDisplayCheckout?(ctx: CheckoutContext, ticketId: string): Promise<CustomerDisplayCheckout | null>;
  /** Functional Decision 15: membership benefits redeemed against this ticket's lines (immutable snapshots). Optional. */
  membershipRedemptionsForTicket?(ctx: CheckoutContext, ticketId: string): Promise<MemberRedemption[]>;
  /** Decision 15: the ticket's lines as the membership rule needs them, and the customer's LIVE percent/fixed benefits. */
  memberDiscountInputs?(ctx: CheckoutContext, ticketId: string): Promise<{ lines: MemberLine[]; benefits: MemberDiscountBenefit[] }>;
  /** Decision 15 loyalty step. findRewardCode: the code in this salon (any customer, any state). reserveRewardCode: issued →
   *  applied to this ticket, atomically, only if still issued (or already on this ticket); returns false if someone else
   *  got there first. releaseRewardCodes: applied → issued for this ticket. rewardCodeForTicket: the code applied to it.
   *  markRewardCodesUsed: applied → used when the ticket is paid. */
  findRewardCode?(ctx: CheckoutContext, code: string): Promise<RewardCodeRow | null>;
  reserveRewardCode?(ctx: CheckoutContext, redemptionId: string, ticketId: string): Promise<boolean>;
  releaseRewardCodes?(ctx: CheckoutContext, ticketId: string): Promise<void>;
  rewardCodeForTicket?(ctx: CheckoutContext, ticketId: string): Promise<RewardCodeRow | null>;
  markRewardCodesUsed?(ctx: CheckoutContext, ticketId: string): Promise<void>;
  /** Functional Decision 34: the shared-terminal reservation (database-backed in production). */
  readonly terminalLeases?: TerminalLeasePort;
  // A lightweight reservation lock for the split's atomic card-capture path, which can't use the payments-row claim
  // above (recordSplitAtomic owns the payment rows). Backed by the dedicated payment_attempts table + its
  // UNIQUE(tenant, idempotency_key): the claim wins for exactly one concurrent caller; settle marks it done; release
  // frees it on a settlement rollback so the same split can be re-attempted.
  claimPaymentAttempt(ctx: CheckoutContext, rec: { ticketId: string; method: PaymentMethod; amountCents: Money; idempotencyKey: string }): Promise<{ claimed: boolean; attemptId: string | null }>;
  settlePaymentAttempt(ctx: CheckoutContext, idempotencyKey: string): Promise<void>;
  releasePaymentAttempt(ctx: CheckoutContext, idempotencyKey: string): Promise<void>;
  // Atomic refund cap enforcement (mirrors the wallet's postDebitAtomic). reserveRefundAtomic re-sums prior refunds
  // and inserts a 'reserved' payment_refunds row INSIDE an advisory lock on the payment, so two concurrent same-payment
  // refunds can never both pass the cap — the reservation counts toward refundedTotalCents immediately. For a card
  // refund the amount is reserved BEFORE the gateway call; releaseRefund frees it if the gateway declines/errors, and
  // finalizeRefund settles the reservation to 'refunded' with the processor reference on success.
  reserveRefundAtomic(ctx: CheckoutContext, input: { paymentId: string; capturedCents: Money; amountCents: Money; reason?: string | null; method?: string | null; processorType?: string | null; canApprove?: boolean; thresholds?: RefundThresholds; requestDetail?: RefundRequestDetail | null }): Promise<{ ok: true; refundId: string } | { ok: false; approvalRequired?: boolean; pendingVerification?: boolean; refundable: number }>;
  releaseRefund(ctx: CheckoutContext, refundId: string): Promise<void>;
  finalizeRefund(ctx: CheckoutContext, refundId: string, processorRefundId: string | null, settledBy?: string): Promise<void>;
  /** D11 (Oct 21 2026): the booking deposit becomes a 'deposit' payment row on the ticket and the deposit is marked
   *  applied by `mark` — ONE transaction. null = nothing recorded (the deposit was no longer captured). */
  recordDepositPaymentAtomic?(ctx: CheckoutContext, input: { ticketId: string; depositId: string; amountCents: Money; mark: (exec: unknown, paymentId: string) => Promise<boolean> }): Promise<PaymentRecord | null>;
  /** Global Loyalty (Final Completion guide §04): the 'global_reward' tender row + the point hold in ONE transaction (the hold
   *  throws → nothing recorded). A retry with the same key returns the existing row. */
  recordRewardPaymentAtomic?(ctx: CheckoutContext, input: { ticketId: string; amountCents: Money; idempotencyKey: string; hold: (exec: unknown, paymentId: string) => Promise<void> }): Promise<PaymentRecord>;
  /** remove a reward from an UNPAID ticket: the hold is released and its tender row voided together */
  voidRewardPaymentAtomic?(ctx: CheckoutContext, input: { ticketId: string; paymentId: string; release: (exec: unknown) => Promise<boolean> }): Promise<boolean>;
  /** Oct 21 2026 — a refund of a gift-card payment goes back ON THE CARD. Which card paid this payment, and can it take
   *  the credit (a voided / replaced card cannot; a card at another salon is refused for now). Nothing is written. */
  giftCardForPayment(ctx: CheckoutContext, originalPaymentId: string): Promise<{ ok: true; giftCardId: string; last4: string | null } | { ok: false; reason: 'no_card' | 'other_salon' | 'not_creditable'; status?: string }>;
  /** ONE transaction: card balance up (+ 'refund' ledger row, idempotent by refund id), the refund payment row, the
   *  reservation settled. null = the card could not be credited after all; nothing written. */
  refundToGiftCardAtomic(ctx: CheckoutContext, input: { giftCardId: string; reservationId: string; originalPaymentId: string; refund: PaymentRecord }): Promise<PaymentRecord | null>;
  /** Mandate P0 §228: the processor's answer to this refund was lost — keep the amount reserved, mark it 'processing'
   *  (the machine's unknown state). Conditional on the row still being 'reserved'. */
  markRefundUnknown(ctx: CheckoutContext, refundId: string, lastError: string): Promise<boolean>;
  /** The unknown refund, with what the sweep / a manager needs to settle it (null when it is no longer 'processing'). */
  unknownRefund(ctx: CheckoutContext, refundId: string): Promise<UnknownRefund | null>;
  /** ONE transaction, conditional on the row still being 'processing' (row lock): `refunded` inserts the refund payment
   *  row and finalizes the reservation with the processor reference; `not_refunded` releases the reservation. Ten
   *  concurrent settlers → exactly one wins; the others get null (nothing recorded twice). */
  /** Every refund on this ticket's payments still waiting for the processor's answer (status 'processing'), oldest first. */
  unsettledRefundsForTicket(ctx: CheckoutContext, ticketId: string): Promise<UnknownRefund[]>;
  settleUnknownRefundAtomic(ctx: CheckoutContext, refundId: string, outcome: { kind: 'refunded'; processorRefundId: string | null } | { kind: 'not_refunded' }, settledBy: string): Promise<{ refund: UnknownRefund; refundPaymentId: string | null } | null>;
  // Append a row to the tenant-scoped payment_refunds ledger (shared with gateway-reported refunds; reconciliation totals it).
  recordRefund(ctx: CheckoutContext, input: { paymentId: string | null; amountCents: number; reason?: string | null; method?: string | null; processorType?: string | null; processorRefundId?: string | null }): Promise<void>;
  // Reverse loyalty points proportionally for a refunded amount.
  reverseLoyaltyPoints(ctx: CheckoutContext, ticketId: string, refundedCents: number, reason: string, source?: { table: string; id: string }): Promise<void>;
  // Sum of prior refunds (payment_refunds ledger) recorded against an original payment — tenant-scoped. Used to cap
  // refunds at the refundable balance and to prevent double/over-refunds.
  refundedTotalCents(ctx: CheckoutContext, originalPaymentId: string): Promise<number>;
  // The cardholder signature captured on the customer-display for this ticket's approved card payment (PNG data URL),
  // or null when none has been captured. Read-only surface for the front desk / dispute evidence.
  paymentSignatureForTicket(ctx: CheckoutContext, ticketId: string): Promise<{ signaturePng: string; capturedOn: string } | null>;
  // Mark an original payment as voided (reversed). Excludes it from revenue and the ticket's paid-total, and the status
  // guards then block any second void/refund of the same payment (critical for Clover, where a void is really a refund).
  markPaymentVoided(ctx: CheckoutContext, paymentId: string): Promise<void>;
  // Sum of funds already captured against a ticket (approved/partial payments; refunds/voids excluded) — tenant-scoped.
  // Used so a follow-up payment collects only the REMAINING balance instead of recomputing the full total.
  paidTotalCents(ctx: CheckoutContext, ticketId: string): Promise<number>;
  /** Stamp a PAID ticket's final money on its row (owner finance and reports read tickets.subtotal/tax/surcharge/total) */
  setFinalTotals?(ctx: CheckoutContext, ticketId: string, t: { subtotalCents: number; taxCents: number; surchargeCents: number; totalCents: number }): Promise<void>;
  /** What was actually charged (approved + partial payments) and the card surcharge inside it — a receipt states these. */
  paidBreakdown(ctx: CheckoutContext, ticketId: string): Promise<{ totalCents: number; surchargeCents: number }>;
  /** Fiserv §9: record the provider-assessed surcharge (fee_amount) on an approved card payment — the payment's amount
   *  grows by the fee the processor actually added; nothing is recomputed locally. */
  recordProviderSurcharge?(ctx: CheckoutContext, paymentId: string, feeCents: number, meta?: { feeType?: string; feeValue?: string }): Promise<void>;
  /** 23-inch spec §97: a receipt was already sent for this ticket (the display does not ask again). */
  hasReceipt(ctx: CheckoutContext, ticketId: string): Promise<boolean>;
  devices(ctx: CheckoutContext): Promise<POSCustomerDisplayDevice[]>;
  /** 23-inch spec §11, §82: the display sessions this ticket is open on (normally none or one). */
  openDisplaySessionsForTicket(ctx: CheckoutContext, ticketId: string): Promise<OpenDisplaySession[]>;
  createSession(ctx: CheckoutContext, ticketId: string, deviceId: string): Promise<POSCustomerDisplaySession | null>;
  getSession(ctx: CheckoutContext, sessionId: string): Promise<POSCustomerDisplaySession | null>;
  updateSession(ctx: CheckoutContext, sessionId: string, patch: Partial<POSCustomerDisplaySession>): Promise<POSCustomerDisplaySession | null>;
  closeSession(ctx: CheckoutContext, sessionId: string): Promise<boolean>;
  activeSession(ctx: CheckoutContext): Promise<POSCustomerDisplaySession | null>;
}

const now = () => new Date().toISOString();
const minsFromNow = (m: number) => new Date(Date.now() + m * 60000).toISOString();

export class InMemoryCheckoutRepository implements CheckoutRepositoryPort {
  private tickets = new Map<string, Ticket[]>();
  private pays = new Map<string, PaymentRecord[]>();
  private gifts = new Map<string, GiftCard[]>();
  private devs = new Map<string, POSCustomerDisplayDevice[]>();
  private attempts = new Map<string, Map<string, string>>(); // tenant -> (idempotency_key -> status); mirrors payment_attempts
  private sessions = new Map<string, POSCustomerDisplaySession[]>();
  private receiptTickets = new Map<string, Set<string>>();
  private ratings = new Map<string, Map<string, number>>();
  private seq = 9000;

  private ensure(tenantId: string) {
    if (this.tickets.has(tenantId)) return;
    if (tenantId !== 'luxe001') { this.tickets.set(tenantId, []); this.pays.set(tenantId, []); this.gifts.set(tenantId, []); this.devs.set(tenantId, []); this.sessions.set(tenantId, []); return; }
    const mk = (id: string, num: string, cust: string, init: string, phone: string, vip: boolean, station: string, lines: ServiceLine[], primary: string, helper: string | undefined, over: Partial<Ticket> = {}): Ticket => ({
      ticketId: id, ticketNumber: num, customerId: 'c_' + id, customerName: cust, customerInitials: init, customerPhone: phone, customerEmail: cust.toLowerCase().replace(/\s+/g, '.') + '@example.com',
      isVip: vip, loyaltyTier: vip ? 'VIP Gold' : 'Regular', station, lines, primaryTechName: primary, helperTechName: helper, finishedAt: now(), qualityApproved: true, notes: '',
      tipCents: 0, discountCents: 0, method: 'card', lockedTotalCents: null, status: 'ready_for_payment', createdAt: now(), ...over,
    });
    this.tickets.set(tenantId, [
      mk('tk_2041', '#2041', 'Grace Kim', 'GK', '+18565550101', true, 'Station 3', [{ serviceLineId: 'l1', serviceName: 'Signature Manicure', technicianName: 'Mia', priceCents: 5500 }, { serviceLineId: 'l2', serviceName: 'Gel Add-on', technicianName: 'Mia', priceCents: 1500 }], 'Mia', undefined),
      mk('tk_2042', '#2042', 'Nora Patel', 'NP', '+18565550102', false, 'Station 1', [{ serviceLineId: 'l3', serviceName: 'Spa Pedicure', technicianName: 'Ava', priceCents: 6500 }], 'Ava', 'Leo'),
      mk('tk_2043', '#2043', 'Liv Chen', 'LC', '+18565550103', false, 'Station 2', [{ serviceLineId: 'l4', serviceName: 'Full Set Acrylic', technicianName: 'Leo', priceCents: 9000 }, { serviceLineId: 'l5', serviceName: 'Nail Art', technicianName: 'Leo', priceCents: 2000 }], 'Leo', undefined, { status: 'sent_to_customer_display' }),
      mk('tk_2044', '#2044', 'Ivy Park', 'IP', '+18565550104', false, 'Station 4', [{ serviceLineId: 'l6', serviceName: 'Classic Manicure', technicianName: 'Mia', priceCents: 3500 }], 'Mia', undefined),
    ]);
    this.pays.set(tenantId, []);
    this.gifts.set(tenantId, [{ code: 'GIFT-50', balanceCents: 5000 }, { code: 'GIFT-200', balanceCents: 20000 }, { code: 'GIFT-EMPTY', balanceCents: 0 }]);
    this.devs.set(tenantId, [{ deviceId: 'disp_st3', label: 'iPad Mini — Station 3', stationCode: 'Station 3', paired: true, lastSeenAt: now(), online: true, maintenance: false }, { deviceId: 'disp_st1', label: 'iPad Mini — Station 1', stationCode: 'Station 1', paired: true, lastSeenAt: now(), online: true, maintenance: false }]);
    this.sessions.set(tenantId, []);
  }
  private T(ctx: CheckoutContext) { this.ensure(ctx.tenantId); return this.tickets.get(ctx.tenantId)!; }
  private P(ctx: CheckoutContext) { this.ensure(ctx.tenantId); return this.pays.get(ctx.tenantId)!; }
  private G(ctx: CheckoutContext) { this.ensure(ctx.tenantId); return this.gifts.get(ctx.tenantId)!; }
  private D(ctx: CheckoutContext) { this.ensure(ctx.tenantId); return this.devs.get(ctx.tenantId)!; }
  private S(ctx: CheckoutContext) { this.ensure(ctx.tenantId); return this.sessions.get(ctx.tenantId)!; }
  private _ticket(ctx: CheckoutContext, id: string) { return this.T(ctx).find((t) => t.ticketId === id) || null; }
  async ticket(ctx: CheckoutContext, id: string) { return this._ticket(ctx, id); }

  async settings(ctx: CheckoutContext) { return this._settingsFull(ctx); }
  // Test-overridable gift-card SALE rules (defaults mirror the settings module). Tests set this to exercise enforcement.
  giftCardSaleSettingsOverride: Partial<GiftCardSaleSettings> = {};
  async giftCardSaleSettings(_ctx: CheckoutContext): Promise<GiftCardSaleSettings> { return { ...DEFAULT_GIFT_CARD_SALE_SETTINGS, ...this.giftCardSaleSettingsOverride }; }
  private _settingsFull(_ctx: CheckoutContext): POSCheckoutPaymentSettingsFull {
    const s = DEFAULT_CHECKOUT_SETTINGS;
    return {
      cardEnabled: true, cashEnabled: true, giftCardEnabled: true, splitPaymentEnabled: true,
      cardSurchargeEnabled: s.creditCardSurchargeEnabled, cardSurchargePercent: s.creditCardSurchargePercent, taxRatePercent: s.taxRatePercent,
      tipsEnabled: true, defaultTipPercents: s.defaultTipPercents, allowCustomTip: true, allowNoTip: true,
      customerDisplayMode: s.customerDisplayPayButtonEnabled ? 'customer_pays' : 'review_only',
      fiservStatus: 'not_configured' as FiservStatus, // honest: no live MID wired in the delivery package
    };
  }
  private coreSettings(): CheckoutSettings { return DEFAULT_CHECKOUT_SETTINGS; }
  private effSubtotal(t: Ticket) { return Math.max(0, subtotalFromLines(t.lines) - t.discountCents); }
  /** the taxed part of the discounted subtotal (a line marked not taxable is left out) */
  private effTaxable(t: Ticket) { return taxableSubtotal(t.lines, t.discountCents); }
  // Mirror of the kysely helper: pending gift-card sale + reload value on this ticket (stable across activation).
  private giftCardChargeFor(ctx: CheckoutContext, ticketId: string): number {
    const sale = this._pendingSales.filter((p) => p.tenantId === ctx.tenantId && p.ticketId === ticketId).reduce((a, p) => a + p.amountCents, 0);
    const reload = this._pendingReloads.filter((p) => p.tenantId === ctx.tenantId && p.ticketId === ticketId).reduce((a, p) => a + p.amountCents, 0);
    return sale + reload;
  }
  async totalsFor(ctx: CheckoutContext, id: string, method?: PaymentMethod) {
    const t = this._ticket(ctx, id); if (!t) return null;
    return totalsForMethod(this.effSubtotal(t), t.tipCents, this.coreSettings(), method || t.method, this.giftCardChargeFor(ctx, id), this.effTaxable(t));
  }

  private toRow(ctx: CheckoutContext, t: Ticket): POSCheckoutTicketRow {
    const totals = totalsForMethod(this.effSubtotal(t), t.tipCents, this.coreSettings(), t.method, undefined, this.effTaxable(t));
    return {
      ticketId: t.ticketId, ticketNumber: t.ticketNumber, tenantId: ctx.tenantId, branchId: ctx.branchId, customerId: t.customerId, customerName: t.customerName,
      customerPhone: t.customerPhone, isVip: t.isVip, station: t.station, serviceCount: t.lines.length, completedAt: t.finishedAt, finishedAt: t.finishedAt,
      subtotalCents: totals.subtotalCents, tipCents: totals.tipCents, taxCents: totals.taxCents, surchargeCents: totals.surchargeCents, discountCents: t.discountCents,
      totalDueCents: totals.totalDueCents, status: t.status, primaryTechnicianName: t.primaryTechName, helperTechnicianName: t.helperTechName, servicesLabel: t.lines[0]?.serviceName ? (t.lines[0].serviceName + (t.lines.length > 1 ? ` +${t.lines.length - 1}` : "")) : undefined,
    };
  }

  async query(ctx: CheckoutContext, f: CheckoutFilters) {
    let rows = this.T(ctx).slice();
    if (f.search) { const q = f.search.toLowerCase(); rows = rows.filter((t) => [t.ticketNumber, t.customerName, t.customerPhone, t.station, t.primaryTechName, ...t.lines.map((l) => l.serviceName)].some((x) => (x || '').toLowerCase().includes(q))); }
    if (f.status) rows = rows.filter((t) => t.status === f.status);
    if (f.station) rows = rows.filter((t) => t.station === f.station);
    if (f.paymentMethod) rows = rows.filter((t) => t.method === f.paymentMethod);
    if (f.technicianId) rows = rows.filter((t) => t.lines.some((l) => l.technicianId === f.technicianId) || t.primaryTechName === f.technicianId);

    const page = clampPage(f.page), pageSize = clampPageSize(f.pageSize, 20);
    const totalItems = rows.length, totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
    const pageRows = rows.slice((page - 1) * pageSize, (page - 1) * pageSize + pageSize).map((t) => this.toRow(ctx, t));

    const all = this.T(ctx); const pays = this.P(ctx);
    const isToday = (iso: string) => iso.slice(0, 10) === new Date().toISOString().slice(0, 10);
    const unpaid = all.filter((t) => t.status !== 'paid' && t.status !== 'failed' && t.status !== 'on_hold');   // a held ticket waits aside (Oct 6 2026)
    const paidToday = pays.filter((p) => p.status === 'approved' && isToday(p.createdAt));
    const readyTotals = unpaid.map((t) => totalsForMethod(this.effSubtotal(t), t.tipCents, this.coreSettings(), t.method, undefined, this.effTaxable(t)));

    // Surcharge + tax collected today, method-agnostic (same rule as the Kysely path): charged total per paid ticket
    // minus its base (subtotal + tip + tax) is the surcharge added — straight card includes it, cash/gift = 0, and a
    // split's card segment carries it (Option A). Never negative.
    const taxRate = this.coreSettings().taxRatePercent || 0;
    const ticketById = new Map(all.map((t) => [t.ticketId, t]));
    const chargedByTicket = new Map<string, number>();
    for (const p of paidToday) chargedByTicket.set(p.ticketId, (chargedByTicket.get(p.ticketId) || 0) + p.amountCents);
    let surchargeCollectedCents = 0, taxCollectedCents = 0;
    for (const [tid, charged] of chargedByTicket) {
      const t = ticketById.get(tid); if (!t) continue;
      const sub = this.effSubtotal(t); const tax = taxCents(this.effTaxable(t), taxRate); const base = sub + t.tipCents + tax;
      surchargeCollectedCents += Math.max(0, charged - base);
      taxCollectedCents += tax;
    }

    const paidIds = new Set(paidToday.map((p) => p.ticketId));
    const rcptSet = this.receiptTickets.get(ctx.tenantId) || new Set<string>();
    // checkout-board-signals.ts — the same rule as the Kysely path. In memory a recorded receipt stands for a delivery.
    const unsettled: BranchUnsettledTender[] = [];
    for (const p of pays) if (p.method === 'card' && p.status === 'processing') unsettled.push({ kind: 'payment', id: p.paymentId, ticketId: p.ticketId, method: p.method, status: p.status, amountCents: p.amountCents, createdAt: p.createdAt });
    for (const [key, status] of this.A(ctx)) { const tid = all.find((t) => key.includes(t.ticketId))?.ticketId; if (tid && attemptStatusUnsettled(status)) unsettled.push({ kind: 'attempt', id: key, ticketId: tid, method: 'card', status, amountCents: 0, createdAt: new Date().toISOString(), idempotencyKey: key }); }
    const signals = boardSignals({
      unpaid: unpaid.map((t) => ({ ticketId: t.ticketId, customerName: t.customerName, status: String(t.status), method: t.method, finishedAt: t.finishedAt })),
      unsettled, refunds: [], receiptOutcomes: [...paidIds].filter((id) => rcptSet.has(id)).map((id) => ({ ticketId: id, channel: 'app', delivery: 'sent', at: new Date().toISOString() })),
      paidTicketIdsToday: [...paidIds], guestOf: (tid) => all.find((t) => t.ticketId === tid)?.customerName || 'Guest', hhmm: () => '',
    });
    const receiptDeliveryRatePercent = signals.receipt.percent ?? 0;
    const kpisFull: POSCheckoutKpisFull = {
      ticketsReadyForPayment: unpaid.length,
      subtotalCents: readyTotals.reduce((a, x) => a + x.subtotalCents, 0),
      tipsTodayCents: paidToday.reduce((a, p) => a + p.tipCents, 0),
      cardSurchargeCollectedCents: surchargeCollectedCents,
      taxCollectedCents: taxCollectedCents,
      paidTicketsToday: paidIds.size,
      failedPaymentsToday: pays.filter((p) => (p.status === 'declined') && isToday(p.createdAt)).length,
      pendingPaymentsToday: signals.pendingPayments,
      receiptDeliveryEligible: signals.receipt.eligible,
      customerDisplayActiveSessions: this.S(ctx).filter((s) => s.state !== 'disconnected' && new Date(s.expiresAt).getTime() > Date.now()).length,
      receiptDeliveryRatePercent,
      averageCheckoutSeconds: 0,
      giftCardLoyaltyRedemptionsCents: 0,
      upsellCapturePercent: 0,
    };
    const kpis: CheckoutKpis = { readyForCheckoutCount: unpaid.length, subtotalTodayCents: kpisFull.subtotalCents, tipsTodayCents: kpisFull.tipsTodayCents, cardSurchargeCollectedCents: kpisFull.cardSurchargeCollectedCents };

    const queueServicesCents = unpaid.reduce((a, t) => a + this.effSubtotal(t), 0);
    const queueTipsEstCents = unpaid.reduce((a, t) => a + (t.tipCents || 0), 0);
    const potentialRevenue = { totalCents: queueServicesCents + queueTipsEstCents, servicesCents: queueServicesCents, retailCents: 0, tipsEstCents: queueTipsEstCents, ticketCount: unpaid.length };
    const eligibleToday = paidIds.size + unpaid.length;
    const conversionPercent = eligibleToday > 0 ? Math.round((paidIds.size / eligibleToday) * 1000) / 10 : null;
    const attention = signals.attention;

    return {
      kpis, kpisFull, analytics: buildCheckoutAnalytics(paidToday, { conversionPercent, potentialRevenue, upsellMix: [], revenueTrendDeltaPercent: null }), attention, staff: [], staffSummary: { total: 0, ready: 0, busy: 0, onBreak: 0, shown: 0 },
      tickets: { items: pageRows, pagination: { page, pageSize, totalItems, totalPages } },
      paymentSettings: this._settingsFull(ctx),
      customerDisplay: { pairedDevices: this.D(ctx), activeSession: this._activeSession(ctx) },
      filters: {
        statuses: ['ready_for_payment', 'sent_to_customer_display', 'payment_in_progress', 'paid', 'failed', 'reopened', 'on_hold'],
        stations: [...new Set(all.map((t) => t.station || ''))].filter(Boolean), technicians: [...new Set(all.map((t) => t.primaryTechName || ''))].filter(Boolean),
        paymentMethods: ['card', 'cash', 'gift_card', 'split'],
      },
    };
  }

  async detail(ctx: CheckoutContext, id: string) {
    const t = this._ticket(ctx, id); if (!t) return null;
    const totals = totalsForMethod(this.effSubtotal(t), t.tipCents, this.coreSettings(), t.method, undefined, this.effTaxable(t));
    return {
      ticketId: t.ticketId, ticketNumber: t.ticketNumber,
      customer: { customerId: t.customerId, fullName: t.customerName, initials: t.customerInitials, phone: t.customerPhone, email: t.customerEmail, isVip: t.isVip, loyaltyTier: t.loyaltyTier },
      stationLabel: t.station,
      completedServices: t.lines.map((l) => ({ serviceLineId: l.serviceLineId, serviceName: l.serviceName, technicianId: l.technicianId, technicianName: l.technicianName, priceCents: l.priceCents, status: 'done' as const })),
      technicians: { primary: t.primaryTechName ? { technicianId: 'tech_primary', name: t.primaryTechName } : undefined, helpers: t.helperTechName ? [{ technicianId: 'tech_helper', name: t.helperTechName }] : [] },
      finishedAt: t.finishedAt,
      qualitySummary: { serviceCompleted: true, customerReady: true, qualityChecked: t.qualityApproved, noOpenIssues: true, approved: t.qualityApproved },
      serviceNotes: t.notes, totals, receiptDeliveryOptions: { sms: !!t.customerPhone, email: !!t.customerEmail, app: !!t.customerId, print: true },
      promotion: couponOf(t.discountSnapshot), discounts: itemizedDiscounts(t.discountSnapshot, t.discountCents || 0), discountSnapshot: t.discountSnapshot,
    };
  }

  async setTip(ctx: CheckoutContext, id: string, tipCents: Money, meta?: { tipType: 'none' | 'percent' | 'custom'; tipPercent: number | null }) { const t = this._ticket(ctx, id); if (!t) return false; t.tipCents = tipCents; t.lockedTotalCents = null; if (meta) { t.tipType = meta.tipType; t.tipPercent = meta.tipPercent; } return true; }
  async setDiscount(ctx: CheckoutContext, id: string, discountCents: Money, discountSnapshot?: any) {
    const t = this._ticket(ctx, id);
    if (!t) return false;
    t.discountCents = discountCents;
    t.lockedTotalCents = null;
    if (discountSnapshot !== undefined) {
      t.discountSnapshot = discountSnapshot;
    }
    return true;
  }
  async setMethod(ctx: CheckoutContext, id: string, method: PaymentMethod) { const t = this._ticket(ctx, id); if (!t) return false; t.method = method; t.lockedTotalCents = null; return true; }
  async setStatus(ctx: CheckoutContext, id: string, status: TicketStatus) { const t = this._ticket(ctx, id); if (!t) return false; t.status = status; return true; }
  registers: { id: string; branchId: string; name: string }[] = [];
  async setHold(ctx: CheckoutContext, id: string, held: boolean) { const t = this._ticket(ctx, id); if (!t || t.status === 'paid') return false; t.status = held ? 'on_hold' : 'ready_for_payment'; return true; }
  async moveToRegister(ctx: CheckoutContext, id: string, registerId: string) { const t = this._ticket(ctx, id); const r = this.registers.find((x) => x.id === registerId && x.branchId === ctx.branchId); if (!t || !r || t.status === 'paid') return null; t.station = r.name; t.registerId = r.id; return { registerId: r.id, name: r.name }; }
  async lockTotal(ctx: CheckoutContext, id: string, totalCents: Money) { const t = this._ticket(ctx, id); if (t) t.lockedTotalCents = totalCents; }

  async giftBalance(ctx: CheckoutContext, code: string) { const g = this.G(ctx).find((x) => x.code === code); return g && (g as any).status !== 'void' ? g.balanceCents : null; }
  async decrementGift(ctx: CheckoutContext, code: string, by: Money, _pin?: string) { const g = this.G(ctx).find((x) => x.code === code); if (!g || (g as any).status === 'void' || !(by > 0) || g.balanceCents < by) return false; g.balanceCents -= by; if (g.balanceCents === 0) (g as any).status = 'redeemed'; return true; }
  private _issuedByKey = new Map<string, GiftCard>();
  async issueGiftCard(ctx: CheckoutContext, req: { code: string; amountCents: Money; customerId?: string; idempotencyKey?: string; cardNumber?: string }) {
    const kk = req.idempotencyKey ? ctx.tenantId + ':' + req.idempotencyKey : '';
    if (kk && this._issuedByKey.has(kk)) return { ...this._issuedByKey.get(kk)! };
    const list = this.G(ctx); const existing = list.find((x) => x.code === req.code);
    let card: GiftCard;
    if (existing) { existing.balanceCents += req.amountCents; card = { code: existing.code, balanceCents: existing.balanceCents }; }
    else { card = { code: req.code, balanceCents: req.amountCents, cardNumber: req.cardNumber } as any; list.push(card); }
    if (kk) this._issuedByKey.set(kk, { ...card });
    return { ...card };
  }
  private _pendingSales: { tenantId: string; code: string; amountCents: Money; customerId?: string; ticketId: string; cardNumber?: string; activated: boolean }[] = [];
  async createPendingGiftCardSale(ctx: CheckoutContext, req: { code: string; amountCents: Money; customerId?: string; ticketId: string; reference: string; cardNumber: string }) {
    this._pendingSales.push({ tenantId: ctx.tenantId, code: req.code, amountCents: req.amountCents, customerId: req.customerId, ticketId: req.ticketId, cardNumber: req.cardNumber, activated: false });
    return { code: req.code, reference: req.reference };
  }
  async createPhysicalGiftCardSale(ctx: CheckoutContext, req: { code: string; amountCents: Money; customerId?: string; ticketId: string; reference: string; cardNumber: string; pin?: string }) {
    // In-memory double doesn't model the physical stock table; the stock guard is a DB-level concern (see the Kysely repo
    // + pgtest). Here a physical sale behaves like a pending sale on the supplied number.
    return this.createPendingGiftCardSale(ctx, req);
  }
  async activatePendingGiftCardSales(ctx: CheckoutContext, ticketId: string) {
    const list = this.G(ctx); let activated = 0;
    for (const p of this._pendingSales) {
      if (p.tenantId === ctx.tenantId && p.ticketId === ticketId && !p.activated) {
        p.activated = true; list.push({ code: p.code, balanceCents: p.amountCents, cardNumber: p.cardNumber } as any); activated++;
      }
    }
    return { activated };
  }
  private _pendingReloads: { tenantId: string; code: string; amountCents: Money; ticketId: string; activated: boolean }[] = [];
  async createPendingGiftCardReload(ctx: CheckoutContext, req: { code: string; amountCents: Money; ticketId: string; reference: string }) {
    const has = this._pendingReloads.find((p) => p.tenantId === ctx.tenantId && p.ticketId === req.ticketId && p.code === req.code && !p.activated);
    if (!has) this._pendingReloads.push({ tenantId: ctx.tenantId, code: req.code, amountCents: req.amountCents, ticketId: req.ticketId, activated: false });
    return { reference: req.reference, amountCents: has ? has.amountCents : req.amountCents };
  }
  async activatePendingGiftCardReloads(ctx: CheckoutContext, ticketId: string) {
    let activated = 0;
    for (const p of this._pendingReloads) {
      if (p.tenantId === ctx.tenantId && p.ticketId === ticketId && !p.activated) {
        const g = this.G(ctx).find((x) => x.code === p.code);
        if (g) { g.balanceCents += p.amountCents; (g as any).status = 'active'; }
        p.activated = true; activated++;
      }
    }
    return { activated };
  }
  async voidGiftCard(ctx: CheckoutContext, code: string): Promise<GiftCardDetail> { const g = this.G(ctx).find((x) => x.code === code); if (g) { (g as any).status = 'void'; g.balanceCents = 0; } return (await this.getGiftCard(ctx, code))!; }
  async getGiftCard(ctx: CheckoutContext, code: string): Promise<GiftCardDetail | null> { const g = this.G(ctx).find((x) => x.code === code); if (!g) return null; const status = (g as any).status === 'void' ? 'void' : (g.balanceCents > 0 ? 'active' : 'redeemed'); return { code: g.code, balanceCents: g.balanceCents, initialBalanceCents: g.balanceCents, status }; }
  async resolveGiftCardCode(ctx: CheckoutContext, input: string): Promise<string | null> {
    const digits = String(input || '').replace(/\D+/g, '');
    if (/^\d{16}$/.test(digits)) { const g = this.G(ctx).find((x) => (x as any).cardNumber === digits); return g ? g.code : null; }
    return String(input || '').trim() || null;
  }
  async resolveCrossTenantGiftCard(): Promise<{ found: boolean }> { return { found: false }; }
  async replaceGiftCardByCode(ctx: CheckoutContext, code: string): Promise<{ ok: boolean; reason?: string; newCode?: string; newCardNumber?: string; newReference?: string; newCardNumberMasked?: string; balanceCents?: Money }> {
    const list = this.G(ctx);
    const old: any = list.find((x) => x.code === code);
    if (!old) return { ok: false, reason: 'not_found' };
    if (!['active', 'partially_redeemed', 'frozen', 'suspended', 'lost_stolen'].includes(String(old.status ?? 'active'))) return { ok: false, reason: 'not_replaceable' };
    const bal = Number(old.balanceCents || 0);
    if (bal <= 0) return { ok: false, reason: 'no_balance' };
    const newCode = 'GC-' + secureString(10)   /* H9: a gift-card code is spendable money — was Math.random() */;
    const newNumber = generateCardNumber();
    old.balanceCents = 0; old.status = 'replaced'; old.replacedByCode = newCode;
    list.push({ code: newCode, balanceCents: bal, cardNumber: newNumber, status: 'active', replacementOfCode: code } as any);
    return { ok: true, newCode, newCardNumber: newNumber, newReference: 'GC-****-' + newCode.slice(-4), newCardNumberMasked: maskFromLast4(lastFour(newNumber)), balanceCents: bal };
  }
  async recordReceipt(ctx: CheckoutContext, rec: { ticketId: string; paymentId?: string; totalCents: Money; emailedTo?: string }) { const set = this.receiptTickets.get(ctx.tenantId) || new Set<string>(); set.add(rec.ticketId); this.receiptTickets.set(ctx.tenantId, set); return { receiptId: 'rcpt_' + Math.random().toString(36).slice(2, 8), receiptNumber: 'R-MOCK-' + Math.floor(Math.random() * 9000 + 1000) }; }
  async recordSatisfaction(ctx: CheckoutContext, ticketId: string, rating: number) { const r = Math.round(rating); if (!(r >= 1 && r <= 5)) return false; const m = this.ratings.get(ctx.tenantId) || new Map<string, number>(); m.set(ticketId, r); this.ratings.set(ctx.tenantId, m); return true; }

  async recordPayment(ctx: CheckoutContext, rec: PaymentRecord) { this.P(ctx).push(rec); return rec; }
  async recordPaymentIfUnchanged(ctx: CheckoutContext, rec: PaymentRecord, expectedPaidCents: number) {
    if ((await this.paidTotalCents(ctx, rec.ticketId)) !== expectedPaidCents) throw new CheckoutInProgressError();
    return this.recordPayment(ctx, rec);
  }
  async redeemGiftAndRecordIfUnchanged(ctx: CheckoutContext, code: string, by: Money, pin: string | undefined, rec: PaymentRecord, expectedPaidCents: number) {
    if ((await this.paidTotalCents(ctx, rec.ticketId)) !== expectedPaidCents) throw new CheckoutInProgressError();
    if (!(await this.decrementGift(ctx, code, by, pin))) return null;
    this.giftCardOfPayment.set(ctx.tenantId + '::' + rec.paymentId, code);
    return this.recordPayment(ctx, rec);
  }
  async recordDepositPaymentAtomic(ctx: CheckoutContext, input: { ticketId: string; depositId: string; amountCents: Money; mark: (exec: unknown, paymentId: string) => Promise<boolean> }): Promise<PaymentRecord | null> {
    const rec: PaymentRecord = { paymentId: 'pay_dep_' + input.depositId.slice(0, 8), ticketId: input.ticketId, method: 'deposit', amountCents: input.amountCents, tipCents: 0, status: 'approved', createdAt: new Date().toISOString(), idempotencyKey: 'deposit:' + input.depositId };
    if (this.P(ctx).some((p) => p.idempotencyKey === rec.idempotencyKey)) return null;
    if (!(await input.mark(null, rec.paymentId))) return null;
    this.P(ctx).push(rec); return rec;
  }
  /** which card paid which payment (the Kysely repository reads it off the 'redeem' ledger row) */
  private giftCardOfPayment = new Map<string, string>();
  async giftCardForPayment(ctx: CheckoutContext, originalPaymentId: string): Promise<{ ok: true; giftCardId: string; last4: string | null } | { ok: false; reason: 'no_card' | 'other_salon' | 'not_creditable'; status?: string }> {
    const code = this.giftCardOfPayment.get(ctx.tenantId + '::' + originalPaymentId);
    const g = code ? this.G(ctx).find((x) => x.code === code) : undefined;
    if (!g) return { ok: false, reason: 'no_card' };
    const st = String((g as any).status ?? 'active');
    if (!['active', 'partially_redeemed', 'redeemed', 'frozen', 'suspended'].includes(st)) return { ok: false, reason: 'not_creditable', status: st };
    return { ok: true, giftCardId: code!, last4: code!.slice(-4) };
  }
  private giftRefundKeys = new Set<string>();
  async refundToGiftCardAtomic(ctx: CheckoutContext, input: { giftCardId: string; reservationId: string; originalPaymentId: string; refund: PaymentRecord }): Promise<PaymentRecord | null> {
    const g = this.G(ctx).find((x) => x.code === input.giftCardId);
    if (!g || !['active', 'partially_redeemed', 'redeemed', 'frozen', 'suspended'].includes(String((g as any).status ?? 'active'))) return null;
    const key = ctx.tenantId + '::refund:' + input.refund.paymentId;
    if (!this.giftRefundKeys.has(key)) { this.giftRefundKeys.add(key); g.balanceCents += input.refund.amountCents; if (['redeemed', 'partially_redeemed'].includes(String((g as any).status))) (g as any).status = 'active'; }
    const rec = await this.recordPayment(ctx, input.refund);
    await this.finalizeRefund(ctx, input.reservationId, rec.paymentId);
    return rec;
  }
  async recordSplitAtomic(ctx: CheckoutContext, ticketId: string, segments: { method: PaymentMethod; amountCents: Money; giftCardCode?: string; pin?: string }[], opts: { cardRetref?: string; cardSurchargeCents?: Money; expectedPaidCents?: number }): Promise<PaymentRecord[]> {
    // In-memory analogue of the Kysely DB transaction: snapshot the gift balances we touch and the payments length, so a
    // failed redemption mid-way rolls everything back (no partial decrements, no orphan payment rows).
    const snap = new Map<string, number | null>();
    for (const seg of segments) if (seg.method === 'gift_card' && seg.giftCardCode && !snap.has(seg.giftCardCode)) { const g = this.G(ctx).find((x) => x.code === seg.giftCardCode); snap.set(seg.giftCardCode, g ? g.balanceCents : null); }
    if (opts.expectedPaidCents !== undefined && (await this.paidTotalCents(ctx, ticketId)) !== opts.expectedPaidCents) throw new CheckoutInProgressError();
    const startLen = this.P(ctx).length;
    const surcharge = opts.cardSurchargeCents || 0;
    try {
      const out: PaymentRecord[] = [];
      for (const seg of segments) {
        if (seg.method === 'gift_card' && seg.giftCardCode) { const okd = await this.decrementGift(ctx, seg.giftCardCode, seg.amountCents, (seg as any).pin); if (!okd) throw withCode(new SplitRedemptionError('Gift card ' + seg.giftCardCode + ' could not be redeemed (balance changed or card inactive)'), 'GIFT_CARD_REDEEM_FAILED'); }
        // Option A: the card segment carries the card-portion surcharge (already captured on the gateway by the service),
        // so its recorded amount = base card dollars + surcharge. Non-card segments are recorded at their base amount.
        const recordedAmount = seg.method === 'card' ? seg.amountCents + surcharge : seg.amountCents;
        const rec: PaymentRecord = { paymentId: 'pay_split_' + Math.random().toString(36).slice(2, 9), ticketId, method: seg.method, amountCents: recordedAmount, tipCents: 0, surchargeCents: seg.method === 'card' ? surcharge : 0, status: 'approved', ...(opts.cardRetref && seg.method === 'card' ? { processorTransactionId: opts.cardRetref } : {}), createdAt: new Date().toISOString() };   // same shape as the Kysely recorder
        out.push(await this.recordPayment(ctx, rec));
      }
      await this.setStatus(ctx, ticketId, 'paid');
      return out;
    } catch (e) {
      for (const [code, bal] of snap) { const g = this.G(ctx).find((x) => x.code === code); if (g && bal != null) { g.balanceCents = bal; if (bal > 0 && (g as any).status === 'redeemed') (g as any).status = 'active'; } }
      this.P(ctx).length = startLen;
      throw e;
    }
  }
  async payments(ctx: CheckoutContext) { return this.P(ctx).slice(); }
  async findPayment(ctx: CheckoutContext, paymentId: string) { return this.P(ctx).find((p) => p.paymentId === paymentId) || null; }
  async findPaymentByIdempotencyKey(ctx: CheckoutContext, idempotencyKey: string) { return this.P(ctx).find((p) => p.idempotencyKey === idempotencyKey) || null; }
  async claimPayment(ctx: CheckoutContext, rec: { paymentId: string; ticketId: string; method: PaymentMethod; amountCents: Money; tipCents: Money; surchargeCents?: Money; idempotencyKey: string }) {
    // The payments array is the claim ledger: a 'processing'/'approved' row holds the key (claim fails for a
    // concurrent duplicate); a 'declined' row has its key released (re-claimable). This mirrors the DB partial index.
    const existing = this.P(ctx).find((p) => p.idempotencyKey === rec.idempotencyKey) || null;
    if (existing) return { claimed: false, paymentId: existing.paymentId, existing };
    this.P(ctx).push({ paymentId: rec.paymentId, ticketId: rec.ticketId, method: rec.method, amountCents: rec.amountCents, tipCents: rec.tipCents || 0, surchargeCents: rec.surchargeCents || 0, status: 'processing', idempotencyKey: rec.idempotencyKey, createdAt: new Date().toISOString() });
    return { claimed: true, paymentId: rec.paymentId, existing: null };
  }
  readonly terminalLeases: TerminalLeasePort = new InMemoryTerminalLeases();
  membershipRedemptions: ({ ticketId: string } & MemberRedemption)[] = [];
  memberInputs: Record<string, { lines: MemberLine[]; benefits: MemberDiscountBenefit[] }> = {};
  async memberDiscountInputs(_ctx: CheckoutContext, ticketId: string) { return this.memberInputs[ticketId] ?? { lines: [], benefits: [] }; }
  rewardCodes: RewardCodeRow[] = [];
  async findRewardCode(_ctx: CheckoutContext, code: string) { return this.rewardCodes.find((c) => c.code === code) ?? null; }
  async reserveRewardCode(_ctx: CheckoutContext, redemptionId: string, ticketId: string) {
    const c = this.rewardCodes.find((x) => x.redemptionId === redemptionId);
    if (!c || !(c.status === 'issued' || (c.status === 'applied' && c.ticketId === ticketId))) return false;
    c.status = 'applied'; c.ticketId = ticketId; return true;
  }
  async releaseRewardCodes(_ctx: CheckoutContext, ticketId: string) { for (const c of this.rewardCodes) if (c.status === 'applied' && c.ticketId === ticketId) { c.status = 'issued'; c.ticketId = null; } }
  async rewardCodeForTicket(_ctx: CheckoutContext, ticketId: string) { return this.rewardCodes.find((c) => c.status === 'applied' && c.ticketId === ticketId) ?? null; }
  async markRewardCodesUsed(_ctx: CheckoutContext, ticketId: string) { for (const c of this.rewardCodes) if (c.status === 'applied' && c.ticketId === ticketId) c.status = 'used'; }
  async membershipRedemptionsForTicket(_ctx: CheckoutContext, ticketId: string) { return this.membershipRedemptions.filter((m) => m.ticketId === ticketId).map(({ ticketId: _t, ...m }) => m); }
  async paymentsForTicket(ctx: CheckoutContext, ticketId: string) { return this.P(ctx).filter((p) => p.ticketId === ticketId).map((p) => ({ ...p })); }
  async customerDisplayCheckout(ctx: CheckoutContext, ticketId: string): Promise<CustomerDisplayCheckout | null> {
    const t = this._ticket(ctx, ticketId); if (!t) return null;
    const totals = totalsForMethod(this.effSubtotal(t), t.tipCents, this.coreSettings(), t.method, this.giftCardChargeFor(ctx, ticketId), this.effTaxable(t));
    return buildCustomerDisplayCheckout({
      ticketNumber: t.ticketNumber, createdAt: t.createdAt, ticketStatus: t.status, lines: t.lines, discountCents: t.discountCents,
      discountSnapshot: t.discountSnapshot ?? null, totals, surchargeLabel: this.coreSettings().surchargeLabel,
      payments: (await this.paymentsForTicket(ctx, ticketId)).map((p) => ({ method: p.method, amountCents: p.amountCents, surchargeCents: p.surchargeCents ?? 0, status: p.status })),
    });
  }
  async cardPaymentsForTicket(ctx: CheckoutContext, ticketId: string) { return (await this.paymentsForTicket(ctx, ticketId)).filter((p) => p.method === 'card'); }
  async unsettledTendersForTicket(ctx: CheckoutContext, ticketId: string, opts: { exceptPaymentId?: string | null } = {}): Promise<UnsettledTender[]> {
    const out: UnsettledTender[] = (await this.cardPaymentsForTicket(ctx, ticketId)).filter((p) => p.status === 'processing' && p.paymentId !== opts.exceptPaymentId)
      .map((p) => ({ kind: 'payment' as const, id: p.paymentId, method: p.method, status: p.status, amountCents: p.amountCents, createdAt: p.createdAt }));
    // the in-memory attempt reservations carry only key → status; a 'processing' one is a split card charge mid-air
    for (const [key, status] of this.A(ctx)) if (attemptStatusUnsettled(status) && key.includes(ticketId)) out.push({ kind: 'attempt', id: key, method: 'card', status, amountCents: 0, createdAt: new Date().toISOString(), idempotencyKey: key });
    return out;
  }
  async finalizePayment(ctx: CheckoutContext, paymentId: string, patch: { status: PaymentRecord['status']; processorTransactionId?: string }) {
    const p = this.P(ctx).find((x) => x.paymentId === paymentId);
    if (!p) return null;
    p.status = patch.status;
    if (patch.processorTransactionId != null) p.processorTransactionId = patch.processorTransactionId;
    if (patch.status === 'declined' || patch.status === 'failed') p.idempotencyKey = undefined; // release the key so the card can be re-attempted (a verified never-reached charge too)
    return p;
  }
  private A(ctx: CheckoutContext) { let m = this.attempts.get(ctx.tenantId); if (!m) { m = new Map(); this.attempts.set(ctx.tenantId, m); } return m; }
  async claimPaymentAttempt(ctx: CheckoutContext, rec: { ticketId: string; method: PaymentMethod; amountCents: Money; idempotencyKey: string }) {
    const m = this.A(ctx);
    if (m.has(rec.idempotencyKey)) return { claimed: false, attemptId: null }; // reservation already held (mirrors UNIQUE)
    m.set(rec.idempotencyKey, 'processing');
    return { claimed: true, attemptId: rec.idempotencyKey };
  }
  async settlePaymentAttempt(ctx: CheckoutContext, idempotencyKey: string) { const m = this.A(ctx); if (m.has(idempotencyKey)) m.set(idempotencyKey, 'settled'); }
  async releasePaymentAttempt(ctx: CheckoutContext, idempotencyKey: string) { this.A(ctx).delete(idempotencyKey); }
  private refundLedger = new Map<string, number>(); // key: `${tenantId}::${originalPaymentId}` -> cumulative refunded cents
  refundRows: { id: string; key: string; paymentId: string; amountCents: number; status: string; processorRefundId?: string; lastError?: string; reason?: string | null; requestDetail?: RefundRequestDetail | null }[] = []; // reservations, for atomic cap + release/finalize/unknown
  async recordRefund(ctx: CheckoutContext, input: { paymentId: string | null; amountCents: number; reason?: string | null; method?: string | null; processorType?: string | null; processorRefundId?: string | null }) {
    const k = ctx.tenantId + '::' + (input.paymentId || '');
    this.refundLedger.set(k, (this.refundLedger.get(k) || 0) + (Number(input.amountCents) || 0));
  }
  async reverseLoyaltyPoints(ctx: CheckoutContext, ticketId: string, refundedCents: number, reason: string, source?: { table: string; id: string }): Promise<void> {}
  async refundedTotalCents(ctx: CheckoutContext, originalPaymentId: string) { return this.refundLedger.get(ctx.tenantId + '::' + originalPaymentId) || 0; }
  async paymentSignatureForTicket(): Promise<{ signaturePng: string; capturedOn: string } | null> { return null; }
  async reserveRefundAtomic(ctx: CheckoutContext, input: { paymentId: string; capturedCents: Money; amountCents: Money; reason?: string | null; method?: string | null; processorType?: string | null; canApprove?: boolean; thresholds?: RefundThresholds; requestDetail?: RefundRequestDetail | null }) {
    // Single-threaded here, so read-check-reserve is naturally atomic; the reservation counts toward the cap at once.
    const k = ctx.tenantId + '::' + input.paymentId;
    // Mandate P0 §228: while one refund on this payment is unresolved at the processor, no other refund may start.
    if (this.refundRows.some((r) => r.key === k && r.status === 'processing')) return { ok: false as const, pendingVerification: true, refundable: Math.max(0, input.capturedCents - (this.refundLedger.get(k) || 0)) };
    const already = this.refundLedger.get(k) || 0;
    const refundable = input.capturedCents - already;
    if (input.amountCents > refundable) return { ok: false as const, refundable: Math.max(0, refundable) };
    // Constitution 12 M9: the same cumulative rule as the database repository (shared pure function).
    if (!input.canApprove && refundNeedsApprover(input.method, already, input.amountCents, input.thresholds ?? refundThresholds())) return { ok: false as const, approvalRequired: true, refundable: Math.max(0, refundable) };
    const id = 'rfnd_' + Math.random().toString(36).slice(2, 10);
    this.refundLedger.set(k, already + input.amountCents);
    this.refundRows.push({ id, key: k, paymentId: input.paymentId, amountCents: input.amountCents, status: 'reserved', reason: input.reason ?? null, requestDetail: input.requestDetail ?? null });
    return { ok: true as const, refundId: id };
  }
  async releaseRefund(ctx: CheckoutContext, refundId: string) {
    const row = this.refundRows.find((r) => r.id === refundId);
    if (row) { this.refundLedger.set(row.key, Math.max(0, (this.refundLedger.get(row.key) || 0) - row.amountCents)); this.refundRows = this.refundRows.filter((r) => r.id !== refundId); }
  }
  async finalizeRefund(ctx: CheckoutContext, refundId: string, processorRefundId: string | null) {
    const row = this.refundRows.find((r) => r.id === refundId);
    if (row) { row.status = 'refunded'; if (processorRefundId != null) row.processorRefundId = processorRefundId; }
  }
  async markRefundUnknown(ctx: CheckoutContext, refundId: string, lastError: string) {
    const row = this.refundRows.find((r) => r.id === refundId && r.key.startsWith(ctx.tenantId + '::'));
    if (!row || row.status !== 'reserved') return false;
    row.status = 'processing'; row.lastError = lastError; return true;
  }
  async unsettledRefundsForTicket(ctx: CheckoutContext, ticketId: string): Promise<UnknownRefund[]> {
    const out: UnknownRefund[] = [];
    for (const row of this.refundRows.filter((r) => r.status === 'processing' && r.key.startsWith(ctx.tenantId + '::'))) { const u = await this.unknownRefund(ctx, row.id); if (u && u.ticketId === ticketId) out.push(u); }
    return out;
  }
  async settleUnknownRefundAtomic(ctx: CheckoutContext, refundId: string, outcome: { kind: 'refunded'; processorRefundId: string | null } | { kind: 'not_refunded' }, settledBy: string) {
    const u = await this.unknownRefund(ctx, refundId);
    if (!u) return null;
    if (outcome.kind === 'not_refunded') { await this.releaseRefund(ctx, refundId); return { refund: u, refundPaymentId: null }; }
    const r = await this.recordPayment(ctx, { paymentId: 'rp_' + Math.random().toString(36).slice(2, 10), ticketId: u.ticketId, method: u.method as any, amountCents: u.amountCents, tipCents: 0, status: 'refunded', processorTransactionId: outcome.processorRefundId || u.originalRetref || undefined, refundedCents: u.amountCents, createdAt: new Date().toISOString() });
    await this.finalizeRefund(ctx, refundId, outcome.processorRefundId || r.paymentId);
    return { refund: u, refundPaymentId: r.paymentId };
  }
  async unknownRefund(ctx: CheckoutContext, refundId: string): Promise<UnknownRefund | null> {
    const row = this.refundRows.find((r) => r.id === refundId && r.key.startsWith(ctx.tenantId + '::'));
    if (!row || row.status !== 'processing') return null;
    const p = this.P(ctx).find((x) => x.paymentId === row.paymentId);
    return { refundId: row.id, paymentId: row.paymentId, ticketId: p?.ticketId ?? '', method: p?.method ?? 'card', amountCents: row.amountCents, reason: row.reason ?? null,
      originalRetref: p?.processorTransactionId ?? null, createdAt: new Date().toISOString(), strandedAt: null, reviewReason: null, requestDetail: row.requestDetail ?? null, createdByUserId: null };
  }
  async markPaymentVoided(ctx: CheckoutContext, paymentId: string) { const p = this.P(ctx).find((x) => x.paymentId === paymentId); if (p) p.status = 'voided'; }
  async paidTotalCents(ctx: CheckoutContext, ticketId: string) { return this.P(ctx).filter((p) => p.ticketId === ticketId && (p.status === 'approved' || p.status === 'partial')).reduce((a, p) => a + (Number(p.amountCents) || 0), 0); }
  async paidBreakdown(ctx: CheckoutContext, ticketId: string) {
    const paid = this.P(ctx).filter((p) => p.ticketId === ticketId && (p.status === 'approved' || p.status === 'partial'));
    return { totalCents: paid.reduce((a, p) => a + (Number(p.amountCents) || 0), 0), surchargeCents: paid.reduce((a, p) => a + (Number(p.surchargeCents) || 0), 0) };
  }
  async recordProviderSurcharge(ctx: CheckoutContext, paymentId: string, feeCents: number): Promise<void> {
    const p = this.P(ctx).find((x) => x.paymentId === paymentId);
    if (p && feeCents > 0) { p.surchargeCents = feeCents; p.amountCents = Number(p.amountCents) + feeCents; }
  }
  async hasReceipt(ctx: CheckoutContext, ticketId: string) { return !!this.receiptTickets.get(ctx.tenantId)?.has(ticketId); }

  async devices(ctx: CheckoutContext) { return this.D(ctx).slice(); }
  async openDisplaySessionsForTicket(ctx: CheckoutContext, ticketId: string) {
    return this.S(ctx).filter((s) => s.ticketId === ticketId && s.state !== 'disconnected' && new Date(s.expiresAt).getTime() > Date.now()).map((s) => ({ sessionId: s.sessionId, deviceId: s.deviceId, state: s.state }));
  }
  async createSession(ctx: CheckoutContext, ticketId: string, deviceId: string) {
    const t = this._ticket(ctx, ticketId); const d = this.D(ctx).find((x) => x.deviceId === deviceId); if (!t || !d) return null;
    // same reservation rule as the database repository: another customer on this display → DISPLAY_BUSY; the same ticket → replaced
    const live = this.S(ctx).filter((x) => x.deviceId === deviceId && x.state !== 'disconnected' && new Date(x.expiresAt).getTime() > Date.now());
    const other = live.find((x) => x.ticketId !== ticketId); if (other) throw new DisplayBusyError(other.state);
    for (const x of live) x.state = 'disconnected';
    const s: POSCustomerDisplaySession = { sessionId: 'sess_' + (++this.seq), ticketId, ticketNumber: t.ticketNumber, deviceId, stationCode: d.stationCode, state: 'showing_ticket', selectedTipCents: t.tipCents, totalDueCents: Number((t as any).totalCents ?? 0), paymentMethod: (t as any).paymentMethod, expiresAt: minsFromNow(10), payButtonEnabled: this._settingsFull(ctx).customerDisplayMode === 'customer_pays', publicToken: 'devtoken_' + this.seq };
    this.S(ctx).push(s); return s;
  }
  private _getSession(ctx: CheckoutContext, sessionId: string) { const s = this.S(ctx).find((x) => x.sessionId === sessionId) || null; if (s && new Date(s.expiresAt).getTime() <= Date.now()) s.state = 'disconnected'; return s; }
  async getSession(ctx: CheckoutContext, sessionId: string) { return this._getSession(ctx, sessionId); }
  async updateSession(ctx: CheckoutContext, sessionId: string, patch: Partial<POSCustomerDisplaySession>) { const s = this._getSession(ctx, sessionId); if (!s) return null; Object.assign(s, patch); if (patch.selectedTipCents != null) await this.setTip(ctx, s.ticketId, patch.selectedTipCents); return s; }
  async closeSession(ctx: CheckoutContext, sessionId: string) { const s = this.S(ctx).find((x) => x.sessionId === sessionId); if (!s) return false; s.state = 'disconnected'; return true; }
  private _activeSession(ctx: CheckoutContext) { return this.S(ctx).find((s) => s.state !== 'disconnected' && new Date(s.expiresAt).getTime() > Date.now()) || null; }
  async activeSession(ctx: CheckoutContext) { return this._activeSession(ctx); }
}
