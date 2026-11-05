// workforce-lifecycles.ts — BUILD_PLAN Phase 12 / Constitution 5 §74–§78 (#27): the workforce module's status lifecycles,
// ONE transition table each (packages/database state-machine). Every writer of these columns goes through its machine —
// transitionStatus (one row, conditional `where status = from`) or canMoveToSql (a set-based / raw-SQL write) — so a
// concurrent writer gets 409 INVALID_STATE_TRANSITION instead of a lost update.
//
// The tables reproduce the moves the code made before this phase (derived from every writer and the Phase 10 CHECK
// vocabularies), with these deliberate refusals — each was a revival or a bypass the old unconditional writes allowed:
//   • compensation_policy_version: a CANCELED / REPLACED / EXPIRED version can no longer be approved or activated again
//     (setVersionStatus / activateVersion had no `where status`, so "approve" brought a cancelled pay rule back to life);
//   • nail_showcase_post / _comment: a REMOVED post or comment can no longer be re-published or hidden (approve after a
//     platform removal put it back on the feed);
//   • nail_showcase_report: a report can no longer be moved back to `open` or rewritten after it was decided (dismissed
//     may still escalate to action_taken);
//   • tech_salon_membership: a technician's own re-request can no longer turn a Super-Admin PAUSED membership into a
//     pending request (bypassing the pause); a platform SUSPENDED / REVOKED membership is never re-hired by a salon flow;
//   • tech_dm_report: a resolved report is not resolved a second time (the resolution is kept).
// tech_salon_memberships and tech_portfolio_photos.moderation_status are also written by modules/super-admin (Global
// Technician administration): those writers import these machines (exported from @aipowersalon/workforce) — one table each.
import { defineStateMachine } from '@aipowersalon/database';

/** tenant_approval_requests.status — the salon's ONE approvals engine (approvals.service). */
export const APPROVAL_REQUEST = defineStateMachine({
  name: 'approval_request', table: 'tenant_approval_requests', column: 'status',
  states: ['pending', 'approved', 'rejected', 'cancelled', 'expired', 'executed', 'execution_failed'],
  transitions: { pending: ['approved', 'rejected', 'cancelled', 'expired'], approved: ['executed', 'execution_failed'] },
  initial: ['pending'],
});

/** access_reviews.status — a periodic access review (open until every person has a decision). */
export const ACCESS_REVIEW = defineStateMachine({
  name: 'access_review', table: 'access_reviews', column: 'status',
  states: ['open', 'completed', 'cancelled'],
  transitions: { open: ['completed', 'cancelled'] },
  initial: ['open'],
});

/** compensation_agreements.status — a new agreement supersedes the technician's previous ones; she acknowledges a sent one. */
export const COMPENSATION_AGREEMENT = defineStateMachine({
  name: 'compensation_agreement', table: 'compensation_agreements', column: 'status',
  states: ['draft', 'sent', 'acknowledged', 'superseded'],
  transitions: { draft: ['sent', 'superseded'], sent: ['acknowledged', 'superseded'], acknowledged: ['superseded'] },
  initial: ['sent', 'draft'],
});

/** bonus_rules.status / technician_tier_plans.status — an owner archives a rule / plan; archiving is final. */
export const BONUS_RULE = defineStateMachine({
  name: 'bonus_rule', table: 'bonus_rules', column: 'status',
  states: ['active', 'archived'], transitions: { active: ['archived'] }, initial: ['active'],
});
export const TIER_PLAN = defineStateMachine({
  name: 'technician_tier_plan', table: 'technician_tier_plans', column: 'status',
  states: ['active', 'archived'], transitions: { active: ['archived'] }, initial: ['active'],
});

/** compensation_adjustments.status — Payroll mandate wave 2 (Oct 12 2026). Auto reversals are written 'posted'; a manual
 *  adjustment, a large one, a refund against a locked period and a chargeback reversal wait ('pending' / 'pending_review')
 *  for an owner's decision. A decided row is never re-decided; 'posted' / 'applied' / 'approved' / 'rejected' are final —
 *  a correction to a decided entry is a NEW entry (§47). */
export const COMPENSATION_ADJUSTMENT = defineStateMachine({
  name: 'compensation_adjustment', table: 'compensation_adjustments', column: 'status',
  states: ['pending', 'approved', 'rejected', 'applied', 'pending_review', 'posted'],
  transitions: { pending: ['approved', 'rejected'], pending_review: ['approved', 'rejected'] },
  initial: ['pending', 'pending_review', 'posted', 'applied', 'approved'],
});

/** compensation_exceptions.status (migration 612, §196–§197) — the financial exception queue. The recovery worker moves a
 *  retryable row open → retrying → resolved; an owner resolves or dismisses one with a note; a re-detected problem re-opens. */
export const COMPENSATION_EXCEPTION = defineStateMachine({
  name: 'compensation_exception', table: 'compensation_exceptions', column: 'status',
  states: ['open', 'retrying', 'resolved', 'dismissed'],
  transitions: { open: ['retrying', 'resolved', 'dismissed'], retrying: ['retrying', 'open', 'resolved', 'dismissed'], resolved: ['open'] },
  initial: ['open'],
});

/** technician_pay_plans.status (migration 613) — a plan is archived (never deleted); a new plan replaces it. */
export const TECHNICIAN_PAY_PLAN = defineStateMachine({
  name: 'technician_pay_plan', table: 'technician_pay_plans', column: 'status',
  states: ['active', 'archived'], transitions: { active: ['archived'] }, initial: ['active'],
});

/** compensation_policy_versions.status — draft → approved (scheduled) → active → replaced by the next active version. */
export const COMPENSATION_POLICY_VERSION = defineStateMachine({
  name: 'compensation_policy_version', table: 'compensation_policy_versions', column: 'status',
  states: ['draft', 'pending_approval', 'scheduled', 'active', 'replaced', 'canceled', 'expired'],
  transitions: {
    draft: ['scheduled', 'active', 'canceled'],
    pending_approval: ['scheduled', 'active', 'canceled'],
    scheduled: ['scheduled', 'active', 'canceled'],
    active: ['active', 'replaced', 'canceled'],
  },
  initial: ['draft'],
});

/** nail_showcase_posts.status — moderation (hide / approve) and removal (owner delete, platform removal; idempotent). */
export const NAIL_SHOWCASE_POST = defineStateMachine({
  name: 'nail_showcase_post', table: 'nail_showcase_posts', column: 'status',
  states: ['draft', 'pending_review', 'published', 'hidden', 'reported', 'removed'],
  transitions: {
    draft: ['pending_review', 'published', 'hidden', 'removed'],
    pending_review: ['published', 'hidden', 'removed'],
    published: ['published', 'hidden', 'reported', 'removed'],
    reported: ['published', 'hidden', 'removed'],
    hidden: ['published', 'hidden', 'removed'],
    removed: ['removed'],
  },
  initial: ['pending_review', 'published'],
});
export const NAIL_SHOWCASE_COMMENT = defineStateMachine({
  name: 'nail_showcase_comment', table: 'nail_showcase_comments', column: 'status',
  states: ['published', 'hidden', 'reported', 'removed'],
  transitions: { published: ['hidden', 'reported', 'removed'], reported: ['hidden', 'published', 'removed'], hidden: ['hidden', 'published', 'removed'], removed: ['removed'] },
  initial: ['published'],
});
export const NAIL_SHOWCASE_REPORT = defineStateMachine({
  name: 'nail_showcase_report', table: 'nail_showcase_reports', column: 'status',
  states: ['open', 'reviewed', 'dismissed', 'action_taken'],
  transitions: { open: ['reviewed', 'dismissed', 'action_taken'], reviewed: ['reviewed', 'dismissed', 'action_taken'], dismissed: ['action_taken'] },
  initial: ['open'],
});

/** tech_salon_memberships.status — the employment relationship between a global technician and one salon. A row is
 *  re-used when the relationship starts again (re-hire, re-request, transfer), so ended states lead back to pending /
 *  active; a Super-Admin pause is lifted only by Super Admin; a platform suspension / revocation only ends. */
export const TECH_SALON_MEMBERSHIP = defineStateMachine({
  name: 'tech_salon_membership', table: 'tech_salon_memberships', column: 'status',
  states: ['pending_invite', 'pending_tech_approval', 'pending_salon_approval', 'active', 'paused', 'suspended', 'former', 'rejected', 'revoked', 'cancelled'],
  transitions: {
    pending_invite: ['pending_invite', 'pending_tech_approval', 'pending_salon_approval', 'active', 'cancelled', 'former'],
    pending_tech_approval: ['pending_invite', 'pending_tech_approval', 'pending_salon_approval', 'active', 'cancelled', 'former'],
    pending_salon_approval: ['pending_invite', 'pending_tech_approval', 'pending_salon_approval', 'active', 'rejected', 'cancelled', 'former'],
    active: ['active', 'pending_invite', 'pending_tech_approval', 'paused', 'former'],
    paused: ['active', 'former'],
    former: ['pending_invite', 'pending_tech_approval', 'pending_salon_approval', 'active'],
    rejected: ['pending_invite', 'pending_tech_approval', 'pending_salon_approval', 'active'],
    cancelled: ['pending_invite', 'pending_tech_approval', 'pending_salon_approval', 'active'],
    suspended: ['former'],
    revoked: ['former'],
  },
  initial: ['pending_invite', 'pending_tech_approval', 'pending_salon_approval', 'active'],
});

/** tech_portfolio_photos.moderation_status — a salon (or Super Admin) approves / hides a portfolio photo; reversible. */
export const TECH_PORTFOLIO_PHOTO = defineStateMachine({
  name: 'tech_portfolio_photo', table: 'tech_portfolio_photos', column: 'moderation_status',
  states: ['pending', 'approved', 'hidden', 'rejected'],
  transitions: { pending: ['approved', 'hidden', 'rejected'], approved: ['approved', 'hidden', 'rejected'], hidden: ['approved', 'hidden', 'rejected'], rejected: ['approved', 'hidden', 'rejected'] },
  initial: ['pending', 'approved'],
});

/** tech_profile_change_requests.status (646, Technician Profile §95) — a held public-profile edit: a manager approves / rejects, or she withdraws; all final. */
export const TECH_PROFILE_CHANGE_REQUEST = defineStateMachine({
  name: 'tech_profile_change_request', table: 'tech_profile_change_requests', column: 'status',
  states: ['pending', 'approved', 'rejected', 'withdrawn'],
  transitions: { pending: ['approved', 'rejected', 'withdrawn'], approved: [], rejected: [], withdrawn: [] },
  initial: ['pending'],
});

/** tech_dm_threads.status — either party blocks; a block is final (a fresh matter is a fresh thread). */
export const TECH_DM_THREAD = defineStateMachine({
  name: 'tech_dm_thread', table: 'tech_dm_threads', column: 'status',
  states: ['active', 'blocked_by_customer', 'blocked_by_technician'],
  transitions: { active: ['blocked_by_customer', 'blocked_by_technician'], blocked_by_customer: ['blocked_by_customer', 'blocked_by_technician'], blocked_by_technician: ['blocked_by_customer', 'blocked_by_technician'] },
  initial: ['active'],
});
export const TECH_DM_REPORT = defineStateMachine({
  name: 'tech_dm_report', table: 'tech_dm_reports', column: 'status',
  states: ['open', 'resolved'], transitions: { open: ['resolved'] }, initial: ['open'],
});

/** technician_time_off.status (528 + 582) — the time-off REQUEST workflow (merge Oct 12 2026, Technician Profile mandate
 *  §20–§21): a technician's request is `pending`; a manager decides it ONCE (approved | rejected — compare-and-set, so two
 *  managers cannot both decide); a pending request is withdrawn (cancelled) by its technician; an approved entry can still
 *  be cancelled (the AI scheduling optimizer's own entries, and a manager revoking approved leave). Only `approved` removes
 *  availability. Moved here from modules/ai/src/ai-lifecycles.ts (ai re-exports it) — one machine per table.column. */
export const TECHNICIAN_TIME_OFF = defineStateMachine({
  name: 'technician_time_off', table: 'technician_time_off', column: 'status',
  states: ['pending', 'approved', 'rejected', 'cancelled'],
  transitions: { pending: ['approved', 'rejected', 'cancelled'], approved: ['cancelled'] },
  initial: ['approved', 'pending'],
});

/** technician_workforce_state (579) — the ONE operational state (merge Oct 12 2026, Technician Profile mandate §11/§147).
 *  Every write is a version compare-and-set in KyselyWorkforceStateStore.cas, which asserts these three machines against
 *  the row it is replacing. Self-moves are listed: a transition that changes ANOTHER fact (manual unavailable, a service
 *  starting) rewrites the clock / shift unchanged. queue_status is DERIVED (deriveQueue), so any state may follow any. */
export const TECH_WORKFORCE_CLOCK = defineStateMachine({
  name: 'tech_workforce_clock', table: 'technician_workforce_state', column: 'clock_status',
  states: ['CLOCKED_OUT', 'CLOCKED_IN', 'ON_BREAK'],
  transitions: { CLOCKED_OUT: ['CLOCKED_OUT', 'CLOCKED_IN'], CLOCKED_IN: ['CLOCKED_IN', 'ON_BREAK', 'CLOCKED_OUT'], ON_BREAK: ['ON_BREAK', 'CLOCKED_IN', 'CLOCKED_OUT'] },
  initial: ['CLOCKED_OUT', 'CLOCKED_IN', 'ON_BREAK'],
});
export const TECH_WORKFORCE_SHIFT = defineStateMachine({
  name: 'tech_workforce_shift', table: 'technician_workforce_state', column: 'shift_status',
  states: ['OFF_SHIFT', 'ON_SHIFT'],
  transitions: { OFF_SHIFT: ['OFF_SHIFT', 'ON_SHIFT'], ON_SHIFT: ['ON_SHIFT', 'OFF_SHIFT'] },
  initial: ['OFF_SHIFT', 'ON_SHIFT'],
});
export const TECH_WORKFORCE_QUEUE = defineStateMachine({
  name: 'tech_workforce_queue', table: 'technician_workforce_state', column: 'queue_status',
  states: ['AVAILABLE', 'ASSIGNED', 'SERVING', 'BREAK', 'UNAVAILABLE', 'OFF_SHIFT'],
  transitions: {
    AVAILABLE: ['AVAILABLE', 'ASSIGNED', 'SERVING', 'BREAK', 'UNAVAILABLE', 'OFF_SHIFT'],
    ASSIGNED: ['AVAILABLE', 'ASSIGNED', 'SERVING', 'BREAK', 'UNAVAILABLE', 'OFF_SHIFT'],
    SERVING: ['AVAILABLE', 'ASSIGNED', 'SERVING', 'BREAK', 'UNAVAILABLE', 'OFF_SHIFT'],
    BREAK: ['AVAILABLE', 'ASSIGNED', 'SERVING', 'BREAK', 'UNAVAILABLE', 'OFF_SHIFT'],
    UNAVAILABLE: ['AVAILABLE', 'ASSIGNED', 'SERVING', 'BREAK', 'UNAVAILABLE', 'OFF_SHIFT'],
    OFF_SHIFT: ['AVAILABLE', 'ASSIGNED', 'SERVING', 'BREAK', 'UNAVAILABLE', 'OFF_SHIFT'],
  },
  initial: ['AVAILABLE', 'ASSIGNED', 'SERVING', 'BREAK', 'UNAVAILABLE', 'OFF_SHIFT'],
});
