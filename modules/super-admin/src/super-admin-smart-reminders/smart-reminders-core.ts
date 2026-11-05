// smart-reminders-core.ts — pure shaping for Super Admin → AI & Automation → Smart Reminders. No I/O; deterministic +
// unit-tested. Real reminder signals come from appointment_reminder_attempts (status ∈ sent|failed|blocked) and
// reminder_settings; anything the schema does not model (scheduled jobs, fallback executions, open/engagement rates,
// per-type counts) is surfaced honestly as available:false — never fabricated.
// Semantic (the good / warn / bad / neutral tone of a KPI): ONE definition, the platform contract's (Constitution 13 §15)
// — this module had its own copy (four modules did, one of them without 'warn').
export type { Semantic } from '@aipowersalon/api-contracts/platform';
import type { Semantic } from '@aipowersalon/api-contracts/platform';

// The 10 reminder types the engine supports (a real platform catalog). Per-type delivery counts are NOT tracked in
// appointment_reminder_attempts, so type cards show the catalog with counts honestly unavailable.
export const REMINDER_TYPES = [
  { key: 'appointment_confirmation', label: 'Appointment Confirmation' },
  { key: 'upcoming_appointment', label: 'Upcoming Appointment Reminder' },
  { key: 'missed_appointment_followup', label: 'Missed Appointment Follow-Up' },
  { key: 'customer_rebooking', label: 'Customer Rebooking Reminder' },
  { key: 'technician_schedule', label: 'Technician Schedule Reminder' },
  { key: 'subscription_payment', label: 'Subscription Payment Reminder' },
  { key: 'merchant_document', label: 'Merchant-Document Reminder' },
  { key: 'onboarding', label: 'Onboarding Reminder' },
  { key: 'support_ticket_update', label: 'Support Ticket Update' },
  { key: 'device_offline_alert', label: 'Device-Offline Alert' },
] as const;

export const CHANNELS = ['sms', 'email', 'push'] as const;
export const CHANNEL_LABEL: Record<string, string> = { sms: 'SMS', email: 'Email', push: 'Push', other: 'Other' };
export function channelBucket(raw: string | null | undefined): string {
  const c = (raw || '').toLowerCase().replace(/[\s-]+/g, '_');
  if (c === 'sms' || c === 'text') return 'sms';
  if (c === 'email' || c === 'mail') return 'email';
  if (c === 'push' || c === 'fcm') return 'push';
  return 'other';
}

// Attempt status → delivery bucket. 'sent' means the reminder was successfully dispatched (the platform's success
// state); 'failed' and 'blocked' are the failure/suppressed states. There is no 'pending' or 'fallback' state modelled.
export function statusBucket(raw: string | null | undefined): { key: 'delivered' | 'failed' | 'blocked'; label: string; semantic: Semantic } {
  switch ((raw || '').toLowerCase()) {
    case 'sent': case 'delivered': return { key: 'delivered', label: 'Delivered', semantic: 'good' };
    case 'blocked': case 'suppressed': return { key: 'blocked', label: 'Blocked', semantic: 'warn' };
    default: return { key: 'failed', label: 'Failed', semantic: 'bad' };
  }
}

export const pct = (part: number, whole: number): number => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0);
export const deliveryRate = (delivered: number, attempted: number): number => pct(delivered, attempted);

export function distribution<T extends { key: string; label: string; count: number }>(rows: T[], total: number): (T & { pct: number })[] {
  return rows.map((r) => ({ ...r, pct: pct(r.count, total) }));
}

export function kpiTrendSemantic(key: string, direction: 'up' | 'down' | 'flat'): Semantic {
  const upIsBad = ['failed', 'problematic', 'fallback', 'blocked'].includes(key);
  if (direction === 'flat') return 'neutral';
  const up = direction === 'up';
  return upIsBad ? (up ? 'bad' : 'good') : (up ? 'good' : 'bad');
}

export function trendDelta(current: number, prior: number): { deltaPct: number; direction: 'up' | 'down' | 'flat' } {
  if (prior === 0) return { deltaPct: current > 0 ? 100 : 0, direction: current > 0 ? 'up' : 'flat' };
  const d = Math.round(((current - prior) / prior) * 1000) / 10;
  return { deltaPct: d, direction: d > 0 ? 'up' : d < 0 ? 'down' : 'flat' };
}

// Timing helpers (Configure Default Timing). Direction + magnitude → signed minutes relative to the business event
// (negative = before, positive = after, 0 = immediate). withinRange checks the magnitude against the allowed band.
export type TimingDirection = 'before' | 'after' | 'immediate';
export function signedOffsetMinutes(direction: TimingDirection, minutes: number): number {
  if (direction === 'immediate') return 0;
  const m = Math.abs(minutes);
  return direction === 'before' ? -m : m;
}
export function withinRange(minutes: number, min: number, max: number): boolean {
  return minutes >= min && minutes <= max;
}
// Format a minute-of-day (0..1439) as HH:MM for display.
export function minuteOfDayLabel(m: number | null): string | null {
  if (m == null) return null;
  const h = Math.floor(m / 60), mm = m % 60;
  return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

// Channel + fallback resolution (Set Channels / Configure Fallback). classifyFailure maps a provider error to a
// permanent vs temporary class (§45): permanent failures are never retried; temporary ones may be. planFallback is the
// deterministic decision the dispatch pipeline consults — it STOPS on the first success (no duplicate sends), otherwise
// advances through the ordered channel sequence, and stops when the sequence is exhausted.
export type FailureKind = 'permanent' | 'temporary';
const PERMANENT = ['invalid_number', 'invalid phone', 'invalid_email', 'invalid email', 'opt_out', 'opted out', 'unsubscribe', 'unsubscribed', 'complaint', 'invalid_token', 'device token', 'unregistered', 'unsupported', 'tenant_mismatch', 'recipient_deleted', 'sender_not_authorized', 'blocked'];
export function classifyFailure(reason: string | null | undefined): FailureKind {
  const r = (reason || '').toLowerCase();
  return PERMANENT.some((p) => r.includes(p)) ? 'permanent' : 'temporary';
}

/** Ordered, de-duplicated channel sequence: primary first, then fallbacks (primary removed from fallbacks). */
export function resolveChannelSequence(primary: string, fallbacks: string[]): string[] {
  const seq = [primary, ...fallbacks.filter((c) => c !== primary)];
  return [...new Set(seq)];
}

export interface AttemptEvent { channel: string; outcome: 'success' | FailureKind }
/** Decide the next channel (or stop). Stop on first success (never send twice); otherwise the next un-attempted channel
 *  in the sequence; stop when exhausted. */
export function planFallback(sequence: string[], events: AttemptEvent[]): { nextChannel: string | null; stop: boolean; reason: string } {
  if (events.some((e) => e.outcome === 'success')) return { nextChannel: null, stop: true, reason: 'delivered' };
  const attempted = new Set(events.map((e) => e.channel));
  const next = sequence.find((c) => !attempted.has(c)) ?? null;
  if (next) return { nextChannel: next, stop: false, reason: attempted.size === 0 ? 'primary' : 'fallback' };
  return { nextChannel: null, stop: true, reason: 'exhausted' };
}
