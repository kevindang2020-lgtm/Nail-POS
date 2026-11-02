// customer-segments.ts — the single source of truth for how a customer is classified as returning / new / inactive.
// Both the Customers page and the POS Overview "Customer Retention" donut import these so the two can't drift
// (they previously used different models: Customers uses visit-frequency + 60-day recency over closed/paid tickets,
// while Overview used a 90-day first-visit/last-visit cohort over ALL tickets — producing different numbers).

// A "visit" is a settled ticket. Unpaid / abandoned tickets are not visits.
export const VISIT_TICKET_STATUSES = ['closed', 'paid'] as const;

// 2+ visits = a returning (repeat) customer; a single visit = new.
export const RETURNING_MIN_VISITS = 2;

// No settled visit in this many days = inactive (lapsed).
export const INACTIVE_DAYS = 60;

export type RetentionSegment = 'returning' | 'new' | 'inactive';

/** Classify one customer from their visit count + days since last visit. Partition: every customer is exactly one. */
export function classifyRetention(visitCount: number, recencyDays: number): RetentionSegment {
  if (recencyDays >= INACTIVE_DAYS) return 'inactive';
  return visitCount >= RETURNING_MIN_VISITS ? 'returning' : 'new';
}
