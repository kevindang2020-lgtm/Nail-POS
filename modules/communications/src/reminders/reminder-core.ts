// Wire types owned by @aipowersalon/api-contracts/tenant (Constitution 13 §15).
export type { ReminderChannel } from '@aipowersalon/api-contracts/tenant';
import type { ReminderChannel } from '@aipowersalon/api-contracts/tenant';
import type { AppLanguage } from '@aipowersalon/api-contracts';
// reminder-core.ts — framework-free engine for appointment reminders. Pure functions only: no DB, no clock,
// no timezone handling (the caller resolves each appointment's absolute start time and "now" to epoch ms,
// keeping this layer deterministic and fully testable). Scheduling/triggering is an ops concern handled elsewhere.


export interface ReminderCandidate {
  appointmentId: string;
  startsAtMs: number;            // absolute appointment start (epoch ms), resolved by the caller in the salon tz
  status: string;                // appointment status; 'booked' and 'confirmed' are eligible (REMINDABLE_STATUSES)
  channel?: ReminderChannel;     // chosen contact channel (sms when a phone exists, else email)
  address?: string;              // recipient phone (E.164) or email
  customerName?: string;
  serviceName?: string;
  startLabel?: string;           // human label for the start time, e.g. "Tue Jun 23, 2:30 PM" (in `language`)
  language?: AppLanguage;        // WP-I: the CUSTOMER's language (customers.preferred_language ?? English) — never staff's
  branchId?: string | null; customerId?: string | null; customerFirstName?: string | null; technicianName?: string | null; apptDate?: string; startTime?: string; services?: unknown;   // 740: a bound template's values
}

export interface SelectOptions {
  leadMs: number;                // how far ahead of the appointment to remind (e.g. 24h)
  windowMs: number;              // size of the firing window (e.g. one run every 1h → 1h window)
  alreadySent?: Set<string>;     // appointmentIds already reminded (idempotency)
}

// Pick the appointments whose start falls inside [now+lead, now+lead+window), are still booked, have a usable
// contact address, and haven't already been reminded. The half-open window prevents double-firing across runs.
/** Appointments that still expect the guest: POS Confirm and a customer reschedule set 'confirmed'. */
export const REMINDABLE_STATUSES = ['booked', 'confirmed'] as const;
export const isRemindable = (s: string) => s === 'booked' || s === 'confirmed';

export function selectDueReminders(cands: ReminderCandidate[], nowMs: number, opts: SelectOptions): ReminderCandidate[] {
  const from = nowMs + opts.leadMs;
  const to = from + Math.max(0, opts.windowMs);
  const sent = opts.alreadySent ?? new Set<string>();
  return cands.filter((c) =>
    isRemindable(c.status) &&
    !!c.address &&
    !sent.has(c.appointmentId) &&
    c.startsAtMs >= from &&
    c.startsAtMs < to,
  );
}

// Build the reminder copy. Kept short and SMS-safe; the email path reuses the same body with a subject. The SMS
// variant carries the carrier-standard STOP opt-out line (the STOP keyword stays English in every language — it is the
// carrier keyword); email reminders omit it (handled via unsubscribe/opt-out).
// ENGLISH ONLY (Kevin, Oct 28 + Nov 9 2026): customers are Americans; only the employee web POS is bilingual. The language
// arguments are kept for callers and ignored; the Vietnamese variants were deleted Nov 9 2026.
/** the rung's own words: "tomorrow" (≥ 20 h), "in about N hours" (≥ 2 h), "in N minutes" — never a bare lead number */
export function rungWords(leadMinutes: number, _language: AppLanguage = 'en'): string {
  if (leadMinutes >= 20 * 60) return leadMinutes <= 28 * 60 ? 'tomorrow' : `in ${Math.round(leadMinutes / 1440)} days`;
  if (leadMinutes >= 110) return `in about ${Math.round(leadMinutes / 60)} hours`;
  if (leadMinutes >= 55) return 'in about an hour';
  return `in ${leadMinutes} minutes`;
}
type Parts = { name: string; salon: string; svc: string; when: string; soon: string; sms: boolean };
const REMINDER_TEMPLATES: Record<'appointment_reminder.en', (p: Parts) => string> = {
  'appointment_reminder.en': (p) => `${p.name ? `Hi ${p.name}, ` : ''}this is a reminder of your appointment${p.svc ? ` for ${p.svc}` : ''} at ${p.salon || 'your salon'}${p.soon ? ` ${p.soon}` : ''}${p.when ? ` on ${p.when}` : ''}. Reply to reschedule.${p.sms ? ' Reply STOP to opt out.' : ''}`,
};
export function buildReminderMessage(c: ReminderCandidate, salonName?: string, channel: ReminderChannel = 'sms', leadMinutes?: number): string {
  const language: AppLanguage = 'en';
  return REMINDER_TEMPLATES['appointment_reminder.en']({
    name: c.customerName?.trim() ?? '', salon: salonName?.trim() ?? '', svc: c.serviceName?.trim() ?? '', when: c.startLabel?.trim() ?? '',
    soon: leadMinutes != null ? rungWords(leadMinutes, language) : '', sms: channel === 'sms',
  }).trim();
}

export function reminderSubject(salonName?: string, _language: AppLanguage = 'en'): string {
  const salon = salonName?.trim() ? ` — ${salonName.trim()}` : '';
  return `Appointment reminder${salon}`;
}
/** The app push that accompanies a reminder (lock screen: no service, no price), in the customer's language. */
export function reminderPush(salonName: string | undefined, startLabel: string | undefined, _language: AppLanguage = 'en'): { title: string; body: string } {
  const salon = salonName?.trim() ?? '', when = startLabel?.trim() ?? '';
  return { title: 'Appointment reminder', body: `Your${salon ? ' ' + salon : ''} appointment is coming up${when ? ' — ' + when : ''}.` };
}

// ── Appointment Reminders guide (747): the dispatch protocol's pure rules ────────────────────────────────────────────
/** the appointment's occurrence — its salon-local date + start time. A reschedule is a NEW occurrence (its own reminder);
 *  the same occurrence can never be claimed twice. */
export function occurrenceKey(apptDate: string | null | undefined, startTime: string | null | undefined): string {
  return `${String(apptDate ?? '').slice(0, 10)} ${String(startTime ?? '').slice(0, 5)}`;
}

/** The firing window WITHOUT the address / already-sent filters (the dispatch record decides those, and records why):
 *  booked appointments whose start lies in [now+lead, now+lead+window). Same half-open window as selectDueReminders. */
export function selectDueWindow(cands: ReminderCandidate[], nowMs: number, opts: { leadMs: number; windowMs: number }): ReminderCandidate[] {
  const from = nowMs + opts.leadMs;
  const to = from + Math.max(0, opts.windowMs);
  return cands.filter((c) => isRemindable(c.status) && c.startsAtMs >= from && c.startsAtMs < to);
}

export interface QuietHours { start: number; end: number; policy: 'defer' | 'skip' | 'send' }
/** minute-of-day of `nowMs` in `tz` */
export function localMinuteOfDay(nowMs: number, tz: string): number {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(nowMs));
    const h = Number(parts.find((p) => p.type === 'hour')?.value ?? 0), m = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
    return (h % 24) * 60 + m;
  } catch { return new Date(nowMs).getUTCHours() * 60 + new Date(nowMs).getUTCMinutes(); }
}
/** inside quiet hours? start..end are minutes of day; a span that crosses midnight (21:00–08:00) wraps. Equal = none. */
export function inQuietHours(nowMs: number, tz: string, qh: QuietHours | null | undefined): boolean {
  if (!qh || qh.start === qh.end) return false;
  const m = localMinuteOfDay(nowMs, tz);
  return qh.start < qh.end ? m >= qh.start && m < qh.end : m >= qh.start || m < qh.end;
}

/** provider outcomes the sweep may retry by itself (bounded: 3 attempts, 10-minute steps of backoff). Everything else —
 *  an invalid number, an opt-out, an interrupted send whose result is unknown — waits for a person. */
export const AUTO_RETRYABLE_REASONS = ['provider_error', 'over_limit', 'not_configured', 'send_failed'] as const;
export const MAX_AUTO_ATTEMPTS = 3;

/** what a send result means for the dispatch record */
export function classifyOutcome(res: { sent: boolean; status: string; reason?: string } | 'threw'): { state: 'submitted' | 'failed' | 'skipped'; reason: string | null } {
  if (res === 'threw') return { state: 'failed', reason: 'provider_error' };
  if (res.sent) return { state: 'submitted', reason: res.status === 'simulated' ? 'simulated' : null };
  if (res.status === 'blocked' && res.reason === 'opted_out') return { state: 'skipped', reason: 'opted_out' };
  return { state: 'failed', reason: res.reason || res.status || 'send_failed' };
}

/** words for a reason code — shown to reception ("Why did I not get my reminder?") */
export const REASON_TEXT: Record<string, string> = {
  opted_out: 'The customer replied STOP (or is opted out), so no reminder was sent.',
  no_destination: 'The customer has no phone number / email for this channel.',
  quiet_hours: 'The reminder fell in the quiet hours.',
  appointment_changed: 'The appointment was rescheduled or cancelled before the reminder went out.',
  invalid_destination: 'The number is not a valid international number (+country code missing).',
  over_limit: 'The salon was out of message credits.',
  not_configured: 'No SMS sender / email provider is set up for this salon.',
  provider_error: 'The provider did not accept the request.',
  send_failed: 'The provider did not accept the request.',
  interrupted_unknown: 'The send was interrupted; it is unknown whether the provider received it — check before retrying.',
  staff_cancelled: 'Cancelled by staff.',
  legacy_ledger: 'Recorded by the earlier reminder ledger (before Oct 31 2026): a reminder or an opt-out block.',
  simulated: 'Test mode: recorded, not sent to a real phone.',
  short_notice: 'The appointment was booked after its reminder time had passed.',
  missed_window: 'No reminder run reached this appointment inside its send window.',
};
