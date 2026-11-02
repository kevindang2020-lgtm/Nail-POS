/**
 * branch-manager-core.ts — pure, DB-free validation for the controlled Assign Manager command (§34).
 *
 * "Manager" of a branch is a MANAGER/OWNER user linked to the branch (users.branch_id); the dashboard derives the
 * displayed manager from exactly that. Assigning relinks such a user to this branch and mirrors their name/email/phone
 * onto the branch row for display. The repository enforces tenant membership, role, and active status against the REAL
 * user row inside the transaction; these helpers validate the request shape and are unit-tested without a database.
 *
 * Note: a user has a single branch_id, so assigning a manager who currently belongs to another branch MOVES them — the
 * previous assignment is replaced, not retained. The UI surfaces this and the audit records the move.
 */

export const ASSIGNABLE_MANAGER_ROLES = ['MANAGER', 'OWNER'] as const;

export interface AssignManagerInput { managerUserId?: unknown; effectiveDate?: unknown; reason?: unknown; }
export interface AssignManagerValue { managerUserId: string; effectiveDate: string | null; reason: string; }
export type AssignManagerValidation = { ok: true; value: AssignManagerValue } | { ok: false; errors: string[] };

const s = (v: unknown): string => (v == null ? '' : String(v)).trim();
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function validateAssignManager(input: AssignManagerInput | undefined): AssignManagerValidation {
  const i = input || {};
  const errors: string[] = [];
  const managerUserId = s(i.managerUserId);
  if (!managerUserId) errors.push('A manager must be selected.');
  const reason = s(i.reason);
  if (reason.length < 3) errors.push('A reason is required to assign a branch manager.');
  const effRaw = s(i.effectiveDate);
  let effectiveDate: string | null = null;
  if (effRaw) {
    if (!ISO_DATE.test(effRaw) || Number.isNaN(Date.parse(effRaw))) errors.push('Effective date must be a valid date (YYYY-MM-DD).');
    else effectiveDate = effRaw;
  }
  if (errors.length) return { ok: false, errors };
  return { ok: true, value: { managerUserId, effectiveDate, reason } };
}
