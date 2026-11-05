// billing-cycle-core.ts — PURE, unit-tested policy for period-end subscription renewal (no DB, no clock of its own).
// This is the "billing policy" the period-end invoice generator applies. Every decision below is a deliberate, editable
// choice — change it here and the generator + tests follow.
//
// POLICY (per subscription whose current_period_end has passed):
//   • active                 → INVOICE the next cycle, then advance the period.
//   • trialing               → INVOICE (the first real charge) AND convert to 'active', then advance the period.
//   • pending_cancellation   → CANCEL (set status 'cancelled'); do NOT invoice — the tenant asked to end at period end.
//   • active + cancel_at ≤ period_end → CANCEL as above (a scheduled cancellation that has now come due).
//   • past_due               → SKIP. Do NOT stack another invoice on top of an unpaid one; dunning/aging owns past_due.
//   • paused                 → SKIP. A paused subscription does not bill (pause_end resumes it elsewhere).
//   • expired | cancelled    → SKIP. Terminal states.
//
// PRICING: amount for the cycle = annual plan price for an annual interval, else the subscription's monthly price.
// IDEMPOTENCY: the generator advances current_period_end atomically and refuses to write a second invoice for a period
//   that already has one — so a re-run (or an overlapping tick) never double-bills. The rules here are deterministic on
//   the subscription's current state, which makes that safe.

export type RenewalAction = 'invoice' | 'cancel' | 'skip';
export interface RenewalDecision { action: RenewalAction; convertTrialToActive: boolean; reason: string }

export interface CycleSubscription {
  status: string;
  currentPeriodEndMs: number | null; // epoch ms of current_period_end (null = never billed / open-ended)
  cancelAtMs: number | null;         // epoch ms of a scheduled cancellation, or null
  monthlyPriceCents: number;
  billingInterval: string;           // 'month' | 'monthly' | 'year' | 'annual' | ...
}

const isAnnual = (interval: string): boolean => /ann|year/i.test(interval || '');

/** The single policy decision for one subscription at `nowMs`. Deterministic; no side effects. */
export function decideRenewal(sub: CycleSubscription, nowMs: number): RenewalDecision {
  // Not actually due yet — the caller normally pre-filters, but guard anyway.
  if (sub.currentPeriodEndMs != null && sub.currentPeriodEndMs > nowMs) {
    return { action: 'skip', convertTrialToActive: false, reason: 'not_due' };
  }
  // A scheduled cancellation that has come due wins over everything (never bill a tenant who asked to stop).
  const cancelDue = sub.cancelAtMs != null && sub.cancelAtMs <= nowMs;
  switch (sub.status) {
    case 'pending_cancellation':
      return { action: 'cancel', convertTrialToActive: false, reason: 'pending_cancellation' };
    case 'active':
      if (cancelDue) return { action: 'cancel', convertTrialToActive: false, reason: 'cancel_at_reached' };
      return { action: 'invoice', convertTrialToActive: false, reason: 'active_renewal' };
    case 'trialing':
      if (cancelDue) return { action: 'cancel', convertTrialToActive: false, reason: 'trial_cancel_before_convert' };
      return { action: 'invoice', convertTrialToActive: true, reason: 'trial_converted' };
    case 'past_due':
      return { action: 'skip', convertTrialToActive: false, reason: 'past_due_owned_by_dunning' };
    case 'paused':
      return { action: 'skip', convertTrialToActive: false, reason: 'paused_no_billing' };
    default: // expired, cancelled, unknown
      return { action: 'skip', convertTrialToActive: false, reason: `terminal_or_unknown:${sub.status}` };
  }
}

/** Cents to charge for the upcoming cycle. annualPriceCents is the plan's annual price when known (else monthly×12). */
export function renewalAmountCents(sub: Pick<CycleSubscription, 'monthlyPriceCents' | 'billingInterval'>, annualPriceCents?: number | null): number {
  const monthly = Math.max(0, Math.round(sub.monthlyPriceCents || 0));
  if (isAnnual(sub.billingInterval)) return Math.max(0, Math.round(annualPriceCents ?? monthly * 12));
  return monthly;
}

/** Advance a period end by one cycle. Month math clamps day-of-month (e.g. Jan 31 → Feb 28/29). Returns epoch ms. */
export function advancePeriodEnd(fromMs: number, billingInterval: string): number {
  const d = new Date(fromMs);
  if (isAnnual(billingInterval)) { d.setUTCFullYear(d.getUTCFullYear() + 1); return d.getTime(); }
  const day = d.getUTCDate();
  d.setUTCDate(1);                       // avoid overflow (e.g. Jan 31 + 1mo)
  d.setUTCMonth(d.getUTCMonth() + 1);
  const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, lastDay));
  return d.getTime();
}
