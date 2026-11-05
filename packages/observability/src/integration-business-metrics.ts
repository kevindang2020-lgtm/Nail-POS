// integration-business-metrics.ts — wave 3 PAYI (Payments/Twilio mandate §104 / §105): business counters for the payment and
// messaging domains, separate from the transport-level provider telemetry (provider-telemetry.ts: calls / failures /
// timeouts / latency / breaker per provider, §103).
//
//   aipowersalon_payment_events_total{event}    attempt · approved · declined · unknown · refund · void · terminal_offline · terminal_busy
//   aipowersalon_messaging_events_total{event}  segments_sent · delivered · failed · verification_attempt · verification_success ·
//                                               rate_limited · opt_out
//
// Controlled dimensions only (§103): the event name is a closed vocabulary — never a tenant id, phone number, amount or
// provider error text. Per-tenant money and message history stays in PostgreSQL (payments, notifications, sms ledgers);
// these counters are for alerting ("declines spiking", "unknowns > 0", "opt-outs after a campaign"). Never throws.
import { registry } from './metrics';

export const PAYMENT_BUSINESS_EVENTS = ['attempt', 'approved', 'declined', 'unknown', 'refund', 'void', 'terminal_offline', 'terminal_busy'] as const;
export type PaymentBusinessEvent = (typeof PAYMENT_BUSINESS_EVENTS)[number];
export const MESSAGING_BUSINESS_EVENTS = ['segments_sent', 'delivered', 'failed', 'verification_attempt', 'verification_success', 'rate_limited', 'opt_out'] as const;
export type MessagingBusinessEvent = (typeof MESSAGING_BUSINESS_EVENTS)[number];

export const paymentBusinessEvents = registry.counter('aipowersalon_payment_events_total', 'Payment business events (attempts, approvals, declines, unknown outcomes, refunds, voids, terminal offline/busy)', ['event']);
export const messagingBusinessEvents = registry.counter('aipowersalon_messaging_events_total', 'Messaging business events (segments sent, delivered, failed, verification attempts/successes, rate-limit hits, opt-outs)', ['event']);

const PAY = new Set<string>(PAYMENT_BUSINESS_EVENTS);
const MSG = new Set<string>(MESSAGING_BUSINESS_EVENTS);
const payCounts = new Map<string, number>();
const msgCounts = new Map<string, number>();

/** Count one payment business event. Unknown names are dropped (bounded vocabulary). Never throws. */
export function recordPaymentEvent(event: PaymentBusinessEvent, n = 1): void {
  try {
    if (!PAY.has(event) || !Number.isFinite(n) || n <= 0) return;
    paymentBusinessEvents.inc({ event }, n);
    payCounts.set(event, (payCounts.get(event) ?? 0) + n);
  } catch { /* metrics never break a payment */ }
}

/** Count messaging business events (`segments_sent` takes the segment count as n). Never throws. */
export function recordMessagingEvent(event: MessagingBusinessEvent, n = 1): void {
  try {
    if (!MSG.has(event) || !Number.isFinite(n) || n <= 0) return;
    messagingBusinessEvents.inc({ event }, n);
    msgCounts.set(event, (msgCounts.get(event) ?? 0) + n);
  } catch { /* metrics never break a send */ }
}

/** This process's totals (System Operations). */
export function integrationBusinessCounts(): { payments: Record<string, number>; messaging: Record<string, number> } {
  return { payments: Object.fromEntries(payCounts), messaging: Object.fromEntries(msgCounts) };
}
/** Tests only. */
export function resetIntegrationBusinessCountsForTests(): void { payCounts.clear(); msgCounts.clear(); }
