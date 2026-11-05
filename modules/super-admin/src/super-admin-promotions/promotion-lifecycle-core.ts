// Pure promotion status state-machine + approval/disable decisions. No DB/Nest deps. Enforces the controlled lifecycle
// from the spec so status can never jump arbitrarily; every management action is validated here before any write.

export const PROMOTION_STATUSES = ['draft', 'pending_approval', 'approved', 'scheduled', 'active', 'paused', 'completed', 'expired', 'disabled', 'rejected', 'cancelled', 'archived'] as const;
export type PromotionStatus = (typeof PROMOTION_STATUSES)[number];

// Allowed transitions (superset of the spec's list). Terminal states (rejected/cancelled/archived/disabled) have none.
export const VALID_TRANSITIONS: Record<string, PromotionStatus[]> = {
  draft: ['pending_approval', 'approved', 'cancelled'],
  pending_approval: ['approved', 'rejected', 'cancelled'],
  approved: ['scheduled', 'active', 'cancelled'],
  scheduled: ['active', 'cancelled', 'disabled'],
  active: ['paused', 'completed', 'expired', 'disabled'],
  paused: ['active', 'disabled', 'cancelled'],
  completed: ['archived'],
  expired: ['archived'],
  disabled: [],
  rejected: [],
  cancelled: [],
  archived: [],
};

export function canTransition(from: string, to: string): boolean {
  const f = String(from || '').toLowerCase();
  const t = String(to || '').toLowerCase();
  return (VALID_TRANSITIONS[f] || []).includes(t as PromotionStatus);
}

export type TransitionResult = { ok: true; status: PromotionStatus } | { ok: false; reason: string };
export function validateTransition(from: string, to: string): TransitionResult {
  if (!PROMOTION_STATUSES.includes(String(to).toLowerCase() as PromotionStatus)) return { ok: false, reason: `unknown target status "${to}"` };
  if (!canTransition(from, to)) return { ok: false, reason: `cannot move a promotion from "${from}" to "${to}"` };
  return { ok: true, status: String(to).toLowerCase() as PromotionStatus };
}

// Approval decision → the resulting (approval_status, status) pair. Only draft/pending_approval promotions are decidable.
export type ApprovalResult = { ok: true; approvalStatus: 'approved' | 'rejected'; status: PromotionStatus } | { ok: false; reason: string };
export function applyApproval(currentStatus: string, decision: 'approve' | 'reject'): ApprovalResult {
  const s = String(currentStatus || '').toLowerCase();
  if (s !== 'pending_approval' && s !== 'draft') return { ok: false, reason: `only a draft or pending_approval promotion can be ${decision}d (status is "${s}")` };
  return decision === 'approve' ? { ok: true, approvalStatus: 'approved', status: 'approved' } : { ok: true, approvalStatus: 'rejected', status: 'rejected' };
}

// Disable is allowed only for a live/pending offer, requires a reason, and never applies to an already-terminal record.
export type DisableResult = { ok: true } | { ok: false; reason: string };
export function canDisable(currentStatus: string): DisableResult {
  const s = String(currentStatus || '').toLowerCase();
  if (['approved', 'scheduled', 'active', 'paused'].includes(s)) return { ok: true };
  return { ok: false, reason: `a promotion with status "${s}" cannot be disabled` };
}

export const MIN_REASON = 4;
export function requireReason(reason: unknown): { ok: true; reason: string } | { ok: false; error: string } {
  const r = typeof reason === 'string' ? reason.trim() : '';
  return r.length >= MIN_REASON ? { ok: true, reason: r } : { ok: false, error: `a reason of at least ${MIN_REASON} characters is required` };
}
