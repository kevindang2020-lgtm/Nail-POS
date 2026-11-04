// checkout.dto.ts — AIPowerSalon Checkout & Payment full workflow (/pos/checkout).
// Extends checkout-display.dto.ts (dual-screen + totals). Reuses computeTotals so money math never drifts.
// Context (tenant/branch/role/permissions) comes from the session — NEVER a frontend tenantId.

import type { CheckoutFilters, SetTipRequest, ApplyDiscountRequest, CashPaymentRequest, CardPaymentRequest, GiftCardPaymentRequest, SplitPaymentRequest, SendReceiptRequest, ReopenServiceRequest } from '@aipowersalon/api-contracts/tenant';
export type { CheckoutFilters, SetTipRequest, ApplyDiscountRequest, CashPaymentRequest, CardPaymentRequest, GiftCardPaymentRequest, SplitPaymentRequest, SendReceiptRequest, ReopenServiceRequest };   // owned by packages/api-contracts (Constitution 13 §13)
import type { ReadyStatus } from '@aipowersalon/api-contracts/tenant';
export type { ReadyStatus };   // owned by packages/api-contracts (Constitution 13 §13)
import {
  Money, PaymentMethod, CheckoutSettings, CheckoutTotals,
  computeTotals, tipForPercent, centsToUsd,
} from "./checkout-display.dto";
import { cardPointeConfigured } from '@aipowersalon/payments';

export type Role = "OWNER" | "MANAGER" | "FRONT_DESK" | "RECEPTION" | "TECHNICIAN" | "CUSTOMER" | "SUPER_ADMIN";
export type DisplayConnState = "idle" | "showing_ticket" | "payment_processing" | "payment_success" | "payment_failed" | "disconnected";

export interface PosContext { tenantId: string; branchId: string; userId: string; role: Role; permissions: string[]; }

export interface ReadyCheckoutTicketRow {
  ticketId: string; ticketNumber: string; customerId: string; customerName: string; customerInitials: string;
  customerPhone?: string; isVip: boolean; stationLabel?: string; completedServiceCount: number;
  finishedAt: string; estimatedTotalCents: Money; status: ReadyStatus;
}
export interface CheckoutTicketDetail {
  ticketId: string; ticketNumber: string;
  customer: { customerId: string; fullName: string; initials: string; phone?: string; email?: string; isVip: boolean; loyaltyTier?: string; loyaltyPoints?: number; visitCount?: number; preferredTechName?: string };
  stationLabel?: string;
  completedServices: { serviceLineId: string; serviceName: string; category?: string; technicianId?: string; technicianName?: string; priceCents: Money; qty?: number; status: "done" }[];
  promotion?: { code: string; amountCents: Money } | null;
  /** BUILD_PLAN Phase 5: every discount on the ticket, itemized (category, label, amount, which deal). */
  discounts?: { category: string; label: string; amountCents: Money; dealId: string | null; redemptionId: string | null }[];
  discountSnapshot?: any;
  /** the compensation authority's answer (Oct 13 2026): 'snapshot' = the paid ticket's immutable snapshot, 'engine' = live estimate */
  commission?: { rows: { name: string; nameCode?: 'technician' | 'unassigned' | null; role: string; roleCode?: 'primary' | 'assist'; percent: number }[]; estimatedPayoutCents: Money; source?: 'snapshot' | 'engine' } | null;
  technicians: { primary?: { technicianId: string; name: string }; helpers: { technicianId: string; name: string }[] };
  finishedAt: string;
  qualitySummary: { serviceCompleted: boolean; customerReady: boolean; qualityChecked: boolean; noOpenIssues: boolean; approved: boolean };
  serviceNotes?: string;
  totals: CheckoutTotals;
  receiptDeliveryOptions: { sms: boolean; email: boolean; app: boolean; print: boolean };
  /** Checkout One-Screen mandate §24–§27 (Oct 28 2026): the tenders on this ticket as the server records them — safe
   *  fields only (no token, no processor reference). paidCents = the canonical paid read (approved + partial);
   *  balanceCents = totalDue − paid, never below 0. The workspace shows partial payment and split progress from these. */
  tenders?: { paymentId: string; method: PaymentMethod; amountCents: Money; tipCents: Money; status: PaymentRecord['status']; createdAt: string; last4?: string | null; surface?: PaymentSurface | null }[];
  paidCents?: Money;
  balanceCents?: Money;
}
export interface CheckoutKpis { readyForCheckoutCount: number; subtotalTodayCents: Money; tipsTodayCents: Money; cardSurchargeCollectedCents: Money; }

export interface PaymentResult { paymentId: string; ticketId: string; status: "approved" | "declined" | "processing" | "cancelled"; processorTransactionId?: string; approvedAmountCents?: Money; }

// ===== pure helpers (unit-testable) =====

// a ticket belongs in the checkout list when it's ready and unpaid
// subtotal from completed service lines
export function subtotalFromLines(lines: { priceCents: Money }[]): Money {
  return lines.reduce(function (a, l) { return a + l.priceCents; }, 0);
}
// Pure: upsell capture = share of the day's paid tickets that carried at least one add-on line. Whole percent; 0 when
// there are no paid tickets (the UI then shows "pending data" rather than a divide-by-zero).
export function computeUpsellCapturePercent(ticketsWithAddOn: number, paidTickets: number): number {
  if (!(paidTickets > 0)) return 0;
  return Math.round((Math.max(0, ticketsWithAddOn) / paidTickets) * 100);
}
/** D2 Services (Nov 4 2026): the part of the discounted subtotal that is taxed. A line marked not taxable (its service's
 *  setting, copied onto the line when it was rung up) is left out; the ticket discount is shared across lines by price.
 *  When every line is taxable this is EXACTLY the discounted subtotal — the number every ticket was taxed on before. */
export function taxableSubtotal(lines: { priceCents: Money; taxable?: boolean }[], discountCents: Money): Money {
  const gross = lines.reduce((a, l) => a + l.priceCents, 0);
  const eff = Math.max(0, gross - (discountCents || 0));
  const taxGross = lines.reduce((a, l) => a + (l.taxable === false ? 0 : l.priceCents), 0);
  if (taxGross === gross) return eff;
  if (gross <= 0) return 0;
  return Math.round((eff * taxGross) / gross);
}
// totals per chosen payment method — card carries surcharge, cash/gift do not (reuses computeTotals)
export function totalsForMethod(subtotalCents: Money, tipCents: Money, settings: CheckoutSettings, method: PaymentMethod, giftCardChargeCents: Money = 0, taxableCents?: Money): CheckoutTotals {
  const t = computeTotals(subtotalCents, tipCents, settings, method, giftCardChargeCents, taxableCents);
  t.paymentMethod = method;
  return t;
}
// gift card: apply balance against the total due, return what's applied + what's left to pay + remaining gift balance
export function applyGiftCard(totalDueCents: Money, giftBalanceCents: Money): { appliedCents: Money; remainingDueCents: Money; giftRemainingCents: Money } {
  const applied = Math.max(0, Math.min(totalDueCents, giftBalanceCents));
  return { appliedCents: applied, remainingDueCents: totalDueCents - applied, giftRemainingCents: giftBalanceCents - applied };
}
// (BUILD_PLAN Phase 9: canTakePayment(role, …) was removed — no caller outside its own spec, and it decided by role NAME
// (OWNER always true). Taking payment is pos.checkout.take_payment on the route; a technician also needs the salon's flag.)
export function requirePermission(permissions: string[], key: string): boolean { return permissions.indexOf(key) >= 0; }
// reopen rules: blocked while processing or once paid (paid needs the refund flow instead)
export function canReopenService(paymentStatus: string, permissions: string[]): { ok: boolean; reason?: string } {
  if (!requirePermission(permissions, "checkout.reopen_service")) return { ok: false, reason: "NO_PERMISSION" };
  if (paymentStatus === "processing") return { ok: false, reason: "PAYMENT_PROCESSING" };
  if (paymentStatus === "paid") return { ok: false, reason: "ALREADY_PAID_USE_REFUND" };
  return { ok: true };
}
// idempotency: stable per (ticket, method, locked total) so retries dedupe but a changed total is a new attempt
/** Smooth Refresh spec §76: another station changed this visit's payments between reading what was due and paying. */
/** Check-In & Display spec §85–§86, §180: the customer display is showing ANOTHER customer's checkout. 409; the POS
 *  offers "Continue checkout on POS" or cancelling the display session — the other customer is never displaced. */
export class DisplayBusyError extends Error {
  readonly code = 'DISPLAY_BUSY' as const;
  constructor(public readonly busyState: string | null) {
    super(busyState === 'payment_processing'
      ? 'The customer display is processing another customer\'s payment. Continue this checkout on the POS, or wait for it to finish.'
      : 'The customer display is showing another customer\'s checkout. Continue on the POS, or close that display session first.');
    this.name = 'DisplayBusyError';
  }
}

/** Dual-Screen mandate §104 (Oct 12 2026): a customer-display refusal with its STANDARD code (packages/api-contracts
 *  ERROR_REGISTRY) — no display for this register, the display offline / in maintenance (`reason`), a display that is not
 *  this branch's (§105), a display session that does not exist. The POS reacts to the code; every one of them means
 *  "continue the checkout on the POS" (§86). */
export type CustomerDisplayErrorCode = 'CUSTOMER_DISPLAY_NOT_CONFIGURED' | 'CUSTOMER_DISPLAY_OFFLINE' | 'DISPLAY_CONTEXT_MISMATCH' | 'DISPLAY_SESSION_NOT_FOUND' | 'DISPLAY_SESSION_EXPIRED';
const DISPLAY_ERROR_STATUS: Record<CustomerDisplayErrorCode, number> = {
  CUSTOMER_DISPLAY_NOT_CONFIGURED: 409, CUSTOMER_DISPLAY_OFFLINE: 409, DISPLAY_CONTEXT_MISMATCH: 403, DISPLAY_SESSION_NOT_FOUND: 404, DISPLAY_SESSION_EXPIRED: 410,
};
export class CustomerDisplayError extends Error {
  readonly status: number;
  constructor(readonly code: CustomerDisplayErrorCode, message: string, readonly reason?: string) {
    super(message); this.name = 'CustomerDisplayError'; this.status = DISPLAY_ERROR_STATUS[code];
  }
}

/** Another payment holds this ticket right now — the customer's card on the terminal (from the display) or another
 *  front-desk payment (Oct 6 2026: one payment at a time per ticket). Nothing was recorded; try again when it finishes. */
export class PaymentInProgressError extends Error {
  readonly code = 'PAYMENT_IN_PROGRESS' as const;
  constructor(message: string) { super(message); this.name = 'PaymentInProgressError'; }
}
export class CheckoutInProgressError extends Error {
  readonly code = 'CHECKOUT_ALREADY_IN_PROGRESS' as const;
  constructor() { super('This ticket was just paid or changed on another station. The checkout has been refreshed.'); this.name = 'CheckoutInProgressError'; }
}
export function buildIdempotencyKey(ticketId: string, method: PaymentMethod, lockedTotalCents: Money): string {
  return ticketId + ":" + method + ":" + lockedTotalCents;
}
// never charge a stale total: the locked amount must equal the current computed amount
export function isTotalLocked(lockedTotalCents: Money | null, currentTotalCents: Money): boolean {
  return lockedTotalCents !== null && lockedTotalCents === currentTotalCents;
}
// tenant-scoped search over the ready list (ticket #, name, phone, station)
export function searchReadyTickets(rows: ReadyCheckoutTicketRow[], q: string): ReadyCheckoutTicketRow[] {
  const s = (q || "").trim().toLowerCase(); if (!s) return rows;
  return rows.filter(function (r) {
    return r.ticketNumber.toLowerCase().indexOf(s) >= 0 || r.customerName.toLowerCase().indexOf(s) >= 0 ||
      (r.customerPhone || "").toLowerCase().indexOf(s) >= 0 || (r.stationLabel || "").toLowerCase().indexOf(s) >= 0;
  });
}
export { centsToUsd, tipForPercent };

// ===== §8/§9/§10/§13 additions: full state, devices/sessions, payment records, request bodies =====
export type TicketStatus = "ready_for_payment" | "sent_to_customer_display" | "payment_in_progress" | "paid" | "failed" | "reopened" | "on_hold";   // on_hold: Hold Ticket (Oct 6 2026)
export type FiservStatus = "connected" | "sandbox" | "not_configured" | "degraded" | "down";
// Sandbox is an EXPLICIT test mode (env-gated) that records clearly-marked simulated approvals so the non-cash money-paths
// can be exercised end-to-end before a real Fiserv MID is wired. The default stays "not_configured" (no fake approvals).
export function resolvePaymentStatus(): FiservStatus {
  if (cardPointeConfigured()) return "connected";
  return process.env.PAYMENTS_SANDBOX === "1" ? "sandbox" : "not_configured";
}
export function cardProcessingEnabled(s: FiservStatus): boolean { return s === "connected" || s === "sandbox"; }
export function isSandbox(s: FiservStatus): boolean { return s === "sandbox"; }
export function processorTxnId(s: FiservStatus, idem: string): string { return (s === "sandbox" ? "sbx_" : "txn_") + idem; }

export interface POSCheckoutTicketRow {
  ticketId: string; ticketNumber: string; tenantId: string; branchId?: string; customerId?: string; customerName: string;
  customerPhone?: string; isVip?: boolean; station?: string; serviceCount: number; completedAt: string; finishedAt?: string;
  subtotalCents: Money; tipCents?: Money; tipType?: 'none' | 'percent' | 'custom'; tipPercent?: number | null; taxCents?: Money; surchargeCents?: Money; discountCents?: Money; totalDueCents: Money;
  status: TicketStatus; primaryTechnicianName?: string; helperTechnicianName?: string; servicesLabel?: string;
}

export interface POSCheckoutKpisFull {
  ticketsReadyForPayment: number; subtotalCents: Money; tipsTodayCents: Money; cardSurchargeCollectedCents: Money;
  taxCollectedCents: Money; paidTicketsToday: number; failedPaymentsToday: number; customerDisplayActiveSessions: number;
  /** Checkout One-Screen mandate §16 (Oct 28 2026): paid tickets today with at least one REAL receipt delivery (sent, or
   *  saved to the customer's app) ÷ paid tickets today, in %. 0 with `receiptDeliveryEligible` 0 = no paid ticket yet. */
  receiptDeliveryRatePercent: number;
  /** The denominator of receiptDeliveryRatePercent (paid tickets today). */
  receiptDeliveryEligible?: number;
  /** §16: tenders whose money question is still open in this branch, any age — POS card 'processing', payment_attempts in
   *  flight / timed out / unknown, an app charge sent and unanswered (the unsettled-payment guard's sources).
   *  null = the read failed (the board says so in Transactions Needing Attention; never a silent 0). */
  pendingPaymentsToday?: number | null;
  averageCheckoutSeconds: number;
  giftCardLoyaltyRedemptionsCents: Money;
  upsellCapturePercent: number;
}

export interface POSCustomerDisplayDevice {
  deviceId: string; label: string;
  /** 23-inch spec §10: the register (pos_stations.id) this display is DEDICATED to — '' when it is SHARED by the branch */
  stationCode: string;
  paired: boolean; lastSeenAt?: string;
  /** §83–§85: heard from within the online window (its heartbeat), and the owner's maintenance switch */
  online?: boolean; maintenance?: boolean;
}
/** POST /pos/checkout/tickets/:ticketId/send-to-customer-display — 23-inch spec §9–§11, §82. `stationId`: this POS's
 *  register (its dedicated display is used first); `deviceId`: Switch Display — exactly that display. Both optional. */
export interface SendToDisplayRequest { stationId?: string | null; deviceId?: string | null }
/** A checkout open on a display (Switch Display moves it; it is never on two displays at once). */
export interface OpenDisplaySession { sessionId: string; deviceId: string; state: string }
export interface POSCustomerDisplaySession {
  sessionId: string; ticketId: string; ticketNumber: string; deviceId: string; stationCode: string;
  state: DisplayConnState; selectedTipCents: Money; totalDueCents: Money; paymentMethod?: PaymentMethod; expiresAt: string; payButtonEnabled: boolean; publicToken?: string;
}

export interface PaymentRecord {
  paymentId: string; ticketId: string; method: PaymentMethod; amountCents: Money; tipCents: Money; surchargeCents?: Money;
  /** "failed": the charge never reached the processor (verified by inquiry, Functional Decision 22) — the claim is released. */
  status: "approved" | "declined" | "processing" | "voided" | "refunded" | "partial" | "not_configured" | "failed";
  processorTransactionId?: string; changeDueCents?: Money; refundedCents?: Money; createdAt: string; idempotencyKey?: string;
  /** gift-card payments: the last four of the card that paid (its printed number's, or its code's) — Oct 6 2026 */
  giftCardLast4?: string;
  /** Owner & Manager Payment App mandate §66/§221 (migration 660): the surface that took it — an ANALYTICS dimension on the
   *  one payments row (never a second transaction); the registered mobile device that captured it; §82 safe card metadata. */
  paymentSurface?: PaymentSurface; deviceId?: string; cardBrand?: string; cardLast4?: string;
}
/** §66: normalized payment surfaces. NULL on older rows = 'pos'. */
export type PaymentSurface = 'pos' | 'clover_compact' | 'cardpointe_terminal' | 'tap_to_pay_iphone' | 'customer_display' | 'cash' | 'manual_external' | 'online';

export interface POSCheckoutPaymentSettingsFull {
  cardEnabled: boolean; cashEnabled: boolean; giftCardEnabled: boolean; splitPaymentEnabled: boolean;
  cardSurchargeEnabled: boolean; cardSurchargePercent: number; taxRatePercent: number; tipsEnabled: boolean;
  defaultTipPercents: number[]; allowCustomTip: boolean; allowNoTip: boolean;
  customerDisplayMode: "review_only" | "customer_pays"; fiservStatus: FiservStatus;
}
export interface CheckoutFilterFacets { statuses: string[]; stations: string[]; technicians: string[]; paymentMethods: string[]; }

// Completed-payment analytics for the dashboard row, derived from today's approved payments (real money, integer cents).
export interface CheckoutAttentionItem { type: string; label: string; guest: string; issue: string; time: string; ticketId?: string; severity?: "info" | "warn" | "danger"; }
export interface ReadyStaffRow { technicianId?: string; name: string; initials?: string; nextAvailable: string; status: string; }
// Map a raw technician presence status to the Ready-Technicians label (null => excluded, e.g. off_shift/archived).
export function staffStatusLabel(raw: string): string | null {
  const m: Record<string, string> = { available: 'Ready', busy: 'Busy', serving: 'Busy', on_break: 'Break', break: 'Break' };
  return m[(raw || '').toLowerCase()] ?? null;
}
export function buildStaffRows(techs: { id: string; name: string; baseStatus?: string }[], statusBy: Record<string, string>): ReadyStaffRow[] {
  const rows: ReadyStaffRow[] = [];
  for (const t of techs) {
    const raw = statusBy[t.id] || (t.baseStatus === 'active' ? 'available' : (t.baseStatus || ''));
    const label = staffStatusLabel(raw);
    if (!label) continue;
    rows.push({ technicianId: t.id, name: t.name, nextAvailable: raw.toLowerCase() === 'available' ? 'Now' : '—', status: label });
  }
  rows.sort((a, b) => (a.status === 'Ready' ? 0 : 1) - (b.status === 'Ready' ? 0 : 1));
  return rows;
}
/** Checkout One-Screen mandate §61 (Oct 28 2026): the Checkout board shows a compact staff panel, never 200 cards. The
 *  board carries the first STAFF_BOARD_LIMIT rows (Ready first) plus the counts for everyone; the full list is the
 *  Tech Queue / Staff screens' job. */
export const STAFF_BOARD_LIMIT = 8;
export interface StaffSummary { total: number; ready: number; busy: number; onBreak: number; shown: number }
export function capStaffRows(rows: ReadyStaffRow[], limit = STAFF_BOARD_LIMIT): { staff: ReadyStaffRow[]; staffSummary: StaffSummary } {
  const count = (st: string) => rows.filter((r) => r.status === st).length;
  const staff = rows.slice(0, Math.max(0, limit));
  return { staff, staffSummary: { total: rows.length, ready: count('Ready'), busy: count('Busy'), onBreak: count('Break'), shown: staff.length } };
}
export interface CheckoutPotentialRevenue { totalCents: Money; servicesCents: Money; retailCents: Money; tipsEstCents: Money; ticketCount: number; }
// Effective line kind: prefer the explicit line_kind; fall back to the legacy is_add_on flag.
export function effectiveLineKind(lineKind: string | null | undefined, isAddOn: boolean | null | undefined): string {
  return (lineKind || (isAddOn ? "add_on" : "service")).toLowerCase();
}
// Upsell Mix: share of upsell (non-base-service) lines by kind. Input is per-kind counts; 'service' is excluded.
export function buildUpsellMix(countsByKind: { kind: string; count: number }[]): { category: string; sharePercent: number; count: number }[] {
  const LABELS: Record<string, string> = { add_on: "Add-Ons", retail: "Retail", upgrade: "Upgrades" };
  const upsell = countsByKind.filter((c) => c.kind !== "service" && c.count > 0);
  const total = upsell.reduce((a, c) => a + c.count, 0);
  return upsell
    .map((c) => ({ category: LABELS[c.kind] || (c.kind.charAt(0).toUpperCase() + c.kind.slice(1)), count: c.count, sharePercent: total ? Math.round((c.count / total) * 1000) / 10 : 0 }))
    .sort((a, b) => b.count - a.count);
}
// buildCommissionPreview (a second per-line commission formula) was REMOVED Oct 13 2026 (FLOW D6): the ticket detail's
// commission block comes from the compensation authority (CompensationService.previewForTicket) via CheckoutService.
export interface CheckoutAnalytics {
  paymentMix: { method: string; count: number; amountCents: Money }[];
  revenueTrend: { hour: number; amountCents: Money }[];
  upsellMix: { category: string; sharePercent: number }[];
  conversionPercent: number | null;
  revenueTodayCents: Money;
  revenueTrendDeltaPercent: number | null;
  potentialRevenue: CheckoutPotentialRevenue;
}
export function buildCheckoutAnalytics(paidToday: { method: string; amountCents: Money; createdAt: string }[], extra?: Partial<CheckoutAnalytics>): CheckoutAnalytics {
  const mixMap: Record<string, { count: number; amountCents: number }> = {};
  const trendMap: Record<number, number> = {};
  for (const p of paidToday) {
    const m = p.method || 'other';
    (mixMap[m] ||= { count: 0, amountCents: 0 });
    mixMap[m].count += 1; mixMap[m].amountCents += p.amountCents || 0;
    const d = new Date(p.createdAt);
    if (!isNaN(d.getTime())) { const h = d.getHours(); trendMap[h] = (trendMap[h] || 0) + (p.amountCents || 0); }
  }
  const revenueTodayCents = paidToday.reduce((a, p) => a + (p.amountCents || 0), 0);
  return {
    paymentMix: Object.entries(mixMap).map(([method, v]) => ({ method, count: v.count, amountCents: v.amountCents })).sort((a, b) => b.amountCents - a.amountCents),
    revenueTrend: Object.keys(trendMap).map(Number).sort((a, b) => a - b).map((hour) => ({ hour, amountCents: trendMap[hour] })),
    upsellMix: extra?.upsellMix ?? [],
    conversionPercent: extra?.conversionPercent ?? null,
    revenueTodayCents,
    revenueTrendDeltaPercent: extra?.revenueTrendDeltaPercent ?? null,
    potentialRevenue: extra?.potentialRevenue ?? { totalCents: 0, servicesCents: 0, retailCents: 0, tipsEstCents: 0, ticketCount: 0 },
  };
}

export interface POSCheckoutFullState {
  kpis: CheckoutKpis;
  kpisFull: POSCheckoutKpisFull;
  kpiTrends?: Record<string, { deltaPercent: number | null; direction: "up" | "down"; text?: string }>;
  analytics: CheckoutAnalytics;
  attention: CheckoutAttentionItem[];
  staff: ReadyStaffRow[];
  /** counts for every technician on the board's branch; `staff` holds only the first STAFF_BOARD_LIMIT (§61) */
  staffSummary?: StaffSummary;
  tickets: { items: POSCheckoutTicketRow[]; pagination: { page: number; pageSize: number; totalItems: number; totalPages: number } };
  selectedTicket?: CheckoutTicketDetail;
  paymentSettings: POSCheckoutPaymentSettingsFull;
  customerDisplay: { pairedDevices: POSCustomerDisplayDevice[]; activeSession?: POSCustomerDisplaySession | null };
  filters: CheckoutFilterFacets;
}

// Gift cards (tenant-scoped, real balances on the Postgres path; see migration 033).
export interface GiftCard { code: string; balanceCents: Money; }
export interface GiftCardDetail { code: string; balanceCents: Money; initialBalanceCents: Money; status: "active" | "redeemed" | "void"; id?: string; last4?: string | null; }
export interface IssueGiftCardRequest { amountCents: Money; code?: string; customerId?: string; idempotencyKey?: string; }
// POS gift-card SALE (payment-first): creates a pending card tied to a ticket; activated when the ticket is paid.
export interface GiftCardSaleRequest { amountCents: Money; customerId?: string; cardNumber?: string; pin?: string; recipient?: { name?: string; phone?: string; email?: string; message?: string }; }
export interface GiftCardSaleResult { code: string; reference: string; amountCents: Money; status: "pending_payment"; }
export interface RefundRequest {
  reason: string; managerPin?: string; amountCents?: Money;
  /** PARTIAL refunds only (Jul 29, 2026): which service lines this refund covers, so technician commission on
   *  exactly those lines reverses (engine reverses each selected line WHOLE — line-granular by design). Ignored
   *  on a full refund (full reversal covers everything). Every id must belong to the payment's ticket. */
  serviceLineIds?: string[];
  /** partial only: whether the tip attributable to the selected lines was also refunded (default false). */
  tipRefunded?: boolean;
}
export interface VoidRequest { reason: string; managerPin?: string; }

/** Functional Decision 22 — the outcome of asking the processor about a card charge whose result was never received. */
export type CardVerificationOutcome =
  | { status: 'approved'; paymentId: string; ticketId: string; processorTransactionId?: string; approvedAmountCents: number }
  | { status: 'declined'; paymentId: string; ticketId: string; processorTransactionId?: string }
  | { status: 'failed'; paymentId: string; ticketId: string; retryAllowed: true }        // never reached the processor
  | { status: 'pending'; paymentId: string; ticketId: string; retryAfterSeconds: number } // processor has no record YET
  | { status: 'unknown'; paymentId?: string; ticketId: string; reason: string }          // processor unreachable / no inquiry API
  | { status: 'none'; ticketId: string };                                                // nothing is waiting for verification

