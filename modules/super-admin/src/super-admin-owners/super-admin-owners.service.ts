// super-admin-owners.service.ts — Super Admin → Owner Multi-Salon assignment logic, extracted Nest-free so it can be
// unit-tested (the @Controller/@Module wiring stays in super-admin-owners.module.ts). WITHIN-TENANT only: a branch is
// assignable to an owner solely when branch.tenant_id === owner.tenant_id; cross-tenant assignment is rejected.
import { sql, type Kysely } from 'kysely';
import type { DB } from '@aipowersalon/database';
import { hashPassword } from '@aipowersalon/auth';
import { buildMediaUrl } from '@aipowersalon/media';


export class SuperAdminOwnersError extends Error {
  constructor(public code: 'not_found' | 'invalid', message: string) { super(message); }
}

const ACCESS_LEVELS = ['owner', 'manager', 'viewer', 'report_only'];
const PIN_RE = /^\d{6}$/;
function normalizePin(pin: unknown): string {
  const s = String(pin ?? '').trim();
  if (!PIN_RE.test(s)) throw new SuperAdminOwnersError('invalid', 'A branch PIN must be exactly 6 digits.');
  return s;
}

export class SuperAdminOwnersService {
  constructor(private readonly db: Kysely<DB>) {}

  private async owner(ownerId: string) {
    const u = await this.db.selectFrom('users as u')
      .leftJoin('technicians as tech', 'tech.user_id', 'u.id')
      .leftJoin('global_tech_profiles as gtp', (join: any) =>
        join.on((eb: any) => eb.or([
          eb('gtp.id', '=', sql<string>`tech.global_tech_profile_id`),
          eb('gtp.user_id', '=', sql<string>`u.id`)
        ]))
      )
      .select([
        'u.id', 'u.tenant_id', 'u.full_name', 'u.email', 'u.role', 'u.status',
        'u.avatar_url as user_avatar_url', 'gtp.avatar_url as gtp_avatar_url', 'tech.avatar_url as tech_avatar_url'
      ])
      .where('u.id', '=', ownerId).executeTakeFirst();
    if (!u) throw new SuperAdminOwnersError('not_found', 'Owner user not found.');
    if (!u.tenant_id) throw new SuperAdminOwnersError('invalid', 'This owner has no salon business assigned.');
    const rawPhoto = (u as any).user_avatar_url || (u as any).gtp_avatar_url || (u as any).tech_avatar_url || null;
    return { ...u, avatarUrl: rawPhoto ? buildMediaUrl(rawPhoto) : null, tenant_id: u.tenant_id as string };
  }

  private async audit(tenantId: string, actorId: string | undefined, action: string, entityId: string, metadata: unknown) {
    await this.db.insertInto('owner_audit_log').values({
      tenant_id: tenantId, branch_id: null, user_id: actorId ?? null, role: 'SUPER_ADMIN',
      action, entity_type: 'user_branch_access', entity_id: entityId, metadata: JSON.stringify(metadata ?? {}) as unknown as object,
    } as any).execute();
  }

  /** GET /super-admin/owners — every OWNER user across tenants with their assigned-branch count. */
  async listOwners() {
    const owners = await this.db.selectFrom('users as u')
      .leftJoin('tenants as t', 't.id', 'u.tenant_id')
      .leftJoin('technicians as tech', 'tech.user_id', 'u.id')
      .leftJoin('global_tech_profiles as gtp', (join: any) =>
        join.on((eb: any) => eb.or([
          eb('gtp.id', '=', sql<string>`tech.global_tech_profile_id`),
          eb('gtp.user_id', '=', sql<string>`u.id`)
        ]))
      )
      .select([
        'u.id', 'u.tenant_id', 'u.full_name', 'u.email', 'u.status', 't.display_name as tenant_name',
        'u.avatar_url as user_avatar_url', 'gtp.avatar_url as gtp_avatar_url', 'tech.avatar_url as tech_avatar_url'
      ])
      .where('u.role', '=', 'OWNER').orderBy('u.full_name').execute();
    const counts = await this.db.selectFrom('user_branch_access')
      .select((eb) => ['user_id', eb.fn.countAll().as('c')]).groupBy('user_id').execute();
    const byUser = new Map(counts.map((c: any) => [c.user_id as string, Number(c.c)] as const));
    return {
      owners: owners.map((o: any) => {
        const rawPhoto = o.user_avatar_url || o.gtp_avatar_url || o.tech_avatar_url || null;
        return {
          ownerId: o.id, tenantId: o.tenant_id, fullName: o.full_name, email: o.email ?? null,
          avatarUrl: rawPhoto ? buildMediaUrl(rawPhoto) : null,
          status: o.status, tenantName: o.tenant_name ?? null, assignedBranchCount: byUser.get(o.id) ?? 0,
        };
      }),
    };
  }

  /** GET /super-admin/owners/:ownerId — assigned branches + the full assignable branch list for that owner's tenant. */
  async getOwner(ownerId: string) {
    const u = await this.owner(ownerId);
    const assigned = await this.db.selectFrom('user_branch_access as a')
      .innerJoin('branches as b', 'b.id', 'a.branch_id')
      .select(['a.branch_id', 'b.name as branch_name', 'a.access_level', 'a.is_primary_owner', 'b.switch_pin_hash'])
      .where('a.tenant_id', '=', u.tenant_id).where('a.user_id', '=', ownerId).orderBy('b.name').execute();
    const allBranches = await this.db.selectFrom('branches').select(['id', 'name', 'status'])
      .where('tenant_id', '=', u.tenant_id).orderBy('name').execute();
    const isMultiSalon = assigned.length > 1;
    return {
      ownerId: u.id, tenantId: u.tenant_id, fullName: u.full_name, email: u.email ?? null, avatarUrl: u.avatarUrl, status: u.status, isMultiSalon,
      assignedBranches: assigned.map((a) => ({ branchId: a.branch_id, branchName: a.branch_name, accessLevel: String(a.access_level), isPrimaryOwner: !!a.is_primary_owner, hasSwitchPin: !!a.switch_pin_hash })),
      assignableBranches: allBranches.map((b) => ({ branchId: b.id, branchName: b.name, status: b.status })),
    };
  }

  /** GET /super-admin/owners/:ownerId/activity — the owner's recent audit timeline for oversight: their own actions
   * (user_id = owner) plus the super-admin actions taken on them (entity_id = owner). Scoped to the owner's tenant, so
   * one owner's activity never bleeds into another's even within a shared tenant. */
  async getOwnerActivity(ownerId: string, limit = 20) {
    const u = await this.owner(ownerId);
    const rows = await this.db.selectFrom('owner_audit_log')
      .select(['action', 'branch_id', 'entity_type', 'entity_id', 'role', 'metadata', 'created_at'])
      .where('tenant_id', '=', u.tenant_id)
      .where((eb) => eb.or([eb('user_id', '=', ownerId), eb('entity_id', '=', ownerId)]))
      .orderBy('created_at', 'desc').limit(Math.min(Math.max(limit, 1), 100)).execute();
    return rows.map((r) => ({
      action: r.action, branchId: (r.branch_id as string | null) ?? null, entityType: (r.entity_type as string | null) ?? null,
      entityId: (r.entity_id as string | null) ?? null, role: (r.role as string | null) ?? null,
      metadata: r.metadata ?? {}, createdAt: (r.created_at as Date).toISOString(),
    }));
  }

  /** POST /super-admin/owners/:ownerId/salons — create a NEW salon (branch) under the owner's tenant and assign it to
   * the owner in one transaction. This is how an owner grows their footprint; there is NO cap on how many salons one
   * owner may hold. */
  async createSalon(actorId: string | undefined, ownerId: string, body: { name?: string; city?: string; state?: string; address?: string; zip?: string; phone?: string; accessLevel?: string; isPrimaryOwner?: boolean; switchPin?: string }) {
    const u = await this.owner(ownerId);
    const name = String(body?.name || '').trim();
    if (!name) throw new SuperAdminOwnersError('invalid', 'A salon name is required.');
    const accessLevel = body?.accessLevel && ACCESS_LEVELS.includes(body.accessLevel) ? body.accessLevel : 'owner';
    const pinHash = body?.switchPin != null && String(body.switchPin).trim() !== '' ? await hashPassword(normalizePin(body.switchPin)) : null;
    const branchId = await this.db.transaction().execute(async (trx) => {
      const b = await trx.insertInto('branches').values({
        tenant_id: u.tenant_id, name, city: body?.city ?? null, state: body?.state ?? null,
        address: body?.address ?? null, zip: body?.zip ?? null, phone: body?.phone ?? null, status: 'active',
        switch_pin_hash: pinHash, switch_pin_updated_at: pinHash ? (new Date() as any) : null,
      } as any).returning('id').executeTakeFirstOrThrow();
      const newId = (b as any).id as string;
      await trx.insertInto('user_branch_access').values({
        tenant_id: u.tenant_id, branch_id: newId, user_id: ownerId, role: 'OWNER',
        access_level: accessLevel, is_primary_owner: !!body?.isPrimaryOwner, created_by_user_id: actorId ?? null,
      } as any).execute();
      if (body?.isPrimaryOwner) {
        await trx.updateTable('user_branch_access').set({ is_primary_owner: false, updated_at: new Date() as any } as any)
          .where('tenant_id', '=', u.tenant_id).where('user_id', '=', ownerId).where('branch_id', '!=', newId).execute();
      }
      return newId;
    });
    await this.audit(u.tenant_id, actorId, 'super_admin_owner_salon_created', ownerId, { branchId, name });
    return this.getOwner(ownerId);
  }

  /** POST /super-admin/owners/:ownerId/branches — assign one branch (within the owner's tenant only). */
  async assignBranch(actorId: string | undefined, ownerId: string, body: { branchId?: string; accessLevel?: string; isPrimaryOwner?: boolean }) {
    const u = await this.owner(ownerId);
    const branchId = String(body?.branchId || '');
    if (!branchId) throw new SuperAdminOwnersError('invalid', 'branchId is required.');
    const accessLevel = body?.accessLevel && ACCESS_LEVELS.includes(body.accessLevel) ? body.accessLevel : 'owner';
    const branch = await this.db.selectFrom('branches').select(['id', 'tenant_id']).where('id', '=', branchId).executeTakeFirst();
    if (!branch) throw new SuperAdminOwnersError('not_found', 'Branch not found.');
    if (branch.tenant_id !== u.tenant_id) throw new SuperAdminOwnersError('invalid', 'That branch belongs to a different salon business than this owner.');
    await this.db.insertInto('user_branch_access').values({
      tenant_id: u.tenant_id, branch_id: branchId, user_id: ownerId, role: 'OWNER',
      access_level: accessLevel, is_primary_owner: !!body?.isPrimaryOwner, created_by_user_id: actorId ?? null,
    } as any).onConflict((oc: any) => oc.columns(['tenant_id', 'user_id', 'branch_id']).doUpdateSet({ access_level: accessLevel, is_primary_owner: !!body?.isPrimaryOwner, updated_at: new Date() as any })).execute();
    if (body?.isPrimaryOwner) {
      await this.db.updateTable('user_branch_access').set({ is_primary_owner: false, updated_at: new Date() as any } as any)
        .where('tenant_id', '=', u.tenant_id).where('user_id', '=', ownerId).where('branch_id', '!=', branchId).execute();
    }
    await this.audit(u.tenant_id, actorId, 'super_admin_owner_branch_assigned', ownerId, { branchId, accessLevel, isPrimaryOwner: !!body?.isPrimaryOwner });
    return this.getOwner(ownerId);
  }

  /** PATCH /super-admin/owners/:ownerId/branches/:branchId — change access level / primary flag. */
  async updateBranch(actorId: string | undefined, ownerId: string, branchId: string, body: { accessLevel?: string; isPrimaryOwner?: boolean }) {
    const u = await this.owner(ownerId);
    const existing = await this.db.selectFrom('user_branch_access').select('id')
      .where('tenant_id', '=', u.tenant_id).where('user_id', '=', ownerId).where('branch_id', '=', branchId).executeTakeFirst();
    if (!existing) throw new SuperAdminOwnersError('not_found', 'This owner is not assigned to that branch.');
    const set: any = { updated_at: new Date() };
    if (body?.accessLevel !== undefined) {
      if (!ACCESS_LEVELS.includes(body.accessLevel)) throw new SuperAdminOwnersError('invalid', 'Invalid access level.');
      set.access_level = body.accessLevel;
    }
    if (body?.isPrimaryOwner !== undefined) set.is_primary_owner = !!body.isPrimaryOwner;
    await this.db.updateTable('user_branch_access').set(set).where('id', '=', existing.id).execute();
    if (body?.isPrimaryOwner) {
      await this.db.updateTable('user_branch_access').set({ is_primary_owner: false, updated_at: new Date() as any } as any)
        .where('tenant_id', '=', u.tenant_id).where('user_id', '=', ownerId).where('branch_id', '!=', branchId).execute();
    }
    await this.audit(u.tenant_id, actorId, 'super_admin_owner_updated', ownerId, { branchId, ...set, updated_at: undefined });
    return this.getOwner(ownerId);
  }

  /** DELETE /super-admin/owners/:ownerId/branches/:branchId — revoke access to one branch. */
  async removeBranch(actorId: string | undefined, ownerId: string, branchId: string) {
    const u = await this.owner(ownerId);
    const res: any = await this.db.deleteFrom('user_branch_access')
      .where('tenant_id', '=', u.tenant_id).where('user_id', '=', ownerId).where('branch_id', '=', branchId).executeTakeFirst();
    await this.audit(u.tenant_id, actorId, 'super_admin_owner_branch_removed', ownerId, { branchId });
    return { ok: true as const, removed: Number(res?.numDeletedRows ?? 0) > 0 };
  }

  /** POST /super-admin/owners/:ownerId/branches/:branchId/pin — set or change a salon's 6-digit switch PIN. Within-tenant
   * and the owner must be assigned to that branch. Stored as a scrypt hash; the PIN itself is never returned. */
  async setBranchPin(actorId: string | undefined, ownerId: string, branchId: string, pin: string) {
    const u = await this.owner(ownerId);
    const access = await this.db.selectFrom('user_branch_access').select('id')
      .where('tenant_id', '=', u.tenant_id).where('user_id', '=', ownerId).where('branch_id', '=', branchId).executeTakeFirst();
    if (!access) throw new SuperAdminOwnersError('not_found', 'This owner is not assigned to that salon.');
    const hash = await hashPassword(normalizePin(pin));
    await this.db.updateTable('branches').set({ switch_pin_hash: hash, switch_pin_updated_at: new Date() as any } as any)
      .where('id', '=', branchId).where('tenant_id', '=', u.tenant_id).execute();
    await this.audit(u.tenant_id, actorId, 'super_admin_owner_branch_pin_set', ownerId, { branchId });
    return this.getOwner(ownerId);
  }

  /** DELETE /super-admin/owners/:ownerId/branches/:branchId/pin — remove a salon's switch PIN (switching stops prompting).
   * Within-tenant and the owner must be assigned to that branch. */
  async clearBranchPin(actorId: string | undefined, ownerId: string, branchId: string) {
    const u = await this.owner(ownerId);
    const access = await this.db.selectFrom('user_branch_access').select('id')
      .where('tenant_id', '=', u.tenant_id).where('user_id', '=', ownerId).where('branch_id', '=', branchId).executeTakeFirst();
    if (!access) throw new SuperAdminOwnersError('not_found', 'This owner is not assigned to that salon.');
    await this.db.updateTable('branches').set({ switch_pin_hash: null, switch_pin_updated_at: null } as any)
      .where('id', '=', branchId).where('tenant_id', '=', u.tenant_id).execute();
    await this.audit(u.tenant_id, actorId, 'super_admin_owner_branch_pin_cleared', ownerId, { branchId });
    return this.getOwner(ownerId);
  }
}
