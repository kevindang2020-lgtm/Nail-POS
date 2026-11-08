// Campaign Builder Steps 4 + 5 (SUNMI addendum, Nov 8 2026) — `/pos/ai-marketing/center/offers` and `/schedule-check`.
// Realm: tenant. Declaration file: types only, never emitted (see packages/api-contracts/README.md).

/** An approved Deals & Promotions offer a campaign may carry (read-only; attaching never redeems or reserves it). */
export interface McOffer {
  id: string;
  title: string;
  kind: string;
  status: 'approved' | 'scheduled' | 'active' | string;
  discount: { type: 'percent'; percent: number; maxCents: number | null } | { type: 'fixed'; cents: number };
  startsAt: string | null;
  endsAt: string | null;
  minSpendCents: number | null;
  maxRedemptions: number | null;
  redeemed: number;
  maxPerCustomer: number | null;
  stackable: boolean;
  newCustomersOnly: boolean;
  memberOnly: boolean;
  requiresCode: boolean;
  terms: string | null;
  budgetCents: number | null;
  allBranches: boolean;
  daysOfWeek: number[] | null;
  validFromMinute: number | null;
  validToMinute: number | null;
}
export interface McOffersResponse { items: McOffer[]; note: string }

/** Step 5: a PROPOSED send time in salon time (YYYY-MM-DD + HH:MM); optional offer whose dates are checked too. */
export interface McScheduleCheckRequest { date: string | null; time: string | null; dealId?: string | null }
export interface McScheduleCheck { key: 'local_time' | 'ambiguous_time' | 'future' | 'quiet_hours' | 'offer_valid' | string; state: 'ok' | 'warn' | 'block'; detail: string }
export interface McScheduleCheckResponse {
  timeZone: string;
  date: string;
  time: string;
  /** the instant, or null when that local time does not exist (spring-forward gap) */
  sendAt: string | null;
  ok: boolean;
  checks: McScheduleCheck[];
  note: string;
}
