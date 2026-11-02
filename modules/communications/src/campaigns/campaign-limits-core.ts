import { localHour } from '@aipowersalon/date-time';
export { localHour };   // owned by @aipowersalon/date-time (Constitution 13 §87)
// campaign-limits-core.ts — the platform campaign limits, ENFORCED.
//
// campaign_limits (max sends per day, max campaigns per day, quiet hours, minimum hours between campaigns) was
// configurable in the Super Admin screen and consulted by nothing: an admin could set a 9pm–8am quiet window and
// campaigns sent at 11pm regardless. Kevin delegated the policy decisions; these are the choices, and why.
//
// 1. BLOCK, don't defer and don't just warn. A refused start is visible — the owner reads why and reschedules.
//    A deferred send fires later with nobody watching, which is exactly the surprise quiet hours exist to prevent.
//    A warning is what the salon effectively had already: a limit nobody enforces.
//
// 2. Quiet hours are judged in the SALON'S timezone. A salon's customers live near the salon, so its clock is the
//    right proxy for theirs, and it is the clock the owner was looking at when they set the window.
//
// 3. "Sends per day" counts the AUDIENCE of every campaign started today plus the one being started. It is
//    enforced BEFORE sending, when the audience is known and sent_count is not; a limit checked after the fact
//    has already been broken.
//
// 4. No limits row, or a NULL field, means that limit is not set. A read ERROR is handled by the caller, which
//    refuses the start — see campaigns.service.ts. Pure function: no clock, no I/O, fully testable.

export interface CampaignLimits {
  maxSendsPerDay: number | null;
  maxCampaignsPerDay: number | null;
  quietHoursStart: number | null;   // 0–23, salon-local
  quietHoursEnd: number | null;     // 0–23, salon-local; may be earlier than start (window wraps midnight)
  minHoursBetween: number | null;
}

export interface CampaignLimitFacts {
  campaignsStartedToday: number;
  sendsStartedToday: number;        // sum of audience sizes of campaigns started today
  lastStartedAt: Date | null;
  audienceSize: number;             // of the campaign being started
}

export type LimitVerdict =
  | { ok: true }
  | { ok: false; code: 'quiet_hours' | 'max_campaigns_per_day' | 'max_sends_per_day' | 'min_hours_between'; message: string };

/** The salon-local hour (0–23) of an instant. */

/** Is `hour` inside the quiet window? start === end means no window. start > end wraps midnight (e.g. 21→8). */
export function inQuietHours(hour: number, start: number | null, end: number | null): boolean {
  if (start == null || end == null || start === end) return false;
  return start < end ? hour >= start && hour < end : hour >= start || hour < end;
}

const pad = (h: number) => `${String(h).padStart(2, '0')}:00`;

export function checkCampaignLimits(limits: CampaignLimits | null, facts: CampaignLimitFacts, now: Date, timeZone: string): LimitVerdict {
  if (!limits) return { ok: true };

  if (inQuietHours(localHour(now, timeZone), limits.quietHoursStart, limits.quietHoursEnd)) {
    return { ok: false, code: 'quiet_hours',
      message: `Campaigns cannot start during quiet hours (${pad(limits.quietHoursStart!)}–${pad(limits.quietHoursEnd!)} salon time). Schedule it for after ${pad(limits.quietHoursEnd!)}.` };
  }
  if (limits.maxCampaignsPerDay != null && facts.campaignsStartedToday >= limits.maxCampaignsPerDay) {
    return { ok: false, code: 'max_campaigns_per_day',
      message: `The daily limit of ${limits.maxCampaignsPerDay} campaign${limits.maxCampaignsPerDay === 1 ? '' : 's'} has been reached. Schedule this one for tomorrow.` };
  }
  if (limits.maxSendsPerDay != null && facts.sendsStartedToday + facts.audienceSize > limits.maxSendsPerDay) {
    const left = Math.max(0, limits.maxSendsPerDay - facts.sendsStartedToday);
    return { ok: false, code: 'max_sends_per_day',
      message: `This campaign would send ${facts.audienceSize} messages, but only ${left} of today's ${limits.maxSendsPerDay} remain. Reduce the audience or schedule it for tomorrow.` };
  }
  if (limits.minHoursBetween != null && limits.minHoursBetween > 0 && facts.lastStartedAt) {
    const hoursSince = (now.getTime() - facts.lastStartedAt.getTime()) / 3_600_000;
    if (hoursSince < limits.minHoursBetween) {
      const wait = Math.ceil(limits.minHoursBetween - hoursSince);
      return { ok: false, code: 'min_hours_between',
        message: `Campaigns must be at least ${limits.minHoursBetween} hours apart. The next one can start in about ${wait} hour${wait === 1 ? '' : 's'}.` };
    }
  }
  return { ok: true };
}
