// Pure validation for controlled CROSS-TENANT worker transfers (§31). Higher risk than a same-tenant branch move:
// the destination must be a DIFFERENT tenant, the reason bar is higher, and (enforced at the UI) a typed worker-name
// confirmation is required. Approval only records the decision — it never provisions access or moves history here.

export const CROSS_TRANSFER_STATUSES = ['requested', 'approved', 'rejected', 'cancelled'] as const;
export type CrossTransferStatus = (typeof CROSS_TRANSFER_STATUSES)[number];
export const CROSS_TRANSFER_DECISIONS = ['approve', 'reject'] as const;
export type CrossTransferDecision = (typeof CROSS_TRANSFER_DECISIONS)[number];

// Elevated minimum vs. the same-tenant branch transfer (8) — a cross-tenant move warrants a fuller justification.
export const MIN_CROSS_REASON_LEN = 12;
export const CROSS_TRANSFER_REQUEST_AUDIT_TYPE = 'workforce_cross_tenant_transfer_requested';
export const CROSS_TRANSFER_DECIDE_AUDIT_TYPE = 'workforce_cross_tenant_transfer_decided';

export interface CrossTransferRequestInput { toTenantId?: unknown; toBranchId?: unknown; effectiveDate?: unknown; reason?: unknown }
export type CrossTransferRequestValidation =
  | { ok: true; toTenantId: string; toBranchId: string | null; effectiveDate: string | null; reason: string }
  | { ok: false; error: string };

const isIsoDate = (s: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));

// Destination tenant is mandatory and must differ from the worker's current tenant (a cross-tenant transfer that stays
// in the same tenant is a category error — use the branch transfer). Effective date, when supplied, must be a real date.
export function validateCrossTransferRequest(input: CrossTransferRequestInput, currentTenantId: string | null): CrossTransferRequestValidation {
  const toTenantId = typeof input?.toTenantId === 'string' ? input.toTenantId.trim() : '';
  if (!toTenantId) return { ok: false, error: 'toTenantId is required' };
  if (currentTenantId && toTenantId === currentTenantId) return { ok: false, error: 'destination tenant must differ from the current tenant' };
  const toBranchId = typeof input?.toBranchId === 'string' && input.toBranchId.trim() ? input.toBranchId.trim() : null;
  let effectiveDate: string | null = null;
  if (input?.effectiveDate != null && String(input.effectiveDate).trim() !== '') {
    const d = String(input.effectiveDate).trim();
    if (!isIsoDate(d)) return { ok: false, error: 'effectiveDate must be a valid YYYY-MM-DD date' };
    effectiveDate = d;
  }
  const reason = typeof input?.reason === 'string' ? input.reason.trim() : '';
  if (reason.length < MIN_CROSS_REASON_LEN) return { ok: false, error: `reason is required (at least ${MIN_CROSS_REASON_LEN} characters)` };
  return { ok: true, toTenantId, toBranchId, effectiveDate, reason };
}

export interface CrossTransferDecisionInput { decision?: unknown; note?: unknown }
export type CrossTransferDecisionValidation = { ok: true; decision: CrossTransferDecision; note: string | null } | { ok: false; error: string };

export function validateCrossTransferDecision(input: CrossTransferDecisionInput): CrossTransferDecisionValidation {
  const decision = input?.decision;
  if (decision !== 'approve' && decision !== 'reject') return { ok: false, error: `decision must be one of: ${CROSS_TRANSFER_DECISIONS.join(', ')}` };
  const note = typeof input?.note === 'string' ? input.note.trim() : '';
  if (decision === 'reject' && note.length < MIN_CROSS_REASON_LEN) return { ok: false, error: `a note (at least ${MIN_CROSS_REASON_LEN} characters) is required to reject` };
  return { ok: true, decision, note: note || null };
}
