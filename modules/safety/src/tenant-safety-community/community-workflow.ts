// community-workflow.ts — the posting workflow as a pure state machine. It encodes the safety-critical rules
// that (a) nothing is published without passing the privacy scan, (b) receptionist-authored posts require
// manager/admin approval, (c) serious categories require Super-Admin moderation, and (d) a post is never
// marked "verified" merely because a user submitted it. Transitions are role- and scan-gated; illegal
// transitions are rejected. PURE — no I/O.
//
// BUILD_PLAN Phase 8: the full lifecycle (author re-submit after correction / sensitive data / evidence request, withdraw,
// every moderator decision, restore, relabel, dispute outcomes, resolve). Callers ALWAYS pass the post's REAL current
// status (bug 4: moderation used to hard-code `moderation_review` as the start state). A moderator publish / restore /
// relabel lands on the published state that matches the post's verification LABEL (publishedStateFor) — publishing
// never sets `evidence_reviewed` on its own.
import type { CommunityRole } from './community-classification';
import type { CommunityScanResult } from './community-privacy-scan';
import { scanDisposition } from './community-privacy-scan';

export type WorkflowState =
  | 'incident_draft' | 'tenant_review' | 'privacy_scan' | 'manager_approval' | 'moderation_review'
  | 'published_unverified' | 'published_evidence_reviewed' | 'published_multiple_reports' | 'published_official_report'
  | 'returned_for_correction' | 'sensitive_data_detected' | 'insufficient_information'
  | 'evidence_requested' | 'rejected' | 'disputed' | 'corrected' | 'resolved' | 'removed' | 'archived';

export type WorkflowEvent =
  | 'submit_for_tenant_review' | 'run_privacy_scan' | 'request_manager_approval' | 'manager_approve'
  | 'manager_return' | 'submit_for_moderation' | 'moderator_publish' | 'moderator_reject'
  | 'moderator_request_evidence' | 'moderator_request_changes' | 'dispute' | 'dispute_upheld' | 'correct' | 'resolve'
  | 'remove' | 'restore' | 'relabel' | 'archive' | 'submit' | 'withdraw' | 'edit';

export type VerificationLabel = 'unverified' | 'evidence_reviewed' | 'multiple_reports' | 'official_report';

// Categories that MUST go through Super-Admin moderation before they can be published.
export const MODERATION_REQUIRED_CATEGORIES: ReadonlySet<string> = new Set([
  'threat_or_violence', 'harassment_or_abusive_conduct', 'employee_safety_incident', 'customer_safety_incident',
  'fake_ai_powersalon_representative', 'account_takeover_attempt', 'stolen_payment_method_concern',
]);

// Critical severity always requires moderation before platform-wide distribution.
export interface WorkflowContext {
  role: CommunityRole;
  receptionistApprovalRequired: boolean;  // tenant setting (default true)
  category: string;
  severity: 'informational' | 'low' | 'moderate' | 'high' | 'critical';
  scan?: CommunityScanResult;
  managerApprovalRequired: boolean;        // tenant setting
  /** the post's verification label — decides which published_* state a publish / restore / relabel lands on */
  verificationLabel?: VerificationLabel | string;
  /** the post was flagged for Super Admin moderation (serious category, critical, reputation, wording) */
  moderationRequired?: boolean;
}

export type TransitionResult = { ok: true; state: WorkflowState } | { ok: false; error: string };
const ok = (state: WorkflowState): TransitionResult => ({ ok: true, state });
const err = (error: string): TransitionResult => ({ ok: false, error });

export const PUBLISHED_STATES: readonly WorkflowState[] = ['published_unverified', 'published_evidence_reviewed', 'published_multiple_reports', 'published_official_report'];
/** A `published_*` state (the four labelled published states). disputed / corrected / resolved stay community-visible too
 *  (see community-classification isCommunityVisible) but are not "published_*". */
export function isPublishedState(s: string): boolean { return (PUBLISHED_STATES as readonly string[]).includes(s); }

/** The published state that matches a verification label (unknown → published_unverified: never upgrade by accident). */
export function publishedStateFor(label: VerificationLabel | string | null | undefined): WorkflowState {
  switch (label) {
    case 'evidence_reviewed': return 'published_evidence_reviewed';
    case 'multiple_reports': return 'published_multiple_reports';
    case 'official_report': return 'published_official_report';
    default: return 'published_unverified';
  }
}

const APPROVER: ReadonlySet<CommunityRole> = new Set<CommunityRole>(['owner', 'tenant_admin', 'branch_manager']);
const AUTHOR: ReadonlySet<CommunityRole> = new Set<CommunityRole>(['owner', 'tenant_admin', 'branch_manager', 'receptionist']);

const CAN_PUBLISH_DIRECTLY = (ctx: WorkflowContext): boolean =>
  !ctx.moderationRequired && ctx.severity !== 'critical' && !MODERATION_REQUIRED_CATEGORIES.has(ctx.category);

/** Where an author's submit lands: blocked scan → sensitive_data_detected; approval required → manager_approval; a
 *  post needing moderation → moderation_review; otherwise published (label-matched, so `unverified` for a new post). */
function submitTarget(ctx: WorkflowContext): TransitionResult {
  if (!AUTHOR.has(ctx.role)) return err('author_role_required');
  if (!ctx.scan) return err('scan_required');
  if (scanDisposition(ctx.scan) === 'blocked') return ok('sensitive_data_detected');
  if (requiresApprovalBeforePublish(ctx)) return ok('manager_approval');
  return CAN_PUBLISH_DIRECTLY(ctx) ? ok(publishedStateFor(ctx.verificationLabel)) : ok('moderation_review');
}

export function transition(state: WorkflowState, event: WorkflowEvent, ctx: WorkflowContext): TransitionResult {
  const moderator = ctx.role === 'moderator';
  switch (`${state}:${event}`) {
    case 'incident_draft:submit_for_tenant_review':
      return ok('tenant_review');

    case 'tenant_review:run_privacy_scan':
    case 'incident_draft:run_privacy_scan': {
      if (!ctx.scan) return err('scan_required');
      const d = scanDisposition(ctx.scan);
      if (d === 'blocked') return ok('sensitive_data_detected');   // payment/ID data — cannot proceed
      if (d === 'needs_review') return ok('sensitive_data_detected'); // customer PII redacted — human confirms
      return ok('manager_approval');
    }

    case 'sensitive_data_detected:run_privacy_scan': {
      // re-scan after the author fixes the content
      if (!ctx.scan) return err('scan_required');
      return scanDisposition(ctx.scan) === 'clean' ? ok('manager_approval') : ok('sensitive_data_detected');
    }

    // ── the author's submit (first submit and every re-submit after a correction) ──
    case 'incident_draft:submit':
    case 'returned_for_correction:submit':
    case 'evidence_requested:submit':
    case 'sensitive_data_detected:submit':
      return submitTarget(ctx);

    // ── the author pulls a pending post back into drafts ──
    case 'manager_approval:withdraw':
    case 'sensitive_data_detected:withdraw':
    case 'returned_for_correction:withdraw':
      if (!AUTHOR.has(ctx.role)) return err('author_role_required');
      return ok('incident_draft');

    case 'manager_approval:manager_approve': {
      if (!APPROVER.has(ctx.role)) return err('approver_role_required');           // receptionist/technician cannot approve
      return CAN_PUBLISH_DIRECTLY(ctx) ? ok(publishedStateFor(ctx.verificationLabel)) : ok('moderation_review');
    }
    case 'manager_approval:manager_return':
      if (!APPROVER.has(ctx.role)) return err('approver_role_required');
      return ok('returned_for_correction');
    case 'manager_approval:submit_for_moderation':
      return ok('moderation_review');

    // ── Super Admin moderation (agent B) ──
    case 'moderation_review:moderator_publish':
    case 'sensitive_data_detected:moderator_publish':
      if (!moderator) return err('moderator_required');
      return ok(publishedStateFor(ctx.verificationLabel));
    case 'moderation_review:moderator_reject':
    case 'sensitive_data_detected:moderator_reject':
    case 'evidence_requested:moderator_reject':
      if (!moderator) return err('moderator_required');
      return ok('rejected');
    case 'moderation_review:moderator_request_changes':
    case 'sensitive_data_detected:moderator_request_changes':
      if (!moderator) return err('moderator_required');
      return ok('returned_for_correction');
    case 'moderation_review:moderator_request_evidence':
      if (!moderator) return err('moderator_required');
      return ok('evidence_requested');

    case 'returned_for_correction:submit_for_tenant_review':
      return ok('tenant_review');
    case 'evidence_requested:submit_for_moderation':
      return ok('moderation_review');

    // ── post-publish lifecycle ──
    case 'published_unverified:dispute':
    case 'published_evidence_reviewed:dispute':
    case 'published_multiple_reports:dispute':
    case 'published_official_report:dispute':
      return ok('disputed');
    case 'disputed:dispute_upheld':
      if (!moderator) return err('moderator_required');
      return ok(publishedStateFor(ctx.verificationLabel));
    case 'disputed:correct':
      return ok('corrected');

    case 'published_unverified:relabel':
    case 'published_evidence_reviewed:relabel':
    case 'published_multiple_reports:relabel':
    case 'published_official_report:relabel':
      if (!moderator) return err('moderator_required');
      return ok(publishedStateFor(ctx.verificationLabel));

    case 'published_unverified:resolve':
    case 'published_evidence_reviewed:resolve':
    case 'published_multiple_reports:resolve':
    case 'published_official_report:resolve':
    case 'corrected:resolve':
    case 'disputed:resolve':
      if (!moderator && !APPROVER.has(ctx.role)) return err('approver_role_required');
      return ok('resolved');

    // an approver's edit of a visible post: payment / ID data hides it again for moderation; a change that now needs
    // moderation (serious category / critical) goes to the moderation queue; otherwise the status is unchanged.
    case 'published_unverified:edit':
    case 'published_evidence_reviewed:edit':
    case 'published_multiple_reports:edit':
    case 'published_official_report:edit':
    case 'corrected:edit':
    case 'disputed:edit':
      if (!APPROVER.has(ctx.role)) return err('approver_role_required');
      if (!ctx.scan) return err('scan_required');
      if (scanDisposition(ctx.scan) === 'blocked') return ok('sensitive_data_detected');
      // here ctx.moderationRequired means "this edit NEWLY needs moderation" (the caller compares before / after) —
      // a post a moderator already cleared is not pulled from the feed by an ordinary edit
      if (ctx.moderationRequired) return ok('moderation_review');
      return ok(state);

    case 'published_unverified:remove':
    case 'published_evidence_reviewed:remove':
    case 'published_multiple_reports:remove':
    case 'published_official_report:remove':
    case 'disputed:remove':
    case 'corrected:remove':
    case 'resolved:remove':
      if (!moderator) return err('moderator_required');
      return ok('removed');
    case 'removed:restore':
      if (!moderator) return err('moderator_required');
      return ok(publishedStateFor(ctx.verificationLabel));

    case 'resolved:archive':
    case 'removed:archive':
      return ok('archived');

    default:
      return err(`illegal_transition:${state}:${event}`);
  }
}

/** A receptionist can create drafts but the tenant setting decides whether their post needs approval before
 *  it can ever reach moderation/publication. */
export function requiresApprovalBeforePublish(ctx: Pick<WorkflowContext, 'role' | 'receptionistApprovalRequired' | 'managerApprovalRequired'>): boolean {
  if (ctx.role === 'receptionist') return ctx.receptionistApprovalRequired;
  if (ctx.role === 'technician') return true; // technicians never publish directly
  return ctx.managerApprovalRequired;
}
