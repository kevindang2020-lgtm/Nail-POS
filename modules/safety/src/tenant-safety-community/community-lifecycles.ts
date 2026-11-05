// community-lifecycles.ts — BUILD_PLAN Phase 12 (#27): the Tenant Safety Community status lifecycles, ONE transition table
// each. Every status write in the community repositories runs through its machine (canMoveToSql in the conditional
// UPDATE, or assertTransition before it), on top of the row locks / version checks the code already had.
import { defineStateMachine } from '@aipowersalon/database';

const PUBLISHED = ['published_unverified', 'published_evidence_reviewed', 'published_multiple_reports', 'published_official_report'] as const;

/** community_posts.status — the posting workflow (community-workflow.ts transition()) flattened to state level: every
 *  (state, event, context) the workflow accepts, enumerated (community-lifecycles.vitest.spec proves the table equals the
 *  workflow), plus the two writes that do not go through an event — an overturned rejection appeal goes back to the
 *  review queue (rejected → moderation_review) and the retention sweep archives a resolved post — and a SELF move on
 *  every non-archived state (a moderator redaction / severity / comment-lock / link writes the row with its status
 *  unchanged). An archived post never moves again. */
export const COMMUNITY_POST = defineStateMachine({
  name: 'community_post', table: 'community_posts', column: 'status',
  states: ['incident_draft', 'tenant_review', 'privacy_scan', 'manager_approval', 'moderation_review', ...PUBLISHED,
    'returned_for_correction', 'sensitive_data_detected', 'insufficient_information', 'evidence_requested', 'rejected', 'disputed', 'corrected', 'resolved', 'removed', 'archived'],
  transitions: {
    incident_draft: ['incident_draft', 'tenant_review', 'manager_approval', 'moderation_review', 'sensitive_data_detected', ...PUBLISHED],
    tenant_review: ['tenant_review', 'manager_approval', 'sensitive_data_detected'],
    privacy_scan: ['privacy_scan'],
    manager_approval: ['manager_approval', 'incident_draft', 'moderation_review', 'returned_for_correction', ...PUBLISHED],
    moderation_review: ['moderation_review', 'evidence_requested', 'rejected', 'returned_for_correction', ...PUBLISHED],
    published_unverified: ['disputed', 'moderation_review', 'removed', 'resolved', 'sensitive_data_detected', ...PUBLISHED],
    published_evidence_reviewed: ['disputed', 'moderation_review', 'removed', 'resolved', 'sensitive_data_detected', ...PUBLISHED],
    published_multiple_reports: ['disputed', 'moderation_review', 'removed', 'resolved', 'sensitive_data_detected', ...PUBLISHED],
    published_official_report: ['disputed', 'moderation_review', 'removed', 'resolved', 'sensitive_data_detected', ...PUBLISHED],
    returned_for_correction: ['returned_for_correction', 'incident_draft', 'tenant_review', 'manager_approval', 'moderation_review', 'sensitive_data_detected', ...PUBLISHED],
    sensitive_data_detected: ['sensitive_data_detected', 'incident_draft', 'manager_approval', 'moderation_review', 'rejected', 'returned_for_correction', ...PUBLISHED],
    insufficient_information: ['insufficient_information'],
    evidence_requested: ['evidence_requested', 'manager_approval', 'moderation_review', 'rejected', 'sensitive_data_detected', ...PUBLISHED],
    rejected: ['rejected', 'moderation_review'],
    disputed: ['disputed', 'corrected', 'moderation_review', 'removed', 'resolved', 'sensitive_data_detected', ...PUBLISHED],
    corrected: ['corrected', 'moderation_review', 'removed', 'resolved', 'sensitive_data_detected'],
    resolved: ['resolved', 'archived', 'removed'],
    removed: ['removed', 'archived', ...PUBLISHED],
  },
  initial: ['incident_draft'],
});

/** community_evidence.upload_status — pending → uploaded | failed (size mismatch, storage missing); a moderator's
 *  rejection marks an uploaded (or failed) file failed. A failed upload never becomes uploaded. */
export const COMMUNITY_EVIDENCE_UPLOAD = defineStateMachine({
  name: 'community_evidence_upload', table: 'community_evidence', column: 'upload_status',
  states: ['pending_upload', 'uploaded', 'failed'],
  transitions: { pending_upload: ['uploaded', 'failed'], uploaded: ['failed'], failed: ['failed'] },
  initial: ['pending_upload'],
});

/** community_evidence.scan_status — fails closed: no verdict keeps it unscanned (a repeat), a verdict is final (the
 *  scanner path already skipped clean / infected files; the write now refuses to overwrite one). */
export const COMMUNITY_EVIDENCE_SCAN = defineStateMachine({
  name: 'community_evidence_scan', table: 'community_evidence', column: 'scan_status',
  states: ['unscanned', 'error', 'clean', 'infected'],
  transitions: { unscanned: ['unscanned', 'clean', 'infected'], error: ['unscanned', 'clean', 'infected'] },
  initial: ['unscanned'],
});

/** community_evidence.redaction_status — a moderator's review: pending → not_required | redacted; a file judged clean
 *  may later be redacted; a REDACTED file is never marked "not required" again (that would re-expose what was hidden —
 *  the review write used to be unconditional). */
export const COMMUNITY_EVIDENCE_REDACTION = defineStateMachine({
  name: 'community_evidence_redaction', table: 'community_evidence', column: 'redaction_status',
  states: ['pending', 'not_required', 'redacted'],
  transitions: { pending: ['not_required', 'redacted'], not_required: ['not_required', 'redacted'], redacted: ['redacted'] },
  initial: ['pending'],
});

/** community_moderation_cases.status — a moderator's work item. Moderators may move a case freely between its four
 *  states (reopen included — today's behaviour; the one-open-case-per-post index still holds); the machine makes the
 *  write conditional on the state read under the row lock. */
export const COMMUNITY_MODERATION_CASE = defineStateMachine({
  name: 'community_moderation_case', table: 'community_moderation_cases', column: 'status',
  states: ['open', 'investigating', 'resolved', 'closed'],
  transitions: {
    open: ['open', 'investigating', 'resolved', 'closed'],
    investigating: ['open', 'investigating', 'resolved', 'closed'],
    resolved: ['open', 'investigating', 'resolved', 'closed'],
    closed: ['open', 'investigating', 'resolved', 'closed'],
  },
  initial: ['open'],
});

/** community_reports.status / community_comment_reports.status — open (or reviewing) → actioned | dismissed, once. */
export const COMMUNITY_REPORT = defineStateMachine({
  name: 'community_report', table: 'community_reports', column: 'status',
  states: ['open', 'reviewing', 'actioned', 'dismissed'],
  transitions: { open: ['reviewing', 'actioned', 'dismissed'], reviewing: ['actioned', 'dismissed'] },
  initial: ['open'],
});
export const COMMUNITY_COMMENT_REPORT = defineStateMachine({
  name: 'community_comment_report', table: 'community_comment_reports', column: 'status',
  states: ['open', 'reviewing', 'actioned', 'dismissed'],
  transitions: { open: ['reviewing', 'actioned', 'dismissed'], reviewing: ['actioned', 'dismissed'] },
  initial: ['open'],
});

/** community_disputes.status — open / under_review → upheld | overturned (a moderator's decision) or withdrawn; once. */
export const COMMUNITY_DISPUTE = defineStateMachine({
  name: 'community_dispute', table: 'community_disputes', column: 'status',
  states: ['open', 'under_review', 'upheld', 'overturned', 'withdrawn'],
  transitions: { open: ['under_review', 'upheld', 'overturned', 'withdrawn'], under_review: ['upheld', 'overturned', 'withdrawn'] },
  initial: ['open'],
});

/** community_appeals.status — submitted / under_review → upheld | overturned or withdrawn; once. */
export const COMMUNITY_APPEAL = defineStateMachine({
  name: 'community_appeal', table: 'community_appeals', column: 'status',
  states: ['submitted', 'under_review', 'upheld', 'overturned', 'withdrawn'],
  transitions: { submitted: ['under_review', 'upheld', 'overturned', 'withdrawn'], under_review: ['upheld', 'overturned', 'withdrawn'] },
  initial: ['submitted'],
});
