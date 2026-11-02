/**
 * branch-transfer-core.ts — pure, DB-free rules for the controlled branch-transfer REQUEST (§33).
 *
 * A transfer moves a branch from one tenant to another. This is high-risk and is deliberately NOT a tenant dropdown
 * edit: the command records a reviewed REQUEST plus a pre-transfer impact snapshot; the actual cross-tenant data move
 * is a separate, reviewed/scheduled job (not executed inline), so historical and financial ownership is never silently
 * rewritten. These helpers validate the request shape and document the impacted data domains; the repository enforces
 * destination validity and the typed-confirmation match against the REAL branch row.
 */

export interface TransferRequestInput { destinationTenantId?: unknown; reason?: unknown; effectiveDate?: unknown; confirmName?: unknown; }
export interface TransferRequestValue { destinationTenantId: string; reason: string; effectiveDate: string | null; confirmName: string; }
export type TransferRequestValidation = { ok: true; value: TransferRequestValue } | { ok: false; errors: string[] };

const s = (v: unknown): string => (v == null ? '' : String(v)).trim();
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function validateTransferRequest(input: TransferRequestInput | undefined): TransferRequestValidation {
  const i = input || {};
  const errors: string[] = [];
  const destinationTenantId = s(i.destinationTenantId);
  if (!destinationTenantId) errors.push('A destination tenant is required.');
  const reason = s(i.reason);
  if (reason.length < 10) errors.push('A detailed business reason (at least 10 characters) is required for a transfer.');
  // Branch transfer is always high-risk → typed confirmation with the branch name (matched server-side).
  const confirmName = s(i.confirmName);
  if (!confirmName) errors.push('Type the exact branch name to confirm this transfer.');
  const effRaw = s(i.effectiveDate);
  let effectiveDate: string | null = null;
  if (effRaw) {
    if (!ISO_DATE.test(effRaw) || Number.isNaN(Date.parse(effRaw))) errors.push('Effective date must be a valid date (YYYY-MM-DD).');
    else effectiveDate = effRaw;
  }
  if (errors.length) return { ok: false, errors };
  return { ok: true, value: { destinationTenantId, reason, effectiveDate, confirmName } };
}

/**
 * Documented data domains affected by a transfer (§33). `move` = follows the branch to the new tenant; `retain` = kept
 * with original tenant ownership for legal/financial retention (never silently reassigned). This list is policy shown on
 * the confirmation screen; the actual per-domain migration is performed by the reviewed execution job, not this request.
 */
export const TRANSFER_IMPACT_DOMAINS: { domain: string; disposition: 'move' | 'retain' | 'review' }[] = [
  { domain: 'Branch record, address, hours, devices', disposition: 'move' },
  { domain: 'Staff & technician assignments', disposition: 'move' },
  { domain: 'Service catalog & product/inventory at the branch', disposition: 'move' },
  { domain: 'Upcoming appointments & live queue', disposition: 'move' },
  { domain: 'Merchant account & payment-processing config', disposition: 'review' },
  { domain: 'Memberships, gift cards & loyalty balances', disposition: 'review' },
  { domain: 'Completed payments & settlement history', disposition: 'retain' },
  { domain: 'Historical reporting & audit trail', disposition: 'retain' },
  { domain: 'Customer records & privacy/consent', disposition: 'review' },
  { domain: 'Subscription & feature limits / billing', disposition: 'review' },
];
