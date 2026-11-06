// ai-review-reputation-requests.ts — PURE post-visit review-request logic. Ethical rules enforced here:
//   • NO GATING: eligibility never depends on the visit's rating/sentiment. Every eligible customer is asked — you cannot
//     route only-happy customers to public review sites or suppress requests for unhappy ones. (There is deliberately no
//     rating parameter in the eligibility function.)
//   • Consent + opt-out + quiet hours + cooldown + frequency cap are always honored.
//   • At most ONE controlled reminder.
//   • Idempotent per (tenant, appointment/visit, customer, channel) so a replayed completion event never double-sends.
import type { ReviewRequestPolicy } from './ai-review-reputation-settings';

export interface CompletedVisit { tenantId: string; branchId?: string | null; customerId: string | null; appointmentId?: string | null; ticketId?: string | null; completedAt: string; visitValueCents: number; channelContact?: boolean; timeZone?: string | null; }

export function reviewRequestIdempotencyKey(v: { tenantId: string; appointmentId?: string | null; ticketId?: string | null; customerId: string | null; channel: string }): string {
  const visit = v.appointmentId || v.ticketId || 'novisit';
  return `${v.tenantId}|${visit}|${v.customerId || 'nocust'}|${v.channel}`;
}

export interface EligibilityChecks { optedOut: boolean; lastRequestAt: string | null; requestsInPeriod: number; hasContact: boolean; }
export interface EligibilityResult { eligible: boolean; reason: string; }

/** Decide whether to send a post-visit review request. NOTE: intentionally takes no rating/sentiment — gating is forbidden. */
export function evaluateRequestEligibility(visit: CompletedVisit, config: ReviewRequestPolicy, checks: EligibilityChecks, now: Date): EligibilityResult {
  if (!config.enabled) return { eligible: false, reason: 'requests_disabled' };
  if (!visit.customerId) return { eligible: false, reason: 'no_customer' };
  if (!checks.hasContact) return { eligible: false, reason: 'no_contact_method' };
  if (checks.optedOut) return { eligible: false, reason: 'opted_out' };
  if (visit.visitValueCents < config.minVisitValueCents) return { eligible: false, reason: 'below_min_value' };
  if (checks.requestsInPeriod >= config.maxPerCustomerPerPeriod) return { eligible: false, reason: 'frequency_cap' };
  if (checks.lastRequestAt) {
    const days = (now.getTime() - new Date(checks.lastRequestAt).getTime()) / 86_400_000;
    if (days < config.cooldownDays) return { eligible: false, reason: 'cooldown' };
  }
  return { eligible: true, reason: 'ok' };
}

/** Compute a send time: apply the configured delay, then shift out of quiet hours into the next allowed window. Quiet hours
 *  are the SALON's local hours: pass its IANA time zone (Review & Reputation Settings guide, Nov 2 2026 — before this the
 *  server's own clock decided, so on a UTC host "21:00–09:00" meant 5 pm–5 am in New York). Without a zone the host's local
 *  hours are used (tests / offline). */
export function computeSendTime(completedAt: string, config: ReviewRequestPolicy, ref?: Date, timeZone?: string | null): Date {
  const base = new Date(new Date(completedAt).getTime() + config.delayMinutes * 60_000);
  void ref;
  const inQuiet = (h: number): boolean => (config.quietHoursStart <= config.quietHoursEnd
    ? h >= config.quietHoursStart && h < config.quietHoursEnd
    : h >= config.quietHoursStart || h < config.quietHoursEnd);
  if (!timeZone) {
    const t = new Date(base);
    let guard = 0;
    while (inQuiet(t.getHours()) && guard++ < 48) { t.setHours(t.getHours() + 1, 0, 0, 0); }
    return t;
  }
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', minute: 'numeric', second: 'numeric', hourCycle: 'h23' });
  const local = (d: Date) => { const p = Object.fromEntries(fmt.formatToParts(d).map((x) => [x.type, Number(x.value)])); return { h: p.hour % 24, m: p.minute, s: p.second }; };
  let t = new Date(base);
  let guard = 0;
  // step to the top of the next local hour until outside quiet hours (DST-safe: each step is computed from the zone's own clock)
  while (inQuiet(local(t).h) && guard++ < 48) { const l = local(t); t = new Date(t.getTime() + ((60 - l.m) * 60 - l.s) * 1000 - t.getMilliseconds()); }
  return t;
}

/** Is `now` inside the policy's quiet hours, in the salon's zone (host zone when none)? The sender checks this at send time
 *  too: a request scheduled for 8:55 pm that a late tick reaches at 9:05 pm waits for the morning (G8, Nov 6 2026). */
export function inQuietHours(now: Date, config: Pick<ReviewRequestPolicy, 'quietHoursStart' | 'quietHoursEnd'>, timeZone?: string | null): boolean {
  if (config.quietHoursStart === config.quietHoursEnd) return false;   // no quiet window
  let h = now.getHours();
  if (timeZone) { try { h = Number(new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', hourCycle: 'h23' }).format(now)) % 24; } catch { /* unknown zone: host hours */ } }
  return config.quietHoursStart < config.quietHoursEnd ? h >= config.quietHoursStart && h < config.quietHoursEnd : h >= config.quietHoursStart || h < config.quietHoursEnd;
}

export interface ReviewRequestState { status: string; sentAt: string | null; reminderSent: boolean; converted: boolean; optedOut: boolean; }
/** One controlled reminder: only if the first send was delivered, not converted, not opted-out, no prior reminder, and enough time passed. */
export function shouldSendReminder(req: ReviewRequestState, reminderAfterHours: number, now: Date, config: ReviewRequestPolicy): boolean {
  if (!config.oneReminder) return false;
  if (req.reminderSent || req.converted || req.optedOut) return false;
  if (req.status !== 'sent' && req.status !== 'delivered') return false;
  if (!req.sentAt) return false;
  const hours = (now.getTime() - new Date(req.sentAt).getTime()) / 3_600_000;
  return hours >= reminderAfterHours;
}
