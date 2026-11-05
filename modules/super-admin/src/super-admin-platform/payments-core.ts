// Pure logic for the Super Admin Payments & Transactions surface. No DB/Nest deps. Security rule (hard): this module
// only ever handles a card BRAND + LAST 4 + a gateway TOKEN — never a full PAN, which is not stored anywhere. maskCard
// composes a display string; there is deliberately no path here that could emit an unmasked card number.

export const PAYMENT_STATUS_LABELS: Record<string, string> = {
  approved: 'Approved', completed: 'Approved', captured: 'Approved', succeeded: 'Approved',
  pending: 'Pending', processing: 'Pending', authorized: 'Pending',
  declined: 'Declined', failed: 'Declined', error: 'Declined',
  refunded: 'Refunded', partially_refunded: 'Partially Refunded', voided: 'Voided', settled: 'Settled',
};

export type TxnTone = 'ok' | 'warn' | 'danger' | 'muted';

export interface TxnFacts { status: string; approved?: boolean; failed?: boolean }

// A single, testable derivation of the display status + tone. failed_at/approved_at are the robust capture signals and
// win over an ambiguous status string. "Declined" (business decline) is distinct from a technical error only by label.
export function deriveTxnStatus(p: TxnFacts): { label: string; tone: TxnTone } {
  const s = String(p.status || '').toLowerCase();
  if (p.failed) return { label: PAYMENT_STATUS_LABELS[s] || 'Declined', tone: 'danger' };
  if (s === 'refunded' || s === 'partially_refunded') return { label: PAYMENT_STATUS_LABELS[s], tone: 'warn' };
  if (s === 'voided') return { label: 'Voided', tone: 'warn' };
  if (s === 'settled') return { label: 'Settled', tone: 'ok' };
  if (p.approved || ['approved', 'completed', 'captured', 'succeeded'].includes(s)) return { label: 'Approved', tone: 'ok' };
  if (['declined', 'failed', 'error'].includes(s)) return { label: PAYMENT_STATUS_LABELS[s] || 'Declined', tone: 'danger' };
  return { label: PAYMENT_STATUS_LABELS[s] || 'Pending', tone: 'muted' };
}

// Composes a masked card label from brand + last4 ONLY. Never receives or returns a full PAN. Falls back to the raw
// method name (e.g. "Apple Pay", "Cash") when there is no card instrument.
export function maskCard(brand: string | null | undefined, last4: string | null | undefined, method?: string | null): string {
  const b = (brand || '').trim();
  const l = (last4 || '').trim().replace(/\D/g, '').slice(-4);
  if (b && l) return `${b} •••• ${l}`;
  if (l) return `•••• ${l}`;
  return (method || '—').trim() || '—';
}

// Total charged to the customer, reconciled from its parts (integer cents): amount + tip + tax + surcharge − discount.
// Surcharge = the customer-facing card surcharge (the "Processing Fee" column). Kept explicit so the UI reconciles.
export interface MoneyParts { amountCents?: number; tipCents?: number; taxCents?: number; discountCents?: number; surchargeCents?: number }
export function totalChargedCents(p: MoneyParts): number {
  const c = (n: unknown) => Math.round(Number(n) || 0);
  return c(p.amountCents) + c(p.tipCents) + c(p.taxCents) + c(p.surchargeCents) - c(p.discountCents);
}

export function pct(part: number, whole: number): number {
  if (!whole || whole <= 0) return 0;
  return Math.round((part / whole) * 1000) / 10;
}

// Masks an email to its first character + domain: "michael.t@example.com" → "m•••@example.com".
export function maskEmail(email: string | null | undefined): string {
  const e = (email || '').trim();
  const at = e.indexOf('@');
  if (at <= 0) return e ? '•••' : '—';
  return `${e[0]}•••${e.slice(at)}`;
}

// Masks a phone to its last 2 digits: "+1 (555) 345-6789" → "•••• 89".
export function maskPhone(phone: string | null | undefined): string {
  const digits = (phone || '').replace(/\D/g, '');
  if (!digits) return '—';
  return `•••• ${digits.slice(-2)}`;
}

// Refund status from refunded vs charged cents (integer). Never over-reports: capped at fully refunded.
export function refundStatusLabel(refundedCents: number, amountCents: number): string {
  const r = Math.max(0, Math.round(refundedCents || 0));
  if (r <= 0) return 'No Refund';
  if (r >= Math.round(amountCents || 0) && amountCents > 0) return 'Fully Refunded';
  return 'Partially Refunded';
}

// Per-transaction settlement is not tracked (settlements are batch-level), so this stays honest: Settled only when the
// status says so; approved-but-not-settled → Unsettled; otherwise Unknown.
export function settlementStatusLabel(status: string, approved: boolean): string {
  const s = String(status || '').toLowerCase();
  if (s === 'settled') return 'Settled';
  if (approved) return 'Unsettled';
  return 'Unknown';
}

export interface PaymentKpi { value: number | null; available: boolean }
const kpi = (v: number | null | undefined): PaymentKpi => ({ value: v == null ? null : Number(v), available: v != null });

export interface PaymentKpiRaw {
  total?: number | null; approved?: number | null; failed?: number | null; volumeCents?: number | null;
  refundVoidCount?: number | null; settledCount?: number | null; processingFeesCents?: number | null; duplicateAlerts?: number | null;
}

// Assembles the 8 headline KPIs. A missing source stays null → available:false (honest gap), never a fabricated 0.
export function assemblePaymentKpis(raw: PaymentKpiRaw): {
  totalTransactions: PaymentKpi; grossVolumeCents: PaymentKpi; approved: PaymentKpi; failedDeclined: PaymentKpi;
  refundsVoids: PaymentKpi; settled: PaymentKpi; processingFeesCents: PaymentKpi; duplicateAlerts: PaymentKpi;
} {
  return {
    totalTransactions: kpi(raw.total),
    grossVolumeCents: kpi(raw.volumeCents),
    approved: kpi(raw.approved),
    failedDeclined: kpi(raw.failed),
    refundsVoids: kpi(raw.refundVoidCount),
    settled: kpi(raw.settledCount),
    processingFeesCents: kpi(raw.processingFeesCents),
    duplicateAlerts: kpi(raw.duplicateAlerts),
  };
}

// Normalizes a raw processor event_type into a readable label + tone for the authorization/event history (§22).
// Never surfaces payloads or secrets — labels only.
const EVENT_LABELS: Record<string, string> = {
  payment_succeeded: 'Authorization approved', captured: 'Capture completed', authorized: 'Authorization approved',
  declined: 'Authorization declined', failed: 'Authorization failed',
  refund: 'Refund requested', refunded: 'Refund completed', 'refund.completed': 'Refund completed', refund_reversal: 'Refund reversed',
  voided: 'Transaction voided', reversal: 'Reversal completed', chargeback_received: 'Chargeback received',
  settlement: 'Settlement batched', 'settlement.batch': 'Settlement batched', settlement_failed: 'Settlement failed', synced: 'Synchronization completed',
  sync: 'Synchronization completed', sync_retried: 'Synchronization retried', gateway_connected: 'Gateway connected', webhook: 'Webhook received',
};
export function normalizeEventLabel(eventType: string | null | undefined): string {
  const e = String(eventType || '').toLowerCase().trim();
  if (!e) return 'Processor event';
  if (EVENT_LABELS[e]) return EVENT_LABELS[e];
  const words = e.replace(/[._]+/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}
export function eventTone(eventType: string | null | undefined): TxnTone {
  const e = String(eventType || '').toLowerCase();
  if (/(fail|declin|chargeback|error|reject)/.test(e)) return 'danger';
  if (/(revers|retr|void|dispute)/.test(e)) return 'warn';
  if (/(succeed|captur|approv|complete|settl|connect|sync)/.test(e)) return 'ok';
  return 'muted';
}
