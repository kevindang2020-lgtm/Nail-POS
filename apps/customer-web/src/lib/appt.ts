// appt.ts — shared formatting + status mapping for the customer appointment screens. Pure functions (unit-testable);
// status buckets and the live-progress step are derived from the backend status string — never fabricated.
// BUILD_PLAN Phase 13 (C6 §99–100): money through @aipowersalon/money; an appointment's day and time are read in the
// BRANCH time zone (the salon's wall clock, wherever the phone is) — the device zone until the branch zone is known.
import { centsToUsd, centsToUsdWhole } from '@aipowersalon/money';
import { addDays, businessDate, epochToLocalDate } from '@aipowersalon/date-time';
import { effectiveTimeZone, fmtInZone, fmtTime } from '@aipowersalon/mobile-sdk';
export const money = (c: number) => centsToUsdWhole(c);
export const money2 = (c: number) => centsToUsd(c || 0);

export const apptWhen = (iso: string): string => {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';

  const tz = effectiveTimeZone();
  const day = epochToLocalDate(d.getTime(), tz);
  const today = businessDate(tz);
  const isToday = day === today;
  const isTomorrow = day === addDays(today, 1);
  const isYesterday = day === addDays(today, -1);

  const dayLabel = isToday
    ? 'Today'
    : isTomorrow
    ? 'Tomorrow'
    : isYesterday
    ? 'Yesterday'
    : fmtInZone(d, {
        month: 'short',
        day: 'numeric',
        year: day.slice(0, 4) !== today.slice(0, 4) ? 'numeric' : undefined,
      });

  const timeStr = fmtTime(d);
  return `${dayLabel} • ${timeStr}`;
};

export type Bucket = 'upcoming' | 'past' | 'cancelled';
const PAST = ['completed', 'paid', 'done', 'service_done', 'checked_out'];
const CANCELLED = ['cancelled', 'canceled', 'no_show', 'no-show'];
export const bucketOf = (status: string, startTime?: string): Bucket => {
  const s = (status || '').toLowerCase();
  if (CANCELLED.includes(s)) return 'cancelled';
  if (PAST.includes(s)) return 'past';
  if (['serving', 'in_progress', 'in-progress', 'checked_in', 'checked-in', 'arrived', 'waiting', 'assigned'].includes(s)) {
    return 'upcoming';
  }
  if (startTime) {
    const t = new Date(startTime).getTime();
    if (!isNaN(t) && t < Date.now() - 30 * 60 * 1000) {
      return 'past';
    }
  }
  return 'upcoming';
};

// live-progress timeline (Appointment Details hero): Checked In → In Progress → Almost Done → Done
export const STEPS = ['Checked In', 'In Progress', 'Almost Done', 'Done'] as const;
export const stepIndex = (status: string): number => {
  const s = (status || '').toLowerCase();
  if (['done', 'completed', 'service_done', 'paid', 'checked_out'].includes(s)) return 3;
  if (['nearly_finished', 'almost_done'].includes(s)) return 2;
  if (['serving', 'in_progress', 'in-progress'].includes(s)) return 1;
  if (['checked_in', 'checked-in', 'arrived', 'waiting', 'assigned'].includes(s)) return 0;
  return -1; // not yet checked in (e.g. confirmed/booked) → no live hero
};
export const statusText = (status: string) => (status || '').replace(/_/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());
