// community-appeals.ts — the appeal rules, pure and testable.
//
// Spec rules encoded here:
//   * "Appeals must be reviewed by an authorized moderator who did not make the original material decision
//     where practical." → canReviewAppeal() refuses the original decider; the "where practical" escape is an
//     EXPLICIT, audited override (allowSameDecider) rather than a silent fallback, so a single-moderator
//     deployment still works but the exception is recorded.
//   * An appellant may only appeal a decision against their OWN tenant.
//   * Only a moderator decides an appeal; an appeal never auto-resolves.
//   * Overturning restores the content to a defined state — it never silently re-publishes something that
//     still needs moderation.
import type { CommunityRole } from './community-classification';
import type { AdvisoryStatus } from './community-classification';

export type AppealSubject =
  | 'post_rejected' | 'post_removed' | 'comment_removed' | 'community_suspended'
  | 'verification_status' | 'severity_change';

export type AppealStatus = 'submitted' | 'under_review' | 'upheld' | 'overturned' | 'withdrawn';

export interface AppealRecord {
  id: string;
  appellantTenantId: string;
  subject: AppealSubject;
  status: AppealStatus;
  originalDeciderUserId: string | null;
}

export interface AppealReviewer { userId: string; role: CommunityRole; }

export type Decision = { ok: true } | { ok: false; reason: string };

/** Who may FILE an appeal: an authorized user of the tenant the decision went against. */
export function canFileAppeal(params: { role: CommunityRole; tenantId: string; targetTenantId: string }): Decision {
  if (params.tenantId !== params.targetTenantId) return { ok: false, reason: 'not_your_tenant' };
  if (params.role === 'owner' || params.role === 'tenant_admin' || params.role === 'branch_manager') return { ok: true };
  return { ok: false, reason: 'role_cannot_appeal' };   // receptionist/technician cannot file
}

/**
 * Who may REVIEW an appeal. Moderators only, and NOT the moderator who made the original decision — unless an
 * explicit, audited override is supplied (the spec's "where practical"). The override is a parameter, never a
 * silent default, so the exception always shows up in the audit trail.
 */
export function canReviewAppeal(reviewer: AppealReviewer, appeal: AppealRecord, allowSameDecider = false): Decision {
  if (reviewer.role !== 'moderator') return { ok: false, reason: 'moderator_required' };
  if (appeal.status === 'upheld' || appeal.status === 'overturned') return { ok: false, reason: 'already_decided' };
  if (appeal.status === 'withdrawn') return { ok: false, reason: 'withdrawn' };
  if (appeal.originalDeciderUserId && reviewer.userId === appeal.originalDeciderUserId && !allowSameDecider) {
    return { ok: false, reason: 'original_decider_cannot_review' };
  }
  return { ok: true };
}

/**
 * What an OVERTURN restores. Deliberately conservative: overturning a removal/rejection does NOT blanket-
 * republish. A post whose category/severity requires moderation returns to `moderation_review`; otherwise it
 * returns to a published-unverified state. Nothing is auto-verified by winning an appeal.
 */
export function restoredStatusOnOverturn(subject: AppealSubject, opts: { moderationRequired: boolean }): AdvisoryStatus | null {
  switch (subject) {
    case 'post_rejected':
    case 'post_removed':
      return opts.moderationRequired ? 'moderation_review' : 'published_unverified';
    case 'comment_removed':
    case 'community_suspended':
    case 'verification_status':
    case 'severity_change':
      return null;   // handled by the caller (comment/visibility/label change), not a post-status transition
  }
}

/** An upheld appeal changes nothing about the content — it only closes the appeal. */
export function upheldChangesContent(): false { return false; }
