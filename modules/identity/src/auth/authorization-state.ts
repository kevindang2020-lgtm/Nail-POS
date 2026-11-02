// authorization-state.ts — BUILD_PLAN Phase 9 (Constitution 2 §versioning / cache invalidation): what a person may do
// RIGHT NOW, read on the request path, so a change reaches a live session on its very next request.
//
// The bug (audit 3): a session carried the permissions it was minted with; a demotion, a narrowed template, a removed
// branch or a suspended account took effect only when the session ended (12 h, or 30 days with remember-me).
//
// The mechanism:
//   • users.authorization_version / tenants.authorization_version (migration 530) are bumped BY DATABASE TRIGGERS on every
//     change that can alter authority (role, status, home branch, platform role, template assignment, branch access,
//     overrides; a salon's custom-role definitions bump the salon). No code path can forget to bump.
//   • a session carries the two versions it was minted with (claims `av` / `tv`);
//   • the tenant-context middleware loads the CURRENT state (cached ≤ 30 s per user, dropped at once in-process when this
//     process changes someone's authorization — invalidateUser / invalidateTenant) and calls authorizeSession():
//       – same versions → the session's grant stands; overrides are applied for this request (expiry honoured now);
//       – stale → this request is RE-AUTHORIZED from the current grants (role, template, overrides, branch access,
//         status). The stale claims are never used. The response says x-authorization-changed: 1 so clients refresh;
//       – inactive / gone / moved salon / no more pos.login → every session of the user is revoked (the existing
//         sessions-table revocation) and the request is 401 SESSION_ENDED;
//       – the session's branch is no longer one they may enter → that session is revoked.
import { canMoveToSql } from '@aipowersalon/database';
import { SESSION } from './identity-lifecycles';
import { sql } from 'kysely';
import {
  permissionsFor, platformPermissionsFor, isPlatformRole, PLATFORM_FALLBACK_ROLE, effectiveTechPermissions, effectivePermissions,
  defaultScopeForRole, enterableBranches, type AccessScope, type AuthzOverride, type AuthzContextState, type Role,
} from '@aipowersalon/permissions';
import { StaffRolesService, KyselyStaffRolesStore } from '../staff-roles/staff-roles';

/** Everything authorization depends on for one person, as stored right now. */
export interface AuthorizationState {
  userId: string;
  /** the salon this state is FOR (the session's salon) */
  tenantId: string | null;
  /** false when the session names a salon the account neither belongs to nor holds branch access in */
  member: boolean;
  /** true for an owner working in ANOTHER salon of their portfolio (users.tenant_id is their home salon; access comes
   *  from user_branch_access rows in this salon — owner-portfolio context switch) */
  crossSalon: boolean;
  role: string;
  status: string;
  homeBranchId: string | null;
  platformRole: string | null;
  userVersion: number;
  tenantVersion: number | null;
  templateKey: string | null;
  scope: AccessScope;
  /** the role / template grant (TECHNICIAN: with the salon's technician_permissions toggles; SUPER_ADMIN: the platform role's set) */
  grant: string[];
  /** user_branch_access rows */
  branchGrants: string[];
  /** branch id → the role that row names (it may only NARROW the session) */
  branchRoles: Record<string, string>;
  /** live (not revoked) override rows; start / expiry are checked at decision time */
  overrides: AuthzOverride[];
}

export interface AuthorizationStatePort {
  load(userId: string, tenantId: string | null): Promise<AuthorizationState | null>;
  /** End every live session of the user (sessions + refresh tokens). Returns how many sessions were ended. */
  revokeUserSessions(userId: string): Promise<number>;
}

/** The session claims the request path compares. */
export interface SessionAuthzClaims { userId: string; role: string; tenantId: string | null; branchId: string | null; permissions: string[]; av?: number; tv?: number }

export type SessionAuthorization =
  | { ok: true; stale: boolean; role: string; permissions: string[]; authz: AuthzContextState }
  | { ok: false; reason: 'account_gone' | 'account_inactive' | 'role_changed' | 'access_removed' | 'branch_access_changed'; revoke: 'user' | 'session' };

const isStaffRole = (r: string) => ['OWNER', 'MANAGER', 'FRONT_DESK', 'RECEPTION', 'TECHNICIAN'].includes(r);

/** A branch-level role row may only NARROW: the grant ∩ that role's defaults (never the role's defaults on their own). */
export function narrowByBranchRole(grant: readonly string[], sessionRole: string, branchRole: string | null | undefined): string[] {
  if (!branchRole || branchRole === sessionRole || !isStaffRole(branchRole)) return [...grant];
  const allowed = new Set<string>(permissionsFor(branchRole as Role));
  return grant.filter((p) => allowed.has(p));
}

/** Is a session stale against the current state? A token without versions (minted before Phase 9) always is. */
export function isStale(claims: Pick<SessionAuthzClaims, 'av' | 'tv'>, st: Pick<AuthorizationState, 'userVersion' | 'tenantVersion' | 'tenantId'>): boolean {
  if (typeof claims.av !== 'number' || claims.av !== st.userVersion) return true;
  if (st.tenantId && st.tenantVersion !== null && (typeof claims.tv !== 'number' || claims.tv !== st.tenantVersion)) return true;
  return false;
}

/**
 * THE request-path decision about a session (pure). See the header for the rules.
 */
export function authorizeSession(claims: SessionAuthzClaims, st: AuthorizationState | null, now: number = Date.now()): SessionAuthorization {
  if (!st) return { ok: false, reason: 'account_gone', revoke: 'user' };
  if (String(st.status || '').toLowerCase() !== 'active') return { ok: false, reason: 'account_inactive', revoke: 'user' };
  if (!st.member || (st.tenantId ?? null) !== (claims.tenantId ?? null)) return { ok: false, reason: 'role_changed', revoke: 'session' };
  const wasPlatform = claims.role === 'SUPER_ADMIN'; const isPlatform = st.role === 'SUPER_ADMIN';
  if (wasPlatform !== isPlatform || (!isPlatform && !isStaffRole(st.role))) return { ok: false, reason: 'role_changed', revoke: 'user' };
  const stale = isStale(claims, st);
  // A token minted WITHOUT versions (before Phase 9, or by a flow that mints its own — a password-reset session with a
  // deliberately empty list, a context switch) is re-checked but never WIDENED: its own list ∩ the current grant.
  const versioned = typeof claims.av === 'number';
  const role = stale ? st.role : claims.role;
  const branchId = claims.branchId || null;
  const base = !stale ? (claims.permissions ?? []) : versioned ? st.grant : (claims.permissions ?? []).filter((p) => st.grant.includes(p));
  const grant = isPlatform ? [...base] : narrowByBranchRole(base, role, branchId ? st.branchRoles[branchId] : null);
  const overrides = isPlatform ? [] : st.overrides;
  const permissions = effectivePermissions({ role, permissions: grant, overrides }, branchId, now);
  const branchIds = isPlatform ? null : enterableBranches({ scope: st.scope, grants: st.branchGrants, homeBranchId: st.homeBranchId });
  if (stale && versioned && !isPlatform) {
    if (!permissions.includes('pos.login')) return { ok: false, reason: 'access_removed', revoke: 'user' };
    if (branchId && branchIds !== null && !branchIds.includes(branchId)) return { ok: false, reason: 'branch_access_changed', revoke: 'session' };
  }
  return {
    ok: true, stale: stale && versioned, role, permissions,
    authz: { scope: isPlatform ? null : st.scope, branchIds, templateKey: st.templateKey, overrides: [...overrides], grant, userVersion: st.userVersion, tenantVersion: st.tenantVersion, reauthorized: stale },
  };
}

/** Per-user cache of the state, ≤ ttlMs old; in-process invalidation by user or by salon. */
export class AuthorizationStateCache {
  private readonly entries = new Map<string, { at: number; state: AuthorizationState | null }>();
  constructor(private readonly port: AuthorizationStatePort, private readonly ttlMs = 30_000, private readonly clock: () => number = () => Date.now()) {}
  private key(userId: string, tenantId: string | null) { return userId + '|' + (tenantId ?? ''); }
  /** `seen`: the versions the caller's session was minted with. A session NEWER than the cached state proves the cache is
   *  behind (the change happened, a refresh minted the new version) — reload instead of re-authorizing the fresh session
   *  from the OLD grants (found by the Phase 1 refresh proof at Phase 9 integration: a narrowed manager kept paying). */
  async get(userId: string, tenantId: string | null, seen?: { av?: number | null; tv?: number | null }): Promise<AuthorizationState | null> {
    const k = this.key(userId, tenantId);
    const e = this.entries.get(k);
    const behind = !!e?.state && ((typeof seen?.av === 'number' && seen.av > e.state.userVersion)
      || (typeof seen?.tv === 'number' && e.state.tenantVersion !== null && seen.tv > e.state.tenantVersion));
    if (e && !behind && this.clock() - e.at < this.ttlMs) return e.state;
    const state = await this.port.load(userId, tenantId);   // throws on a database error — the caller decides (never cached)
    this.entries.set(k, { at: this.clock(), state });
    if (this.entries.size > 50_000) { const first = this.entries.keys().next().value; if (first !== undefined) this.entries.delete(first); }
    return state;
  }
  invalidateUser(userId: string): void { for (const k of [...this.entries.keys()]) if (k.startsWith(userId + '|')) this.entries.delete(k); }
  invalidateTenant(tenantId: string): void { for (const [k, e] of this.entries) if (e.state?.tenantId === tenantId) this.entries.delete(k); }
  revokeUserSessions(userId: string): Promise<number> { this.invalidateUser(userId); return this.port.revokeUserSessions(userId); }
}

/** DI token for the shared AuthorizationStateCache (identity's AuthModule provides it). */
export const AUTHORIZATION_STATE = 'AUTHORIZATION_STATE';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const iso = (v: unknown): string | null => (v ? new Date(v as any).toISOString() : null);

/** The grant for a person (the same rule sign-in uses — LoginService.permissionsAt). */
export function grantFor(role: string, opts: { platformRole?: string | null; template?: string[] | null; techOverrides?: { permission: string; allowed: boolean }[] }): string[] {
  if (role === 'SUPER_ADMIN') return platformPermissionsFor(isPlatformRole(opts.platformRole ?? '') ? opts.platformRole : PLATFORM_FALLBACK_ROLE);
  const base = permissionsFor(role as Role);
  if (role !== 'TECHNICIAN') {
    if (opts.template) { const allowed = new Set<string>(base); return opts.template.filter((p) => allowed.has(p)); }
    return base;
  }
  return opts.techOverrides ? effectiveTechPermissions(base, opts.techOverrides) : base;
}

export class KyselyAuthorizationStatePort implements AuthorizationStatePort {
  constructor(private readonly db: any) {}
  async load(userId: string, sessionTenantId: string | null): Promise<AuthorizationState | null> {
    if (!UUID.test(userId)) return null;
    const u: any = (await sql`select u.id, u.tenant_id, u.role, coalesce(u.status, 'active') as status, u.branch_id, u.platform_role,
        u.authorization_version as uv from users u where u.id = ${userId} limit 1`.execute(this.db)).rows[0];
    if (!u) return null;
    const homeTenant: string | null = u.tenant_id ? String(u.tenant_id) : null;
    const tenantId: string | null = sessionTenantId && UUID.test(sessionTenantId) ? sessionTenantId : homeTenant;
    const crossSalon = !!tenantId && tenantId !== homeTenant;
    const role = String(u.role);
    let member = true;
    if (crossSalon) {
      // owner-portfolio: an OWNER working in another salon they hold branch access in (user_branch_access in THAT salon)
      const g: any = await sql`select 1 from user_branch_access where tenant_id = ${tenantId} and user_id = ${userId} limit 1`.execute(this.db);
      member = role === 'OWNER' && (g.rows ?? []).length > 0;
    }
    const tv: any = tenantId ? (await sql`select authorization_version as tv from tenants where id = ${tenantId} limit 1`.execute(this.db)).rows[0] : null;
    let templateKey: string | null = null; let scope: AccessScope = defaultScopeForRole(role); let template: string[] | null = null;
    let techOverrides: { permission: string; allowed: boolean }[] | undefined;
    let branchGrants: string[] = []; const branchRoles: Record<string, string> = {}; let overrides: AuthzOverride[] = [];
    if (tenantId && member && role !== 'SUPER_ADMIN' && role !== 'CUSTOMER') {
      const a = crossSalon ? null : await new StaffRolesService(new KyselyStaffRolesStore(this.db)).resolveAssignment(tenantId, userId, role);
      if (a && role !== 'TECHNICIAN') { templateKey = a.templateKey; scope = a.scope; template = a.permissions; }
      if (role === 'TECHNICIAN') {
        const r: any = await sql`select p.permission_key, p.allowed from technician_permissions p
            join technicians t on t.id = p.technician_id and t.tenant_id = p.tenant_id
           where p.tenant_id = ${tenantId} and t.user_id = ${userId}`.execute(this.db).catch(() => ({ rows: [] }));
        techOverrides = (r.rows ?? []).map((x: any) => ({ permission: String(x.permission_key), allowed: !!x.allowed }));
      }
      const ba: any = await sql`select branch_id, role from user_branch_access where tenant_id = ${tenantId} and user_id = ${userId}`.execute(this.db);
      for (const r of ba.rows ?? []) { const b = String(r.branch_id); branchGrants.push(b); if (r.role) branchRoles[b] = String(r.role); }
      branchGrants = branchGrants.sort();
      const ov: any = await sql`select id, permission, effect, branch_id, starts_at, expires_at from tenant_user_permission_overrides
         where tenant_id = ${tenantId} and user_id = ${userId} and revoked_at is null`.execute(this.db);
      overrides = (ov.rows ?? []).map((r: any) => ({ id: String(r.id), permission: String(r.permission), effect: r.effect === 'DENY' ? 'DENY' : 'ALLOW', branchId: r.branch_id ? String(r.branch_id) : null, startsAt: iso(r.starts_at), expiresAt: iso(r.expires_at) }));
    }
    return {
      userId, tenantId, member, crossSalon, role, status: String(u.status), homeBranchId: crossSalon ? null : (u.branch_id ? String(u.branch_id) : null), platformRole: u.platform_role ? String(u.platform_role) : null,
      userVersion: Number(u.uv ?? 1), tenantVersion: tenantId ? Number(tv?.tv ?? 1) : null,
      templateKey, scope, grant: grantFor(role, { platformRole: u.platform_role, template, techOverrides }), branchGrants, branchRoles, overrides,
    };
  }
  async revokeUserSessions(userId: string): Promise<number> {
    if (!UUID.test(userId)) return 0;
    const r: any = await sql`update sessions set status = 'revoked', revoked_at = now() where user_id = ${userId} and status = 'active' and ${canMoveToSql(SESSION, 'revoked')} returning id`.execute(this.db);
    await sql`update refresh_tokens set revoked_at = now() where user_id = ${userId} and revoked_at is null`.execute(this.db).catch(() => undefined);
    return (r.rows ?? []).length;
  }
}

/** Current versions for minting (sign-in, branch selection, refresh). null = unknown (no database). */
export async function currentAuthorizationVersions(db: any, userId: string, tenantId?: string | null): Promise<{ av: number; tv: number | null } | null> {
  if (!db || !UUID.test(userId)) return null;
  const r: any = (await sql`select u.authorization_version as uv, t.authorization_version as tv from users u
      left join tenants t on t.id = coalesce(${tenantId && UUID.test(tenantId) ? tenantId : null}::uuid, u.tenant_id) where u.id = ${userId} limit 1`.execute(db)).rows[0];
  return r ? { av: Number(r.uv ?? 1), tv: r.tv === null || r.tv === undefined ? null : Number(r.tv) } : null;
}

/** The branches a staff member may enter in a salon (template scope → grants → home → any); null = every branch.
 *  Used by sign-in and branch selection — the request path computes the same from the loaded state. */
export async function enterableBranchesForUser(db: any, tenantId: string, userId: string, role: string): Promise<string[] | null> {
  if (!db || !UUID.test(tenantId) || !UUID.test(userId)) return null;
  const a = role === 'TECHNICIAN' ? null : await new StaffRolesService(new KyselyStaffRolesStore(db)).resolveAssignment(tenantId, userId, role);
  const scope = a?.scope ?? defaultScopeForRole(role);
  const g: any = await sql`select branch_id from user_branch_access where tenant_id = ${tenantId} and user_id = ${userId}`.execute(db);
  const u: any = (await sql`select branch_id from users where id = ${userId} and tenant_id = ${tenantId} limit 1`.execute(db)).rows[0];
  const grants = (g.rows ?? []).map((r: any) => String(r.branch_id));
  const homeBranchId = u?.branch_id ? String(u.branch_id) : null;
  // Oct 12 2026 merge (other chat, workforce audit P2 #28): a TECHNICIAN's branches are her EMPLOYMENT — the identity
  // service writes a user_branch_access grant per active membership and removes it when the employment ends (WF 578
  // backfilled everyone employed today). So for a technician the OWN scope's "any branch" default does not apply:
  // grants → those; no grants → her home branch only; neither → none (fail CLOSED, never the whole salon).
  // Their version gave a no-grant technician nothing at all; ours keeps the home branch so a login created by a path
  // that predates the grant writer is not locked out of the one branch it was created in.
  if (role === 'TECHNICIAN') return technicianEnterableBranches(grants, homeBranchId);
  return enterableBranches({ scope, grants, homeBranchId });
}

/** Pure: the branches a TECHNICIAN login may enter — grants, else the home branch, else none (never null = "any"). */
export function technicianEnterableBranches(grants: readonly string[], homeBranchId: string | null): string[] {
  const g = Array.from(new Set(grants.filter(Boolean))).sort();
  if (g.length) return g;
  return homeBranchId ? [homeBranchId] : [];
}
