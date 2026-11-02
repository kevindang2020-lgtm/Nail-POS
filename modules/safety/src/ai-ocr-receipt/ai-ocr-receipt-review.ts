// ai-ocr-receipt-review.ts — PURE review + approval logic. Human corrections are recorded with before/after snapshots
// (never fabricated); approval rules can only ADD requirements (higher amounts need explicit / dual approval, restricted
// categories always need approval) — they can never remove the review gate. The decision engine will NOT mark a document
// 'approved' until the required number of DISTINCT approvers have approved. This is the gate Stage 9 posting depends on.
import type { ConfidenceState } from './ai-ocr-receipt-core';
import type { ApprovalRules } from './ai-ocr-receipt-settings';

// ── field / line corrections ─────────────────────────────────────────────────
export interface CorrectableField { fieldKey: string; value: string | null; valueCents: number | null; state: ConfidenceState; correctedByUserId?: string | null; }
export interface FieldCorrectionAudit { fieldKey: string; before: { value: string | null; valueCents: number | null; state: ConfidenceState }; after: { value: string | null; valueCents: number | null; state: ConfidenceState }; userId: string; }
export interface FieldCorrectionResult { field: CorrectableField; audit: FieldCorrectionAudit; }

/** Apply a reviewer's correction to a field. Records before/after; marks the field manually_corrected (or _confirmed if
 *  the value is unchanged). PURE — returns a new field + audit entry, mutates nothing. */
export function applyFieldCorrection(field: CorrectableField, patch: { value?: string | null; valueCents?: number | null; userId: string; confirmOnly?: boolean }): FieldCorrectionResult {
  const before = { value: field.value, valueCents: field.valueCents, state: field.state };
  const nextValue = patch.confirmOnly ? field.value : (patch.value !== undefined ? patch.value : field.value);
  const nextCents = patch.confirmOnly ? field.valueCents : (patch.valueCents !== undefined ? patch.valueCents : field.valueCents);
  const unchanged = nextValue === field.value && nextCents === field.valueCents;
  const state: ConfidenceState = patch.confirmOnly || unchanged ? 'manually_confirmed' : 'manually_corrected';
  const after = { value: nextValue, valueCents: nextCents, state };
  return { field: { ...field, value: nextValue, valueCents: nextCents, state, correctedByUserId: patch.userId }, audit: { fieldKey: field.fieldKey, before, after, userId: patch.userId } };
}

// ── approval requirement ─────────────────────────────────────────────────────
export interface ApprovalRequirement { approversRequired: number; restricted: boolean; reasons: string[]; }

/** Determine how many approvers a document needs, given tenant rules. Rules only ever RAISE the bar. */
export function evaluateApprovalRequirement(doc: { totalCents: number | null; category: string | null }, rules: ApprovalRules): ApprovalRequirement {
  const reasons: string[] = [];
  let approversRequired = 1;
  const total = Math.abs(doc.totalCents ?? 0);
  if (total >= rules.requireApprovalAboveCents) reasons.push('amount_over_approval_threshold');
  if (rules.dualApprovalAboveCents != null && total >= rules.dualApprovalAboveCents) { approversRequired = 2; reasons.push('amount_over_dual_approval_threshold'); }
  const restricted = !!(doc.category && rules.restrictedCategories.includes(doc.category));
  if (restricted) reasons.push('restricted_category');
  return { approversRequired, restricted, reasons };
}

// ── decision engine ──────────────────────────────────────────────────────────
export type ReviewOutcome = 'in_review' | 'approved' | 'rejected' | 'returned';
export interface ApprovalEntry { userId: string; at: string; }
export interface ReviewDecisionState { status: ReviewOutcome; approvals: ApprovalEntry[]; }
export interface Decision { userId: string; action: 'approve' | 'reject' | 'return'; reason?: string | null; at: string; }
export interface DecisionResult { state: ReviewDecisionState; audit: { action: string; userId: string; reason: string | null; at: string; before: ReviewOutcome; after: ReviewOutcome }; error?: string; }

export function applyDecision(state: ReviewDecisionState, decision: Decision, requirement: ApprovalRequirement): DecisionResult {
  const before = state.status;
  const audit = (after: ReviewOutcome) => ({ action: decision.action, userId: decision.userId, reason: decision.reason ?? null, at: decision.at, before, after });
  if (state.status === 'approved' || state.status === 'rejected') return { state, audit: audit(state.status), error: 'already_final' };

  if (decision.action === 'reject') { const s: ReviewDecisionState = { status: 'rejected', approvals: state.approvals }; return { state: s, audit: audit('rejected') }; }
  if (decision.action === 'return') { const s: ReviewDecisionState = { status: 'returned', approvals: state.approvals }; return { state: s, audit: audit('returned') }; }

  // approve — a given user's approval only counts once (dual approval needs two DISTINCT people)
  const already = state.approvals.some((a) => a.userId === decision.userId);
  const approvals = already ? state.approvals : [...state.approvals, { userId: decision.userId, at: decision.at }];
  const finalized = approvals.length >= requirement.approversRequired;
  const status: ReviewOutcome = finalized ? 'approved' : 'in_review';
  return { state: { status, approvals }, audit: audit(status), error: already ? 'duplicate_approver_ignored' : undefined };
}

/** True only when the document has reached 'approved' with enough distinct approvers — the precondition for posting. */
export function isApproved(state: ReviewDecisionState, requirement: ApprovalRequirement): boolean {
  return state.status === 'approved' && state.approvals.length >= requirement.approversRequired;
}
