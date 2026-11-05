// membership-lifecycle-core.ts — pure transition logic for cancel / pause / resume. It decides the target status and the
// exact column patch, validating every move against the shared status machine (canTransition). No money is involved:
// canceling/canceled only stops future billing and records intent; the already-paid period is honored via term_end_at.
// Refunds/proration are deliberately NOT modeled here — that is a separate money-path concern.
import { canTransition } from './memberships-core';

export interface LifecyclePatch {
  status: string;
  autoRenew?: boolean;
  cancelAtPeriodEnd?: boolean;
  canceledAt?: string | null;
  cancelReason?: string | null;
  termEndAt?: string | null;
  pausedAt?: string | null;
  pauseResumesAt?: string | null;
  bumpPausesUsed?: boolean;
}

export type LifecycleResult =
  | { ok: true; targetStatus: string; activityType: string; patch: LifecyclePatch }
  | { ok: false; reason: string };

export function resolveCancel(currentStatus: string, opts: { atPeriodEnd: boolean; currentPeriodEnd: string | null; reason: string | null; nowIso: string }): LifecycleResult {
  if (opts.atPeriodEnd) {
    if (!canTransition(currentStatus, 'canceling')) return { ok: false, reason: `Cannot cancel a membership in status "${currentStatus}".` };
    // Stop auto-renew now; keep benefits until the paid period ends. The period-end flip to 'canceled' is handled by
    // billing/sweeps later (a canceling membership has auto_renew=false, so run-renewals never charges it).
    return { ok: true, targetStatus: 'canceling', activityType: 'cancel_scheduled', patch: { status: 'canceling', autoRenew: false, cancelAtPeriodEnd: true, cancelReason: opts.reason, termEndAt: opts.currentPeriodEnd } };
  }
  if (!canTransition(currentStatus, 'canceled')) {
    const canSchedule = canTransition(currentStatus, 'canceling');
    return { ok: false, reason: canSchedule ? `Immediate cancellation isn't allowed from status "${currentStatus}" — cancel at period end instead.` : `Cannot cancel a membership in status "${currentStatus}".` };
  }
  return { ok: true, targetStatus: 'canceled', activityType: 'canceled', patch: { status: 'canceled', autoRenew: false, cancelAtPeriodEnd: false, canceledAt: opts.nowIso, cancelReason: opts.reason, termEndAt: opts.currentPeriodEnd ?? opts.nowIso } };
}

export function resolvePause(currentStatus: string, opts: { resumesAt: string | null; nowIso: string }): LifecycleResult {
  if (!canTransition(currentStatus, 'paused')) return { ok: false, reason: `Cannot pause a membership in status "${currentStatus}".` };
  return { ok: true, targetStatus: 'paused', activityType: 'paused', patch: { status: 'paused', pausedAt: opts.nowIso, pauseResumesAt: opts.resumesAt, bumpPausesUsed: true } };
}

export function resolveResume(currentStatus: string): LifecycleResult {
  // Resume applies to a paused membership and to a canceling one (reactivation before period end); both go back to active
  // and clear the relevant lifecycle stamps. Resuming an already-active membership is rejected (nothing to resume).
  if (!canTransition(currentStatus, 'active')) return { ok: false, reason: `Cannot resume a membership in status "${currentStatus}".` };
  return { ok: true, targetStatus: 'active', activityType: 'resumed', patch: { status: 'active', pausedAt: null, pauseResumesAt: null, cancelAtPeriodEnd: false, canceledAt: null, cancelReason: null } };
}
