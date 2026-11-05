import type { DeletionStatus } from '@aipowersalon/api-contracts/platform';
export type { DeletionStatus };   // owned by packages/api-contracts (Constitution 13 §13)
// Permanent-deletion workflow — pure, DB-free. Encodes the dual-approval state machine and the execute gate. The
// legal-hold guard itself lives in legal-hold-lifecycle; this module enforces the *other* preconditions (a second,
// distinct approver; an exact typed customer-ID confirmation; a passed retention check) and surfaces precise reasons.


export interface ValidationResult { ok: boolean; errors: string[] }

export function validateRequest(input: { tenantId?: string; customerId?: string; reason?: string }): ValidationResult {
  const errors: string[] = [];
  if (!input.tenantId?.trim()) errors.push('A tenant is required.');
  if (!input.customerId?.trim()) errors.push('A customer is required.');
  if (!input.reason?.trim()) errors.push('A reason is required.');
  return { ok: errors.length === 0, errors };
}

/** Second approval must come from a DIFFERENT user than the requester, and only on a requested deletion. */
export function canApprove(status: DeletionStatus, requesterUserId: string | null, approverUserId: string | null): ValidationResult {
  const errors: string[] = [];
  if (status !== 'requested') errors.push('Only a requested deletion can be approved.');
  if (!approverUserId) errors.push('An approver identity is required.');
  if (approverUserId && requesterUserId && approverUserId === requesterUserId) errors.push('The approver must be a different person than the requester (dual control).');
  return { ok: errors.length === 0, errors };
}

export interface ExecuteContext {
  status: DeletionStatus;
  customerId: string;
  typedConfirmation: string;     // executor must type the exact customer id
  retentionOk: boolean;          // retention policy permits deletion
  legalHoldBlocked: boolean;     // an active hold covers the customer
}

/** Execution is permitted only when the request is approved, the typed confirmation exactly matches the customer
 *  id, retention permits deletion, and no legal hold blocks it. Returns every failed precondition. */
export function validateExecute(ctx: ExecuteContext): ValidationResult {
  const errors: string[] = [];
  if (ctx.status !== 'approved') errors.push('The deletion must be approved by a second reviewer before it can be executed.');
  if (ctx.typedConfirmation.trim() !== ctx.customerId.trim()) errors.push('The typed confirmation does not match the customer ID.');
  if (!ctx.retentionOk) errors.push('A retention policy currently prevents deleting this record.');
  if (ctx.legalHoldBlocked) errors.push('This record is under an active legal hold and cannot be deleted until the hold is released.');
  return { ok: errors.length === 0, errors };
}
