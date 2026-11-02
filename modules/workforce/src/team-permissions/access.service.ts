// access.service.ts — BUILD_PLAN Phase 9 (Constitution 2): the salon side of roles & access, behind /pos/access.
//
//   members / roles / effective permissions / preview / audit / catalog   (read; roles.view)
//   role assignment            → StaffRolesService (ceiling = what the actor holds; owner-level needs ownership.transfer;
//                                 LAST_OWNER → 409; base role may change — promotion / demotion)
//   branch access              → user_branch_access, salon-managed (only the platform could write it before)
//   per-user overrides         → tenant_user_permission_overrides: ALLOW (only keys the actor holds) / DENY, optional branch,
//                                 optional expiry (= temporary access); never super_admin.*, never on yourself
//   ownership transfer         → tenants.owner_user_id + the new owner's role (+ the previous owner's chosen role)
// Every change runs in ONE transaction with its authorization_audit_events row and its AUTHORIZATION_CHANGED event, and the
// database triggers bump the person's authorization version: their very next request is re-authorized. This process's
// cache is dropped at once (other instances within 30 s).
import { sql, type Kysely } from 'kysely';
import { canMoveToSql } from '@aipowersalon/database';
import type { OutboxWriter } from '@aipowersalon/events';
import { recordBranchDiffForUser, recordEmploymentEvent } from '../technicians/employment-history';
import {
  PERMISSIONS, PERMISSION_REGISTRY, hasPermission, decide, effectivePermissions, enterableBranches, isHighRiskPermission, validateCustomRole,
  type AuthzOverride, type AuthzPrincipal, type Role,
} from '@aipowersalon/permissions';
import {
  StaffRolesService, KyselyStaffRolesStore, StaffRoleError, KyselyAuthorizationStatePort, recordAuthorizationChange, SESSION, USER_ACCOUNT,
  type AuthorizationStateCache, type AuthorizationState,
} from '@aipowersalon/identity';
import type {
  TeamRoleView, TeamMemberView, TeamAssignRoleRequest, TeamBranchAccess, TeamBranchAccessRequest, TeamOverrideView, TeamOverrideRequest,
  TeamOverrideRevoke, TeamEffectivePermissions, TeamPreviewRequest, TeamPreviewResult, AuthzAuditEventView, OwnershipTransferRequest,
  OwnershipTransferResult, PermissionDefinition, AuthzReason,
} from '@aipowersalon/api-contracts/tenant';

export interface AccessActor { tenantId: string; userId: string; role: string; permissions: string[]; ip?: string | null }
export class AccessError extends Error {
  constructor(readonly status: 400 | 403 | 404 | 409, readonly code: string, message: string) { super(message); this.name = 'AccessError'; }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TENANT_KEYS: string[] = (PERMISSIONS as readonly string[]).filter((k) => !k.startsWith('super_admin.'));
const TENANT_KEY_SET = new Set(TENANT_KEYS);
export const DORMANT_DAYS = 60;
const iso = (v: unknown): string | null => (v ? new Date(v as any).toISOString() : null);
const nameOf = (r: any): string => r.full_name || [r.first_name, r.last_name].filter(Boolean).join(' ') || r.email || 'Staff member';
const reasonText = (r: unknown): string => String(r ?? '').trim().slice(0, 500);

export class TeamAccessService {
  private readonly roles: StaffRolesService;
  private readonly states: KyselyAuthorizationStatePort;
  constructor(private readonly db: Kysely<any>, private readonly outbox: OutboxWriter | null, private readonly authz: AuthorizationStateCache | null = null,
              private readonly clock: () => number = () => Date.now()) {
    this.roles = new StaffRolesService(new KyselyStaffRolesStore(db, (trx, change) => recordAuthorizationChange(trx, outbox, change)));
    this.states = new KyselyAuthorizationStatePort(db);
  }

  private holds(a: AccessActor, key: string): boolean { return hasPermission({ tenantId: a.tenantId, branchId: '', userId: a.userId, role: a.role as Role, permissions: a.permissions }, key); }
  private async staffRow(tenantId: string, userId: string): Promise<any> {
    if (!UUID.test(userId)) throw new AccessError(404, 'NOT_FOUND', 'That person is not a staff member of this salon.');
    const u: any = (await sql`select id, role, coalesce(status, 'active') as status from users where id = ${userId} and tenant_id = ${tenantId} and role in ('OWNER','MANAGER','FRONT_DESK','RECEPTION','TECHNICIAN') limit 1`.execute(this.db)).rows[0];
    if (!u) throw new AccessError(404, 'NOT_FOUND', 'That person is not a staff member of this salon.');
    return u;
  }
  /** Changing an owner's access is ownership-level authority. */
  private ownerLevel(a: AccessActor, targetRole: string, what: string) {
    if (targetRole === 'OWNER' && !this.holds(a, 'ownership.transfer')) throw new AccessError(403, 'PERMISSION_DENIED', `Only the owner can change an owner's ${what}.`);
  }
  private notSelf(a: AccessActor, userId: string, what: string) {
    if (a.userId === userId) throw new AccessError(403, 'SELF_CHANGE', `You cannot change your own ${what}. Ask the owner.`);
  }
  private changed(userId: string) { this.authz?.invalidateUser(userId); }

  // ── read ─────────────────────────────────────────────────────────────────────────────────────────────────────────
  async listRoles(a: AccessActor): Promise<TeamRoleView[]> {
    const roles = await this.roles.listRoles(a.tenantId);
    const counts: any = await sql`select coalesce(a.template_key, '') as k, u.role, count(*)::int as n from users u
        left join staff_role_assignments a on a.user_id = u.id and a.tenant_id = u.tenant_id
       where u.tenant_id = ${a.tenantId} and u.role in ('OWNER','MANAGER','FRONT_DESK','RECEPTION','TECHNICIAN') group by 1, 2`.execute(this.db);
    const byKey = new Map<string, number>(); const untemplated = new Map<string, number>();
    for (const r of counts.rows ?? []) { if (r.k) byKey.set(String(r.k), (byKey.get(String(r.k)) ?? 0) + Number(r.n)); else untemplated.set(String(r.role), Number(r.n)); }
    return roles.map((r) => ({ key: r.key, name: r.name, baseRole: r.baseRole, scope: r.scope, permissions: r.permissions, custom: r.custom, description: r.description ?? null, memberCount: byKey.get(r.key) ?? 0 }));
  }

  async listMembers(a: AccessActor, onlyUserId?: string): Promise<TeamMemberView[]> {
    const roles = await this.roles.listRoles(a.tenantId);
    const t: any = (await sql`select owner_user_id from tenants where id = ${a.tenantId}`.execute(this.db)).rows[0];
    const users: any[] = (await sql`select u.id, u.full_name, u.first_name, u.last_name, u.email, u.role, coalesce(u.status, 'active') as status, u.branch_id,
          u.last_login_at, u.authorization_version, sa.template_key
        from users u left join staff_role_assignments sa on sa.user_id = u.id and sa.tenant_id = u.tenant_id
       where u.tenant_id = ${a.tenantId} and u.role in ('OWNER','MANAGER','FRONT_DESK','RECEPTION','TECHNICIAN')
         and (${onlyUserId ?? null}::uuid is null or u.id = ${onlyUserId ?? null}::uuid)
       order by u.role, u.full_name`.execute(this.db)).rows;
    if (!users.length) return [];
    const ids = users.map((u) => String(u.id));
    const access: any[] = (await sql`select uba.user_id, uba.branch_id, b.name as branch_name, uba.role, uba.access_level, uba.is_primary_owner
        from user_branch_access uba left join branches b on b.id = uba.branch_id and b.tenant_id = uba.tenant_id
       where uba.tenant_id = ${a.tenantId} and uba.user_id in (${sql.join(ids)}) order by b.name`.execute(this.db)).rows;
    const overrides: any[] = (await sql`select o.*, g.full_name as g_full, g.first_name as g_first, g.last_name as g_last, g.email as g_email
        from tenant_user_permission_overrides o left join users g on g.id = o.granted_by_user_id
       where o.tenant_id = ${a.tenantId} and o.user_id in (${sql.join(ids)}) and o.revoked_at is null order by o.created_at desc`.execute(this.db)).rows;
    const now = this.clock();
    return users.map((u) => {
      const id = String(u.id);
      const last = u.last_login_at ? new Date(u.last_login_at).getTime() : null;
      return {
        userId: id, name: nameOf(u), email: u.email ?? null, role: String(u.role), templateKey: u.template_key ?? null,
        templateName: u.template_key ? roles.find((r) => r.key === u.template_key)?.name ?? null : null,
        status: String(u.status), homeBranchId: u.branch_id ? String(u.branch_id) : null,
        branchAccess: access.filter((r) => String(r.user_id) === id).map((r): TeamBranchAccess => ({ branchId: String(r.branch_id), branchName: r.branch_name ?? '', role: r.role ?? null, accessLevel: r.access_level, isPrimaryOwner: !!r.is_primary_owner })),
        overrides: overrides.filter((r) => String(r.user_id) === id).map((r) => this.overrideView(r, now)),
        lastLoginAt: iso(u.last_login_at), dormant: String(u.status) === 'active' && (last === null || now - last > DORMANT_DAYS * 86_400_000),
        isOwner: String(u.role) === 'OWNER', isPrimaryOwner: !!t?.owner_user_id && String(t.owner_user_id) === id, authorizationVersion: Number(u.authorization_version ?? 1),
      };
    });
  }

  async member(a: AccessActor, userId: string): Promise<TeamMemberView> {
    if (!UUID.test(userId)) throw new AccessError(404, 'NOT_FOUND', 'That person is not a staff member of this salon.');
    const m = (await this.listMembers(a, userId))[0];
    if (!m) throw new AccessError(404, 'NOT_FOUND', 'That person is not a staff member of this salon.');
    return m;
  }

  private overrideView(r: any, now = this.clock()): TeamOverrideView {
    const exp = r.expires_at ? new Date(r.expires_at).getTime() : null; const start = r.starts_at ? new Date(r.starts_at).getTime() : 0;
    return {
      id: String(r.id), permission: String(r.permission), effect: r.effect === 'DENY' ? 'DENY' : 'ALLOW', branchId: r.branch_id ? String(r.branch_id) : null, reason: String(r.reason ?? ''),
      grantedByName: r.g_full || [r.g_first, r.g_last].filter(Boolean).join(' ') || r.g_email || null, startsAt: iso(r.starts_at) ?? '', expiresAt: iso(r.expires_at),
      active: !r.revoked_at && start <= now && (exp === null || exp > now), temporary: exp !== null,
    };
  }

  private async state(a: AccessActor, userId: string): Promise<AuthorizationState> {
    await this.staffRow(a.tenantId, userId);
    const st = await this.states.load(userId, a.tenantId);
    if (!st) throw new AccessError(404, 'NOT_FOUND', 'That person is not a staff member of this salon.');
    return st;
  }
  private principalOf(st: AuthorizationState, grant = st.grant, overrides = st.overrides): AuthzPrincipal {
    return { userId: st.userId, tenantId: st.tenantId, branchId: null, role: st.role, permissions: grant, status: st.status, templateKey: st.templateKey, scope: st.scope, branchIds: null, overrides };
  }

  async effective(a: AccessActor, userId: string): Promise<TeamEffectivePermissions> {
    const st = await this.state(a, userId);
    const p = this.principalOf(st); const now = this.clock();
    const permissions: TeamEffectivePermissions['permissions'] = []; const denied: TeamEffectivePermissions['denied'] = [];
    for (const key of TENANT_KEYS) {
      const d = decide(p, key, null, { now });
      if (d.allowed) {
        const o = d.reason === 'granted_temporarily' ? st.overrides.find((x) => x.permission === key && x.effect === 'ALLOW' && x.expiresAt) : null;
        permissions.push({ key, reason: d.reason as AuthzReason, expiresAt: o?.expiresAt ? new Date(o.expiresAt).toISOString() : null });
      } else if (d.reason !== 'missing_permission') denied.push({ key, reason: d.reason as AuthzReason });
    }
    const branchIds = enterableBranches({ scope: st.scope, grants: st.branchGrants, homeBranchId: st.homeBranchId });
    return { userId, role: st.role, templateKey: st.templateKey, scope: st.scope, branchIds, permissions, denied, authorizationVersion: st.userVersion };
  }

  async preview(a: AccessActor, req: TeamPreviewRequest): Promise<TeamPreviewResult> {
    const now = this.clock();
    let st: AuthorizationState | null = null;
    if (req?.userId) st = await this.state(a, String(req.userId));
    const current = st ? effectivePermissions({ role: st.role, permissions: st.grant, overrides: st.overrides }, null, now) : [];
    let grant: string[] = st ? st.grant : []; let role = st?.role ?? 'FRONT_DESK';
    if (req?.templateKey) {
      const t = await this.roles.resolveTemplate(a.tenantId, String(req.templateKey));
      if (!t) throw new AccessError(404, 'NOT_FOUND', 'Role not found.');
      grant = t.permissions; role = t.baseRole;
    } else if (req?.customRole) {
      const v = validateCustomRole({ name: 'Preview', baseRole: req.customRole.baseRole, scope: req.customRole.scope, permissions: req.customRole.permissions ?? [] }, 'OWNER');
      if (!v.ok) throw new AccessError(400, 'VALIDATION', v.error);
      grant = v.role.permissions; role = v.role.baseRole;
    }
    const proposed: AuthzOverride[] = [...(st?.overrides ?? [])];
    for (const o of req?.overrides ?? []) {
      this.validKey(o?.permission);
      proposed.push({ permission: String(o.permission), effect: o.effect === 'DENY' ? 'DENY' : 'ALLOW', branchId: o.scopeBranchId ?? null, expiresAt: o.expiresAt ?? null });
    }
    const granted = effectivePermissions({ role, permissions: grant, overrides: proposed }, null, now).filter((k) => TENANT_KEY_SET.has(k));
    const denied = Array.from(new Set(proposed.filter((o) => o.effect === 'DENY').map((o) => o.permission))).sort();
    const g = new Set(granted); const c = new Set(current);
    return { granted, denied, added: granted.filter((k) => !c.has(k)), removed: current.filter((k) => !g.has(k)), highRisk: granted.filter((k) => isHighRiskPermission(k)) };
  }

  async audit(a: AccessActor, q: { userId?: string; page?: number; pageSize?: number }): Promise<{ items: AuthzAuditEventView[]; page: number; pageSize: number; total: number; hasMore: boolean }> {
    const page = Math.max(1, Math.floor(Number(q?.page) || 1)); const pageSize = Math.min(100, Math.max(1, Math.floor(Number(q?.pageSize) || 25)));
    const target = q?.userId && UUID.test(String(q.userId)) ? String(q.userId) : null;
    if (q?.userId && !target) return { items: [], page, pageSize, total: 0, hasMore: false };
    const total = Number((await sql`select count(*)::int as n from authorization_audit_events where tenant_id = ${a.tenantId} and (${target}::uuid is null or target_user_id = ${target}::uuid)`.execute(this.db) as any).rows[0]?.n ?? 0);
    const rows: any[] = (await sql`select e.id, e.action, e.before_state, e.after_state, e.reason, e.created_at,
          ac.full_name as a_full, ac.first_name as a_first, ac.last_name as a_last, ac.email as a_email,
          tg.full_name as t_full, tg.first_name as t_first, tg.last_name as t_last, tg.email as t_email
        from authorization_audit_events e
        left join users ac on ac.id = e.actor_user_id
        left join users tg on tg.id = e.target_user_id
       where e.tenant_id = ${a.tenantId} and (${target}::uuid is null or e.target_user_id = ${target}::uuid)
       order by e.created_at desc, e.id desc limit ${pageSize} offset ${(page - 1) * pageSize}`.execute(this.db)).rows;
    const nm = (f: any, fi: any, l: any, e: any) => f || [fi, l].filter(Boolean).join(' ') || e || null;
    return {
      items: rows.map((r) => ({ id: String(r.id), action: String(r.action), actorName: nm(r.a_full, r.a_first, r.a_last, r.a_email), targetName: nm(r.t_full, r.t_first, r.t_last, r.t_email), before: r.before_state ?? null, after: r.after_state ?? null, reason: r.reason ?? null, createdAt: iso(r.created_at) ?? '' })),
      page, pageSize, total, hasMore: page * pageSize < total,
    };
  }

  catalog(): PermissionDefinition[] {
    return (PERMISSION_REGISTRY as unknown as PermissionDefinition[]).filter((d) => d.realm !== 'platform' && !d.key.startsWith('super_admin.'));
  }

  // ── write ────────────────────────────────────────────────────────────────────────────────────────────────────────
  async assignRole(a: AccessActor, userId: string, req: TeamAssignRoleRequest): Promise<TeamMemberView> {
    const reason = reasonText(req?.reason);
    if (!reason) throw new AccessError(400, 'VALIDATION', 'Say why (reason).');
    const beforeRole: any = await sql`select u.role, t.id as technician_id, t.global_tech_profile_id from users u
        left join technicians t on t.tenant_id = u.tenant_id and t.user_id = u.id and t.archived_at is null
       where u.tenant_id = ${a.tenantId} and u.id = ${userId} limit 1`.execute(this.db).catch(() => ({ rows: [] }));
    try {
      await this.roles.assignRole({ tenantId: a.tenantId, userId: a.userId, role: a.role, permissions: a.permissions, ip: a.ip ?? null }, userId, req?.templateKey ?? null, { reason });
    } catch (e) {
      if (e instanceof StaffRoleError) throw new AccessError(e.code === 'CONFLICT' ? 409 : e.code === 'FORBIDDEN' ? 403 : e.code === 'NOT_FOUND' ? 404 : 400, e.reason ?? (e.code === 'FORBIDDEN' ? 'PERMISSION_DENIED' : e.code), e.message);
      throw e;
    }
    this.changed(userId);
    const view = await this.member(a, userId);
    // Technician Profile §128: a technician's role change is employment history (after the role service committed it)
    const b0 = beforeRole?.rows?.[0];
    if (b0?.technician_id) {
      const after: any = await sql`select role from users where tenant_id = ${a.tenantId} and id = ${userId}`.execute(this.db).catch(() => ({ rows: [] }));
      const to = String(after?.rows?.[0]?.role ?? req?.templateKey ?? '');
      if (to && to !== String(b0.role ?? '')) {
        await recordEmploymentEvent(this.db, { tenantId: a.tenantId, technicianId: String(b0.technician_id), profileId: b0.global_tech_profile_id, type: 'role_changed',
          from: b0.role ?? null, to, reason, actorUserId: UUID.test(a.userId) ? a.userId : null, actorRole: a.role ?? null, source: 'team_access' }).catch(() => {});
      }
    }
    return view;
  }

  async setBranchAccess(a: AccessActor, userId: string, req: TeamBranchAccessRequest): Promise<TeamMemberView> {
    const reason = reasonText(req?.reason);
    if (!reason) throw new AccessError(400, 'VALIDATION', 'Say why (reason).');
    const level = req?.accessLevel ?? 'staff';
    if (!['manager', 'staff', 'viewer', 'report_only'].includes(level)) throw new AccessError(400, 'VALIDATION', 'accessLevel must be manager, staff, viewer or report_only.');
    const ids = Array.from(new Set((Array.isArray(req?.branchIds) ? req.branchIds : []).map(String)));
    if (ids.some((b) => !UUID.test(b))) throw new AccessError(400, 'VALIDATION', 'branchIds must be branch ids.');
    this.notSelf(a, userId, 'branch access');
    const u = await this.staffRow(a.tenantId, userId);
    this.ownerLevel(a, String(u.role), 'branch access');
    if (ids.length) {
      const ok: any = await sql`select id from branches where tenant_id = ${a.tenantId} and id in (${sql.join(ids)})`.execute(this.db);
      if ((ok.rows ?? []).length !== ids.length) throw new AccessError(404, 'NOT_FOUND', 'One of those branches is not part of this salon.');
    }
    await this.db.transaction().execute(async (trx) => {
      const before: any[] = (await sql`select branch_id, access_level, role, is_primary_owner from user_branch_access where tenant_id = ${a.tenantId} and user_id = ${userId} order by branch_id for update`.execute(trx)).rows;
      // the primary owner's own rows are the Owner App's portfolio — never removed from here
      if (ids.length) await sql`delete from user_branch_access where tenant_id = ${a.tenantId} and user_id = ${userId} and is_primary_owner = false and branch_id not in (${sql.join(ids)})`.execute(trx);
      else await sql`delete from user_branch_access where tenant_id = ${a.tenantId} and user_id = ${userId} and is_primary_owner = false`.execute(trx);
      for (const b of ids) {
        await sql`insert into user_branch_access (tenant_id, branch_id, user_id, access_level, created_by_user_id)
          values (${a.tenantId}, ${b}, ${userId}, ${level}, ${UUID.test(a.userId) ? a.userId : null})
          on conflict (tenant_id, user_id, branch_id) do update set access_level = case when user_branch_access.is_primary_owner then user_branch_access.access_level else excluded.access_level end, updated_at = now()`.execute(trx);
      }
      // Technician Profile §128: a technician's branch added / removed is employment history (no-op for other staff)
      await recordBranchDiffForUser(trx, { tenantId: a.tenantId, userId, before: before.map((r) => String(r.branch_id)), after: ids, actorUserId: UUID.test(a.userId) ? a.userId : null, actorRole: a.role ?? null, reason });
      await recordAuthorizationChange(trx, this.outbox, { tenantId: a.tenantId, actorUserId: a.userId, targetUserId: userId, action: 'branch_access.changed',
        before: before.map((r) => ({ branchId: String(r.branch_id), accessLevel: r.access_level })), after: { branchIds: ids.sort(), accessLevel: level }, reason, ip: a.ip ?? null });
    });
    this.changed(userId);
    return this.member(a, userId);
  }

  private validKey(permission: unknown): string {
    const k = String(permission ?? '').trim();
    if (k.startsWith('super_admin.')) throw new AccessError(400, 'VALIDATION', 'Platform permissions can never be granted to salon staff.');
    if (!TENANT_KEY_SET.has(k)) throw new AccessError(400, 'VALIDATION', `"${k}" is not a permission in the catalog.`);
    return k;
  }

  async grantOverride(a: AccessActor, userId: string, req: TeamOverrideRequest): Promise<TeamOverrideView> {
    const key = this.validKey(req?.permission);
    const effect = req?.effect === 'DENY' ? 'DENY' : req?.effect === 'ALLOW' ? 'ALLOW' : null;
    if (!effect) throw new AccessError(400, 'VALIDATION', 'effect must be ALLOW or DENY.');
    const reason = reasonText(req?.reason);
    if (!reason) throw new AccessError(400, 'VALIDATION', 'Say why (reason).');
    const now = this.clock();
    let expiresAt: Date | null = null;
    if (req?.expiresAt) {
      const t = Date.parse(String(req.expiresAt));
      if (!Number.isFinite(t) || t <= now) throw new AccessError(400, 'VALIDATION', 'expiresAt must be in the future.');
      if (t - now > 366 * 86_400_000) throw new AccessError(400, 'VALIDATION', 'Temporary access can last at most a year.');
      expiresAt = new Date(t);
    }
    // `scopeBranchId`: the tenant-context middleware strips a body `branchId` (the session owns the branch), so the
    // override's branch travels under its own name
    const branchId = req?.scopeBranchId ? String(req.scopeBranchId) : null;
    if (branchId && !UUID.test(branchId)) throw new AccessError(400, 'VALIDATION', 'scopeBranchId must be a branch id.');
    this.notSelf(a, userId, 'permissions');
    const u = await this.staffRow(a.tenantId, userId);
    this.ownerLevel(a, String(u.role), 'permissions');
    // the grant ceiling: an ALLOW only for what the actor holds themselves
    if (effect === 'ALLOW' && !this.holds(a, key)) throw new AccessError(403, 'PERMISSION_DENIED', `You can only grant a permission you hold yourself (${key}).`);
    if (branchId) {
      const b: any = (await sql`select id from branches where id = ${branchId} and tenant_id = ${a.tenantId}`.execute(this.db)).rows[0];
      if (!b) throw new AccessError(404, 'NOT_FOUND', 'That branch is not part of this salon.');
    }
    const row = await this.db.transaction().execute(async (trx) => {
      // one LIVE override per user + key + branch: a new one replaces the old (recorded)
      const prev: any[] = (await sql`update tenant_user_permission_overrides set revoked_at = now(), revoked_by_user_id = ${UUID.test(a.userId) ? a.userId : null}, revoke_reason = 'replaced'
          where tenant_id = ${a.tenantId} and user_id = ${userId} and permission = ${key} and branch_id is not distinct from ${branchId}::uuid and revoked_at is null
          returning id, effect, expires_at`.execute(trx)).rows;
      const ins: any = (await sql`insert into tenant_user_permission_overrides (tenant_id, user_id, permission, effect, reason, branch_id, granted_by_user_id, expires_at)
          values (${a.tenantId}, ${userId}, ${key}, ${effect}, ${reason}, ${branchId}::uuid, ${a.userId}, ${expiresAt})
          returning *`.execute(trx)).rows[0];
      await recordAuthorizationChange(trx, this.outbox, { tenantId: a.tenantId, actorUserId: a.userId, targetUserId: userId, action: 'override.granted',
        before: prev.length ? { id: String(prev[0].id), effect: prev[0].effect, expiresAt: iso(prev[0].expires_at) } : null,
        after: { id: String(ins.id), permission: key, effect, branchId, expiresAt: iso(ins.expires_at) }, reason, ip: a.ip ?? null });
      return ins;
    });
    this.changed(userId);
    return this.overrideView(row);
  }

  async revokeOverride(a: AccessActor, id: string, req: TeamOverrideRevoke): Promise<TeamOverrideView> {
    const reason = reasonText(req?.reason);
    if (!reason) throw new AccessError(400, 'VALIDATION', 'Say why (reason).');
    if (!UUID.test(String(id))) throw new AccessError(404, 'NOT_FOUND', 'Override not found.');
    const o: any = (await sql`select o.*, u.role as target_role from tenant_user_permission_overrides o join users u on u.id = o.user_id
       where o.id = ${id} and o.tenant_id = ${a.tenantId}`.execute(this.db)).rows[0];
    if (!o) throw new AccessError(404, 'NOT_FOUND', 'Override not found.');
    this.notSelf(a, String(o.user_id), 'permissions');
    this.ownerLevel(a, String(o.target_role), 'permissions');
    if (o.revoked_at) throw new AccessError(409, 'ALREADY_REVOKED', 'That override was already revoked.');
    const row = await this.db.transaction().execute(async (trx) => {
      const r: any = (await sql`update tenant_user_permission_overrides set revoked_at = now(), revoked_by_user_id = ${UUID.test(a.userId) ? a.userId : null}, revoke_reason = ${reason}
          where id = ${id} and tenant_id = ${a.tenantId} and revoked_at is null returning *`.execute(trx)).rows[0];
      if (!r) throw new AccessError(409, 'ALREADY_REVOKED', 'That override was already revoked.');
      await recordAuthorizationChange(trx, this.outbox, { tenantId: a.tenantId, actorUserId: a.userId, targetUserId: String(r.user_id), action: 'override.revoked',
        before: { id, permission: r.permission, effect: r.effect, expiresAt: iso(r.expires_at) }, after: null, reason, ip: a.ip ?? null });
      return r;
    });
    this.changed(String(row.user_id));
    return this.overrideView(row);
  }

  /**
   * Ownership transfer: the salon's primary owner hands it to another active staff member, who becomes an OWNER (template
   * cleared: owner defaults) and tenants.owner_user_id; the previous owner keeps OWNER (co-owner) or takes the template
   * named by keepPreviousOwnerAs. One transaction, the salon row locked first.
   */
  async transferOwnership(a: AccessActor, req: OwnershipTransferRequest): Promise<OwnershipTransferResult> {
    const reason = reasonText(req?.reason);
    if (!reason) throw new AccessError(400, 'VALIDATION', 'Say why (reason).');
    const to = String(req?.toUserId ?? '');
    if (!UUID.test(to)) throw new AccessError(404, 'NOT_FOUND', 'That person is not a staff member of this salon.');
    if (to === a.userId) throw new AccessError(400, 'VALIDATION', 'You already own this salon.');
    let keep: { key: string; baseRole: string } | null = null;
    if (req?.keepPreviousOwnerAs) {
      const t = await this.roles.resolveTemplate(a.tenantId, String(req.keepPreviousOwnerAs));
      if (!t) throw new AccessError(404, 'NOT_FOUND', 'Role not found.');
      keep = { key: t.key, baseRole: t.baseRole };
    }
    await this.db.transaction().execute(async (trx) => {
      const t: any = (await sql`select id, owner_user_id from tenants where id = ${a.tenantId} for update`.execute(trx)).rows[0];
      if (!t) throw new AccessError(404, 'NOT_FOUND', 'Salon not found.');
      const me: any = (await sql`select role, coalesce(status, 'active') as status from users where id = ${a.userId} and tenant_id = ${a.tenantId} for update`.execute(trx)).rows[0];
      if (!me || me.role !== 'OWNER' || me.status !== 'active') throw new AccessError(403, 'PERMISSION_DENIED', 'Only an active owner can transfer ownership.');
      if (t.owner_user_id && String(t.owner_user_id) !== a.userId) {
        const primary: any = (await sql`select coalesce(status, 'active') as status, role from users where id = ${t.owner_user_id} and tenant_id = ${a.tenantId}`.execute(trx)).rows[0];
        if (primary && primary.status === 'active' && primary.role === 'OWNER') throw new AccessError(403, 'PERMISSION_DENIED', 'Only the primary owner can transfer ownership.');
      }
      const target: any = (await sql`select role, coalesce(status, 'active') as status from users where id = ${to} and tenant_id = ${a.tenantId} and role in ('OWNER','MANAGER','FRONT_DESK','RECEPTION','TECHNICIAN') for update`.execute(trx)).rows[0];
      if (!target) throw new AccessError(404, 'NOT_FOUND', 'That person is not a staff member of this salon.');
      if (target.status !== 'active') throw new AccessError(409, 'TARGET_INACTIVE', 'Ownership can only go to an active account.');
      const prevTemplate: any = (await sql`select template_key from staff_role_assignments where tenant_id = ${a.tenantId} and user_id = ${a.userId}`.execute(trx)).rows[0];
      if (target.role !== 'OWNER') await sql`update users set role = 'OWNER', updated_at = now() where id = ${to} and tenant_id = ${a.tenantId}`.execute(trx);
      await sql`delete from staff_role_assignments where tenant_id = ${a.tenantId} and user_id = ${to}`.execute(trx);
      await sql`update tenants set owner_user_id = ${to}, updated_at = now() where id = ${a.tenantId}`.execute(trx);
      await sql`update user_branch_access set is_primary_owner = (user_id = ${to}), updated_at = now() where tenant_id = ${a.tenantId} and (user_id = ${to} or user_id = ${a.userId}) and is_primary_owner <> (user_id = ${to})`.execute(trx);
      if (keep) {
        if (keep.baseRole !== 'OWNER') await sql`update users set role = ${keep.baseRole}, updated_at = now() where id = ${a.userId} and tenant_id = ${a.tenantId}`.execute(trx);
        await sql`insert into staff_role_assignments (tenant_id, user_id, template_key, assigned_by, assigned_at) values (${a.tenantId}, ${a.userId}, ${keep.key}, ${a.userId}, now())
          on conflict (tenant_id, user_id) do update set template_key = excluded.template_key, assigned_by = excluded.assigned_by, assigned_at = now()`.execute(trx);
      }
      // after: the new owner is an active OWNER, so the salon cannot be left without one — asserted, not assumed
      const owners: any = (await sql`select count(*)::int as n from users where tenant_id = ${a.tenantId} and role = 'OWNER' and coalesce(status, 'active') = 'active'`.execute(trx)).rows[0];
      if (Number(owners?.n ?? 0) < 1) throw new AccessError(409, 'LAST_OWNER', "The salon must keep an active owner.");
      await recordAuthorizationChange(trx, this.outbox, { tenantId: a.tenantId, actorUserId: a.userId, targetUserId: to, action: 'ownership.transferred',
        before: { ownerUserId: t.owner_user_id ? String(t.owner_user_id) : null, role: String(target.role) }, after: { ownerUserId: to, role: 'OWNER' }, reason, ip: a.ip ?? null });
      await recordAuthorizationChange(trx, this.outbox, { tenantId: a.tenantId, actorUserId: a.userId, targetUserId: a.userId, action: keep && keep.baseRole !== 'OWNER' ? 'role.base_changed' : 'role.assigned',
        before: { role: 'OWNER', templateKey: prevTemplate?.template_key ?? null }, after: { role: keep?.baseRole ?? 'OWNER', templateKey: keep?.key ?? prevTemplate?.template_key ?? null }, reason, ip: a.ip ?? null });
    });
    this.changed(to); this.changed(a.userId);
    return { ok: true, newOwnerUserId: to, previousOwnerUserId: a.userId };
  }
  /** B-13 (Oct 20 2026) — END EMPLOYMENT for staff who are not technicians (front desk, manager, reception, accountant, a
   *  co-owner). The technician chain (revoke-technician-access) owns technicians: roster, membership, Clock PIN; a staff
   *  login has none of those, so this is the same TERMINATION in one transaction — login inactive (state machine), every
   *  session + refresh token revoked, branch grants and the role assignment removed, audited (status.changed, reason) and
   *  announced (AUTHORIZATION_CHANGED → the person's next request is refused and the Roles screens refetch). Refuses:
   *  yourself; a technician (409 USE_TECHNICIAN_CHAIN); an owner unless the actor is an owner; the LAST active owner. */
  async endEmployment(a: AccessActor, userId: string, req: { reason?: string }): Promise<{ ok: true; userId: string; sessionsRevoked: number; branchGrantsRemoved: number }> {
    const reason = reasonText(req?.reason);
    if (!reason) throw new AccessError(400, 'VALIDATION', 'Say why (reason).');
    if (!UUID.test(String(userId ?? ''))) throw new AccessError(404, 'NOT_FOUND', 'That person is not a staff member of this salon.');
    if (userId === a.userId) throw new AccessError(400, 'VALIDATION', 'You cannot end your own employment — ask another owner.');
    const out = await this.db.transaction().execute(async (trx) => {
      const u: any = (await sql`select id, role, coalesce(status, 'active') as status, branch_id from users where id = ${userId} and tenant_id = ${a.tenantId} for update`.execute(trx)).rows[0];
      if (!u) throw new AccessError(404, 'NOT_FOUND', 'That person is not a staff member of this salon.');
      if (u.role === 'TECHNICIAN') throw new AccessError(409, 'USE_TECHNICIAN_CHAIN', 'Technicians are ended from their profile (Disconnect / End employment) — that removes the roster and Clock PIN too.');
      if (u.role === 'SUPER_ADMIN' || u.role === 'CUSTOMER') throw new AccessError(404, 'NOT_FOUND', 'That person is not a staff member of this salon.');
      if (u.status === 'inactive') throw new AccessError(409, 'ALREADY_ENDED', 'This employment has already been ended.');
      if (u.role === 'OWNER') {
        if (a.role !== 'OWNER') throw new AccessError(403, 'PERMISSION_DENIED', 'Only an owner can end another owner\'s employment.');
        const owners: any = (await sql`select count(*)::int as n from users where tenant_id = ${a.tenantId} and role = 'OWNER' and coalesce(status, 'active') = 'active' and id <> ${userId}`.execute(trx)).rows[0];
        if (Number(owners?.n ?? 0) < 1) throw new AccessError(409, 'LAST_OWNER', 'The salon must keep an active owner.');
      }
      const upd = await sql`update users set status = 'inactive', updated_at = now() where id = ${userId} and tenant_id = ${a.tenantId} and ${canMoveToSql(USER_ACCOUNT, 'inactive')}`.execute(trx);
      if (Number(upd.numAffectedRows ?? 0) < 1) throw new AccessError(409, 'INVALID_STATE', 'This account cannot be ended from its current state.');
      const sessions = await sql`update sessions set status = 'revoked', revoked_at = coalesce(revoked_at, now())
        where user_id = ${userId} and (status <> 'revoked' or revoked_at is null) and ${canMoveToSql(SESSION, 'revoked')} and (tenant_id = ${a.tenantId} or tenant_id is null)`.execute(trx);
      try { await sql`update refresh_tokens set revoked_at = now() where user_id = ${userId} and revoked_at is null`.execute(trx); } catch { /* the session row is the authority */ }
      const grants = await sql`delete from user_branch_access where tenant_id = ${a.tenantId} and user_id = ${userId}`.execute(trx);
      await sql`delete from staff_role_assignments where tenant_id = ${a.tenantId} and user_id = ${userId}`.execute(trx);
      await sql`update tenant_user_permission_overrides set revoked_at = now(), revoke_reason = 'employment_ended' where tenant_id = ${a.tenantId} and user_id = ${userId} and revoked_at is null`.execute(trx).catch(() => undefined);
      await recordAuthorizationChange(trx, this.outbox, { tenantId: a.tenantId, actorUserId: a.userId, targetUserId: userId, action: 'status.changed',
        before: { status: String(u.status), role: String(u.role) }, after: { status: 'inactive', role: String(u.role), employmentEnded: true }, reason, ip: a.ip ?? null });
      return { sessionsRevoked: Number(sessions.numAffectedRows ?? 0), branchGrantsRemoved: Number(grants.numAffectedRows ?? 0) };
    });
    this.changed(userId);
    return { ok: true as const, userId, ...out };
  }
}

/** The expiry sweep (job): temporary overrides past their expiry get revoked_at + reason 'expired', each audited and
 *  announced (AUTHORIZATION_CHANGED). Decisions never wait for it — expiry is honoured at decision time; the sweep keeps the
 *  table, the audit trail and the authorization versions (trigger) honest. One salon per call (tenant-partitioned). */
export async function sweepExpiredOverridesForTenant(db: Kysely<any>, outbox: OutboxWriter | null, tenantId: string, limit = 500): Promise<number> {
  return db.transaction().execute(async (trx) => {
    const rows: any[] = (await sql`update tenant_user_permission_overrides set revoked_at = now(), revoke_reason = 'expired'
        where id in (select id from tenant_user_permission_overrides where tenant_id = ${tenantId} and revoked_at is null and expires_at is not null and expires_at <= now()
                     order by expires_at limit ${limit} for update skip locked)
          and tenant_id = ${tenantId}
        returning id, user_id, permission, effect, branch_id, expires_at`.execute(trx)).rows;
    for (const r of rows) {
      await recordAuthorizationChange(trx, outbox, { tenantId, actorUserId: null, targetUserId: String(r.user_id), action: 'override.expired',
        before: { id: String(r.id), permission: r.permission, effect: r.effect, branchId: r.branch_id ? String(r.branch_id) : null, expiresAt: iso(r.expires_at) }, after: null, reason: 'expired' });
    }
    return rows.length;
  });
}

/** Which salons have expired, still-live overrides (the sweep's dispatcher). Cross-salon by design: a platform job. */
export async function tenantsWithExpiredOverrides(db: Kysely<any>, limit = 200): Promise<string[]> {
  const r: any = await sql`select distinct tenant_id from tenant_user_permission_overrides where revoked_at is null and expires_at is not null and expires_at <= now() limit ${limit}`.execute(db);
  return (r.rows ?? []).map((x: any) => String(x.tenant_id));
}

export { TENANT_KEYS };
