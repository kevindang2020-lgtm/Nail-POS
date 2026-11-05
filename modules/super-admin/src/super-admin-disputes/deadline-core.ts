// deadline-core.ts — pure, backend-authoritative deadline math for Chargebacks & Disputes. No I/O, no browser clock.
// The caller passes the server's "now" (ms). Deadline state is derived from the processor deadline (due_by), the dispute
// lifecycle status, and a submitted flag. Extensions are honored by simply passing the extended due_by.

export type DeadlineInput = { dueBy: string | null; status: string; submitted: boolean };
export type DeadlineState =
  | 'more_than_7_days' | 'approaching' | 'due_soon' | 'due_today' | 'overdue'
  | 'submitted' | 'closed' | 'unknown';

const CLOSED = new Set(['won', 'lost', 'expired', 'withdrawn', 'cancelled', 'closed', 'refunded']);
const SUBMITTED_STATUSES = new Set(['submitted', 'under_review']);

export function deadlineState(input: DeadlineInput, now: number): DeadlineState {
  if (CLOSED.has(input.status)) return 'closed';
  if (input.submitted || SUBMITTED_STATUSES.has(input.status)) return 'submitted';
  if (input.dueBy == null) return 'unknown';
  const ms = new Date(input.dueBy).getTime();
  if (!Number.isFinite(ms)) return 'unknown';
  const hoursLeft = (ms - now) / 3600000;
  if (hoursLeft < 0) return 'overdue';
  if (hoursLeft <= 24) return 'due_today';
  if (hoursLeft <= 48) return 'due_soon';
  if (hoursLeft <= 24 * 7) return 'approaching';
  return 'more_than_7_days';
}

// Whole days remaining (ceil), or null when there is no deadline. Negative means overdue.
export function daysRemaining(dueBy: string | null, now: number): number | null {
  if (dueBy == null) return null;
  const ms = new Date(dueBy).getTime();
  if (!Number.isFinite(ms)) return null;
  return Math.ceil((ms - now) / 86400000);
}

// Whole hours remaining (floor toward zero), or null. Used for the "due today / due in 24h" buckets.
export function hoursRemaining(dueBy: string | null, now: number): number | null {
  if (dueBy == null) return null;
  const ms = new Date(dueBy).getTime();
  if (!Number.isFinite(ms)) return null;
  return Math.trunc((ms - now) / 3600000);
}

export const DEADLINE_BUCKETS = ['due_today', 'due_24h', 'due_48h', 'due_3d', 'due_7d', 'overdue'] as const;
export type DeadlineBucket = (typeof DEADLINE_BUCKETS)[number];

// Does a dispute fall in a requested deadline bucket? Buckets are inclusive upper bounds on hours/days remaining and only
// apply to still-open, not-yet-submitted disputes (submitted/closed disputes have no live response deadline).
export function inBucket(input: DeadlineInput, bucket: DeadlineBucket, now: number): boolean {
  const st = deadlineState(input, now);
  if (st === 'submitted' || st === 'closed' || st === 'unknown') return false;
  const h = hoursRemaining(input.dueBy, now);
  if (h == null) return false;
  switch (bucket) {
    case 'overdue': return h < 0;
    case 'due_today': return h >= 0 && h <= 24;
    case 'due_24h': return h >= 0 && h <= 24;
    case 'due_48h': return h >= 0 && h <= 48;
    case 'due_3d': return h >= 0 && h <= 24 * 3;
    case 'due_7d': return h >= 0 && h <= 24 * 7;
  }
}

// A reminder is due when the dispute is open, unsubmitted, and its state is at/inside the "approaching" window, and no
// reminder for that (dispute, state) has already been sent. Pure policy — the caller supplies the already-sent set.
export function reminderDue(input: DeadlineInput, alreadySentStates: Set<string>, now: number): DeadlineState | null {
  const st = deadlineState(input, now);
  const remindable: DeadlineState[] = ['approaching', 'due_soon', 'due_today', 'overdue'];
  if (!remindable.includes(st)) return null;
  return alreadySentStates.has(st) ? null : st;
}
