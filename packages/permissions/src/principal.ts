// principal.ts — BUILD_PLAN Phase 9 (Constitution 2 §148): the ONLY place backend code asks "which PLANE is this
// principal on?" by role name. Authorization inside a plane is a PERMISSION (hasPermission / the decision object), never
// a role name; but the planes themselves — customer, salon staff, platform (Super Admin), a display device — are
// identities, and a service that must refuse a whole plane (defence in depth behind RealmGuard and the session realm)
// asks here instead of carrying its own FORBIDDEN_ROLES list. check:role-checks allowlists this file and nothing that
// could be a permission.
import { hasPermission, type Ctx } from './security-core';

type RoleLike = string | { role?: unknown } | null | undefined;
const roleOf = (p: RoleLike): string => String((typeof p === 'string' ? p : p?.role) ?? '').toUpperCase();

/** The platform plane (Super Admin, incl. every platform role — they all sign in as SUPER_ADMIN). */
export function isPlatformPrincipal(p: RoleLike): boolean { return roleOf(p) === 'SUPER_ADMIN'; }

/** The customer plane (a customer's own app session). */
export function isCustomerPrincipal(p: RoleLike): boolean { return roleOf(p) === 'CUSTOMER'; }

/** A paired customer-facing display / kiosk device — never a person, never staff. */
export function isDevicePrincipal(p: RoleLike): boolean { return roleOf(p) === 'CUSTOMER_DISPLAY'; }

/**
 * A salon-side principal: not a customer, not a display device, and (unless `allowPlatform`) not the platform. What the
 * staff services' old `FORBIDDEN_ROLES = ['CUSTOMER', 'CUSTOMER_DISPLAY', 'SUPER_ADMIN']` lists said, in one place (a context
 * with no role — an internal caller — passes, exactly as it did those lists).
 * Which staff member may do WHAT is still a permission.
 */
export function isStaffPrincipal(p: RoleLike, opts: { allowPlatform?: boolean } = {}): boolean {
  if (isCustomerPrincipal(p) || isDevicePrincipal(p)) return false;
  if (isPlatformPrincipal(p)) return !!opts.allowPlatform;
  return true;
}

/**
 * The tenant-wide READ scope: may this principal see every branch of the salon rather than only the branch it is signed
 * in to? A permission, not a role name — `owner.branches.compare` (the owner's cross-branch view; OWNER-level templates
 * hold it, a branch manager does not). Used where a service used to say `role === 'OWNER' ? all branches : my branch`.
 */
export const TENANT_WIDE_READ_KEY = 'owner.branches.compare';
export function hasTenantWideScope(ctx: Pick<Ctx, 'role' | 'permissions'> | null | undefined): boolean {
  if (!ctx) return false;
  return hasPermission(ctx as Ctx, TENANT_WIDE_READ_KEY);
}
