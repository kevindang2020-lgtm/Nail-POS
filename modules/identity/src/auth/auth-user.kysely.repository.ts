/**
 * auth-user.kysely.repository.ts — production AuthUserRepository over Postgres (Kysely), implementing the same port the
 * in-memory repo does. Tenant resolution is by tenant_code; the user lookup is scoped to the resolved tenant id (never
 * a client value) and excludes SUPER_ADMIN rows. Email is matched case-insensitively (lower(email)); phone matches the
 * stored E.164 normalized_phone. Mirrors the established adapter pattern: provided only when a Postgres handle exists,
 * otherwise the module falls back to the in-memory repo.
 *
 * Honest caveat (same as the other Kysely adapters): this type-checks and builds, but has NOT been run against a live
 * Postgres in this environment.
 */
import { canMoveToSql } from '@aipowersalon/database';
import { USER_ACCOUNT } from './identity-lifecycles';
import { currentAuthorizationVersions, enterableBranchesForUser } from './authorization-state';
import { RecoveryCodes, KyselyRecoveryCodeStore } from './mfa-recovery-codes';
import type { Kysely } from 'kysely';
import { StaffRolesService, KyselyStaffRolesStore } from '../staff-roles/staff-roles';
import { sql } from 'kysely';
import type { DB } from '@aipowersalon/database';
import type { Role } from '@aipowersalon/permissions';
import type { TenantStatus, UserStatus, SubStatus } from './auth-flow';
import type { CustomerLoginCandidate, CustomerIdentity, OwnerLoginRecord } from './auth-user.repository';
import type { NormalizedIdentifier } from '@aipowersalon/auth';
import type { AuthUserRepository, LoginLookup, LoginUserRecord } from './auth-user.repository';
import type { ProviderSecrets } from '@aipowersalon/security';

const USER_COLS = ['id', 'tenant_id', 'branch_id', 'role', 'status', 'password_hash', 'mfa_enabled', 'full_name'] as const;

function toRecord(u: {
  id: string; tenant_id: string | null; branch_id: string | null; role: string; status: string;
  password_hash: string | null; mfa_enabled: boolean; full_name: string | null;
}): LoginUserRecord {
  return {
    userId: u.id, tenantId: u.tenant_id, branchId: u.branch_id, role: u.role as Role,
    status: u.status as UserStatus, passwordHash: u.password_hash, mfaEnabled: !!u.mfa_enabled, fullName: u.full_name,
  };
}

export class KyselyAuthUserRepository implements AuthUserRepository {
  constructor(private readonly db: Kysely<DB>, private readonly mfaSecrets: ProviderSecrets) {}

  // Decrypted base32 secret of the user's CONFIRMED TOTP factor, or null if none is enrolled/confirmed.
  private async loadTotpSecret(userId: string): Promise<string | null> {
    const f = await this.db.selectFrom('mfa_factors').select(['secret_enc'])
      .where('user_id', '=', userId).where('type', '=', 'totp').where('confirmed', '=', true)
      .where('secret_enc', 'is not', null).orderBy('created_at', 'desc').executeTakeFirst();
    return f?.secret_enc ? this.mfaSecrets.decrypt(f.secret_enc) : null;
  }

  // Atomically advance last_used_step for the user's confirmed TOTP factor. The `last_used_step < step` predicate is
  // evaluated inside the UPDATE, so a replay of the same (or an earlier) code updates zero rows and returns false even
  // under concurrent attempts. Returns false when there is no confirmed factor.
  async consumeRecoveryCode(userId: string, code: string): Promise<boolean> {
    return new RecoveryCodes(new KyselyRecoveryCodeStore(this.db)).consume(userId, code).catch(() => false);
  }
  async markTotpStepUsed(userId: string, step: number): Promise<boolean> {
    const res: any = await this.db.updateTable('mfa_factors')
      .set({ last_used_step: step } as any)
      .where('user_id', '=', userId).where('type', '=', 'totp').where('confirmed', '=', true)
      .where((eb: any) => eb.or([eb('last_used_step', 'is', null), eb('last_used_step', '<', step)]))
      .executeTakeFirst().catch(() => undefined);
    return !!res && Number(res.numUpdatedRows ?? 0) > 0;
  }

  async findTenantUserForLogin(tenantCode: string, id: NormalizedIdentifier): Promise<LoginLookup> {
    const tenant = await this.db
      .selectFrom('tenants').select(['id', 'status', 'suspension_reason_code'])
      .where('tenant_code', '=', tenantCode)
      .executeTakeFirst();
    if (!tenant) return { tenantFound: false, branchCount: 0 };

    let user: LoginUserRecord | undefined;
    if (id.kind === 'email' || id.kind === 'phone') {
      let q = this.db
        .selectFrom('users').select(USER_COLS as unknown as string[] as any)
        .where('tenant_id', '=', tenant.id)
        .where('role', '<>', 'SUPER_ADMIN')
        .where('role', '<>', 'CUSTOMER');   // spec §11 symmetry (found live by auth-matrix-e2e Jul 29): customers sign in at the CUSTOMER portal only — the staff door must not find them, exactly as the customer door cannot find staff.
      q = id.kind === 'email'
        ? q.where((eb: any) => eb(eb.fn('lower', ['email']), '=', id.value))
        : q.where('normalized_phone', '=', id.value);
      const row = await q.executeTakeFirst();
      if (row) { user = toRecord(row as any); user.totpSecret = await this.loadTotpSecret(user.userId); }
    }

    const sub = await this.db
      .selectFrom('tenant_subscriptions').select(['status'])
      .where('tenant_id', '=', tenant.id)
      .orderBy('created_at', 'desc')
      .executeTakeFirst();

    // Count ACTIVE branches only — an inactive branch is not a location anyone can work in, so it must not
    // trigger (or suppress) branch selection.
    const cntResult = await this.db
      .selectFrom('branches').select(['id'])
      .where('tenant_id', '=', tenant.id)
      .where((eb: any) => eb(eb.fn('lower', ['status']), '=', 'active'))
      .execute();
    const cnt = cntResult.length;
    const singleBranchId = cnt === 1 ? cntResult[0].id : undefined;

    // Status of the user's assigned branch (if any). A session must never be scoped to an inactive branch.
    let assignedBranchActive: boolean | undefined;
    if (user?.branchId) {
      const b = await this.db
        .selectFrom('branches').select(['status'])
        .where('id', '=', user.branchId)
        .where('tenant_id', '=', tenant.id)
        .executeTakeFirst();
      assignedBranchActive = !!b && String((b as any).status || '').toLowerCase() === 'active';
    }

    return {
      tenantFound: true,
      tenantStatus: tenant.status as TenantStatus,
      suspensionReasonCode: tenant.suspension_reason_code ?? null,
      user,
      subscriptionStatus: (sub?.status as SubStatus) || 'active', // default active if no row (trial)
      branchCount: cnt,
      singleBranchId,
      assignedBranchActive,
    };
  }

  /**
   * Customer-app login lookup. The security property lives in the SQL, not in a caller's discipline:
   *
   *   `where role = 'CUSTOMER'`
   *
   * A manager, technician, owner or Super Admin is therefore INVISIBLE to this query. Even with a correct
   * password they cannot obtain a session through the customer app — there is nothing for the login to find.
   * No salon code is involved, because a customer does not have one; they are found by phone or email.
   */
  async findCustomersForLogin(id: NormalizedIdentifier): Promise<CustomerLoginCandidate[]> {
    if (id.kind === 'unknown') return [];

    let q = this.db
      .selectFrom('users as u')
      .innerJoin('tenants as t', 't.id', 'u.tenant_id')
      .select([
        'u.id as id', 'u.tenant_id as tenant_id', 'u.branch_id as branch_id', 'u.role as role',
        'u.status as status', 'u.password_hash as password_hash', 'u.mfa_enabled as mfa_enabled',
        'u.full_name as full_name', 'u.email as email', 'u.normalized_phone as normalized_phone',
        't.status as tenant_status', 't.display_name as salon_name', 'u.customer_default_at as customer_default_at',
      ] as any)
      .where('u.role', '=', 'CUSTOMER')          // ← staff can never be found here
      .limit(10);

    q = id.kind === 'email'
      ? q.where((eb: any) => eb(eb.fn('lower', ['u.email']), '=', id.value))
      : q.where('u.normalized_phone', '=', id.value);

    const rows: any[] = await q.execute();
    if (!rows.length) return [];

    const out: CustomerLoginCandidate[] = [];
    for (const r of rows) {
      const sub = await this.db
        .selectFrom('tenant_subscriptions').select(['status'])
        .where('tenant_id', '=', r.tenant_id)
        .orderBy('created_at', 'desc').limit(1).executeTakeFirst();
      const cand = toRecord(r as any);
      cand.totpSecret = await this.loadTotpSecret(cand.userId);   // TOTP lives in mfa_factors, not on users
      out.push({
        user: cand,
        tenantStatus: String(r.tenant_status) as TenantStatus,
        subscriptionStatus: sub ? (sub.status as SubStatus) : undefined,
        salonName: String(r.salon_name ?? 'Salon'),
        defaultAt: r.customer_default_at ? new Date(r.customer_default_at).toISOString() : null,
      });
    }
    return out;
  }

  /**
   * The customer's global identity, with every salon they belong to.
   *
   * Only CUSTOMER links are ever returned — staff have no identity row (the backfill excluded them and nothing
   * creates one), so this can never be a way for a manager to sign in through the customer app.
   */
  async findCustomerIdentity(id: NormalizedIdentifier): Promise<CustomerIdentity | null> {
    if (id.kind === 'unknown') return null;

    // Raw SQL: these tables are new and not yet in the generated Kysely types.
    const idQ = id.kind === 'phone'
      ? sql`select * from customer_identities where normalized_phone = ${id.value} limit 1`
      : sql`select * from customer_identities where lower(email) = ${id.value} limit 1`;
    const idRes: any = await idQ.execute(this.db);
    const idRow: any = idRes?.rows?.[0];
    if (!idRow) return null;

    // Only CUSTOMER links are ever returned — staff have no identity row, so this can never let a manager in.
    const linkRes: any = await sql`
      select l.tenant_id, l.user_id, t.display_name as salon_name, t.status as tenant_status, u.customer_default_at,
             (select s.status from tenant_subscriptions s
               where s.tenant_id = l.tenant_id order by s.created_at desc limit 1) as sub_status
      from customer_identity_links l
      join users u   on u.id = l.user_id
      join tenants t on t.id = l.tenant_id
      where l.identity_id = ${idRow.id}
        and u.role = 'CUSTOMER'
        and u.status = 'active'`.execute(this.db);

    const salons = (linkRes?.rows ?? []).map((r: any) => ({
      tenantId: String(r.tenant_id),
      userId: String(r.user_id),
      salonName: String(r.salon_name ?? 'Salon'),
      tenantStatus: String(r.tenant_status) as TenantStatus,
      subscriptionStatus: (r.sub_status as SubStatus) ?? undefined,
      defaultAt: r.customer_default_at ? new Date(r.customer_default_at).toISOString() : null,
    }));

    return {
      identityId: String(idRow.id),
      passwordHash: idRow.password_hash ?? null,
      status: String(idRow.status ?? 'active'),
      salons,
    };
  }

  /**
   * Owner-app login. No Store Code: an owner with several salons has none.
   *
   * The security property lives in the SQL, not in a caller's discipline:
   *
   *     where u.role = 'OWNER'
   *
   * A manager, technician or customer is INVISIBLE to this query. Even with correct credentials there is nothing
   * for the Owner App login to find.
   *
   * The salons come from `user_branch_access` — the same canonical grant the portfolio switcher reads — so what
   * she can sign into and what she can switch to are, by construction, the same list.
   */
  async findOwnerForLogin(id: NormalizedIdentifier): Promise<OwnerLoginRecord | null> {
    if (id.kind === 'unknown') return null;

    const uq = id.kind === 'email'
      ? sql`select * from users where role = 'OWNER' and lower(email) = ${id.value} limit 1`
      : sql`select * from users where role = 'OWNER' and normalized_phone = ${id.value} limit 1`;

    const ures: any = await uq.execute(this.db);
    const row: any = ures?.rows?.[0];
    if (!row) return null;

    const user = toRecord(row);
    user.totpSecret = await this.loadTotpSecret(user.userId);
    // Optional Owner Access Code factor. The query is `select *`, so the column is already on the row once
    // migration 382 adds it; null (unset) means "no code required for this owner" and the login branch skips it.
    (user as { accessCodeHash?: string | null }).accessCodeHash = row.owner_access_code_hash ?? null;

    // Her portfolio, straight from the canonical membership grants. Primary salon first, so the session opens
    // where she'd expect.
    const sres: any = await sql`
      select uba.tenant_id, uba.branch_id, uba.is_primary_owner,
             t.display_name as salon_name, t.status as tenant_status, t.suspension_reason_code,
             (select s.status from tenant_subscriptions s
               where s.tenant_id = uba.tenant_id order by s.created_at desc limit 1) as sub_status
      from user_branch_access uba
      join tenants t on t.id = uba.tenant_id
      where uba.user_id = ${user.userId} and uba.access_level = 'owner'
      order by uba.is_primary_owner desc, t.display_name asc`.execute(this.db);

    const seen = new Set<string>();
    const salons = [];
    for (const r of (sres?.rows ?? [])) {
      const tenantId = String(r.tenant_id);
      if (seen.has(tenantId)) continue;      // one entry per salon, not per branch
      seen.add(tenantId);
      salons.push({
        tenantId,
        branchId: r.branch_id ? String(r.branch_id) : null,
        salonName: String(r.salon_name ?? 'Salon'),
        tenantStatus: String(r.tenant_status) as TenantStatus,
        suspensionReasonCode: r.suspension_reason_code ?? null,   // Constitution 7 §19
        subscriptionStatus: (r.sub_status as SubStatus) ?? undefined,
        isPrimaryOwner: !!r.is_primary_owner,
      });
    }

    return { user, salons };
  }

  async findSuperAdminForLogin(id: NormalizedIdentifier): Promise<{ user?: LoginUserRecord }> {
    if (id.kind !== 'email' && id.kind !== 'phone') return {};
    let q = this.db
      .selectFrom('users').select([...USER_COLS, 'normalized_phone'] as unknown as string[] as any)
      .where('tenant_id', 'is', null)
      .where('role', '=', 'SUPER_ADMIN');
    q = id.kind === 'email'
      ? q.where((eb: any) => eb(eb.fn('lower', ['email']), '=', id.value))
      : q.where('normalized_phone', '=', id.value);
    const row = await q.executeTakeFirst();
    if (!row) return {};
    const user = toRecord(row as any); user.totpSecret = await this.loadTotpSecret(user.userId);
    // Phone for the mandatory SMS second factor (super-admin-login-otp). Not part of USER_COLS/toRecord, so attach it.
    (user as { phone?: string | null }).phone = (row as any).normalized_phone ?? null;
    return { user };
  }
  /**
   * This salon's permission overrides for one technician (migration 377).
   *
   * tenant_id-scoped, and `technicians.user_id` is the join — so a technician's overrides at Salon A can never be
   * read while minting their session at Salon B. Under the per-salon login model those are different `users`
   * rows anyway, but the tenant predicate is what makes that a guarantee rather than a coincidence.
   */
  async platformRoleOf(userId: string): Promise<string | null> {
    if (!this.db) return null;
    // throws on a database error — the caller fails SAFE to the read-only role, it must not see "no role" as a value
    const r: any = await sql`select platform_role from users where id = ${userId} and role = 'SUPER_ADMIN' limit 1`.execute(this.db);
    return r.rows[0]?.platform_role ?? null;
  }
  /** BUILD_PLAN Phase 9 */
  async authorizationVersions(userId: string, tenantId: string | null): Promise<{ av: number; tv: number | null } | null> {
    return this.db ? currentAuthorizationVersions(this.db, userId, tenantId) : null;
  }
  /** BUILD_PLAN Phase 9 */
  async enterableBranchesFor(tenantId: string, userId: string, role: string): Promise<string[] | null> {
    return this.db ? enterableBranchesForUser(this.db, tenantId, userId, role) : null;
  }
  async userStateForRefresh(userId: string): Promise<{ role: string; tenantId: string | null; status: string } | null> {
    if (!this.db) return null;
    const r: any = await sql`select role, tenant_id, coalesce(status, 'active') as status from users where id = ${userId} limit 1`.execute(this.db);
    const u = r.rows[0];
    return u ? { role: String(u.role), tenantId: u.tenant_id ? String(u.tenant_id) : null, status: String(u.status) } : null;
  }
  /** Functional Decision 12 — resolved through the one fail-safe resolver (null = base-role defaults). */
  async staffTemplatePermissions(tenantId: string, userId: string, baseRole: string): Promise<string[] | null> {
    return new StaffRolesService(new KyselyStaffRolesStore(this.db as any)).resolvePermissions(tenantId, userId, baseRole);
  }
  async techPermissionOverrides(tenantId: string, userId: string): Promise<{ permission: string; allowed: boolean }[]> {
    if (!this.db) return [];
    const r: any = await sql`
      select p.permission_key, p.allowed
        from technician_permissions p
        join technicians t on t.id = p.technician_id and t.tenant_id = p.tenant_id
       where p.tenant_id = ${tenantId} and t.user_id = ${userId}`.execute(this.db).catch(() => null);
    return (r?.rows ?? []).map((x: any) => ({ permission: String(x.permission_key), allowed: !!x.allowed }));
  }

  async technicianGlobalStatus(userId: string, tenantId: string | null): Promise<string | null> {
    if (!this.db || !tenantId) return null;
    // Scoped through THIS salon's login + roster row (tenant_id on both), then up to the global profile. A blocked
    // status sorts first so one blocked profile among several wins.
    const r: any = await sql`
      select p.status
        from global_tech_profiles p
       where p.id in (select u.global_tech_profile_id from users u where u.id = ${userId} and u.tenant_id = ${tenantId} and u.global_tech_profile_id is not null
                      union
                      select t.global_tech_profile_id from technicians t where t.user_id = ${userId} and t.tenant_id = ${tenantId} and t.global_tech_profile_id is not null)
       order by (p.status <> 'active') desc
       limit 1`.execute(this.db);
    const row = r?.rows?.[0];
    return row ? String(row.status) : null;
  }

  async activateUser(userId: string): Promise<void> {
    if (!this.db) return;
    await this.db
      .updateTable('users')
      .set({ status: 'active', updated_at: new Date() } as any)
      .where('id', '=', userId)
      .where('status', '=', 'invited')
      .where(canMoveToSql(USER_ACCOUNT, 'active') as any)
      .execute()
      .catch(() => undefined);
  }
}

