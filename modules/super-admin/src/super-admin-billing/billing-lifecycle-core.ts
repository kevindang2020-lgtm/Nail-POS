// billing-lifecycle-core.ts — pure helpers for subscription pause/cancel lifecycle decisions. No I/O. Cancellation
// NEVER implies data or history deletion; these functions only decide the resulting status and effective date.

export class LifecycleError extends Error {}

// Resolve a cancellation into a resulting subscription status + effective date. Immediate cancels now; end_of_period
// schedules a pending cancellation for the current period end (renewal is then prevented).
export function resolveCancellation(strategy: string, periodEnd: string | Date | null): { status: 'cancelled' | 'pending_cancellation'; effectiveAt: string } {
  if (strategy === 'immediate') return { status: 'cancelled', effectiveAt: new Date().toISOString() };
  if (strategy === 'end_of_period') {
    const end = periodEnd ? new Date(periodEnd) : new Date(Date.now() + 30 * 86400000);
    return { status: 'pending_cancellation', effectiveAt: end.toISOString() };
  }
  throw new LifecycleError('strategy must be "immediate" or "end_of_period"');
}

// A subscription can be paused only from active/trialing/past_due. Returns the pause window.
export function resolvePause(currentStatus: string, resumeDate?: string | Date | null): { status: 'paused'; pauseStart: string; pauseEnd: string | null } {
  if (!['active', 'trialing', 'past_due'].includes(currentStatus)) throw new LifecycleError(`Cannot pause a subscription in status "${currentStatus}"`);
  return { status: 'paused', pauseStart: new Date().toISOString(), pauseEnd: resumeDate ? new Date(resumeDate).toISOString() : null };
}

export function canResume(currentStatus: string): boolean {
  return currentStatus === 'paused';
}
