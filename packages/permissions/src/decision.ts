// decision.ts — BUILD_PLAN Phase 9 (Constitution 2 §decision object): ONE function answers "may this principal do this,
// to this record, and WHY". Before this the tenant side had a boolean (hasPermission) and a bare 403 'Missing permission';
// nobody could tell a denied-by-override from a never-granted from an out-of-branch. Now every answer is an AuthzDecision
// with a reason code (the AuthzReason union of @aipowersalon/api-contracts tenant/authorization.ts — duplicated here
// structurally because this package depends on nothing but tenant-context).
//
// THE ORDER (each step can end the decision):
//   1. inactive account                          → account_inactive
//   2. realm mismatch (platform ↔ tenant)        → platform_key_for_tenant / tenant_key_for_platform
//   3. an explicit DENY override (branch-aware)  → denied_by_override              (DENY always wins)
//   4. the role / template grant                 → granted_by_role / granted_by_template
//   5. an ALLOW override (incl. temporary)       → granted_by_override / granted_temporarily
//      none of 4–5                               → missing_permission
//   6. scope against the resource (tenant, OWN, BRANCH / SELECTED_BRANCHES; TENANT = any branch)
//                                                → out_of_branch_scope / out_of_own_scope
//   7. policy handlers (policies.ts)             → policy_denied (detail = the policy)
//
// Pure: no I/O, no Nest. `hasPermission` (security-core.ts) is the boolean façade over this.
import type { Role } from './rbac';
import type { AccessScope } from './role-templates';
import { requiredCapability } from './security-core';
import { runPolicies, type AuthzPolicyCheck } from './policies';

export type AuthzReason =
  | 'granted_by_role' | 'granted_by_template' | 'granted_by_override' | 'granted_temporarily'
  | 'denied_by_override' | 'missing_permission' | 'out_of_branch_scope' | 'out_of_own_scope' | 'out_of_assigned_scope'
  | 'platform_key_for_tenant' | 'tenant_key_for_platform' | 'account_inactive' | 'policy_denied' | 'step_up_required';
export interface AuthzDecision { allowed: boolean; key: string; reason: AuthzReason; scope: DecisionScope | null; detail?: string | null }

/** One per-user override row as the decision needs it (tenant_user_permission_overrides). */
export interface AuthzOverride {
  id?: string;
  permission: string;
  effect: 'ALLOW' | 'DENY';
  /** null = every branch the user may enter */
  branchId?: string | null;
  startsAt?: string | number | Date | null;
  /** set = temporary */
  expiresAt?: string | number | Date | null;
  revokedAt?: string | number | Date | null;
}

/** Who is asking. `permissions` is the role / template GRANT only (what the session was minted with or what the current
 *  grants say) — never with overrides folded in; those are `overrides`, applied here at decision time. */
export interface AuthzPrincipal {
  userId: string;
  tenantId: string | null;
  branchId?: string | null;
  role: Role | string;
  permissions: readonly string[];
  /** 'active' unless told otherwise (a session's principal is active by construction). */
  status?: string | null;
  templateKey?: string | null;
  /** The template's scope. Undefined = no scope check beyond the tenant (legacy callers). */
  scope?: DecisionScope | null;
  /** The branches the principal may act in; null / undefined = every branch of the salon. */
  branchIds?: readonly string[] | null;
  overrides?: readonly AuthzOverride[];
}

/** The record being acted on, when there is one. */
export interface AuthzResource { tenantId?: string | null; branchId?: string | null; ownerUserId?: string | null;
  /** Security Deep Scan §68: the users a record is ASSIGNED to (a ticket's technicians, an appointment's technician) */
  assignedUserIds?: readonly string[] | null }
/** Security Deep Scan §68: the decision scopes — the template scopes, plus ASSIGNED (records assigned to the principal) and
 *  PLATFORM (the platform role plane), which a salon role template never carries. */
export type DecisionScope = AccessScope | 'ASSIGNED' | 'PLATFORM';

export interface DecideOptions { now?: number | Date; policies?: readonly AuthzPolicyCheck[] }

const PLATFORM_PREFIX = 'super_admin.';
const ms = (v: string | number | Date | null | undefined): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = v instanceof Date ? v.getTime() : typeof v === 'number' ? v : Date.parse(String(v));
  return Number.isFinite(n) ? n : null;
};
const nowMs = (n?: number | Date): number => (n === undefined ? Date.now() : n instanceof Date ? n.getTime() : n);

/** Is the override live at this instant (started, not expired, not revoked)? */
export function overrideActive(o: AuthzOverride, now?: number | Date): boolean {
  const t = nowMs(now);
  if (ms(o.revokedAt) !== null) return false;
  const s = ms(o.startsAt); if (s !== null && s > t) return false;
  const e = ms(o.expiresAt); if (e !== null && e <= t) return false;
  return true;
}
/** Does a branch-bound override apply in this branch? A null override branch applies everywhere; a branch-bound one
 *  applies only when acting in that branch. */
export function overrideApplies(o: AuthzOverride, branchId: string | null | undefined): boolean {
  if (!o.branchId) return true;
  return !!branchId && o.branchId === branchId;
}
/** An override row matches a requested key directly, or through the coarse capability a granular pos.* key maps to. */
function overrideMatches(o: AuthzOverride, key: string): boolean {
  return o.permission === key || o.permission === requiredCapability(key);
}

const isPlatformRole = (role: string) => role === 'SUPER_ADMIN';
/** The grant set (role / template) holds the key, directly or via the granular→coarse mapping. */
export function grantHolds(perms: readonly string[], key: string): boolean {
  return perms.indexOf(key) >= 0 || perms.indexOf(requiredCapability(key)) >= 0;
}

/**
 * THE decision. See the header for the order. `resource.branchId` (when given) is the branch the override and scope
 * checks are made for; otherwise the principal's own branch.
 */
export function decide(p: AuthzPrincipal, key: string, resource?: AuthzResource | null, opts: DecideOptions = {}): AuthzDecision {
  const scope: DecisionScope | null = p.scope ?? null;
  const out = (allowed: boolean, reason: AuthzReason, detail?: string | null): AuthzDecision => ({ allowed, key, reason, scope, ...(detail ? { detail } : {}) });
  const role = String(p.role ?? '');
  // 1. inactive
  if (p.status && String(p.status).toLowerCase() !== 'active') return out(false, 'account_inactive');
  // 2. realm: platform keys never reach a salon principal; a platform principal never holds a salon key
  if (isPlatformRole(role)) {
    if (!key.startsWith(PLATFORM_PREFIX)) return out(false, 'tenant_key_for_platform');
    return (p.permissions || []).indexOf(key) >= 0 ? out(true, 'granted_by_role') : out(false, 'missing_permission');
  }
  if (key.startsWith(PLATFORM_PREFIX)) return out(false, 'platform_key_for_tenant');
  const t = nowMs(opts.now);
  const actingBranch = resource?.branchId ?? p.branchId ?? null;
  const live = (p.overrides ?? []).filter((o) => overrideActive(o, t) && overrideApplies(o, actingBranch) && overrideMatches(o, key));
  // 3. explicit DENY wins over everything
  const deny = live.find((o) => o.effect === 'DENY');
  if (deny) return out(false, 'denied_by_override', deny.id ?? null);
  // 4. role / template
  let granted: AuthzReason | null = grantHolds(p.permissions || [], key) ? (p.templateKey ? 'granted_by_template' : 'granted_by_role') : null;
  // 5. ALLOW override (a temporary one says so)
  if (!granted) {
    const allow = live.find((o) => o.effect === 'ALLOW');
    if (allow) granted = ms(allow.expiresAt) !== null ? 'granted_temporarily' : 'granted_by_override';
  }
  if (!granted) return out(false, 'missing_permission');
  // 6. scope against the record
  if (resource) {
    if (resource.tenantId && p.tenantId && resource.tenantId !== p.tenantId) return out(false, 'out_of_branch_scope', 'other_tenant');
    if (scope === 'OWN' && resource.ownerUserId !== undefined && resource.ownerUserId !== null && resource.ownerUserId !== p.userId) return out(false, 'out_of_own_scope');
    // §68 ASSIGNED: only a record assigned to the principal (or owned by them); a record that names neither is not decided here
    if (scope === 'ASSIGNED' && ((resource.assignedUserIds && resource.assignedUserIds.length) || (resource.ownerUserId !== undefined && resource.ownerUserId !== null))
      && !(resource.assignedUserIds ?? []).includes(p.userId) && resource.ownerUserId !== p.userId) return out(false, 'out_of_assigned_scope');
    if ((scope === 'BRANCH' || scope === 'SELECTED_BRANCHES') && resource.branchId) {
      const allowed = p.branchIds ?? null;
      if (allowed !== null && !allowed.includes(resource.branchId)) return out(false, 'out_of_branch_scope');
    }
  }
  // 7. policies
  const pol = runPolicies({ userId: p.userId, branchId: p.branchId ?? null, branchIds: p.branchIds ?? null }, opts.policies);
  if (!pol.ok) return out(false, 'policy_denied', `${pol.name}:${pol.detail}`);
  return out(true, granted);
}

/**
 * The permission LIST a principal effectively holds right now in one branch: the grant, plus live ALLOW overrides, minus
 * live DENY overrides (a DENY on a coarse key also removes it from the grant, so every granular pos.* key mapped onto it
 * fails too). This is what the request context carries, so every existing hasPermission() call honours overrides.
 */
export function effectivePermissions(p: Pick<AuthzPrincipal, 'permissions' | 'overrides' | 'role'>, branchId: string | null | undefined, now?: number | Date): string[] {
  const out = new Set<string>(p.permissions || []);
  if (isPlatformRole(String(p.role ?? ''))) return [...out].sort();
  const t = nowMs(now);
  const live = (p.overrides ?? []).filter((o) => overrideActive(o, t) && overrideApplies(o, branchId) && !o.permission.startsWith(PLATFORM_PREFIX));
  for (const o of live) if (o.effect === 'ALLOW') out.add(o.permission);
  for (const o of live) if (o.effect === 'DENY') out.delete(o.permission);
  return [...out].sort();
}
