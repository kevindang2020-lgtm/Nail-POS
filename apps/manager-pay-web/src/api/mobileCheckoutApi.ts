// mobileCheckoutApi.ts — typed client for the Owner & Manager Payment App backend (apps/api/src/mobile-checkout).
// Every call goes through the shared `api` client, which sends the session cookie and refuses to send tenant/branch ids
// (the server derives them). Types mirror the backend DTOs so screens stay honest about what the API actually returns.
import { api } from './client';

// ── Readiness (GET /mobile-checkout/readiness) ──────────────────────────────────────────────────────────────────────
export type OverallStatus =
  | 'ready' | 'backend_unavailable' | 'update_required' | 'processor_unavailable'
  | 'device_unsupported' | 'tap_to_pay_setup_required' | 'not_ready';
export interface ReadinessCheck { key: string; ok: boolean; label: string; detail?: string; critical: boolean }
export interface ReadinessReport {
  overall: OverallStatus;
  canTakePayment: boolean;
  checks: ReadinessCheck[];
  processor?: string;
  tapToPayConfigured?: boolean;
}

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
export interface MobileQueueResult { items: MobileQueueItem[]; count: number }
export type QueueFilter = 'all' | 'ready' | 'in_service' | 'unpaid';
export type QueueSort = 'newest' | 'oldest' | 'amount';

// ── Ticket detail (GET /mobile-checkout/tickets/:id) ────────────────────────────────────────────────────────────────
// Shape matches the WIRE (mobile-checkout-ticket.ts mapper) — fixtures must mirror it. serviceLineId powers the
// partial-refund line picker; `name` never existed on the wire (a fixture-vs-wire drift bug fixed Jul 29).
export interface MobileTicketService { serviceLineId: string; serviceName: string; category?: string; qty?: number; technicianName?: string; priceCents: number }
export interface MobileTicketDetail {
  ticketId: string;
  ticketNumber?: string;
  customer?: { name?: string; phoneLast4?: string; emailMasked?: string; isVip?: boolean; loyaltyPoints?: number };
  services: MobileTicketService[];
  totals: { subtotalCents: number; discountCents: number; tipCents: number; taxCents: number; surchargeCents: number; totalDueCents: number };
  status: string;
  receiptDeliveryOptions: { sms: boolean; email: boolean; app: boolean; print: boolean };
}

export interface ReceiptResult { channel: string; configured: boolean; disabledReason?: string; delivery?: string; providerRef?: string; receiptNumber?: string }

export type CaptureOutcome = 'approved' | 'declined' | 'timeout' | 'unknown';
export interface AttemptAdvance { idempotencyKey: string; from: string; to: string; outcome?: CaptureOutcome; resolution?: string }

// ── Lock (POST/GET /mobile-checkout/tickets/:id/lock*) ──────────────────────────────────────────────────────────────
export interface LockResult { acquired: boolean; action: 'acquired' | 'refreshed' | 'taken_over'; expiresAt: string }
export interface LockStatus { locked: boolean; ownedByCaller: boolean; heldBy?: { source: string; message: string; expiresAt: string } | null }

// ── Proceed + attempts ──────────────────────────────────────────────────────────────────────────────────────────────
export type TipPreset = 'none' | 'p15' | 'p20' | 'p25' | { customCents: number };
export interface SplitSegmentPlan { amountCents: number; method: string }
export interface ProceedResult {
  canProceed: boolean;
  reason?: string;
  message?: string;
  balanceCents: number;
  idempotencyKey?: string;
  attemptState?: string;
  plannedTipCents?: number;
  plannedSplit?: { totalCents: number; segments: SplitSegmentPlan[] };
}
export interface PaymentAttempt {
  id: string;
  ticketId: string;
  amountCents: number;
  method: string;
  status: string;
  idempotencyKey: string;
  createdAt: string;
  updatedAt: string;
}

export interface AttemptReport {
  period: string;
  totalAttempts: number;
  byStatus: Record<string, number>;
  attemptedTotalCents: number;
  settledTotalCents: number;
  daily: { date: string; count: number; attemptedCents: number }[];
}

export interface BalanceSummary {
  totalDueCents: number;
  confirmedCents: number;
  inFlightCents: number;
  remainingCents: number;
  isFullyPaid: boolean;
}

export interface TicketPayment { paymentId: string; method: string; amountCents: number; tipCents: number; status: string; createdAt: string }
export const mobileCheckoutApi = {
  readiness: (deviceId?: string) => api.get<ReadinessReport>('/mobile-checkout/readiness', deviceId ? { deviceId } : undefined),
  // Register this device on sign-in (lands 'pending' until an owner/Super Admin approves it). Fire-and-forget.
  registerDevice: (body: { deviceId: string; label?: string; platform?: string; osVersion?: string; appVersion?: string; tapToPayCapable?: boolean }) =>
    api.post<{ deviceId: string; status: string }>('/mobile-checkout/device/register', body),
  // Owner device management (owner approves/revokes their own salon's pay devices; server enforces OWNER + tenant scope).
  myDevices: () => api.get<Array<{ deviceId: string; status: string; label?: string | null; platform: string; tapToPayCapable: boolean; lastSeenAt?: string | null }>>('/mobile-checkout/devices'),
  approveDevice: (deviceId: string) => api.post<{ deviceId: string; status: string }>(`/mobile-checkout/devices/${encodeURIComponent(deviceId)}/approve`, {}),
  revokeDevice: (deviceId: string) => api.post<{ deviceId: string; status: string }>(`/mobile-checkout/devices/${encodeURIComponent(deviceId)}/revoke`, {}),

  queue: (opts?: { filter?: QueueFilter; sort?: QueueSort; search?: string }) =>
    api.get<MobileQueueResult>('/mobile-checkout/queue', { filter: opts?.filter, sort: opts?.sort, search: opts?.search }),

  ticket: (ticketId: string) => api.get<MobileTicketDetail>(`/mobile-checkout/tickets/${encodeURIComponent(ticketId)}`),

  // Ticket composition (TapPay prototype pass): retail lines + discount via the canonical engines.
  retailCatalog: (search?: string) => api.get<{ products: { productId: string; name: string; retailPriceCents: number; inStock?: number | null }[] }>(`/mobile-checkout/retail-catalog${search ? `?search=${encodeURIComponent(search)}` : ''}`),
  addRetail: (ticketId: string, input: { productId: string; quantity?: number }) => api.post<{ ok: boolean }>(`/mobile-checkout/tickets/${ticketId}/retail`, input),
  applyDiscount: (ticketId: string, input: { discountCents: number; reason?: string }) => api.post<{ ok: boolean }>(`/mobile-checkout/tickets/${ticketId}/discount`, input),
  ticketBalance: (ticketId: string) => api.get<BalanceSummary>(`/mobile-checkout/tickets/${encodeURIComponent(ticketId)}/balance`),
  ticketPayments: (ticketId: string) => api.get<TicketPayment[]>(`/mobile-checkout/tickets/${encodeURIComponent(ticketId)}/payments`),
  refundPayment: (paymentId: string, body: { reason: string; amountCents?: number; serviceLineIds?: string[]; tipRefunded?: boolean }) => api.post<{ refundId?: string; status: string }>(`/mobile-checkout/payments/${encodeURIComponent(paymentId)}/refund`, body),
  voidPayment: (paymentId: string, body: { reason: string }) => api.post<{ status: string }>(`/mobile-checkout/payments/${encodeURIComponent(paymentId)}/void`, body),

  acquireLock: (ticketId: string, sessionId: string, deviceId?: string) =>
    api.post<LockResult>(`/mobile-checkout/tickets/${encodeURIComponent(ticketId)}/lock`, { sessionId, deviceId }),
  refreshLock: (ticketId: string, sessionId: string) =>
    api.post<LockResult>(`/mobile-checkout/tickets/${encodeURIComponent(ticketId)}/lock/refresh`, { sessionId }),
  releaseLock: (ticketId: string, sessionId: string, reason?: string) =>
    api.post<{ released: boolean }>(`/mobile-checkout/tickets/${encodeURIComponent(ticketId)}/lock/release`, { sessionId, reason }),
  lockStatus: (ticketId: string, sessionId?: string) =>
    api.get<LockStatus>(`/mobile-checkout/tickets/${encodeURIComponent(ticketId)}/lock`, { sessionId }),

  proceed: (ticketId: string, body: { sessionId: string; deviceId?: string; tip?: TipPreset; segments?: SplitSegmentPlan[] }) =>
    api.post<ProceedResult>(`/mobile-checkout/tickets/${encodeURIComponent(ticketId)}/proceed-to-payment`, body as unknown as Record<string, unknown>),

  createAttempt: (ticketId: string, body: { sessionId: string; idempotencyKey: string; amountCents: number; deviceId?: string }) =>
    api.post<PaymentAttempt>(`/mobile-checkout/tickets/${encodeURIComponent(ticketId)}/payment-attempts`, body),
  attemptReadiness: (idempotencyKey: string, deviceId?: string) =>
    api.post<PaymentAttempt>(`/mobile-checkout/payment-attempts/${encodeURIComponent(idempotencyKey)}/readiness`, deviceId ? { deviceId } : {}),
  cancelAttempt: (idempotencyKey: string) =>
    api.post<PaymentAttempt>(`/mobile-checkout/payment-attempts/${encodeURIComponent(idempotencyKey)}/cancel`),
  captureResult: (idempotencyKey: string, body: { outcome: CaptureOutcome; processorRef?: string; authCode?: string; brand?: string; last4?: string; capturedAmountCents?: number }) =>
    api.post<AttemptAdvance>(`/mobile-checkout/payment-attempts/${encodeURIComponent(idempotencyKey)}/capture-result`, body),
  reconcile: (idempotencyKey: string, resolution: 'confirmed' | 'declined' | 'voided') =>
    api.post<AttemptAdvance>(`/mobile-checkout/payment-attempts/${encodeURIComponent(idempotencyKey)}/reconcile`, { resolution }),
  listAttempts: (ticketId: string) =>
    api.get<PaymentAttempt[]>(`/mobile-checkout/tickets/${encodeURIComponent(ticketId)}/payment-attempts`),
  recentAttempts: async (limit = 50, opts?: { startDate?: string; endDate?: string }): Promise<PaymentAttempt[]> => {
    const params: Record<string, any> = { limit };
    if (opts?.startDate) { params.startDate = opts.startDate; params.from = opts.startDate; }
    if (opts?.endDate) { params.endDate = opts.endDate; params.to = opts.endDate; }
    try {
      const rows = await api.get<PaymentAttempt[]>('/mobile-checkout/payment-attempts', params);
      if (Array.isArray(rows)) return rows;
    } catch {
      // Endpoint may not be present in all backend builds — fall back to completed payments
    }
    const res = await api.get<{ items?: any[] }>('/mobile-checkout/payments', params);
    return (res?.items || []).map((p: any) => ({
      id: p.paymentId || p.id || String(Math.random()),
      ticketId: p.ticketId || '',
      amountCents: p.amountCents || 0,
      method: p.method || 'card',
      status: p.status === 'PAID' ? 'confirmed' : (p.status || 'ready').toLowerCase(),
      idempotencyKey: p.paymentId || p.id || '',
      createdAt: p.createdAt || new Date().toISOString(),
      updatedAt: p.createdAt || new Date().toISOString(),
    }));
  },
  report: (opts?: { period?: 'today' | '7d' | '30d' | string; startDate?: string; endDate?: string } | ('today' | '7d' | '30d')) => {
    let params: Record<string, any>;
    if (typeof opts === 'string') {
      params = { period: opts };
    } else {
      params = {
        period: opts?.period || '7d',
        ...(opts?.startDate ? { startDate: opts.startDate, from: opts.startDate } : {}),
        ...(opts?.endDate ? { endDate: opts.endDate, to: opts.endDate } : {}),
      };
    }
    return api.get<AttemptReport>('/mobile-checkout/reports', params);
  },
  sendReceipt: (ticketId: string, channel: 'sms' | 'email' | 'app', destination?: string) =>
    api.post<ReceiptResult>(`/mobile-checkout/tickets/${encodeURIComponent(ticketId)}/receipt`, { channel, destination }),
};
