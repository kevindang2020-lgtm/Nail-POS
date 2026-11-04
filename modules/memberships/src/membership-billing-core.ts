// membership-billing-core.ts — the pure, I/O-free heart of recurring membership billing: period-date math, proration on
// mid-cycle plan changes, the dunning state machine (active → grace → past_due → suspended, recovering to active on a
// successful charge), the retry schedule, a deterministic idempotency key per (membership, period, attempt), and the
// CardPointe response → normalized event mapper. Mirrors the AI-subscription-billing pattern: nothing here charges a
// card — it decides WHAT a charge should be and how a charge RESULT advances state. Money is integer cents throughout.
import { canTransition, splitMembershipRevenue } from './memberships-core';

export type BillingInterval = 'month' | 'quarter' | 'six_month' | 'year' | 'none' | 'custom';

/** Advance a date by N billing intervals. 'none'/'custom' do not auto-advance (prepaid / bespoke terms).
 *  Month arithmetic clamps to the last day of the target month (Jan 31 + 1 month = Feb 28/29, never Mar 3), and
 *  `anchorDay` (the day of month the membership started) keeps a later cycle from drifting: Feb 28 + 1 month with
 *  anchor 31 is Mar 31, not Mar 28. */
export function addInterval(start: Date, interval: BillingInterval, count = 1, anchorDay?: number | null): Date {
  const c = Math.max(1, Math.floor(count));
  const months = interval === 'month' ? c : interval === 'quarter' ? 3 * c : interval === 'six_month' ? 6 * c : interval === 'year' ? 12 * c : 0;
  if (!months) return new Date(start.getTime()); // none / custom
  const y = start.getUTCFullYear(), m = start.getUTCMonth() + months;
  const want = anchorDay && anchorDay >= 1 && anchorDay <= 31 ? Math.max(Math.floor(anchorDay), start.getUTCDate()) : start.getUTCDate();
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(want, lastDay), start.getUTCHours(), start.getUTCMinutes(), start.getUTCSeconds(), start.getUTCMilliseconds()));
}

// ── normalized renewal events (provider-agnostic) ──
export type RenewalEventType = 'renewal_succeeded' | 'renewal_failed' | 'recovered' | 'canceled' | 'expired' | 'paused' | 'resumed';

export interface BillingTransition {
  ok: boolean;
  changed: boolean;
  status: string;
  setPeriod: boolean;     // a fresh paid period began → caller refreshes current_period_* and next_billing_at
  setCanceled: boolean;   // stamp canceled_at
  reason: string;
}
const noop = (status: string, reason: string): BillingTransition => ({ ok: true, changed: false, status, setPeriod: false, setCanceled: false, reason });
const to = (status: string, reason: string, extra: Partial<BillingTransition> = {}): BillingTransition => ({ ok: true, changed: true, status, setPeriod: false, setCanceled: false, reason, ...extra });

/**
 * Map a normalized renewal event onto the next membership status, guarded by the membership transition map so an event
 * that doesn't apply to the current status is a safe no-op rather than an illegal flip. A successful charge recovers to
 * active from any non-terminal dunning state; a failure steps one rung down the dunning ladder.
 */
export function applyMembershipBillingEvent(current: string, event: RenewalEventType | string): BillingTransition {
  switch (event) {
    case 'renewal_succeeded':
    case 'recovered': {
      if (current === 'active') return to('active', 'renewed', { setPeriod: true });
      if (canTransition(current, 'active')) return to('active', `recovered_from_${current}`, { setPeriod: true });
      return noop(current, 'succeeded_not_applicable');
    }
    case 'renewal_failed': {
      const target = current === 'active' || current === 'trial' ? 'grace' : current === 'grace' ? 'past_due' : current === 'past_due' ? 'suspended' : null;
      if (target && canTransition(current, target)) return to(target, `payment_failed_${current}_to_${target}`);
      return noop(current, 'failed_not_applicable');
    }
    case 'canceled': {
      if (current === 'canceled') return noop('canceled', 'already_canceled');
      if (canTransition(current, 'canceled')) return to('canceled', 'canceled', { setCanceled: true });
      if (canTransition(current, 'canceling')) return to('canceling', 'cancel_at_period_end', { setCanceled: false });
      return noop(current, 'cannot_cancel');
    }
    case 'expired':
      if (current === 'expired') return noop('expired', 'already_expired');
      return canTransition(current, 'expired') ? to('expired', 'expired') : noop(current, 'cannot_expire');
    case 'paused':
      return canTransition(current, 'paused') ? to('paused', 'paused') : noop(current, 'cannot_pause');
    case 'resumed':
      return canTransition(current, 'active') ? to('active', 'resumed', { setPeriod: true }) : noop(current, 'cannot_resume');
    default:
      return { ok: false, changed: false, status: current, setPeriod: false, setCanceled: false, reason: 'unknown_event' };
  }
}

// ── dunning retry schedule ──
export const DUNNING_RETRY_DAYS = [3, 5, 7]; // delay before re-attempting after the 1st, 2nd, 3rd failure
export interface DunningStep { retryInDays: number | null; terminal: 'suspend' | null }
/** Given the attempt number that just FAILED (1-based) and the max attempts, return the next retry delay or a terminal
 * suspend once attempts are exhausted. */
export function dunningStep(attempt: number, maxAttempts = 4): DunningStep {
  const a = Math.max(1, Math.floor(attempt));
  if (a >= maxAttempts) return { retryInDays: null, terminal: 'suspend' };
  const idx = Math.min(a - 1, DUNNING_RETRY_DAYS.length - 1);
  return { retryInDays: DUNNING_RETRY_DAYS[idx], terminal: null };
}

/** Deterministic idempotency key for a renewal charge of a given period + attempt. Combined with the UNIQUE constraint
 * on membership_payments.idempotency_key, re-submitting the same period+attempt can never double-charge. */
export function renewalIdempotencyKey(membershipId: string, periodStartISO: string, attempt: number): string {
  return `renew:${membershipId}:${periodStartISO}:${Math.max(1, Math.floor(attempt))}`;
}

// ── proration on a mid-cycle plan change ──
export interface ProrationResult {
  daysTotal: number;
  daysElapsed: number;
  daysRemaining: number;
  unusedOldCents: number;      // credit back for the unused remainder of the old price
  remainingNewCents: number;   // charge for the remainder at the new price
  netChargeCents: number;      // positive → charge the member; negative → credit the member
}
const DAY = 86400000;
export function prorate(oldPriceCents: number, newPriceCents: number, periodStart: Date, periodEnd: Date, changeAt: Date): ProrationResult {
  const total = Math.max(1, Math.round((periodEnd.getTime() - periodStart.getTime()) / DAY));
  const elapsed = Math.min(total, Math.max(0, Math.round((changeAt.getTime() - periodStart.getTime()) / DAY)));
  const remaining = Math.max(0, total - elapsed);
  const unusedOld = Math.round((oldPriceCents * remaining) / total);
  const remainingNew = Math.round((newPriceCents * remaining) / total);
  return { daysTotal: total, daysElapsed: elapsed, daysRemaining: remaining, unusedOldCents: unusedOld, remainingNewCents: remainingNew, netChargeCents: remainingNew - unusedOld };
}

/** Allocation snapshot for a renewal payment, honoring allocation timing. on_billing splits the eligible amount now
 * (default eligible = the charge itself, refined per-benefit at redemption later); on_redemption/hybrid book the charge
 * to the house at billing and credit the technician share when the benefit is actually redeemed. */
export function renewalAllocation(amountCents: number, techPct: number, allocationTiming: string): { techCents: number; ownerCents: number } {
  if (allocationTiming === 'on_billing') return splitMembershipRevenue(amountCents, techPct);
  return { techCents: 0, ownerCents: Math.max(0, Math.round(amountCents)) };
}

// ── CardPointe (Fiserv) response → normalized renewal event (idempotent on retref) ──
export interface CardPointeRenewalResult { retref?: string; respstat?: string; resptext?: string; respcode?: string; amount?: string; account?: string }
export type CardPointeRenewalMap = { ok: true; event: RenewalEventType; ref: string; status: string } | { ok: false; reason: string };
// respstat: 'A' approved, 'B' retry (soft decline — not yet actionable), 'C' declined (hard).
export function cardpointeRenewalToEvent(charge: CardPointeRenewalResult): CardPointeRenewalMap {
  const retref = charge?.retref;
  // a decline the gateway never saw (no gateway configured, no saved card) carries its reason in resptext and no retref
  if (!retref) return { ok: false, reason: String(charge?.respstat ?? '').toUpperCase() === 'C' && charge?.resptext ? charge.resptext : 'missing_retref' };
  const stat = String(charge?.respstat ?? '').toUpperCase();
  if (stat === 'A') return { ok: true, event: 'renewal_succeeded', ref: retref, status: charge?.resptext || 'A' };
  if (stat === 'C') return { ok: true, event: 'renewal_failed', ref: retref, status: charge?.resptext || 'C' };
  return { ok: false, reason: stat === 'B' ? 'retry_pending' : 'no_actionable_status' };
}
