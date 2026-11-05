// Pure validation + pipeline shaping for controlled worker branch transfers (§30).
// A transfer is a reviewed request: created first, then approved (executes the branch move) or rejected. This module
// has no DB/Nest deps so the rules are unit-testable in isolation.

export const TRANSFER_STATUSES = ['requested', 'approved', 'rejected', 'cancelled'] as const;
export type TransferStatus = (typeof TRANSFER_STATUSES)[number];
export const TRANSFER_DECISIONS = ['approve', 'reject'] as const;
export type TransferDecision = (typeof TRANSFER_DECISIONS)[number];

export const MIN_TRANSFER_REASON_LEN = 8;
export const TRANSFER_REQUEST_AUDIT_TYPE = 'workforce_transfer_requested';
export const TRANSFER_DECIDE_AUDIT_TYPE = 'workforce_transfer_decided';

export interface TransferRequestInput { toBranchId?: unknown; reason?: unknown }
export type TransferRequestValidation = { ok: true; toBranchId: string; reason: string } | { ok: false; error: string };

// A transfer needs a real destination branch that differs from the worker's current branch, plus a mandatory reason.
export function validateTransferRequest(input: TransferRequestInput, currentBranchId: string | null): TransferRequestValidation {
  const toBranchId = typeof input?.toBranchId === 'string' ? input.toBranchId.trim() : '';
  if (!toBranchId) return { ok: false, error: 'toBranchId is required' };
  if (currentBranchId && toBranchId === currentBranchId) return { ok: false, error: 'worker is already assigned to that branch' };
  const reason = typeof input?.reason === 'string' ? input.reason.trim() : '';
  if (reason.length < MIN_TRANSFER_REASON_LEN) return { ok: false, error: `reason is required (at least ${MIN_TRANSFER_REASON_LEN} characters)` };
  return { ok: true, toBranchId, reason };
}

export interface TransferDecisionInput { decision?: unknown; note?: unknown }
export type TransferDecisionValidation = { ok: true; decision: TransferDecision; note: string | null } | { ok: false; error: string };

// Approve executes the move; reject must say why (note required) so the audit trail explains the outcome.
export function validateTransferDecision(input: TransferDecisionInput): TransferDecisionValidation {
  const decision = input?.decision;
  if (decision !== 'approve' && decision !== 'reject') return { ok: false, error: `decision must be one of: ${TRANSFER_DECISIONS.join(', ')}` };
  const note = typeof input?.note === 'string' ? input.note.trim() : '';
  if (decision === 'reject' && note.length < MIN_TRANSFER_REASON_LEN) return { ok: false, error: `a note (at least ${MIN_TRANSFER_REASON_LEN} characters) is required to reject` };
  return { ok: true, decision, note: note || null };
}

// Shape raw status counts into a stable pipeline summary for the panel (fills missing statuses with 0).
export function summarizeTransferPipeline(counts: { status: string; count: number }[]): { total: number; byStatus: Record<TransferStatus, number> } {
  const byStatus = { requested: 0, approved: 0, rejected: 0, cancelled: 0 } as Record<TransferStatus, number>;
  let total = 0;
  for (const c of counts || []) {
    const s = String(c.status || '').toLowerCase() as TransferStatus;
    const n = Number(c.count) || 0;
    if (s in byStatus) { byStatus[s] += n; total += n; }
  }
  return { total, byStatus };
}
