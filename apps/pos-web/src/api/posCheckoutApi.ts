// posCheckoutApi.ts — RECONCILED to the real backend controllers (checkout.controller.ts):
import type { ApplyDiscountRequest, CardPaymentRequest, CashPaymentRequest, CheckoutFilters, GiftCardPaymentRequest, PaymentMethod, ReopenServiceRequest, SendReceiptRequest, SetTipRequest, SplitPaymentRequest } from '@aipowersalon/api-contracts/tenant';
export type { ApplyDiscountRequest, CardPaymentRequest, CashPaymentRequest, CheckoutFilters, GiftCardPaymentRequest, PaymentMethod, ReopenServiceRequest, SendReceiptRequest, SetTipRequest, SplitPaymentRequest };   // the API's own contract (Constitution 13 §15) — never re-declare it here
import type { OfferReason, OfferSummary, TicketOffers, UnsettledTender } from '@aipowersalon/api-contracts/tenant';

// Nov 5 2026: the registry code rides on the error (screens branch on e.code — e.g. CHECKOUT_ALREADY_IN_PROGRESS, TECH_TIPS_NOT_CONFIRMED;
// before this the module's own error dropped it and those branches never fired)
export class ApiError extends Error {
  public code?: string;
  constructor(message: string, public status: number, public body?: any) { super(message); this.name = 'ApiError'; this.code = typeof body?.error?.code === 'string' ? body.error.code : typeof body?.code === 'string' ? body.code : undefined; }
}
function qs(f: Record<string, unknown>): string { const p = new URLSearchParams(); Object.keys(f).forEach((k) => { const v = f[k]; if (v != null && v !== '') p.set(k, String(v)); }); const s = p.toString(); return s ? '?' + s : ''; }
import { posHttp } from './client';
const idem = (k?: string): Record<string, string> => (k ? { 'Idempotency-Key': k } : {});
const CO = '/pos/checkout';
// Oct 21 2026: THE shared raw-fetch helper (client.ts posHttp) — X-Client-Type, timing, the 401 announcement; this module's own error mapping
const http = <T,>(path: string, init?: RequestInit) => posHttp<T>(path, init, { mapError: (status, body, message) => new ApiError(message, status, body) });
const CD = '/pos/customer-display';
const id = (s: string) => encodeURIComponent(s);
const tPost = (tid: string, action: string, body?: unknown) => http<any>(`${CO}/tickets/${id(tid)}/${action}`, { method: 'POST', ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
// A payment POST carrying an Idempotency-Key (Constitution 5 §61–66): a retry of the same payment whose answer was lost
// sends the same key and gets the FIRST result back instead of a 409 (the server already refuses a second settlement).
const tPostKeyed = (tid: string, action: string, body: unknown, idempotencyKey?: string) =>
  http<any>(`${CO}/tickets/${id(tid)}/${action}`, { method: 'POST', body: JSON.stringify(body), headers: idem(idempotencyKey) });

export const posCheckoutApi = {
  // reads
  state: (f: CheckoutFilters = {}) => http<any>(`${CO}/state` + qs(f as Record<string, unknown>)),
  kpis: () => http<any>(`${CO}/kpis`),
  settings: () => http<any>(`${CO}/settings`),
  tickets: (f: CheckoutFilters = {}) => http<any>(`${CO}/tickets` + qs(f as Record<string, unknown>)),
  detail: (tid: string) => http<any>(`${CO}/tickets/${id(tid)}`),
  // Attach a payment-first gift-card sale to an open ticket; the card activates when the ticket is paid.
  createGiftCardSale: (tid: string, body: { amountCents: number; customerId?: string; cardNumber?: string; pin?: string; recipient?: { name?: string; phone?: string; email?: string; message?: string } }) => http<{ code: string; reference: string; amountCents: number; status: string }>(`${CO}/tickets/${id(tid)}/gift-card-sale`, { method: 'POST', body: JSON.stringify(body) }),
  createGiftCardReload: (tid: string, body: { code: string; amountCents: number }) => http<{ reference: string; amountCents: number; balanceCents: number; status: string }>(`${CO}/tickets/${id(tid)}/gift-card-reload`, { method: 'POST', body: JSON.stringify(body) }),
  giftCardLookup: (input: string) => http<{ found: boolean; cardId?: string; reference?: string; cardNumberMasked?: string; balanceCents?: number; status?: string; redeemableHere?: boolean; viaNetwork?: boolean }>(`${CO}/gift-cards/lookup`, { method: 'POST', body: JSON.stringify({ input }) }),
  replaceGiftCard: (input: string) => http<{ ok: boolean; reason?: string; newReference?: string; newCardNumber?: string; newCardNumberMasked?: string; balanceCents?: number }>(`${CO}/gift-cards/replace`, { method: 'POST', body: JSON.stringify({ input }) }),
  signature: (tid: string) => http<{ signaturePng: string | null; capturedOn?: string | null }>(`${CO}/tickets/${id(tid)}/signature`),
  technicianSplit: (tid: string) => http<{ participantCount: number; technicians: { technicianId: string; displayName?: string; serviceEarningsCents: number; cardTipCents: number; cashTipCents: number }[] }>(`${CO}/tickets/${id(tid)}/technician-split`),
  // ticket mutations (real routes + typed bodies)
  /** Oct 6 2026: set the ticket aside / back in the queue; move it to one of this location's registers. */
  hold: (tid: string) => http<{ ticketId: string; status: string }>(`${CO}/tickets/${id(tid)}/hold`, { method: 'POST' }),
  resume: (tid: string) => http<{ ticketId: string; status: string }>(`${CO}/tickets/${id(tid)}/resume`, { method: 'POST' }),
  move: (tid: string, registerId: string) => tPost(tid, 'move', { registerId }) as Promise<{ ticketId: string; registerId: string; station: string }>,
  applyTip: (tid: string, body: SetTipRequest) => tPost(tid, 'apply-tip', body),
  applyDiscount: (tid: string, body: ApplyDiscountRequest) => tPost(tid, 'apply-discount', body),
  applyPromotion: (tid: string, code: string) => tPost(tid, 'apply-promotion', { code }),
  /** Decision 15 loyalty step: a customer's reward code (issued when they spent points). */
  applyRewardCode: (tid: string, code: string) => tPost(tid, 'reward-code', { code }),
  removeRewardCode: (tid: string) => http<any>(`${CO}/tickets/${id(tid)}/reward-code/remove`, { method: 'POST' }),
  applyDeal: (tid: string, appointmentId?: string) => tPost(tid, 'apply-deal', appointmentId ? { appointmentId } : {}),
  /** BUILD_PLAN Phase 5 — the checkout deals panel: applied, eligible (with value), not eligible (with WHY), best deal. */
  offers: (tid: string) => http<TicketOffers>(`${CO}/tickets/${id(tid)}/offers`),
  applyOffer: (tid: string, body: { dealId?: string; code?: string; couponId?: string; fromAppointment?: boolean }) => tPost(tid, 'offers', body),
  applyBestOffers: (tid: string) => http<any>(`${CO}/tickets/${id(tid)}/offers/best`, { method: 'POST', body: '{}' }),
  removeOffer: (tid: string, redemptionId: string) => http<any>(`${CO}/tickets/${id(tid)}/offers/${encodeURIComponent(redemptionId)}/remove`, { method: 'POST' }),
  recalculate: (tid: string, paymentMethod?: PaymentMethod) => tPost(tid, 'recalculate', { paymentMethod }),
  reopenService: (tid: string, body: ReopenServiceRequest) => tPost(tid, 'reopen-service', body),
  payCash: (tid: string, body: CashPaymentRequest, idempotencyKey?: string) => tPostKeyed(tid, 'pay/cash', body, idempotencyKey),
  payCard: (tid: string, body: CardPaymentRequest = {}) => tPost(tid, 'pay/card', body),
  /** Functional Decision 22: ask the processor about a charge whose answer was lost (approved / declined / failed / pending / unknown). */
  verifyCard: (tid: string) => tPost(tid, 'pay/card/verify', {}),
  /** B-81 (Oct 23 2026): every card charge still mid-air on the ticket (a POS card answer, a split / Tap to Pay attempt, a guest's app charge) */
  unsettledTenders: (tid: string) => http<UnsettledTender[]>(`${CO}/tickets/${id(tid)}/unsettled-tenders`),
  payGiftCard: (tid: string, body: GiftCardPaymentRequest, idempotencyKey?: string) => tPostKeyed(tid, 'pay/gift-card', body, idempotencyKey),
  /** Global Loyalty (Oct 30 2026): AI PowerSalon Rewards on this ticket — what may be used now + the reward already applied */
  rewardsQuote: (tid: string) => http<any>(`${CO}/tickets/${id(tid)}/rewards`),
  /** hold `blocks` × $1 of the customer's points as one tender; ONE request key per intent (a retry re-sends it) */
  payRewards: (tid: string, blocks: number, idempotencyKey: string) => http<any>(`${CO}/tickets/${id(tid)}/pay/rewards`, { method: 'POST', body: JSON.stringify({ blocks }), headers: idem(idempotencyKey) }),
  removeRewards: (tid: string) => http<any>(`${CO}/tickets/${id(tid)}/rewards/remove`, { method: 'POST', body: '{}' }),
  paySplit: (tid: string, body: SplitPaymentRequest, idempotencyKey?: string) => tPostKeyed(tid, 'pay/split', body, idempotencyKey),
  receiptSendAll: (tid: string, body: SendReceiptRequest) => tPost(tid, 'receipt/send-all', body),
  // 23-inch spec §9–§11, §82: stationId = this POS's register (its dedicated display first, else a shared one);
  // deviceId = Switch Display (exactly that display)
  sendToCustomerDisplay: (tid: string, body: { stationId?: string | null; deviceId?: string } = {}) => tPost(tid, 'send-to-customer-display', body),
  // payment-level
  // idempotencyKey: one per refund/void INTENT (newIdempotencyKey) — a retry of the same action sends the same key and gets the first answer back
  refund: (paymentId: string, body: { reason: string; managerPin?: string; amountCents?: number }, idempotencyKey?: string) => http<any>(`${CO}/payments/${id(paymentId)}/refund`, { method: 'POST', body: JSON.stringify(body), headers: idem(idempotencyKey) }),
  /** Decision 20 — how a ticket refund of amountCents splits across the original payments (read-only). */
  refundPreview: (ticketId: string, amountCents: number) => http<TicketRefundPreview>(`${CO}/tickets/${id(ticketId)}/refund-preview?amountCents=${encodeURIComponent(String(amountCents))}`),
  /** Decision 20 — refund an amount from the ticket: split proportionally, cards first, stops at the first tender that fails. */
  refundTicket: (ticketId: string, body: { reason: string; amountCents: number; serviceLineIds?: string[] }, idempotencyKey?: string) => http<TicketRefundResult>(`${CO}/tickets/${id(ticketId)}/refund`, { method: 'POST', body: JSON.stringify(body), headers: idem(idempotencyKey) }),
  // mandate P0 §228 (Oct 20 2026): refunds whose processor answer was lost wait in 'verifying'; the server's sweep settles
  // them from the processor record, or a manager does (step-up) with the processor portal open
  unsettledRefunds: (ticketId: string) => http<UnsettledRefunds>(`${CO}/tickets/${id(ticketId)}/refunds/unsettled`),
  settleRefund: (ticketId: string, refundId: string, body: { outcome: 'refunded' | 'not_refunded'; processorRefundId?: string; note: string }, idempotencyKey?: string) => http<{ settled: boolean; status: 'refunded' | 'released' | 'not_processing' }>(`${CO}/tickets/${id(ticketId)}/refunds/${id(refundId)}/settle`, { method: 'POST', body: JSON.stringify(body), headers: idem(idempotencyKey) }),
  void: (paymentId: string, body: { reason: string; managerPin?: string }, idempotencyKey?: string) => http<any>(`${CO}/payments/${id(paymentId)}/void`, { method: 'POST', body: JSON.stringify(body), headers: idem(idempotencyKey) }),
  // customer display
  display: {
    devices: () => http<any[]>(`${CD}/devices`),
    createSession: (ticketId: string, deviceId: string) => http<any>(`${CD}/sessions`, { method: 'POST', body: JSON.stringify({ ticketId, deviceId }) }),
    updateSession: (sessionId: string, patch: Record<string, unknown>) => http<any>(`${CD}/sessions/${id(sessionId)}`, { method: 'PATCH', body: JSON.stringify(patch) }),
    closeSession: (sessionId: string) => http<any>(`${CD}/sessions/${id(sessionId)}/close`, { method: 'POST' }),
    /** Oct 21 2026: call off the terminal prompt in progress for this session (the guest walked away / chose cash) */
    cancelTerminal: (sessionId: string) => http<{ cancelled: boolean; reason?: string }>(`${CD}/sessions/${id(sessionId)}/cancel-terminal`, { method: 'POST' }),
  },
};

export interface TicketRefundPreview {
  ticketId: string; amountCents: number; refundableCents: number;
  allocations: { paymentId: string; method: string; amountToRefundCents: number; giftCardLast4?: string }[];
  tenders: { paymentId: string; method: string; amountCents: number; refundedCents: number; remainingCents: number; giftCardLast4?: string }[];
  /** BUILD_PLAN Phase 5: each service and what it was actually paid — after its discounts, with the tax on that (a service refund returns THAT) */
  lines?: { serviceLineId: string; serviceName: string; priceCents: number; netCents: number; taxCents?: number; paidCents?: number }[];
}
export interface UnsettledRefunds {
  ticketId: string;
  refunds: { refundId: string; paymentId: string; method: string; amountCents: number; reason: string | null; createdAt: string; strandedAt: string | null; reviewReason: string | null; canSettle: boolean }[];
}
export interface TicketRefundResult {
  ticketId: string; requestedCents: number; refundedCents: number; complete: boolean;
  tenders: { paymentId: string; method: string; amountCents: number; status: string; refundId?: string; error?: string; giftCardLast4?: string; approvalId?: string }[];   // approval_pending + approvalId: sent to the salon's Approvals (Phase 9)
}

// BUILD_PLAN Phase 5 — the deals panel's shapes (the server's DealsCheckoutService.panel)
export type { OfferReason, OfferSummary, TicketOffers };   // the API's own contract — never re-declared here
