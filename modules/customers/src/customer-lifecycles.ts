// customer-lifecycles.ts — BUILD_PLAN Phase 12 (#27): the customers module's lifecycles as state machines.
import { defineStateMachine } from '@aipowersalon/database';

/** customer_recon_runs.status — the 7 PM reconciliation run: RUNNING until it finishes (once). */
export const CUSTOMER_RECON_RUN = defineStateMachine({
  name: 'customer_recon_run', table: 'customer_recon_runs', column: 'status',
  states: ['RUNNING', 'COMPLETED', 'COMPLETED_WITH_ISSUES', 'PARTIAL', 'FAILED'],
  transitions: { RUNNING: ['COMPLETED', 'COMPLETED_WITH_ISSUES', 'PARTIAL', 'FAILED'] },
  initial: ['RUNNING'],
});

/** global_customers.status — a global identity is merged into another at most once; a MERGED one never comes back. */
export const GLOBAL_CUSTOMER = defineStateMachine({
  name: 'global_customer', table: 'global_customers', column: 'status',
  states: ['active', 'archived', 'merged'],
  transitions: { active: ['active', 'archived', 'merged'], archived: ['active', 'archived', 'merged'] },
  initial: ['active'],
});

/** customer_identity_conflicts.status — NEW → REVIEWING → a decision; a decided conflict may be re-opened for review
 *  (the Super Admin screen has always allowed it), never silently re-decided without passing REVIEWING. */
const DECIDED = ['RESOLVED', 'MERGED', 'KEEP_SEPARATE', 'IGNORED', 'FALSE_POSITIVE'] as const;
export const CUSTOMER_IDENTITY_CONFLICT = defineStateMachine({
  name: 'customer_identity_conflict', table: 'customer_identity_conflicts', column: 'status',
  states: ['NEW', 'REVIEWING', 'RESOLVED', 'MERGED', 'KEEP_SEPARATE', 'IGNORED', 'FALSE_POSITIVE'],
  transitions: {
    NEW: ['NEW', 'REVIEWING', ...DECIDED], REVIEWING: ['NEW', 'REVIEWING', ...DECIDED],
    RESOLVED: ['REVIEWING'], MERGED: ['REVIEWING'], KEEP_SEPARATE: ['REVIEWING'], IGNORED: ['REVIEWING'], FALSE_POSITIVE: ['REVIEWING'],
  },
  initial: ['NEW'],
});

/** customer_legal_holds.status — active → released, once. */
export const CUSTOMER_LEGAL_HOLD = defineStateMachine({
  name: 'customer_legal_hold', table: 'customer_legal_holds', column: 'status',
  states: ['active', 'released'],
  transitions: { active: ['released'] },
  initial: ['active'],
});

/** referral_redemptions.status — a referral is rewarded ONCE (marking it rewarded again used to re-write the reward). */
export const REFERRAL_REDEMPTION = defineStateMachine({
  name: 'referral_redemption', table: 'referral_redemptions', column: 'status',
  states: ['pending', 'rewarded', 'void'],
  transitions: { pending: ['rewarded', 'void'] },
  initial: ['pending'],
});

// ── Referral Program guide (Oct 30 2026, migration 751) ─────────────────────────────────────────────────────────────────
/** referral_redemptions.state — the canonical referral journey. RECORDED is not QUALIFIED; QUALIFIED is not APPROVED;
 *  APPROVED is not REWARD_ISSUED. REJECTED / EXPIRED / CANCELLED / REVERSED are final (history is kept, never deleted). */
export const REFERRAL = defineStateMachine({
  name: 'referral', table: 'referral_redemptions', column: 'state',
  states: ['RECORDED', 'PENDING_QUALIFICATION', 'QUALIFIED', 'REWARD_PENDING_APPROVAL', 'APPROVED', 'REWARD_ISSUED', 'REJECTED', 'EXPIRED', 'CANCELLED', 'REVERSED', 'UNDER_REVIEW'],
  transitions: {
    RECORDED: ['PENDING_QUALIFICATION', 'UNDER_REVIEW', 'REJECTED', 'CANCELLED'],
    PENDING_QUALIFICATION: ['QUALIFIED', 'UNDER_REVIEW', 'EXPIRED', 'CANCELLED', 'REJECTED'],
    QUALIFIED: ['REWARD_PENDING_APPROVAL', 'APPROVED', 'UNDER_REVIEW', 'REJECTED'],
    REWARD_PENDING_APPROVAL: ['APPROVED', 'REJECTED', 'UNDER_REVIEW'],
    UNDER_REVIEW: ['PENDING_QUALIFICATION', 'QUALIFIED', 'REWARD_PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'CANCELLED'],
    APPROVED: ['REWARD_ISSUED', 'UNDER_REVIEW', 'REJECTED'],
    REWARD_ISSUED: ['REVERSED', 'UNDER_REVIEW'],
  },
  initial: ['RECORDED', 'PENDING_QUALIFICATION'],
});

/** referral_rewards.state — the reward obligation. ISSUED (points / credit posted once) is not paid cash; a cash payout with
 *  no approved provider is BLOCKED_EXTERNAL, never "paid". A retried issuance after FAILED reuses the same issuance key. */
/** Refer a Friend build (Nov 5 2026, migration 815): one salon-local referral voucher (friend / referrer). PENDING (the
 *  referrer's, until the friend's verified paid first visit) → AVAILABLE (a live wallet coupon) → REDEEMED at Checkout; VOID
 *  (refund / reversal / dispute, unused), EXPIRED (past its date, unused) and RELEASED (a pending one that can no longer
 *  qualify) free the budget it held. */
export const REFERRAL_VOUCHER = defineStateMachine({
  name: 'referral_voucher', table: 'referral_vouchers', column: 'state',
  states: ['PENDING', 'AVAILABLE', 'REDEEMED', 'EXPIRED', 'VOID', 'RELEASED'],
  transitions: {
    PENDING: ['AVAILABLE', 'RELEASED', 'VOID'],
    AVAILABLE: ['REDEEMED', 'EXPIRED', 'VOID'],
  },
  initial: ['PENDING', 'AVAILABLE'],
});

export const REFERRAL_REWARD = defineStateMachine({
  name: 'referral_reward', table: 'referral_rewards', column: 'state',
  states: ['PENDING_APPROVAL', 'APPROVED', 'ISSUED', 'REJECTED', 'REVERSED', 'BLOCKED_EXTERNAL', 'FAILED'],
  transitions: {
    PENDING_APPROVAL: ['APPROVED', 'REJECTED'],
    APPROVED: ['ISSUED', 'BLOCKED_EXTERNAL', 'FAILED', 'REJECTED'],
    FAILED: ['ISSUED', 'BLOCKED_EXTERNAL', 'REJECTED'],
    BLOCKED_EXTERNAL: ['REJECTED'],
    ISSUED: ['REVERSED'],
  },
  initial: ['PENDING_APPROVAL', 'APPROVED'],
});

/** customer_referrals.status — a code can be disabled (and enabled again) by a manager; its referrals are untouched. */
export const REFERRAL_CODE = defineStateMachine({
  name: 'referral_code', table: 'customer_referrals', column: 'status',
  states: ['active', 'disabled'],
  transitions: { active: ['disabled'], disabled: ['active'] },
  initial: ['active'],
});

// ── Customer Retention win-back SMS (migration 709) and nightly snapshots (724) ──────────────────────────────────────
// Deliberate refusals (each was possible through an unconditional write before):
//   • retention_sms_recipient: nothing moves BACK to 'queued' or 'submitting' — a recipient whose text may have reached
//     the provider (submitting / sent / unknown) can never be queued and sent again; sent / blocked / failed / unknown
//     are final.
//   • retention_sms_campaign: a confirmed campaign never returns to draft; a finished one (completed / partial / failed /
//     expired / canceled) is never re-opened.
//   • customer_retention_snapshot_run: a COMPLETED run is never re-claimed (the nightly job skips it) or marked failed.

/** retention_sms_campaigns.status — draft (a preview, expires) → queued (confirmed) → sending → completed | partial |
 *  failed. A queued campaign whose every recipient was blocked at send time finishes without passing 'sending'.
 *  'canceled' is the stop the worker honours (a canceled campaign's queued recipients are blocked, never sent). */
export const RETENTION_SMS_CAMPAIGN = defineStateMachine({
  name: 'retention_sms_campaign', table: 'retention_sms_campaigns', column: 'status',
  states: ['draft', 'queued', 'sending', 'completed', 'partial', 'failed', 'expired', 'canceled'],
  transitions: {
    draft: ['queued', 'expired', 'canceled'],
    queued: ['sending', 'completed', 'partial', 'failed', 'canceled'],
    sending: ['completed', 'partial', 'failed', 'canceled'],
  },
  initial: ['draft'],
});

/** retention_sms_recipients.status — excluded (every preview row) → queued (confirmed) → submitting (committed BEFORE
 *  the provider call) → sent | blocked | failed; a job that finds 'submitting' marks it 'unknown' and never re-sends. */
export const RETENTION_SMS_RECIPIENT = defineStateMachine({
  name: 'retention_sms_recipient', table: 'retention_sms_recipients', column: 'status',
  states: ['excluded', 'queued', 'submitting', 'sent', 'blocked', 'failed', 'unknown'],
  transitions: {
    excluded: ['queued'],
    queued: ['submitting', 'blocked'],
    submitting: ['sent', 'blocked', 'failed', 'unknown'],
  },
  initial: ['excluded'],
});

/** customer_retention_snapshot_runs.status — running → completed | failed; a failed (or a stale running) run is claimed
 *  again by the retry; completed is final. */
export const CUSTOMER_RETENTION_SNAPSHOT_RUN = defineStateMachine({
  name: 'customer_retention_snapshot_run', table: 'customer_retention_snapshot_runs', column: 'status',
  states: ['running', 'completed', 'failed'],
  transitions: { running: ['running', 'completed', 'failed'], failed: ['running'] },
  initial: ['running'],
});

/** segment_audience_drafts.status — Customer Segments guide §10 C: an UNSENT audience. draft → discarded (the owner threw
 *  it away) | expired (past expires_at); both final. Nothing here sends: Campaign Center owns approval and sending. */
export const SEGMENT_AUDIENCE_DRAFT = defineStateMachine({
  name: 'segment_audience_draft', table: 'segment_audience_drafts', column: 'status',
  states: ['draft', 'discarded', 'expired'],
  transitions: { draft: ['discarded', 'expired'] },
  initial: ['draft'],
});

/** customer_duplicate_scans.status (761): running → completed | failed. */
export const CUSTOMER_DUPLICATE_SCAN = defineStateMachine({
  name: 'customer_duplicate_scan', table: 'customer_duplicate_scans', column: 'status',
  states: ['running', 'completed', 'failed'], transitions: { running: ['completed', 'failed'] }, initial: ['running'],
});
/** customer_duplicate_groups.status (761): a group is reviewed (in review / deferred / kept separate), resolved by a scan
 *  that no longer finds it, reopened (pending) by new evidence or a manager, and MERGED — the one end state (its sources
 *  are archived; it can never reappear). A scan re-touches every live group in place (self-moves). */
const DUP_ALL = ['pending', 'in_review', 'deferred', 'failed', 'kept_separate', 'resolved', 'merged'] as const;
export const CUSTOMER_DUPLICATE_GROUP = defineStateMachine({
  name: 'customer_duplicate_group', table: 'customer_duplicate_groups', column: 'status',
  states: ['pending', 'in_review', 'deferred', 'failed', 'kept_separate', 'resolved', 'merged'],
  transitions: { pending: DUP_ALL, in_review: DUP_ALL, deferred: DUP_ALL, failed: DUP_ALL, kept_separate: DUP_ALL, resolved: DUP_ALL },
  initial: ['pending', 'deferred', 'kept_separate'],
});

/** customer_merge_snapshots.status — round 10 (Customer 08): a completed merge's snapshot is active until it is undone,
 *  once (the table's guard trigger allows exactly this change). */
export const CUSTOMER_MERGE_SNAPSHOT = defineStateMachine({
  name: 'customer_merge_snapshot', table: 'customer_merge_snapshots', column: 'status',
  states: ['active', 'undone'],
  transitions: { active: ['undone'] },
  initial: ['active'],
});
