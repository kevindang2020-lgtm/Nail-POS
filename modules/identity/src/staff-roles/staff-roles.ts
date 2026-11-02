// staff-roles.ts — Functional Decision 12, step 2: storing and assigning staff role templates.
// Default roles come from packages/permissions (role-templates.ts); a salon's own roles are stored per tenant; each staff
// member has at most ONE template per salon. Every template only NARROWS its base role — checked when a custom role is
// created, when a role is assigned, and again whenever permissions are resolved (resolvePermissions).
//
// BUILD_PLAN Phase 9 (Constitution 2): authority comes from PERMISSIONS, never from role names — roles.view to see,
// roles.manage to change; the grant ceiling is what the actor HOLDS (a role / template carrying anything the actor lacks is
// refused); owner-level changes (to or from OWNER) need ownership.transfer; a template may now move a person to another base role (promotion / demotion) within those ceilings; nobody
// changes their own role; the salon always keeps one active OWNER (LAST_OWNER, checked under a lock on the salon row);
// every change writes authorization_audit_events + AUTHORIZATION_CHANGED in the same transaction.
import { sql, type Kysely } from 'kysely';
import { DEFAULT_ROLE_TEMPLATES, findRoleTemplate, templatePermissions, validateCustomRole, permissionsFor, STAFF_SELF_SERVICE, hasPermission, type AccessScope, type Role } from '@aipowersalon/permissions';
import type { AuthorizationChange } from '../auth/authorization-audit';

export interface RoleView { key: string; name: string; baseRole: Role; scope: AccessScope; permissions: string[]; custom: boolean; description?: string }
export interface CustomRoleRow { id: string; tenantId: string; name: string; baseRole: string; scope: string; permissions: string[]; archivedAt: string | null }
export interface StaffActor { tenantId: string; userId: string; role: string; /** the actor's own effective permissions (session) */ permissions?: string[]; ip?: string | null }
/** A role change as the store applies it (one transaction: lock the salon, last-owner check, users.role, assignment, audit). */
export interface RoleChange { tenantId: string; userId: string; toBase: string; templateKey: string | null; by: string; reason?: string | null; ip?: string | null }
/** Writes the authorization audit row + AUTHORIZATION_CHANGED inside the store's transaction. */
export type AuthorizationRecorder = (trx: any, change: AuthorizationChange) => Promise<unknown>;

export interface StaffRolesStore {
  customRoles(tenantId: string, includeArchived?: boolean): Promise<CustomRoleRow[]>;
  customRole(tenantId: string, id: string): Promise<CustomRoleRow | null>;
  insertCustomRole(row: Omit<CustomRoleRow, 'id' | 'archivedAt'> & { createdBy: string }): Promise<CustomRoleRow>;
  archiveCustomRole(tenantId: string, id: string, by?: string): Promise<boolean>;
  /** The staff member's base role IN THIS SALON, or null when they are not staff here. */
  userBaseRole(tenantId: string, userId: string): Promise<string | null>;
  assignment(tenantId: string, userId: string): Promise<string | null>;
  setAssignment(tenantId: string, userId: string, templateKey: string | null, by: string): Promise<void>;
  /** BUILD_PLAN Phase 9: apply a role change atomically; throws StaffRoleError('…', 'CONFLICT', 'LAST_OWNER') when it would
   *  leave the salon without an active owner. Returns the state before. */
  applyRoleChange(c: RoleChange): Promise<{ fromBase: string; fromTemplate: string | null }>;
  /** Active owners of the salon other than this user (the pre-check; applyRoleChange re-checks under the lock). */
  otherActiveOwners(tenantId: string, userId: string): Promise<number>;
  /** This salon's staff (not customers, not platform accounts) with their current template key. */
  listStaff(tenantId: string): Promise<{ userId: string; name: string; email: string | null; baseRole: string; status: string; templateKey: string | null }[]>;
}

export class StaffRoleError extends Error { constructor(msg: string, readonly code: 'VALIDATION' | 'FORBIDDEN' | 'NOT_FOUND' | 'CONFLICT', readonly reason: string | null = null) { super(msg); this.name = 'StaffRoleError'; } }
/** The salon's last active owner may not be demoted, deactivated or removed. */
export const LAST_OWNER = 'LAST_OWNER';
export const lastOwnerError = () => new StaffRoleError("This is the salon's only active owner. Make someone else an owner first.", 'CONFLICT', LAST_OWNER);
/** The base role that IS ownership (the role → template mapping itself; not an authorization shortcut). */
export const isOwnerBase = (baseRole: string | null | undefined) => baseRole === 'OWNER';
/**
 * BUILD_PLAN Phase 9 — last-owner protection for ANY path that demotes, deactivates or removes a person (the salon's role
 * assignment, the access review's revoke, the platform's role / disable routes). Call INSIDE the transaction that makes
 * the change, BEFORE it: it locks the salon row (so two such changes serialize) and throws lastOwnerError() when the
 * person is the salon's only active OWNER. A person who is not an active owner passes.
 */
export async function assertNotLastOwner(trx: any, tenantId: string, userId: string): Promise<void> {
  await sql`select id from tenants where id = ${tenantId} for update`.execute(trx);
  const u: any = (await sql`select role, coalesce(status, 'active') as status from users where id = ${userId} and tenant_id = ${tenantId}`.execute(trx)).rows[0];
  if (!u || !isOwnerBase(String(u.role)) || String(u.status) !== 'active') return;
  const n: any = (await sql`select count(*)::int as n from users where tenant_id = ${tenantId} and role = 'OWNER' and id <> ${userId} and coalesce(status, 'active') = 'active'`.execute(trx)).rows[0];
  if (Number(n?.n ?? 0) === 0) throw lastOwnerError();
}

const CUSTOM = 'custom:';
const view = (t: (typeof DEFAULT_ROLE_TEMPLATES)[number]): RoleView => ({ key: t.key, name: t.name, baseRole: t.baseRole, scope: t.scope, permissions: templatePermissions(t), custom: false, description: t.description });
const customView = (r: CustomRoleRow): RoleView => ({ key: CUSTOM + r.id, name: r.name, baseRole: r.baseRole as Role, scope: r.scope as AccessScope,
  permissions: r.permissions.filter((p) => new Set<string>(permissionsFor(r.baseRole as Role)).has(p)), custom: true });

export interface StaffRolesAudit { record(e: { tenantId: string; userId: string; action: string; entityId?: string; metadata?: Record<string, unknown> }): void }

export class StaffRolesService {
  constructor(private readonly store: StaffRolesStore, private readonly audit?: StaffRolesAudit) {}

  /** The ten defaults plus the salon's live custom roles. */
  async listRoles(tenantId: string): Promise<RoleView[]> {
    return [...DEFAULT_ROLE_TEMPLATES.map(view), ...(await this.store.customRoles(tenantId)).map(customView)];
  }

  /** What the actor holds: the session's effective permissions (role defaults only when the caller passed none). */
  private mine(actor: StaffActor): string[] { return actor.permissions && actor.permissions.length ? actor.permissions : permissionsFor(actor.role as Role); }
  private holds(actor: StaffActor, key: string): boolean { return hasPermission({ tenantId: actor.tenantId, branchId: '', userId: actor.userId, role: actor.role as Role, permissions: this.mine(actor) }, key); }
  private manage(actor: StaffActor) {
    if (!this.holds(actor, 'roles.manage')) throw new StaffRoleError('Only an owner or a manager can manage staff roles.', 'FORBIDDEN');
  }
  private viewing(actor: StaffActor) {
    if (!this.holds(actor, 'roles.view') && !this.holds(actor, 'roles.manage')) throw new StaffRoleError('Only an owner or a manager can see staff roles.', 'FORBIDDEN');
  }

  /** What the actor may hand out: what they HOLD (Oct 6 2026; Phase 9: no OWNER shortcut — an owner holds every salon
   *  key, so nothing is beyond them, and an owner narrowed by a DENY override cannot hand out what was denied). */
  private beyondCeiling(actor: StaffActor, permissions: string[]): string[] {
    const mine = new Set<string>(this.mine(actor));
    return permissions.filter((p) => !mine.has(p));
  }

  /** The permissions a person holds here now (template, else base-role defaults). */
  async currentGrant(tenantId: string, userId: string, baseRole: string): Promise<string[]> {
    return (await this.resolvePermissions(tenantId, userId, baseRole)) ?? [...permissionsFor(baseRole as Role)];
  }

  async createCustomRole(actor: StaffActor, input: { name: string; baseRole: string; scope: string; permissions: string[] }): Promise<RoleView> {
    this.manage(actor);
    const v = validateCustomRole(input, this.holds(actor, 'ownership.transfer') ? 'OWNER' : actor.role);
    if (!v.ok) throw new StaffRoleError(v.error, 'VALIDATION');
    const over = this.beyondCeiling(actor, v.role.permissions);
    if (over.length) throw new StaffRoleError(`You can only build a role from permissions you hold yourself (not: ${over.slice(0, 5).join(', ')}${over.length > 5 ? ', …' : ''}).`, 'FORBIDDEN');
    if ((await this.store.customRoles(actor.tenantId)).some((r) => r.name.toLowerCase() === v.role.name.toLowerCase())) throw new StaffRoleError(`A role named "${v.role.name}" already exists.`, 'VALIDATION');
    const row = await this.store.insertCustomRole({ tenantId: actor.tenantId, name: v.role.name, baseRole: v.role.baseRole, scope: v.role.scope, permissions: v.role.permissions, createdBy: actor.userId });
    this.audit?.record({ tenantId: actor.tenantId, userId: actor.userId, action: 'staff_role_created', entityId: row.id, metadata: { name: row.name, baseRole: row.baseRole, scope: row.scope, permissionCount: row.permissions.length } });
    return customView(row);
  }

  async archiveCustomRole(actor: StaffActor, id: string): Promise<void> {
    this.manage(actor);
    const r = await this.store.customRole(actor.tenantId, id);
    if (!r || r.archivedAt) throw new StaffRoleError('Role not found.', 'NOT_FOUND');
    if (this.beyondCeiling(actor, customView(r).permissions).length) throw new StaffRoleError('Only the owner can archive an owner-level role.', 'FORBIDDEN');
    await this.store.archiveCustomRole(actor.tenantId, id, actor.userId);
    this.audit?.record({ tenantId: actor.tenantId, userId: actor.userId, action: 'staff_role_archived', entityId: id, metadata: { name: r.name } });
  }

  /** The template a key names, for this salon (a default, or a LIVE custom role of this salon). */
  async resolveTemplate(tenantId: string, key: string): Promise<RoleView | null> {
    if (key.startsWith(CUSTOM)) { const r = await this.store.customRole(tenantId, key.slice(CUSTOM.length)); return r && !r.archivedAt ? customView(r) : null; }
    const t = findRoleTemplate(key); return t ? view(t) : null;
  }

  /**
   * Gives a staff member a role (a template). The template's base role becomes the person's base role — a promotion or a
   * demotion between salon roles — within the ceiling: the actor must hold everything the template grants; owner-level
   * changes (to or from OWNER) need ownership.transfer (so a manager never changes an owner or makes one). `templateKey: null`
   * clears the template (base-role defaults). Nobody changes their own role; the last active owner cannot be demoted.
   */
  async assignRole(actor: StaffActor, userId: string, templateKey: string | null, opts: { reason?: string | null } = {}): Promise<{ userId: string; templateKey: string | null; role: string }> {
    this.manage(actor);
    const base = await this.store.userBaseRole(actor.tenantId, userId);
    let toBase = base ?? ''; let granted: string[] = [];
    if (templateKey !== null) {
      const t = await this.resolveTemplate(actor.tenantId, templateKey);
      if (!t) throw new StaffRoleError('Role not found.', 'NOT_FOUND');
      toBase = t.baseRole;
      granted = t.permissions;
    } else if (base) {
      granted = [...permissionsFor(base as Role)];   // clearing the template gives the base role's full defaults
    }
    // The salon always keeps an active owner — said before "not your own role", so the last owner learns WHY.
    if (base && isOwnerBase(base) && !isOwnerBase(toBase) && (await this.store.otherActiveOwners(actor.tenantId, userId)) === 0) throw lastOwnerError();
    // Nobody changes their OWN role (Oct 6 2026): a narrowed manager could re-assign themselves a wider template.
    if (userId === actor.userId) throw new StaffRoleError(this.holds(actor, 'ownership.transfer') ? 'You cannot change your own role.' : 'You cannot change your own role. Ask the owner.', 'FORBIDDEN');
    if (!base) throw new StaffRoleError('That person is not a staff member of this salon.', 'NOT_FOUND');
    // Ownership is its own authority (ownership.transfer — the owner's): a template may otherwise be narrow enough to fit
    // under a manager's ceiling while still making someone an OWNER, or a manager could demote the owner.
    if (isOwnerBase(base) && !this.holds(actor, 'ownership.transfer')) throw new StaffRoleError("Only the owner can change an owner's role.", 'FORBIDDEN');
    if (isOwnerBase(toBase) && !this.holds(actor, 'ownership.transfer')) throw new StaffRoleError('Only the owner can assign an owner-level role.', 'FORBIDDEN');
    const over = this.beyondCeiling(actor, granted);
    if (over.length) throw new StaffRoleError(`That role carries permissions you do not hold yourself (${over.slice(0, 5).join(', ')}${over.length > 5 ? ', …' : ''}). Ask the owner.`, 'FORBIDDEN');
    const before = await this.store.applyRoleChange({ tenantId: actor.tenantId, userId, toBase, templateKey, by: actor.userId, reason: opts.reason ?? null, ip: actor.ip ?? null });
    this.audit?.record({ tenantId: actor.tenantId, userId: actor.userId, action: 'staff_role_assigned', entityId: userId, metadata: { from: before.fromTemplate, to: templateKey, fromRole: before.fromBase, toRole: toBase } });
    return { userId, templateKey, role: toBase };
  }

  /** The salon's staff with their current role, for the roles screen. */
  async listStaff(actor: StaffActor) {
    this.viewing(actor);
    const roles = await this.listRoles(actor.tenantId);
    return (await this.store.listStaff(actor.tenantId)).map((u) => ({ ...u, templateName: u.templateKey ? roles.find((r) => r.key === u.templateKey)?.name ?? null : null,
      assignable: roles.filter((r) => this.beyondCeiling(actor, r.permissions).length === 0).map((r) => ({ key: r.key, name: r.name, baseRole: r.baseRole })) }));
  }

  /**
   * The permissions a staff member carries in this salon — used at sign-in (step 3). FAIL-SAFE: no assignment, an
   * archived/unknown role, a role built on a different base role than the person now has, or ANY error → null, and the
   * caller uses the base-role defaults. It can never return a permission the base role does not hold.
   */
  async resolvePermissions(tenantId: string, userId: string, baseRole: string): Promise<string[] | null> {
    return (await this.resolveAssignment(tenantId, userId, baseRole))?.permissions ?? null;
  }

  /** BUILD_PLAN Phase 9: the same fail-safe resolution, with the template's key and SCOPE (read at runtime now — the scope
   *  used to be stored and displayed only). null = no usable template: base-role defaults and the base role's scope. */
  async resolveAssignment(tenantId: string, userId: string, baseRole: string): Promise<{ templateKey: string; scope: AccessScope; permissions: string[] } | null> {
    try {
      const key = await this.store.assignment(tenantId, userId); if (!key) return null;
      const t = await this.resolveTemplate(tenantId, key);
      if (!t || t.baseRole !== baseRole) return null;
      const allowed = new Set<string>(permissionsFor(baseRole as Role));
      // a custom role stored before Phase 9 never listed the self-service keys (own profile, Help Center) — every staff member
      // keeps them, whatever the stored list says
      return { templateKey: key, scope: t.scope, permissions: [...new Set([...t.permissions, ...STAFF_SELF_SERVICE])].filter((p) => allowed.has(p)) };
    } catch { return null; }
  }
}

export class KyselyStaffRolesStore implements StaffRolesStore {
  constructor(private readonly db: Kysely<any>, private readonly recorder?: AuthorizationRecorder) {}
  private row = (r: any): CustomRoleRow => ({ id: String(r.id), tenantId: String(r.tenant_id), name: r.name, baseRole: r.base_role, scope: r.scope,
    permissions: Array.isArray(r.permissions) ? r.permissions.map(String) : (typeof r.permissions === 'string' ? JSON.parse(r.permissions) : []), archivedAt: r.archived_at ? new Date(r.archived_at).toISOString() : null });
  async customRoles(tenantId: string, includeArchived = false) {
    let q = this.db.selectFrom('tenant_custom_roles').selectAll().where('tenant_id', '=', tenantId);
    if (!includeArchived) q = q.where('archived_at', 'is', null);
    return (await q.orderBy('name').execute()).map(this.row);
  }
  async customRole(tenantId: string, id: string) {
    if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
    const r = await this.db.selectFrom('tenant_custom_roles').selectAll().where('tenant_id', '=', tenantId).where('id', '=', id).executeTakeFirst();
    return r ? this.row(r) : null;
  }
  async insertCustomRole(x: Omit<CustomRoleRow, 'id' | 'archivedAt'> & { createdBy: string }) {
    // BUILD_PLAN Phase 9: the definition and its authorization audit row + event commit together (the salon's version is
    // bumped by the tenant_custom_roles trigger: everyone on a custom role re-authorizes)
    return this.db.transaction().execute(async (trx) => {
      const r = await trx.insertInto('tenant_custom_roles').values({ tenant_id: x.tenantId, name: x.name, base_role: x.baseRole, scope: x.scope,
        permissions: JSON.stringify(x.permissions), created_by: /^[0-9a-f-]{36}$/i.test(x.createdBy) ? x.createdBy : null } as any).returningAll().executeTakeFirstOrThrow();
      const row = this.row(r);
      if (this.recorder) await this.recorder(trx, { tenantId: x.tenantId, actorUserId: x.createdBy, targetUserId: null, action: 'role.custom_created', before: null,
        after: { key: 'custom:' + row.id, name: row.name, baseRole: row.baseRole, scope: row.scope, permissions: row.permissions } });
      return row;
    });
  }
  async archiveCustomRole(tenantId: string, id: string, by?: string) {
    return this.db.transaction().execute(async (trx) => {
      const r: any = await trx.updateTable('tenant_custom_roles').set({ archived_at: sql`now()`, updated_at: sql`now()` } as any).where('tenant_id', '=', tenantId).where('id', '=', id).where('archived_at', 'is', null).executeTakeFirst();
      const ok = Number(r?.numUpdatedRows ?? 0) > 0;
      if (ok && this.recorder) await this.recorder(trx, { tenantId, actorUserId: by ?? null, targetUserId: null, action: 'role.custom_archived', before: { key: 'custom:' + id }, after: null });
      return ok;
    });
  }
  async userBaseRole(tenantId: string, userId: string) {
    if (!/^[0-9a-f-]{36}$/i.test(userId)) return null;
    const u: any = await this.db.selectFrom('users').select(['role']).where('id', '=', userId).where('tenant_id', '=', tenantId).executeTakeFirst();
    return u?.role && u.role !== 'SUPER_ADMIN' && u.role !== 'CUSTOMER' ? String(u.role) : null;
  }
  async assignment(tenantId: string, userId: string) {
    if (!/^[0-9a-f-]{36}$/i.test(userId)) return null;
    const r: any = await this.db.selectFrom('staff_role_assignments').select(['template_key']).where('tenant_id', '=', tenantId).where('user_id', '=', userId).executeTakeFirst();
    return r ? String(r.template_key) : null;
  }
  async listStaff(tenantId: string) {
    const rows: any[] = await this.db.selectFrom('users as u').leftJoin('staff_role_assignments as a', (j: any) => j.onRef('a.user_id', '=', 'u.id').on('a.tenant_id', '=', tenantId))
      .select(['u.id', 'u.full_name', 'u.first_name', 'u.last_name', 'u.email', 'u.role', 'u.status', 'a.template_key'])
      .where('u.tenant_id', '=', tenantId).where('u.role', 'in', ['OWNER', 'MANAGER', 'FRONT_DESK', 'RECEPTION', 'TECHNICIAN']).orderBy('u.role').orderBy('u.full_name').execute();
    return rows.map((r) => ({ userId: String(r.id), name: r.full_name || [r.first_name, r.last_name].filter(Boolean).join(' ') || r.email || 'Staff member', email: r.email ?? null,
      baseRole: String(r.role), status: String(r.status ?? 'active'), templateKey: r.template_key ?? null }));
  }
  async setAssignment(tenantId: string, userId: string, templateKey: string | null, by: string, db: Kysely<any> = this.db) {
    if (templateKey === null) { await db.deleteFrom('staff_role_assignments').where('tenant_id', '=', tenantId).where('user_id', '=', userId).execute(); return; }
    await sql`insert into staff_role_assignments (tenant_id, user_id, template_key, assigned_by, assigned_at)
      values (${tenantId}, ${userId}, ${templateKey}, ${/^[0-9a-f-]{36}$/i.test(by) ? by : null}, now())
      on conflict (tenant_id, user_id) do update set template_key = excluded.template_key, assigned_by = excluded.assigned_by, assigned_at = now()`.execute(db);
  }
  async otherActiveOwners(tenantId: string, userId: string, db: Kysely<any> = this.db): Promise<number> {
    const r: any = await sql`select count(*)::int as n from users where tenant_id = ${tenantId} and role = 'OWNER' and id <> ${userId}
       and coalesce(status, 'active') = 'active'`.execute(db);
    return Number(r.rows[0]?.n ?? 0);
  }
  /** One transaction: the salon row is LOCKED first, so two concurrent demotions of the last two owners serialize and the
   *  second sees the first (READ COMMITTED: each statement after the lock takes a fresh snapshot) → LAST_OWNER. */
  async applyRoleChange(c: RoleChange): Promise<{ fromBase: string; fromTemplate: string | null }> {
    return this.db.transaction().execute(async (trx) => {
      await sql`select id from tenants where id = ${c.tenantId} for update`.execute(trx);
      const u: any = (await sql`select role from users where id = ${c.userId} and tenant_id = ${c.tenantId} for update`.execute(trx)).rows[0];
      if (!u) throw new StaffRoleError('That person is not a staff member of this salon.', 'NOT_FOUND');
      const fromBase = String(u.role);
      if (isOwnerBase(fromBase) && !isOwnerBase(c.toBase) && (await this.otherActiveOwners(c.tenantId, c.userId, trx)) === 0) throw lastOwnerError();
      const a: any = (await sql`select template_key from staff_role_assignments where tenant_id = ${c.tenantId} and user_id = ${c.userId}`.execute(trx)).rows[0];
      const fromTemplate = a ? String(a.template_key) : null;
      if (c.toBase !== fromBase) await sql`update users set role = ${c.toBase}, updated_at = now() where id = ${c.userId} and tenant_id = ${c.tenantId}`.execute(trx);
      await this.setAssignment(c.tenantId, c.userId, c.templateKey, c.by, trx);
      if (this.recorder) await this.recorder(trx, { tenantId: c.tenantId, actorUserId: c.by, targetUserId: c.userId, action: c.toBase !== fromBase ? 'role.base_changed' : 'role.assigned',
        before: { role: fromBase, templateKey: fromTemplate }, after: { role: c.toBase, templateKey: c.templateKey }, reason: c.reason ?? null, ip: c.ip ?? null });
      return { fromBase, fromTemplate };
    });
  }
}

/** In-memory twin (tests, and wiring without a database). */
export class InMemoryStaffRolesStore implements StaffRolesStore {
  roles: CustomRoleRow[] = []; users = new Map<string, string>(); assignments = new Map<string, string>(); private n = 0;
  async customRoles(tenantId: string, includeArchived = false) { return this.roles.filter((r) => r.tenantId === tenantId && (includeArchived || !r.archivedAt)); }
  async customRole(tenantId: string, id: string) { return this.roles.find((r) => r.tenantId === tenantId && r.id === id) ?? null; }
  async insertCustomRole(x: any) { const r: CustomRoleRow = { id: `00000000-0000-4000-8000-${String(++this.n).padStart(12, '0')}`, tenantId: x.tenantId, name: x.name, baseRole: x.baseRole, scope: x.scope, permissions: x.permissions, archivedAt: null }; this.roles.push(r); return r; }
  async archiveCustomRole(tenantId: string, id: string) { const r = await this.customRole(tenantId, id); if (!r || r.archivedAt) return false; r.archivedAt = new Date().toISOString(); return true; }
  async userBaseRole(tenantId: string, userId: string) { return this.users.get(tenantId + '::' + userId) ?? null; }
  async assignment(tenantId: string, userId: string) { return this.assignments.get(tenantId + '::' + userId) ?? null; }
  names = new Map<string, string>();
  async listStaff(tenantId: string) { return [...this.users].filter(([k]) => k.startsWith(tenantId + '::')).map(([k, role]) => { const userId = k.split('::')[1]; return { userId, name: this.names.get(userId) ?? userId, email: null, baseRole: role, status: 'active', templateKey: this.assignments.get(k) ?? null }; }); }
  async setAssignment(tenantId: string, userId: string, k: string | null) { const key = tenantId + '::' + userId; if (k === null) this.assignments.delete(key); else this.assignments.set(key, k); }
  statuses = new Map<string, string>(); changes: RoleChange[] = [];
  async otherActiveOwners(tenantId: string, userId: string) { return [...this.users].filter(([k, r]) => k.startsWith(tenantId + '::') && k !== tenantId + '::' + userId && isOwnerBase(r) && (this.statuses.get(k) ?? 'active') === 'active').length; }
  async applyRoleChange(c: RoleChange) {
    const key = c.tenantId + '::' + c.userId; const fromBase = this.users.get(key);
    if (!fromBase) throw new StaffRoleError('That person is not a staff member of this salon.', 'NOT_FOUND');
    if (isOwnerBase(fromBase) && !isOwnerBase(c.toBase) && (await this.otherActiveOwners(c.tenantId, c.userId)) === 0) throw lastOwnerError();
    const fromTemplate = this.assignments.get(key) ?? null;
    this.users.set(key, c.toBase); await this.setAssignment(c.tenantId, c.userId, c.templateKey); this.changes.push(c);
    return { fromBase, fromTemplate };
  }
}
