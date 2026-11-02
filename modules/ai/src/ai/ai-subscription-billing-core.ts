// ai-subscription-billing-core.ts — the pure state machine that maps a normalized billing event to the next
// subscription status. No I/O. The same 8 statuses as the table; transitions are guarded so an event that doesn't apply
// to the current status is a safe no-op rather than an illegal flip. This is what keeps "access follows payment" honest:
// a failed/refunded/cancelled event moves the subscription out of an access-granting status, and only a
// succeeded/recovered event moves it back to active.
export type AiSubStatus = 'active' | 'trialing' | 'past_due' | 'unpaid' | 'cancelled' | 'expired' | 'disabled' | 'suspended';

export type AiBillingEventType =
  | 'payment_succeeded' | 'trial_converted' | 'payment_recovered'
  | 'payment_failed' | 'refunded' | 'chargeback'
  | 'subscription_cancelled' | 'subscription_expired' | 'trial_expired'
  | 'paused' | 'resumed' | 'disabled' | 'enabled';

export interface AiBillingTransition {
  ok: boolean;
  changed: boolean;
  status: AiSubStatus;
  lastPaymentStatus?: string;
  setPeriod?: boolean;     // refresh current_period_* (a fresh paid period began)
  setCancelled?: boolean;  // stamp cancelled_at
  reason: string;
}

const ALL: AiSubStatus[] = ['active', 'trialing', 'past_due', 'unpaid', 'cancelled', 'expired', 'disabled', 'suspended'];
const noop = (status: AiSubStatus, reason: string): AiBillingTransition => ({ ok: true, changed: false, status, reason });
const to = (status: AiSubStatus, reason: string, extra: Partial<AiBillingTransition> = {}): AiBillingTransition => ({ ok: true, changed: true, status, reason, ...extra });

export function applyAiBillingEvent(current: AiSubStatus, event: AiBillingEventType | string): AiBillingTransition {
  if (!ALL.includes(current)) return { ok: false, changed: false, status: current as AiSubStatus, reason: 'unknown_current_status' };
  switch (event) {
    case 'payment_succeeded':
    case 'trial_converted':
    case 'payment_recovered': {
      // A successful charge grants/refreshes access from any non-terminal state.
      if (current === 'active') return { ...noop('active', 'already_active'), lastPaymentStatus: 'succeeded', setPeriod: true, changed: true };
      return to('active', `activated_on_${event}`, { lastPaymentStatus: 'succeeded', setPeriod: true });
    }
    case 'payment_failed': {
      if (current === 'active' || current === 'trialing' || current === 'past_due') return to('past_due', 'payment_failed', { lastPaymentStatus: 'failed' });
      return { ...noop(current, 'failed_not_applicable'), lastPaymentStatus: 'failed' };
    }
    case 'refunded':
    case 'chargeback': {
      if (current === 'cancelled' || current === 'expired') return noop(current, 'terminal');
      return to('unpaid', event, { lastPaymentStatus: event });
    }
    case 'subscription_cancelled':
      return current === 'cancelled' ? noop('cancelled', 'already_cancelled') : to('cancelled', 'cancelled', { setCancelled: true });
    case 'subscription_expired':
      return current === 'expired' ? noop('expired', 'already_expired') : to('expired', 'expired');
    case 'trial_expired':
      return current === 'trialing' ? to('expired', 'trial_expired') : noop(current, 'not_trialing');
    case 'paused':
      return current === 'suspended' ? noop('suspended', 'already_suspended') : to('suspended', 'paused');
    case 'resumed':
      return (current === 'suspended' || current === 'disabled') ? to('active', 'resumed', { setPeriod: true }) : noop(current, 'not_paused');
    case 'disabled':
      return current === 'disabled' ? noop('disabled', 'already_disabled') : to('disabled', 'disabled');
    case 'enabled':
      return current === 'disabled' ? to('active', 'enabled', { setPeriod: true }) : noop(current, 'not_disabled');
    default:
      return { ok: false, changed: false, status: current, reason: 'unknown_event' };
  }
}
