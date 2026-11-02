// approvals.ts — BUILD_PLAN Phase 9 (agent D): the salon approvals engine's wire shapes beyond the base set in
// authorization.ts (ApprovalRequestView / ApprovalPage / ApprovalCreateRequest / ApprovalDecisionRequest /
// ApprovalPolicyView / ApprovalPolicyUpdate). A refund policy has TWO limits (cash and any method — Kevin's decision 3:
// $50 / $200 by default) and a policy may cap what a non-owner approver may approve; the base view carries one number.
import type { ApprovalPolicyUpdate, ApprovalPolicyView, ApprovalRequestView } from './authorization';

export interface ApprovalPolicyDetail extends ApprovalPolicyView {
  label: string;
  cashThresholdCents: number | null;     // refund only: cash refunds need an approver past this (cumulative per payment)
  approverLimitCents: number | null;     // a decider WITHOUT approvals.manage_policies may approve up to this; null = no cap
}
export interface ApprovalPolicyChange extends ApprovalPolicyUpdate {
  cashThresholdCents?: number | null;
  approverLimitCents?: number | null;
}
/** POST pos/approvals — `created: false` when a live request for the same subject already existed (it is returned). */
export interface ApprovalCreateResult { request: ApprovalRequestView; created: boolean }
/** A money action that was SENT FOR APPROVAL instead of being done (e.g. a front-desk refund past the salon's limit). */
export interface ApprovalPendingResult { status: 'approval_pending'; approvalId: string; expiresAt: string | null; message: string }
