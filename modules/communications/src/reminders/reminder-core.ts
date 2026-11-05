// Wire types owned by @aipowersalon/api-contracts/tenant (Constitution 13 §15).
export type { ReminderChannel } from '@aipowersalon/api-contracts/tenant';
import type { ReminderChannel } from '@aipowersalon/api-contracts/tenant';
// reminder-core.ts — framework-free engine for appointment reminders. Pure functions only: no DB, no clock,
// no timezone handling (the caller resolves each appointment's absolute start time and "now" to epoch ms,
// keeping this layer deterministic and fully testable). Scheduling/triggering is an ops concern handled elsewhere.


export interface ReminderCandidate {
  appointmentId: string;
  startsAtMs: number;            // absolute appointment start (epoch ms), resolved by the caller in the salon tz
  status: string;                // appointment status; only 'booked' is eligible
  channel?: ReminderChannel;     // chosen contact channel (sms when a phone exists, else email)
  address?: string;              // recipient phone (E.164) or email
  customerName?: string;
  serviceName?: string;
  startLabel?: string;           // human label for the start time, e.g. "Tue Jun 23, 2:30 PM"
}

export interface SelectOptions {
  leadMs: number;                // how far ahead of the appointment to remind (e.g. 24h)
  windowMs: number;              // size of the firing window (e.g. one run every 1h → 1h window)
  alreadySent?: Set<string>;     // appointmentIds already reminded (idempotency)
}

// Pick the appointments whose start falls inside [now+lead, now+lead+window), are still booked, have a usable
// contact address, and haven't already been reminded. The half-open window prevents double-firing across runs.
export function selectDueReminders(cands: ReminderCandidate[], nowMs: number, opts: SelectOptions): ReminderCandidate[] {
  const from = nowMs + opts.leadMs;
  const to = from + Math.max(0, opts.windowMs);
  const sent = opts.alreadySent ?? new Set<string>();
  return cands.filter((c) =>
    c.status === 'booked' &&
    !!c.address &&
    !sent.has(c.appointmentId) &&
    c.startsAtMs >= from &&
    c.startsAtMs < to,
  );
}

// Build the reminder copy. Kept short and SMS-safe; the email path reuses the same body with a subject. The SMS
// variant carries the carrier-standard STOP opt-out line; email reminders omit it (handled via unsubscribe/opt-out).
export function buildReminderMessage(c: ReminderCandidate, salonName?: string, channel: ReminderChannel = 'sms'): string {
  const who = c.customerName?.trim() ? `Hi ${c.customerName.trim()}, ` : '';
  const salon = salonName?.trim() || 'your salon';
  const svc = c.serviceName?.trim() ? ` for ${c.serviceName.trim()}` : '';
  const when = c.startLabel?.trim() ? ` on ${c.startLabel.trim()}` : '';
  const optOut = channel === 'sms' ? ' Reply STOP to opt out.' : '';
  return `${who}this is a reminder of your appointment${svc} at ${salon}${when}. Reply to reschedule.${optOut}`.trim();
}

export function reminderSubject(salonName?: string): string {
  return `Appointment reminder${salonName?.trim() ? ` — ${salonName.trim()}` : ''}`;
}
