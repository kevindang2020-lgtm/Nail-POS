// mobileCheckoutApi.ts — typed client for the Owner & Manager Payment App backend (apps/api/src/mobile-checkout).
// Every call goes through the shared `api` client, which sends the session cookie and refuses to send tenant/branch ids
// (the server derives them). Types mirror the backend DTOs so screens stay honest about what the API actually returns.
import type { ReadinessCheck, ReadinessReport } from '@aipowersalon/api-contracts/tenant';
export type { ReadinessCheck, ReadinessReport };   // the API's own contract (Constitution 13 §15) — never re-declare it here
import type { AttemptReport, BalanceSummary, CaptureOutcome, LockResult, LockStatus, MobileQueueResult, MobileTicketDetail, MobileTicketService, OverallStatus, ProceedResult, SplitSegmentPlan, TipPreset, CheckoutClaimView, MobilePaymentHistoryFilter, MobilePaymentHistoryResult, MobilePaymentHistoryRow, MobilePaymentsReport, MobilePayDeviceView, TapToPayCapabilityView } from '@aipowersalon/api-contracts/tenant';
export type { AttemptReport, BalanceSummary, CaptureOutcome, LockResult, LockStatus, MobileQueueResult, MobileTicketDetail, MobileTicketService, OverallStatus, ProceedResult, SplitSegmentPlan, TipPreset, CheckoutClaimView, MobilePaymentHistoryFilter, MobilePaymentHistoryResult, MobilePaymentHistoryRow, MobilePaymentsReport, MobilePayDeviceView, TapToPayCapabilityView };   // the API's own contract (Constitution 13 §15) — never re-declare it here
import { api } from './client';


// ── Queue (GET /mobile-checkout/queue) ──────────────────────────────────────────────────────────────────────────────
export interface MobileQueueItem {
  ticketId: string;
  ticketNumber?: string;
  customerName?: string;
  customerPhoneLast4?: string;
  servicesLabel?: string;
  totalDueCents: number;
  status: string;
  technicianName?: string;
}
export type QueueFilter = 'all' | 'ready' | 'in_progress' | 'failed';   // GET /mobile-checkout/queue accepts all|ready|in_progress|failed|paid
export type QueueSort = 'oldest' | 'newest' | 'amount_desc' | 'customer';   // the server's sorts ('amount' was refused)


export interface ReceiptResult { channel: string; configured: boolean; disabledReason?: string; delivery?: string; providerRef?: string; receiptNumber?: string }

export interface AttemptAdvance { idempotencyKey: string; from: string; to: string; outcome?: CaptureOutcome; resolution?: string }


export interface PaymentAttempt {
  id: string;
  ticketId: string;
  amountCents: number;
  method: string;
  status: string;
  idempotencyKey: string;
  createdAt: string;
  updatedAt: string;
  // mandate §65 (migration 660): the PaymentIntent fields + safe result metadata
  provider?: string | null; paymentSurface?: string | null; deviceId?: string | null; checkoutVersion?: string | null;
  processorRef?: string | null; cardBrand?: string | null; cardLast4?: string | null; paymentId?: string | null; lastErrorCode?: string | null; expiresAt?: string | null;
}
export interface AttemptRecovery extends PaymentAttempt { terminal: boolean; recoverable: boolean }
export interface AttemptVerifyResult { status: string; decision: { action: 'confirm' | 'decline' | 'release' | 'wait' | 'review'; reason?: string; detail?: string }; paymentId?: string }
export interface CashTenderResult { paymentId: string; duplicate: boolean; totalDueCents: number; paidCents: number; remainingCents: number; ticketPaid: boolean }



export interface TicketPayment { paymentId: string; method: string; amountCents: number; tipCents: number; status: string; createdAt: string }
export const mobileCheckoutApi = {
  readiness: (deviceId?: string) => api.get<ReadinessReport>('/mobile-checkout/readiness', deviceId ? { deviceId } : undefined),
  /** §19/§28: Tap to Pay ● Ready / Setup Required / Unavailable / switched off, with the provider's real capabilities. */
  capability: (deviceId?: string) => api.get<TapToPayCapabilityView>('/mobile-checkout/capability', deviceId ? { deviceId } : undefined),
  /** §149: this phone is alive (the POS "Mobile Payments ● Online" card). */
  heartbeat: (deviceId: string, appVersion?: string) => api.post<{ ok: boolean }>('/mobile-checkout/device/heartbeat', { deviceId, appVersion }),
  disableDevice: (deviceId: string, reason?: string) => api.post<{ deviceId: string; status: string }>(`/mobile-checkout/devices/${encodeURIComponent(deviceId)}/disable`, { reason }),
  /** §46: an authorized takeover of a claim held at the POS / another phone (manager override + reason). */
  takeoverLock: (ticketId: string, sessionId: string, deviceId: string | undefined, reason: string) =>
    api.post<LockResult>(`/mobile-checkout/tickets/${encodeURIComponent(ticketId)}/lock/takeover`, { sessionId, deviceId, reason }),
  /** §83–§84: the cash part of a split, recorded on the canonical checkout. */
  cashTender: (ticketId: string, body: { sessionId: string; idempotencyKey: string; amountCents: number; deviceId?: string }) =>
    api.post<CashTenderResult>(`/mobile-checkout/tickets/${encodeURIComponent(ticketId)}/cash-tender`, body, { idempotencyKey: 'ct-' + body.idempotencyKey }),   // M6-6: route-level Idempotency-Key from the logical key
  /** §130/§160: the attempt by key — restore / verify after a relaunch, never a new charge. */
  getAttempt: (idempotencyKey: string) => api.get<AttemptRecovery>(`/mobile-checkout/payment-attempts/${encodeURIComponent(idempotencyKey)}`),
  /** §76: ask the provider what became of an unresolved attempt. */
  verifyAttempt: (idempotencyKey: string) => api.post<AttemptVerifyResult>(`/mobile-checkout/payment-attempts/${encodeURIComponent(idempotencyKey)}/verify`, {}),
  /** §45: active claims in this branch (ids + labels) — the queue marks tickets another device is processing. */
  claims: () => api.get<{ ticketId: string; userId: string | null; userName: string | null; deviceId: string | null; deviceLabel: string | null; expiresAt: string }[]>('/mobile-checkout/claims'),
  /** §103–§106: Payment History from the canonical payments table. */
  payments: (f: MobilePaymentHistoryFilter = {}) => api.get<MobilePaymentHistoryResult>('/mobile-checkout/payments', f as Record<string, unknown>),
  /** §107–§110: gross sales report (never labelled payout unless settlement data exists). */
  salesReport: (period: 'today' | '7d' | '30d' = '7d') => api.get<MobilePaymentsReport>('/mobile-checkout/reports/sales', { period }),
  // Register this device on sign-in (lands 'pending' until an owner/Super Admin approves it). Secure Tap to Pay M6-4: with
  // the phone's P-256 public key (the request is signed by that key — proof of possession; device/enroll.ts) and, from a
  // POS QR, a single-use pairing code that pre-approves the phone for that location.
  registerDevice: (body: { deviceId: string; label?: string; platform?: string; osVersion?: string; appVersion?: string; tapToPayCapable?: boolean; publicKey?: string; pairingCode?: string }) =>
    api.post<{ deviceId: string; status: string }>('/mobile-checkout/device/register', body),
  // Owner device management (owner approves/revokes their own salon's pay devices; server enforces OWNER + tenant scope).
  myDevices: () => api.get<MobilePayDeviceView[]>('/mobile-checkout/devices'),
  approveDevice: (deviceId: string) => api.post<{ deviceId: string; status: string }>(`/mobile-checkout/devices/${encodeURIComponent(deviceId)}/approve`, {}),
  revokeDevice: (deviceId: string, reason?: string) => api.post<{ deviceId: string; status: string }>(`/mobile-checkout/devices/${encodeURIComponent(deviceId)}/revoke`, { reason }),

  queue: (opts?: { filter?: QueueFilter; sort?: QueueSort; search?: string }) =>
    api.get<MobileQueueResult>('/mobile-checkout/queue', { filter: opts?.filter, sort: opts?.sort, search: opts?.search }),

  ticket: (ticketId: string, sessionId?: string) => api.get<MobileTicketDetail>(`/mobile-checkout/tickets/${encodeURIComponent(ticketId)}`, sessionId ? { sessionId } : undefined),

  // Ticket composition (TapPay prototype pass): retail lines + discount via the canonical engines.
  retailCatalog: (search?: string) => api.get<{ products: { productId: string; name: string; retailPriceCents: number; inStock?: number | null }[] }>(`/mobile-checkout/retail-catalog${search ? `?search=${encodeURIComponent(search)}` : ''}`),
  addRetail: (ticketId: string, input: { productId: string; quantity?: number }) => api.post<{ ok: boolean }>(`/mobile-checkout/tickets/${ticketId}/retail`, input),
  applyDiscount: (ticketId: string, input: { discountCents: number; reason?: string }) => api.post<{ ok: boolean }>(`/mobile-checkout/tickets/${ticketId}/discount`, input),
  ticketBalance: (ticketId: string) => api.get<BalanceSummary>(`/mobile-checkout/tickets/${encodeURIComponent(ticketId)}/balance`),
  ticketPayments: (ticketId: string) => api.get<TicketPayment[]>(`/mobile-checkout/tickets/${encodeURIComponent(ticketId)}/payments`),
  // idempotencyKey: one per refund/void INTENT (newIdempotencyKey) — a retry of the same action reuses it
  refundPayment: (paymentId: string, body: { reason: string; amountCents?: number; serviceLineIds?: string[]; tipRefunded?: boolean }, idempotencyKey?: string) => api.post<{ refundId?: string; status: string }>(`/mobile-checkout/payments/${encodeURIComponent(paymentId)}/refund`, body, { idempotencyKey }),
  /** Functional Decision 20: how a refund amount would split across the ticket's original payments. */
  refundPreview: (ticketId: string, amountCents: number) => api.get<{ amountCents: number; refundableCents: number; allocations: { paymentId: string; method: string; amountToRefundCents: number; action: string }[] }>(`/mobile-checkout/tickets/${encodeURIComponent(ticketId)}/refund-preview?amountCents=${encodeURIComponent(String(amountCents))}`),
  /** Functional Decision 20: refund an amount from the ticket — the backend splits it and refunds each part to its own method. */
  refundTicket: (ticketId: string, body: { reason: string; amountCents: number }, idempotencyKey?: string) => api.post<{ requestedCents: number; refundedCents: number; complete: boolean; tenders: { paymentId: string; method: string; amountCents: number; status: string; error?: string }[] }>(`/mobile-checkout/tickets/${encodeURIComponent(ticketId)}/refund`, body, { idempotencyKey }),
  voidPayment: (paymentId: string, body: { reason: string }, idempotencyKey?: string) => api.post<{ status: string }>(`/mobile-checkout/payments/${encodeURIComponent(paymentId)}/void`, body, { idempotencyKey }),

  acquireLock: (ticketId: string, sessionId: string, deviceId?: string) =>
    api.post<LockResult>(`/mobile-checkout/tickets/${encodeURIComponent(ticketId)}/lock`, { sessionId, deviceId }),
  refreshLock: (ticketId: string, sessionId: string) =>
    api.post<LockResult>(`/mobile-checkout/tickets/${encodeURIComponent(ticketId)}/lock/refresh`, { sessionId }),
  releaseLock: (ticketId: string, sessionId: string, reason?: string) =>
    api.post<{ released: boolean }>(`/mobile-checkout/tickets/${encodeURIComponent(ticketId)}/lock/release`, { sessionId, reason }),

  proceed: (ticketId: string, body: { sessionId: string; deviceId?: string; tip?: TipPreset; segments?: SplitSegmentPlan[]; expectedVersion?: string }) =>
    api.post<ProceedResult>(`/mobile-checkout/tickets/${encodeURIComponent(ticketId)}/proceed-to-payment`, body as unknown as Record<string, unknown>),

  createAttempt: (ticketId: string, body: { sessionId: string; idempotencyKey: string; amountCents: number; deviceId?: string; expectedVersion?: string }) =>
    api.post<PaymentAttempt>(`/mobile-checkout/tickets/${encodeURIComponent(ticketId)}/payment-attempts`, body, { idempotencyKey: 'pa-' + body.idempotencyKey }),   // M6-6: the stable intent key → one HTTP identity
  attemptReadiness: (idempotencyKey: string, deviceId?: string) =>
    api.post<PaymentAttempt>(`/mobile-checkout/payment-attempts/${encodeURIComponent(idempotencyKey)}/readiness`, deviceId ? { deviceId } : {}),
  cancelAttempt: (idempotencyKey: string) =>
    api.post<PaymentAttempt>(`/mobile-checkout/payment-attempts/${encodeURIComponent(idempotencyKey)}/cancel`),
  captureResult: (idempotencyKey: string, body: { outcome: CaptureOutcome; processorRef?: string; authCode?: string; brand?: string; last4?: string; capturedAmountCents?: number; deviceId?: string }) =>
    api.post<AttemptAdvance>(`/mobile-checkout/payment-attempts/${encodeURIComponent(idempotencyKey)}/capture-result`, body, { idempotencyKey: `cr-${idempotencyKey}-${body.outcome}` }),   // M6-6: one SDK result = one HTTP identity
  report: (period: 'today' | '7d' | '30d' = '7d') =>
    api.get<AttemptReport>('/mobile-checkout/reports', { period }),
  sendReceipt: (ticketId: string, channel: 'sms' | 'email' | 'app') =>
    api.post<ReceiptResult>(`/mobile-checkout/tickets/${encodeURIComponent(ticketId)}/receipt`, { channel }),
};
