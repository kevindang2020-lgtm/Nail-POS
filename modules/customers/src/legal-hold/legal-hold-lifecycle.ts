import type { LegalHoldStatus, LegalHoldScope } from '@aipowersalon/api-contracts/platform';
export type { LegalHoldStatus, LegalHoldScope };   // owned by packages/api-contracts (Constitution 13 §13)
// Legal Hold lifecycle — pure, DB-free. Encodes what a valid hold requires, when it can be released, and the core
// safeguard the rest of the platform relies on: an active hold BLOCKS permanent deletion and destructive merge.


export interface ApplyHoldInput { tenantId?: string; matterRef?: string; reason?: string; scope?: string; customerId?: string | null }
export interface ReleaseHoldInput { reason?: string }
export interface ValidationResult { ok: boolean; errors: string[] }

const SCOPES: LegalHoldScope[] = ['customer', 'branch', 'tenant'];

/** A hold requires a tenant, a matter reference, a reason, and a valid scope; a customer-scoped hold also needs a customer. */
export function validateApplyHold(input: ApplyHoldInput): ValidationResult {
  const errors: string[] = [];
  if (!input.tenantId || !input.tenantId.trim()) errors.push('A tenant is required.');
  if (!input.matterRef || !input.matterRef.trim()) errors.push('A matter / case reference is required.');
  if (!input.reason || !input.reason.trim()) errors.push('A reason is required.');
  const scope = (input.scope || 'customer') as LegalHoldScope;
  if (!SCOPES.includes(scope)) errors.push(`Scope must be one of: ${SCOPES.join(', ')}.`);
  if (scope === 'customer' && !(input.customerId && String(input.customerId).trim())) errors.push('A customer is required for a customer-scoped hold.');
  return { ok: errors.length === 0, errors };
}

/** Release requires a reason and is only valid on an active hold. */
export function validateReleaseHold(currentStatus: LegalHoldStatus, input: ReleaseHoldInput): ValidationResult {
  const errors: string[] = [];
  if (currentStatus !== 'active') errors.push('Only an active hold can be released.');
  if (!input.reason || !input.reason.trim()) errors.push('A reason is required to release a hold.');
  return { ok: errors.length === 0, errors };
}

export interface HoldLike { status: LegalHoldStatus; scope: LegalHoldScope; customerId: string | null; tenantId: string }

/**
 * Does any active hold block deletion of this customer? An active customer-scoped hold on the customer blocks it;
 * an active tenant- or branch-scoped hold covering the customer's tenant also blocks it. This is the guard the
 * permanent-deletion and destructive-merge flows MUST consult.
 */
export function deletionBlockedByHold(holds: HoldLike[], target: { tenantId: string; customerId: string }): boolean {
  return holds.some((h) =>
    h.status === 'active' && h.tenantId === target.tenantId && (
      (h.scope === 'customer' && h.customerId === target.customerId) ||
      h.scope === 'tenant' ||
      h.scope === 'branch'
    ));
}
