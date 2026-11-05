// appt.ts — shared formatting + status mapping for the customer appointment screens. Pure functions (unit-testable);
// status buckets and the live-progress step are derived from the backend status string — never fabricated.
export const money = (c: number) => '$' + Math.round((c || 0) / 100).toLocaleString('en-US');
export const money2 = (c: number) => '$' + ((c || 0) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const apptWhen = (iso: string): string => {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';

  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();

  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const isTomorrow = d.toDateString() === tomorrow.toDateString();

  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const isYesterday = d.toDateString() === yesterday.toDateString();

  const dayLabel = isToday
    ? 'Today'
    : isTomorrow
    ? 'Tomorrow'
    : isYesterday
    ? 'Yesterday'
    : d.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: d.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
      });

  const timeStr = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
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
