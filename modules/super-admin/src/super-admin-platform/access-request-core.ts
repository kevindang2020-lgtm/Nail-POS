// access-request-core.ts — pure rules for the access-request workflow (§26). No I/O, so unit-tested. Two safety
// invariants live here: an approver can never grant a role above their OWN authority (deny-by-default), and
// privileged grants are flagged high-risk so the service can require explicit confirmation (two-person extension).

// Authority ranking of the fixed system roles. Higher = more authority. Unknown roles rank 0 (deny).
const ROLE_RANK: Record<string, number> = { SUPER_ADMIN: 100, OWNER: 80, MANAGER: 60, RECEPTION: 40, FRONT_DESK: 40, TECHNICIAN: 20, CUSTOMER: 0 };
const GRANTABLE = ['OWNER', 'MANAGER', 'FRONT_DESK', 'RECEPTION', 'TECHNICIAN', 'SUPER_ADMIN'];

export function roleRank(role: string): number { return ROLE_RANK[role] ?? 0; }
export function isGrantableRole(role: string): boolean { return GRANTABLE.includes(role); }

/** An approver may grant a role only at or below their own authority; SUPER_ADMIN is grantable only by a SUPER_ADMIN. */
export function approverCanGrant(approverRole: string, requestedRole: string): boolean {
  if (!isGrantableRole(requestedRole)) return false;
  if (requestedRole === 'SUPER_ADMIN') return approverRole === 'SUPER_ADMIN';
  return roleRank(approverRole) >= roleRank(requestedRole);
}

/** Privileged elevations require extra care (high-risk → explicit confirmation / two-person where required). */
export function isHighRisk(requestedRole: string): boolean {
  return requestedRole === 'OWNER' || requestedRole === 'SUPER_ADMIN';
}

export type RequestAction = 'review' | 'approve' | 'reject' | 'cancel';
export type TransitionResult = { ok: true; next: string } | { ok: false; reason: 'invalid_transition' };

/** Lifecycle guard. Decisions act only on open requests (submitted / under_review); everything else is terminal. */
export function decideTransition(current: string, action: RequestAction): TransitionResult {
  const open = current === 'submitted' || current === 'under_review';
  switch (action) {
    case 'review': return current === 'submitted' ? { ok: true, next: 'under_review' } : { ok: false, reason: 'invalid_transition' };
    case 'approve': return open ? { ok: true, next: 'approved' } : { ok: false, reason: 'invalid_transition' };
    case 'reject': return open ? { ok: true, next: 'rejected' } : { ok: false, reason: 'invalid_transition' };
    case 'cancel': return open ? { ok: true, next: 'cancelled' } : { ok: false, reason: 'invalid_transition' };
    default: return { ok: false, reason: 'invalid_transition' };
  }
}

/** Expiry instant for a temporary grant (null = permanent). */
export function grantExpiry(now: Date, durationDays: number | null | undefined): Date | null {
  if (!durationDays || durationDays <= 0) return null;
  return new Date(now.getTime() + durationDays * 24 * 60 * 60 * 1000);
}

// ── batch 8 decision 6 (Nov 9 2026): the roles a signed-in salon user may REQUEST — one policy, served to the POS ──
/** tenant roles a salon user may ask for (never a platform role); the dropdown and the server read this same list */
export const SELF_REQUESTABLE_ROLES = ['OWNER', 'MANAGER', 'FRONT_DESK', 'RECEPTION', 'TECHNICIAN'] as const;
export type RequestableRoleState = 'available' | 'held' | 'open_request' | 'not_requestable';
/** Pure: each requestable role for this user — held / already asked for / available — with the high-risk flag. */
export function requestableRoles(currentRole: string | null | undefined, openRequestRoles: string[]): { role: string; highRisk: boolean; state: RequestableRoleState }[] {
  const cur = String(currentRole ?? '').toUpperCase();
  return SELF_REQUESTABLE_ROLES.map((role) => ({ role, highRisk: isHighRisk(role),
    state: role === cur ? 'held' : openRequestRoles.includes(role) ? 'open_request' : 'available' }));
}
