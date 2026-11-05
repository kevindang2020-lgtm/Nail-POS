import type { DealStatus, DealSettings, DealOwnerType, DiscountType, TechDealPolicy } from '@aipowersalon/api-contracts/tenant';
export type { DealStatus, DealSettings, DealOwnerType, DiscountType, TechDealPolicy };   // owned by packages/api-contracts (Constitution 13 §13)
// deals.core.ts — pure domain logic for the Deals Marketplace (no I/O). Everything money is integer cents. These
// functions are the single source of truth for: the final promotional price (never negative), the legal deal status
// transitions, and the backend enforcement of a salon's technician-deal policy. The service layer calls these; nothing
// here touches the database, so it is exhaustively unit-tested.



export type DealAction =
  | 'submit' | 'approve' | 'reject' | 'request_changes' | 'publish'
  | 'pause' | 'resume' | 'mark_sold_out' | 'expire' | 'cancel' | 'archive' | 'schedule';

/** Final promotional price in integer cents. A discount can NEVER produce a negative price (spec §4). */
export function computeFinalPriceCents(originalCents: number, type: DiscountType, percent?: number | null, cents?: number | null): number {
  const o = Math.max(0, Math.round(originalCents || 0));
  let final = o;
  if (type === 'percent') {
    const p = Math.min(100, Math.max(0, Math.round(percent ?? 0)));
    final = o - Math.floor((o * p) / 100);   // the same rounding the pricing engine charges (engine/pricing.ts)
  } else if (type === 'fixed_price') {
    final = Math.min(o, Math.max(0, Math.round(cents ?? 0)));   // "this service for $30" — never raises a cheaper price
  } else {
    const d = Math.max(0, Math.round(cents ?? 0));
    final = o - d;
  }
  return Math.max(0, final);
}

/** Savings in integer cents (never negative). */
export function savingsCents(originalCents: number, type: DiscountType, percent?: number | null, cents?: number | null): number {
  const o = Math.max(0, Math.round(originalCents || 0));
  return Math.max(0, o - computeFinalPriceCents(o, type, percent, cents));
}

// The legal status machine. Each action lists the states it may fire FROM and the single state it moves TO. An action
// from any other state is illegal (returns null → the service raises a conflict rather than silently mutating).
const TRANSITIONS: Record<DealAction, { from: DealStatus[]; to: DealStatus }> = {
  submit:          { from: ['draft'], to: 'pending_approval' },
  approve:         { from: ['pending_approval'], to: 'approved' },
  reject:          { from: ['pending_approval'], to: 'rejected' },
  request_changes: { from: ['pending_approval'], to: 'draft' },
  publish:         { from: ['approved', 'scheduled', 'paused'], to: 'active' },
  schedule:        { from: ['approved', 'paused'], to: 'scheduled' },   // Phase 5: published with a future start
  pause:           { from: ['active'], to: 'paused' },
  resume:          { from: ['paused'], to: 'active' },
  mark_sold_out:   { from: ['active'], to: 'sold_out' },
  expire:          { from: ['approved', 'scheduled', 'active', 'paused'], to: 'expired' },
  cancel:          { from: ['draft', 'pending_approval', 'approved', 'scheduled', 'active', 'paused'], to: 'canceled' },
  archive:         { from: ['expired', 'rejected', 'canceled', 'sold_out'], to: 'archived' },
};

/** Next status for an action, or null if the transition is illegal from `current`. */
export function nextStatus(current: DealStatus, action: DealAction): DealStatus | null {
  const t = TRANSITIONS[action];
  if (!t) return null;
  return t.from.includes(current) ? t.to : null;
}

/** A deal is bookable by customers only in these live states (spec §5). */
export function isBookable(status: DealStatus): boolean {
  return status === 'active';
}

/** Where a freshly-created deal lands, given who made it and the salon's technician-deal policy (spec §3). */
export function initialStatus(ownerType: DealOwnerType, policy: TechDealPolicy): DealStatus {
  if (ownerType === 'salon') return 'draft';           // salon deals start as a manager draft
  // BUILD_PLAN Phase 5, bug 18: "on_auto" parked the deal at 'approved', which no customer ever sees and nothing ever
  // published — the auto path was a dead end. Auto means live (the service turns it into 'scheduled' for a future start).
  if (policy === 'on_auto') return 'active';
  return 'pending_approval';                            // on_with_approval → straight to the manager queue
}


export interface TechDealProposal {
  discountType: DiscountType;
  discountPercent?: number | null;
  discountCents?: number | null;
  originalPriceCents?: number | null;
  startsAt?: string | null;
  endsAt?: string | null;
  maxRedemptions?: number | null;
  newCustomersOnly?: boolean;
  activeDealCountForTech?: number;
}

/**
 * Backend enforcement of the manager-configured technician-deal limits (spec §3: "The backend must enforce these
 * rules. Do not enforce them only in the Technician App."). Returns the list of human-readable violation reasons —
 * empty means the proposal is within policy.
 */
export function validateTechDealAgainstSettings(p: TechDealProposal, s: DealSettings): string[] {
  const v: string[] = [];
  if (s.allowTechnicianDeals === 'off') { v.push('Technician deals are turned off for this salon.'); return v; }

  if (p.discountType === 'percent' && s.maxDiscountPercent != null && (p.discountPercent ?? 0) > s.maxDiscountPercent) {
    v.push(`Discount exceeds the ${s.maxDiscountPercent}% cap set by your salon.`);
  }
  if (p.discountType === 'fixed' && s.maxFixedDiscountCents != null && (p.discountCents ?? 0) > s.maxFixedDiscountCents) {
    v.push('The fixed discount exceeds the amount your salon allows.');
  }
  if (s.minServicePriceCents != null && (p.originalPriceCents ?? 0) < s.minServicePriceCents) {
    v.push('The service price is below the minimum your salon allows for deals.');
  }
  if (s.maxRedemptionsCap != null && p.maxRedemptions != null && p.maxRedemptions > s.maxRedemptionsCap) {
    v.push('The redemption limit exceeds your salon cap.');
  }
  if (s.maxActiveDealsPerTech != null && (p.activeDealCountForTech ?? 0) >= s.maxActiveDealsPerTech) {
    v.push('You already have the maximum number of active deals allowed.');
  }
  if (p.newCustomersOnly && !s.allowedNewCustomer) {
    v.push('New-customer-only deals are not permitted at this salon.');
  }
  if (s.maxCampaignDurationDays != null && p.startsAt && p.endsAt) {
    const days = (new Date(p.endsAt).getTime() - new Date(p.startsAt).getTime()) / 86400000;
    if (days > s.maxCampaignDurationDays) v.push(`The deal runs longer than the ${s.maxCampaignDurationDays}-day maximum.`);
  }
  return v;
}


/** Where "publish" lands: live now, or scheduled for its start (the lifecycle job activates it then). */
export function publishTarget(startsAt: string | null | undefined, now: number): 'active' | 'scheduled' {
  return startsAt && Date.parse(startsAt) > now ? 'scheduled' : 'active';
}

export const DEAL_KINDS = ['deal', 'coupon', 'automatic', 'announcement'] as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isInt = (v: unknown) => typeof v === 'number' && Number.isInteger(v);
const optPosInt = (v: unknown) => v == null || (isInt(v) && (v as number) > 0);

export interface DealInputShape {
  title?: unknown; kind?: unknown; discountType?: unknown; discountPercent?: unknown; discountCents?: unknown; maxDiscountCents?: unknown;
  maxRedemptions?: unknown; maxPerCustomer?: unknown; minSpendCents?: unknown; depositCents?: unknown; budgetCents?: unknown; bookingLeadMinutes?: unknown;
  startsAt?: unknown; endsAt?: unknown; serviceIds?: unknown; branchId?: unknown; daysOfWeek?: unknown; validFromMinute?: unknown; validToMinute?: unknown;
  channels?: unknown; priority?: unknown; stackGroup?: unknown;
}

/**
 * BUILD_PLAN Phase 5, bug 21: every field checked BEFORE it reaches the database. 12.5 %, 0 %, 101 %, a fraction of a
 * cent, an end before the start — each used to surface as a Postgres error (500). Returns the problems (empty = valid).
 */
export function validateDealInput(i: DealInputShape, opts: { partial?: boolean } = {}): string[] {
  const e: string[] = [];
  const has = (k: keyof DealInputShape) => i[k] !== undefined;
  if (!opts.partial || has('title')) { if (typeof i.title !== 'string' || !i.title.trim()) e.push('A deal title is required.'); else if (i.title.trim().length > 120) e.push('The title is at most 120 characters.'); }
  if (has('kind') && !(DEAL_KINDS as readonly unknown[]).includes(i.kind)) e.push('Unknown deal kind.');
  const type = i.discountType;
  if (!opts.partial || has('discountType')) {
    if (type !== 'percent' && type !== 'fixed' && type !== 'fixed_price') e.push('Invalid discount type.');
    else if (i.kind !== 'announcement') {
      if (type === 'percent' && !(isInt(i.discountPercent) && (i.discountPercent as number) >= 1 && (i.discountPercent as number) <= 100)) e.push('A percentage discount is a whole number from 1 to 100.');
      if (type === 'fixed' && !(isInt(i.discountCents) && (i.discountCents as number) > 0)) e.push('A fixed discount is a whole number of cents above zero.');
      if (type === 'fixed_price' && !(isInt(i.discountCents) && (i.discountCents as number) >= 0)) e.push('A fixed price is a whole number of cents.');
    }
  }
  if (!optPosInt(i.maxDiscountCents)) e.push('The discount cap is a whole number of cents above zero.');
  if (!optPosInt(i.maxRedemptions)) e.push('The redemption limit is a whole number above zero.');
  if (!optPosInt(i.maxPerCustomer)) e.push('The per-customer limit is a whole number above zero.');
  if (!optPosInt(i.minSpendCents)) e.push('The minimum spend is a whole number of cents above zero.');
  if (!optPosInt(i.budgetCents)) e.push('The budget is a whole number of cents above zero.');
  if (i.depositCents != null && !(isInt(i.depositCents) && (i.depositCents as number) >= 0)) e.push('The deposit is a whole number of cents.');
  if (i.bookingLeadMinutes != null && !(isInt(i.bookingLeadMinutes) && (i.bookingLeadMinutes as number) >= 0 && (i.bookingLeadMinutes as number) <= 60 * 24 * 60)) e.push('Booking lead time is a whole number of minutes (up to 60 days).');
  if (i.priority != null && !(isInt(i.priority) && (i.priority as number) >= 0 && (i.priority as number) <= 10_000)) e.push('Priority is a whole number from 0 to 10000.');
  if (i.stackGroup != null && (typeof i.stackGroup !== 'string' || i.stackGroup.length > 40)) e.push('A stack group is a short name.');
  const d = (v: unknown) => (v == null || v === '' ? null : typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? Date.parse(v) : NaN);
  const s = d(i.startsAt); const en = d(i.endsAt);
  if (Number.isNaN(s as number)) e.push('The start date is not a valid date.');
  if (Number.isNaN(en as number)) e.push('The end date is not a valid date.');
  if (s != null && en != null && !Number.isNaN(s) && !Number.isNaN(en) && en <= s) e.push('The deal must end after it starts.');
  if (i.serviceIds != null && (!Array.isArray(i.serviceIds) || i.serviceIds.length > 100 || i.serviceIds.some((x) => typeof x !== 'string' || !UUID.test(x)))) e.push('Services must be a list of service ids.');
  if (i.branchId != null && i.branchId !== '' && (typeof i.branchId !== 'string' || !UUID.test(i.branchId))) e.push('The location is not valid.');
  if (i.daysOfWeek != null && (!Array.isArray(i.daysOfWeek) || !i.daysOfWeek.length || i.daysOfWeek.some((x) => !isInt(x) || (x as number) < 0 || (x as number) > 6))) e.push('Days are 0 (Sunday) to 6 (Saturday).');
  const mins = [i.validFromMinute, i.validToMinute];
  if (mins.some((m) => m != null) && !(mins.every((m) => isInt(m) && (m as number) >= 0 && (m as number) < 1440) && i.validFromMinute !== i.validToMinute)) e.push('Hours need a start and an end time of day.');
  if (i.channels != null && (!Array.isArray(i.channels) || !i.channels.length || i.channels.some((c) => !['pos', 'online', 'customer_app', 'ai_receptionist'].includes(String(c))))) e.push('Channels must be pos, online, customer_app or ai_receptionist.');
  return e;
}
