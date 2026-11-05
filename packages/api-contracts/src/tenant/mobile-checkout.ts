// GENERATED FROM apps/api by tooling/contracts/move-contracts.py, then OWNED HERE (Constitution 13 §13).
// Realm: tenant. Declaration file: types only, never emitted (see packages/api-contracts/README.md).

export type OverallStatus =
  | 'ready'
  | 'ready_with_warning'
  | 'authentication_required'
  | 'device_unsupported'
  | 'merchant_setup_required'
  | 'tap_to_pay_setup_required'
  | 'processor_unavailable'
  | 'backend_unavailable'
  | 'update_required'
  | 'setup_required'
  | 'unknown';

export interface MobileQueueResult {
  items: MobileQueueRow[];
  count: number;
  generatedAt: string;
}

export interface MobileTicketService {
  serviceLineId: string;
  serviceName: string;
  category?: string;
  technicianName?: string;
  qty: number;
  priceCents: number;
}

export interface MobileTicketDetail {
  ticketId: string;
  ticketNumber: string;
  finishedAt: string;
  stationLabel?: string;
  customer: {
    fullName: string;
    initials: string;
    phoneMasked?: string;
    emailMasked?: string;   // the receipt screen offers e-mail delivery; the source ticket always had the address
    isVip: boolean;
    loyaltyTier?: string;
    loyaltyPoints?: number;
    visitCount?: number;
    preferredTechName?: string;
  };
  services: MobileTicketService[];
  primaryTechnicianName?: string;
  discount?: { code: string; amountCents: number } | null;
  totals: {
    subtotalCents: number;
    discountCents: number;
    tipCents: number;
    taxCents: number;
    surchargeCents: number;
    totalDueCents: number;
  };
  serviceNotes?: string;
  receiptDeliveryOptions: { sms: boolean; email: boolean; app: boolean; print: boolean };
  /** Mandate §55 (wave 3 / TTP): the checkout VERSION (an ETag over services, discounts, tip, totals). The app sends it
   *  back on proceed / payment-attempt; a capture is refused with CHECKOUT_VERSION_CONFLICT when the POS changed the
   *  ticket after the phone loaded it. */
  version: string;
  /** §48/§85: what the canonical payments rows already cover (approved + partial), and the balance still due. */
  paidCents: number;
  balanceDueCents: number;
  /** §45–§46: who holds the payment claim on this ticket right now (null = nobody). */
  claim?: CheckoutClaimView | null;
}

/** §43–§46: the active payment claim (checkout lock) as every screen sees it — ids / labels only, never PII. */
export interface CheckoutClaimView {
  source: 'pos' | 'mobile' | 'display';
  ownedByCaller: boolean;
  userId?: string | null;
  userName?: string | null;
  deviceId?: string | null;
  deviceLabel?: string | null;
  expiresAt: string;
  message: string;
}

export type CaptureOutcome = 'approved' | 'declined' | 'timeout' | 'unknown';

export type TipPreset = 'none' | 'p15' | 'p20' | 'p25' | { customCents: number };

export interface SplitSegmentPlan { amountCents: number; method: string }

export interface ProceedResult extends ProceedDecision {
  idempotencyKey?: string;
  attemptState?: PaymentAttemptState;
  plannedTipCents?: number;
  plannedSplit?: { totalCents: number; segments: SplitSegmentPlan[] };
  /** §55: the checkout version the decision was made on — send it back when creating the attempt. */
  version?: string;
  /** §17/§184: the amount crossed the tenant's step-up threshold — re-authenticate before the attempt. */
  stepUpRequired?: boolean;
}

/** §103–§106: a payment row on the History screen — from the canonical payments table, never a second ledger. */
export interface MobilePaymentHistoryRow {
  paymentId: string;
  ticketId: string;
  ticketNumber?: string;
  createdAt: string;
  customerName: string;
  amountCents: number;
  tipCents: number;
  refundedCents: number;
  method: string;
  paymentSurface: string;
  cardBrand?: string | null;
  cardLast4?: string | null;
  /** PAID | PARTIALLY_REFUNDED | REFUNDED | VOIDED | UNKNOWN | DECLINED | FAILED */
  status: string;
  employeeName?: string | null;
  deviceId?: string | null;
  deviceLabel?: string | null;
  branchId?: string | null;
}
export interface MobilePaymentHistoryResult { items: MobilePaymentHistoryRow[]; count: number; generatedAt: string }
export interface MobilePaymentHistoryFilter {
  from?: string; to?: string; status?: string; method?: string; employeeId?: string; deviceId?: string; branchId?: string; surface?: string; limit?: number;
}

/** §107–§110: the mobile manager report. GROSS sales are never labelled payout — processor settlement / payout figures
 *  come only from payment_settlements (settlementKnown = false → the payout line is absent, not invented). */
export interface MobilePaymentsReport {
  period: ReportPeriod;
  from: string;
  to: string;
  grossCardSalesCents: number;
  cashSalesCents: number;
  otherSalesCents: number;
  refundsCents: number;
  tipsCents: number;
  transactionCount: number;
  averageTicketCents: number;
  bySurface: { surface: string; salesCents: number; count: number }[];
  settlementKnown: boolean;
  processorFeesCents?: number;
  netProcessorPayoutCents?: number;
}

/** §12 / §145: a registered payment device as the owner / Super Admin device-health screens see it. */
export interface MobilePayDeviceView {
  deviceId: string;
  label?: string | null;
  branchId?: string | null;
  platform: string;
  osVersion?: string | null;
  appVersion?: string | null;
  tapToPayCapable: boolean;
  status: 'pending' | 'active' | 'revoked' | 'compromised' | 'disabled';
  boundUserId?: string | null;
  boundUserName?: string | null;
  approvedAt?: string | null;
  lastSeenAt?: string | null;
  lastPaymentAt?: string | null;
  lastErrorAt?: string | null;
  lastErrorCode?: string | null;
  revokedAt?: string | null;
  revokeReason?: string | null;
  online: boolean;
  /** Secure Tap to Pay (687/688): where the phone may charge, how it was enrolled, and whether it is a shared salon phone. */
  allowedBranchIds?: string[];
  pairedVia?: string | null;
  attestationStatus?: string | null;
  shared?: boolean;
}

/** POST /mobile-checkout/devices/pairings — the single-use, 5-minute pairing code the POS shows as a QR (§7 / §70). */
export interface MobileDevicePairingResult { pairingCode: string; qrPayload: string; expiresAt: string; branchId: string; shared: boolean }
/** POST /mobile-checkout/devices/:deviceId/branches — the device after its allowed locations were replaced (§9). */
export interface MobileDeviceBranchesResult { deviceId: string; status: string; branchId?: string | null; allowedBranchIds?: string[]; shared?: boolean }

/** §19: provider capabilities as the app shows them — values come from the actual integration. */
export interface TapToPayCapabilityView {
  provider: string;
  state: 'ready' | 'setup_required' | 'unavailable' | 'disabled';
  reason?: string;
  /** §125–§126: the provider environment of this deployment — a non-production build shows a SANDBOX banner. */
  environment: 'sandbox' | 'production';
  capabilities: { tapToPay: boolean; cardPresentTerminal: boolean; refunds: boolean; voids: boolean; partialRefunds: boolean; splitPayments: boolean; tokenization: boolean; offlinePayments: boolean; statusLookup: boolean };
}

export interface AttemptReport {
  period: ReportPeriod;
  totalAttempts: number;
  byStatus: Record<string, number>;
  attemptedTotalCents: number;
  settledTotalCents: number;
  daily: { date: string; count: number; attemptedCents: number }[];
}

export interface BalanceSummary {
  totalDueCents: number;
  /** Captured by attempts that reached 'confirmed'. */
  confirmedCents: number;
  /** Reserved by not-yet-resolved attempts (created + in-flight) so a new attempt can't over-charge the same balance. */
  inFlightCents: number;
  /** totalDue − confirmed − inFlight, clamped at zero. What a NEW attempt may charge. */
  remainingCents: number;
  /** True once confirmed captures cover the whole balance. */
  isFullyPaid: boolean;
}

export interface MobileQueueRow {
  ticketId: string;
  ticketNumber: string;
  readyAt: string;
  customerName: string;
  customerPhoneMasked?: string;
  isVip: boolean;
  stationLabel?: string;
  serviceCount: number;
  servicesLabel?: string;
  technicianName?: string;
  totalDueCents: number;
  status: MobileQueueStatus;
}

// The runtime list lives in apps/api (payment-attempt-state.ts); it asserts both ways against this union, so the two cannot drift.
export type PaymentAttemptState =
  | 'created'
  | 'readiness_checking'
  | 'ready'
  | 'reader_initializing'
  | 'awaiting_customer_tap'
  | 'card_detected'
  | 'authorization_pending'
  | 'authorized'
  | 'confirmation_pending'
  | 'confirmed'
  | 'declined'
  | 'canceled'
  | 'timed_out'
  | 'failed'
  | 'unknown'
  | 'reconciliation_required'
  | 'voided'
  | 'partially_refunded'
  | 'refunded';

export interface ProceedDecision {
  canProceed: boolean;
  reason?: string;
  message?: string;
  balanceCents: number;
}

export type ReportPeriod = 'today' | '7d' | '30d';

export type MobileQueueStatus = 'ready_for_payment' | 'payment_in_progress' | 'payment_failed' | 'paid';

export interface ReadinessCheck {
  key: string;
  label: string;
  state: CheckState;
  critical: boolean;
  detail?: string;
}

export interface ReadinessReport {
  overall: OverallStatus;
  canTakePayment: boolean;
  checks: ReadinessCheck[];
  generatedAt: string;
  /** Mandate §190: why this device is refused, when it is (DEVICE_NOT_AUTHORIZED | DEVICE_REVOKED). */
  deviceBlockReason?: 'DEVICE_NOT_AUTHORIZED' | 'DEVICE_REVOKED' | 'DEVICE_NOT_REGISTERED' | 'DEVICE_PENDING_APPROVAL' | 'DEVICE_SUSPENDED' | 'DEVICE_BRANCH_NOT_AUTHORIZED';
}

export type CheckState = 'ok' | 'warn' | 'setup_required' | 'unavailable' | 'unknown';

// ── wave 3 TTP: the remaining mobile-checkout response shapes (Constitution 5 typing ratchet) ─────────────────────────
/** §149 heartbeat answer. */
export interface MobileHeartbeatResult { ok: boolean }
/** §13 / §138 a device trust change (approve / disable / revoke / compromised / reassign). */
export interface MobileDeviceStatusResult { deviceId: string; status: string }
/** POST /mobile-checkout/devices/:deviceId/rename — Secure Tap to Pay §15: the phone's new (cleaned) name. */
export interface MobileDeviceRenameResult { deviceId: string; label: string | null; status: string }
/** POST /mobile-checkout/device/attest — Secure Tap to Pay §5: the verifier's verdict ('unverifiable' = nothing stored). */
export interface MobileDeviceAttestResult { deviceId: string; verdict: 'passed' | 'failed' | 'unverifiable'; attestationStatus: 'none' | 'passed' | 'failed'; deviceStatus: string; policy: 'off' | 'enforce'; reason: string | null }
/** Secure Tap to Pay §14 / §15 / §62 (M6-6): one sign-in opened on a payment phone — the owner's device dashboard. Never a
 *  token or a full session id: `ref` is the first 8 characters, enough to match the security log. */
export interface MobileDeviceSessionRow {
  ref: string;
  userId: string;
  userName: string | null;
  branchId: string | null;
  signedInAt: string;
  lastActiveAt: string | null;
  expiresAt: string;
  revokedAt: string | null;
  state: 'active' | 'revoked' | 'expired';
}
/** §49 / §50 / §62: one audit event about (or done on) this phone — safe fields only, newest first. */
export interface MobileDeviceAuditRow {
  at: string;
  action: string;
  actorUserId: string | null;
  actorName: string | null;
  summary: string | null;
  reason: string | null;
  ticketId: string | null;
  status: string | null;
}
/** GET /mobile-checkout/devices/:deviceId/activity — owner-only (pos.devices.manage), this salon's phone only. */
export interface MobileDeviceActivity {
  deviceId: string;
  label: string | null;
  status: string;
  shared: boolean;
  sessions: MobileDeviceSessionRow[];
  audit: MobileDeviceAuditRow[];
}
/** §45 an active phone claim in this branch (ids + labels only). */
export interface MobileActiveClaim { ticketId: string; userId: string | null; userName: string | null; deviceId: string | null; deviceLabel: string | null; expiresAt: string }
/** §149 a branch payment phone for the POS "Mobile Payments" card. */
export interface MobilePaymentPhoneStatus { deviceId: string; label: string | null; userName: string | null; online: boolean; status: string; tapToPayCapable: boolean; lastSeenAt: string | null }
/** §150 send-to-phone outcome (the push may be unavailable; the queue still shows the ticket). */
export interface MobileSendToDeviceResult { sent: boolean; reason?: string }
/** §83–§84 the cash part of a split, recorded on the canonical checkout. */
export interface MobileCashTenderResult { paymentId: string; duplicate: boolean; totalDueCents: number; paidCents: number; remainingCents: number; ticketPaid: boolean }
/** §130 / §160 an attempt read back after a relaunch (never a new charge). */
export interface MobileAttemptRecoveryView {
  id: string; ticketId: string; amountCents: number; method: string; status: string; idempotencyKey: string; createdAt: string; updatedAt: string;
  provider?: string | null; paymentSurface?: string | null; deviceId?: string | null; merchantAccountId?: string | null; currency?: string | null; checkoutVersion?: string | null;
  processorRef?: string | null; cardBrand?: string | null; cardLast4?: string | null; paymentId?: string | null; lastErrorCode?: string | null; expiresAt?: string | null;
  terminal: boolean; recoverable: boolean;
}
/** §76 what the provider said about an unresolved attempt, and what the server did. */
export interface MobileAttemptVerifyResult {
  status: string;
  decision: { action: 'confirm' | 'decline' | 'release' | 'wait' | 'review'; reason?: string; detail?: string; processorRef?: string; capturedAmountCents?: number; cardBrand?: string; cardLast4?: string };
  paymentId?: string;
}

/** GET /mobile-checkout/payment-attempts — one Tap to Pay payment attempt in the History tab (safe card metadata only). */
export interface MobilePaymentAttemptView {
  id: string; ticketId: string; amountCents: number; method: string; status: string; idempotencyKey: string; createdAt: string; updatedAt: string;
  provider?: string | null; paymentSurface?: string | null; deviceId?: string | null; merchantAccountId?: string | null; currency?: string | null;
  checkoutVersion?: string | null; processorRef?: string | null; cardBrand?: string | null; cardLast4?: string | null; paymentId?: string | null;
  lastErrorCode?: string | null; expiresAt?: string | null;
}
