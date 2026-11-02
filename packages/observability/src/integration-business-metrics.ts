// integration-business-metrics.ts — wave 3 PAYI (Payments/Twilio mandate §104 / §105): business counters for the payment and
// messaging domains, separate from the transport-level provider telemetry (provider-telemetry.ts: calls / failures /
// timeouts / latency / breaker per provider, §103).
//
//   aipowersalon_payment_events_total{event}    attempt · approved · declined · unknown · refund · void · terminal_offline · terminal_busy
//   aipowersalon_payment_device_events_total{event}   Secure Tap to Pay §51 (Oct 26 2026): registered · approved · suspended ·
//                                               revoked · compromised · renamed · claim_conflict · revoked_device_attempt ·
//                                               key_mismatch · request_replayed · app_version_refused · attestation_passed ·
//                                               attestation_failed · attestation_unverifiable · unusual_registration (Oct 27)
//   aipowersalon_payment_device_app_version_total{version}  the app versions payment phones report (major.minor, ≤ 40, else 'other')
//   aipowersalon_messaging_events_total{event}  segments_sent · delivered · failed · verification_attempt · verification_success ·
//                                               rate_limited · opt_out
//
// Controlled dimensions only (§103): the event name is a closed vocabulary — never a tenant id, phone number, amount or
// provider error text. Per-tenant money and message history stays in PostgreSQL (payments, notifications, sms ledgers);
// these counters are for alerting ("declines spiking", "unknowns > 0", "opt-outs after a campaign"). Never throws.
import { registry } from './metrics';

export const PAYMENT_BUSINESS_EVENTS = ['attempt', 'approved', 'declined', 'unknown', 'refund', 'void', 'terminal_offline', 'terminal_busy', 'cancelled'] as const;
export type PaymentBusinessEvent = (typeof PAYMENT_BUSINESS_EVENTS)[number];
export const MESSAGING_BUSINESS_EVENTS = ['segments_sent', 'delivered', 'failed', 'verification_attempt', 'verification_success', 'rate_limited', 'opt_out'] as const;
export type MessagingBusinessEvent = (typeof MESSAGING_BUSINESS_EVENTS)[number];

export const paymentBusinessEvents = registry.counter('aipowersalon_payment_events_total', 'Payment business events (attempts, approvals, declines, unknown outcomes, refunds, voids, terminal offline/busy)', ['event']);
export const messagingBusinessEvents = registry.counter('aipowersalon_messaging_events_total', 'Messaging business events (segments sent, delivered, failed, verification attempts/successes, rate-limit hits, opt-outs)', ['event']);

export const PAYMENT_DEVICE_EVENTS = ['registered', 'approved', 'suspended', 'revoked', 'compromised', 'renamed', 'claim_conflict', 'revoked_device_attempt', 'key_mismatch', 'request_replayed', 'app_version_refused', 'attestation_passed', 'attestation_failed', 'attestation_unverifiable', 'unusual_registration'] as const;
export type PaymentDeviceEvent = (typeof PAYMENT_DEVICE_EVENTS)[number];
export const paymentDeviceEvents = registry.counter('aipowersalon_payment_device_events_total', 'Tap to Pay payment-phone events (registrations, approvals, revocations, claim conflicts, refused revoked / mis-signed / replayed / outdated requests, attestation verdicts)', ['event']);
export const paymentDeviceAppVersions = registry.counter('aipowersalon_payment_device_app_version_total', 'App versions reported by Tap to Pay payment phones (major.minor; bounded)', ['version']);

const PAY = new Set<string>(PAYMENT_BUSINESS_EVENTS);
const DEV = new Set<string>(PAYMENT_DEVICE_EVENTS);
const devCounts = new Map<string, number>();
const versionCounts = new Map<string, number>();
const MAX_VERSIONS = 40;
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

/** Secure Tap to Pay §51: count one payment-device event. Unknown names are dropped (bounded vocabulary). Never throws. */
export function recordPaymentDeviceEvent(event: PaymentDeviceEvent, n = 1): void {
  try {
    if (!DEV.has(event) || !Number.isFinite(n) || n <= 0) return;
    paymentDeviceEvents.inc({ event }, n);
    devCounts.set(event, (devCounts.get(event) ?? 0) + n);
  } catch { /* metrics never break a request */ }
}
/** The version label: 'major.minor' of a dotted numeric version, 'other' for anything else or past the bound. */
export function paymentAppVersionLabel(version: string): string {
  const m = /^\s*v?(\d{1,4})\.(\d{1,4})(?:\.\d{1,6})?\s*$/.exec(String(version ?? ''));
  if (!m) return 'other';
  const label = `${Number(m[1])}.${Number(m[2])}`;
  return versionCounts.has(label) || versionCounts.size < MAX_VERSIONS ? label : 'other';
}
/** §51 app-version distribution: one report (registration / heartbeat) from a payment phone. Never throws. */
export function recordPaymentDeviceAppVersion(version: string): void {
  try {
    const label = paymentAppVersionLabel(version);
    paymentDeviceAppVersions.inc({ version: label });
    versionCounts.set(label, (versionCounts.get(label) ?? 0) + 1);
  } catch { /* metrics never break a request */ }
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
export function integrationBusinessCounts(): { payments: Record<string, number>; messaging: Record<string, number>; paymentDevices: Record<string, number>; paymentAppVersions: Record<string, number> } {
  return { payments: Object.fromEntries(payCounts), messaging: Object.fromEntries(msgCounts), paymentDevices: Object.fromEntries(devCounts), paymentAppVersions: Object.fromEntries(versionCounts) };
}
/** Tests only. */
export function resetIntegrationBusinessCountsForTests(): void { payCounts.clear(); msgCounts.clear(); devCounts.clear(); versionCounts.clear(); }
