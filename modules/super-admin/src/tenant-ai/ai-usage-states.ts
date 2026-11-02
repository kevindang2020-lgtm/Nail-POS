// ai-usage-states.ts — AI Usage & Limits Complete Build Guide (Oct 30 2026) §7: ONE pure mapping from the stored facts
// (Super Admin's global availability, the tenant subscription row, the trial dates, whether a payment was ever recorded,
// the current-period usage) to the state a salon sees and the actions it may take. The access gate
// (modules/ai/src/ai/ai-access-gate.ts) stays the enforcement authority; this only names its outcome honestly:
//   • a lapsed trial is "Trial expired", never "Trial" — and offers no Cancel;
//   • Cancelled offers no Cancel; Past due is never shown as a healthy renewal;
//   • Disabled by admin (global switch or the tenant row's `disabled`) does not suggest that an upgrade restores it;
//   • an unknown stored status is "Unable to verify", never a guess.
// Paid activation, upgrades and reactivation are NOT self-serve in this codebase (billing / Super Admin) — the action is
// a link to Billing, never a charge from this page.

export const DISPLAY_STATES = ['available', 'trial_available', 'trialing', 'trial_expired', 'active', 'cancelled', 'expired', 'past_due', 'suspended', 'disabled_by_admin', 'unable_to_verify'] as const;
export type DisplayState = (typeof DISPLAY_STATES)[number];
export type PackageAction = 'view_details' | 'start_trial' | 'cancel' | 'upgrade' | 'reactivate' | 'update_billing' | 'open_module';
export type UsageLevel = 'ok' | 'warn_80' | 'critical_90' | 'exhausted_100' | 'unlimited' | 'not_metered' | 'unknown';

export interface StateInput {
  globallyEnabled: boolean;
  sub: { status: string; trialEndsAt: string | Date | null; trialStartsAt: string | Date | null } | null;
  trialDays: number;
  /** a trial was ever started for this package (row's trial_starts_at, or a recorded trial event) */
  trialEverStarted: boolean;
  /** a successful payment / conversion was ever recorded for this package (ai_billing_events) */
  everPaid: boolean;
  now?: Date;
}

export function displayStateOf(i: StateInput): DisplayState {
  const now = (i.now ?? new Date()).getTime();
  if (!i.globallyEnabled) return 'disabled_by_admin';
  const s = i.sub;
  if (!s) return i.trialDays > 0 && !i.trialEverStarted ? 'trial_available' : 'available';
  const ends = s.trialEndsAt ? new Date(s.trialEndsAt).getTime() : null;
  switch (s.status) {
    case 'trialing': return ends != null && now > ends ? 'trial_expired' : 'trialing';
    case 'active': return 'active';
    case 'past_due': case 'unpaid': return 'past_due';
    case 'cancelled': return 'cancelled';
    case 'expired': return ends != null && now >= ends && !i.everPaid ? 'trial_expired' : 'expired';
    case 'suspended': return 'suspended';
    case 'disabled': return 'disabled_by_admin';
    default: return 'unable_to_verify';
  }
}

/** Valid actions for a state × permission (the server refuses anything else). View details is always present. */
export function actionsFor(state: DisplayState, canManage: boolean, canBilling: boolean, trialEligible: boolean): PackageAction[] {
  const a: PackageAction[] = ['view_details'];
  if (state === 'trial_available' && canManage && trialEligible) a.push('start_trial');
  if ((state === 'trialing' || state === 'active' || state === 'past_due') && canManage) a.push('cancel');
  if (canBilling) {
    if (state === 'available' || state === 'trial_available' || state === 'trialing' || state === 'trial_expired') a.push('upgrade');
    if (state === 'cancelled' || state === 'expired') a.push('reactivate');
    if (state === 'past_due') a.push('update_billing');
  }
  if (state === 'trialing' || state === 'active') a.push('open_module');
  return a;
}

/** the one primary action a card shows (others live in Details) */
export function primaryAction(actions: PackageAction[]): PackageAction {
  for (const k of ['start_trial', 'update_billing', 'upgrade', 'reactivate', 'open_module'] as const) if (actions.includes(k)) return k;
  return 'view_details';
}

/** usage level for a fixed-period quota (limit ≤ 0 = unlimited for a live subscription, not metered otherwise) */
export function usageLevelOf(used: number | null, limit: number, live: boolean): UsageLevel {
  if (!live) return 'not_metered';
  if (used == null) return 'unknown';
  if (!Number.isFinite(limit) || limit <= 0) return 'unlimited';
  const p = (used * 100) / limit;
  return p >= 100 ? 'exhausted_100' : p >= 90 ? 'critical_90' : p >= 80 ? 'warn_80' : 'ok';
}
