// platform-staff-core.ts — Constitution 7 §24–§26: who may change a platform account's role, as pure rules.
//
//  §25 grant ceiling: an actor may only grant a role whose every permission the actor already holds — a narrower
//      administrator cannot mint a broader one, whatever keys are later handed out.
//  §25 self-escalation: nobody changes their OWN platform role (up or down) — another platform administrator must.
//  §26 last Super Admin: the final ACTIVE PLATFORM_SUPER_ADMIN cannot be moved to another role; recovery capability
//      would be gone. (A protected transfer is: first make someone else PLATFORM_SUPER_ADMIN, then change this one.)
// The repository counts active super admins under a row lock and calls this inside the same transaction, so two
// administrators demoting each other at once cannot both succeed.
import { isPlatformRole, platformPermissionsFor, type PlatformRole } from '@aipowersalon/permissions';

export interface RoleChangeInput {
  actor: { userId: string; permissions: readonly string[] };
  target: { userId: string; isPlatformAccount: boolean; status: string; currentRole: string | null } | null;
  newRole: string;
  reason: string;
  /** active PLATFORM_SUPER_ADMIN accounts, counted under lock in the same transaction */
  activeSuperAdmins: number;
}
export type RoleChangeDecision =
  | { ok: true; from: PlatformRole | null; to: PlatformRole }
  | { ok: false; status: 400 | 403 | 404 | 409; code: string; message: string };

export const MIN_REASON = 10;

export function decideRoleChange(i: RoleChangeInput): RoleChangeDecision {
  if (!i.actor.permissions.includes('super_admin.platform_roles.manage')) return { ok: false, status: 403, code: 'forbidden', message: 'Changing platform roles requires super_admin.platform_roles.manage.' };
  if (!isPlatformRole(i.newRole)) return { ok: false, status: 400, code: 'unknown_role', message: 'Unknown platform role.' };
  if ((i.reason ?? '').trim().length < MIN_REASON) return { ok: false, status: 400, code: 'reason_required', message: `A reason of at least ${MIN_REASON} characters is required.` };
  if (!i.target || !i.target.isPlatformAccount) return { ok: false, status: 404, code: 'not_found', message: 'Platform account not found.' };
  if (i.target.userId === i.actor.userId) return { ok: false, status: 403, code: 'self_change', message: 'You cannot change your own platform role. Another platform administrator must.' };
  // §25 grant ceiling: every permission of the new role must already be the actor's
  const granted = platformPermissionsFor(i.newRole) as string[];
  const beyond = granted.filter((k) => !i.actor.permissions.includes(k));
  if (beyond.length) return { ok: false, status: 403, code: 'beyond_grant_ceiling', message: `That role includes permissions you do not hold (${beyond.length}).` };
  const from = isPlatformRole(i.target.currentRole) ? i.target.currentRole : null;
  if (from === i.newRole) return { ok: false, status: 409, code: 'no_change', message: 'The account already has that role.' };
  // §26 last recovery-capable administrator
  if (from === 'PLATFORM_SUPER_ADMIN' && i.target.status === 'active' && i.activeSuperAdmins <= 1) {
    return { ok: false, status: 409, code: 'last_super_admin', message: 'This is the last active Platform Super Admin. Make another account Platform Super Admin first.' };
  }
  return { ok: true, from, to: i.newRole };
}

/**
 * §24 / §26 — suspending or reactivating a PLATFORM account. Same authority as a role change (platform_roles.manage);
 * never your own account; a reason of 10+ characters; and the last ACTIVE PLATFORM_SUPER_ADMIN cannot be suspended
 * (recovery capability would be gone).
 */
export function decideStatusChange(i: { actor: { userId: string; permissions: readonly string[] }; target: { userId: string; status: string; role: string | null } | null;
    to: string; reason: string; activeSuperAdmins: number }): { ok: true; from: string; to: 'active' | 'suspended' } | { ok: false; status: 400 | 403 | 404 | 409; code: string; message: string } {
  if (!i.actor.permissions.includes('super_admin.platform_roles.manage')) return { ok: false, status: 403, code: 'forbidden', message: 'Managing platform accounts requires super_admin.platform_roles.manage.' };
  if (i.to !== 'active' && i.to !== 'suspended') return { ok: false, status: 400, code: 'invalid_status', message: 'Status must be active or suspended.' };
  if ((i.reason ?? '').trim().length < MIN_REASON) return { ok: false, status: 400, code: 'reason_required', message: `A reason of at least ${MIN_REASON} characters is required.` };
  if (!i.target) return { ok: false, status: 404, code: 'not_found', message: 'Platform account not found.' };
  if (i.target.userId === i.actor.userId) return { ok: false, status: 403, code: 'self_change', message: 'You cannot suspend or reactivate your own account.' };
  if (i.target.status === i.to) return { ok: false, status: 409, code: 'no_change', message: `The account is already ${i.to}.` };
  if (i.to === 'suspended' && i.target.role === 'PLATFORM_SUPER_ADMIN' && i.target.status === 'active' && i.activeSuperAdmins <= 1) {
    return { ok: false, status: 409, code: 'last_super_admin', message: 'This is the last active Platform Super Admin and cannot be suspended.' };
  }
  return { ok: true, from: i.target.status, to: i.to };
}
