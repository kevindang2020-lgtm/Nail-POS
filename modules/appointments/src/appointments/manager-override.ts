// manager-override.ts — ONE rule for the `managerOverride` flag every front-desk write accepts (merge Oct 12 2026, carried
// from the other chat's Technician Profile phase 1 / workforce audit P0 #7; the mandate's "unless authorized override").
//
//   • The flag is honoured ONLY when the session holds `pos.booking.override_conflict` (alias booking.override). A request
//     that asks for an override WITHOUT the permission is refused (403) — never silently downgraded, so the desk learns
//     that an owner/manager must do it, and never granted by a client checkbox.
//   • Every honoured override is audited by the caller (the `onUsed` hook receives the action + actor).
//   • What an override may bypass is decided by the caller: availability, store / working hours, an overlap (written as a
//     FLAGGED overbook — migration 482). It never bypasses the hard rules (skills, employment, branch, a state machine).
import { hasPermission } from '@aipowersalon/permissions';

export const MANAGER_OVERRIDE_PERMISSION = 'pos.booking.override_conflict';

export class ManagerOverrideForbiddenError extends Error {
  readonly code = 'MANAGER_OVERRIDE_FORBIDDEN';
  constructor(action: string) { super(`A manager override (${MANAGER_OVERRIDE_PERMISSION}) is required for ${action}.`); this.name = 'ManagerOverrideForbiddenError'; }
}

export interface ManagerOverrideUse { action: string; userId: string; role: string; permission: string }

/**
 * Resolve the client's `managerOverride` flag against the session. Returns true only for an AUTHORISED override (and
 * reports it through `onUsed`); false when no override was requested; throws when one was requested without the right.
 */
export function resolveManagerOverride(
  ctx: { userId?: string; role?: string; tenantId?: string; branchId?: string | null; permissions?: string[] },
  requested: unknown,
  onUsed: (use: ManagerOverrideUse) => void,
  action: string,
): boolean {
  const asked = requested === true || requested === 'true' || requested === 1;
  if (!asked) return false;
  if (!hasPermission(ctx as any, MANAGER_OVERRIDE_PERMISSION)) throw new ManagerOverrideForbiddenError(action);
  onUsed({ action, userId: String(ctx.userId ?? ''), role: String(ctx.role ?? ''), permission: MANAGER_OVERRIDE_PERMISSION });
  return true;
}
