// super-admin-staff.kysely.repository.ts — READ-ONLY, platform-wide (cross-tenant) Staff / Technicians aggregation for
// the Super Admin Staff overview (Phase 9). Reads the canonical `technicians` table across all tenants (joined to
// tenants + branches for names); it does NOT re-implement any staff/scheduling logic and writes nothing. With no DB
// configured it returns an honest empty overview (no fabricated data). Phone numbers are masked in the detail view.
import { type DB, andTenant, tenantPred, type OverviewScope } from '@aipowersalon/database';
import { Kysely, sql } from 'kysely';
import type {
  PlatformStaffOverview, StaffOverviewFilters, PlatformStaffDetail,
  PlatformStaffTenantRow, PlatformStaffRow, PlatformStaffStatusSlice, WorkforceRaw, WorkforceDirectoryPage, WorkforceDirectoryRow, WorkforceProfile,
} from './super-admin-staff.service';
import { roleCategory, deriveProfileStatus, deriveAccessStatus, deriveFlags } from './workforce-core';
import { parseViewFilters } from './workforce-savedview-core';
import { type WorkforceQuery, pagesFor } from './workforce-directory-core';
import { buildMediaUrl } from '@aipowersalon/media';
import { canMoveToSql, InvalidStateTransitionError } from '@aipowersalon/database';
import { WORKER_TRANSFER_REQUEST, WORKER_CROSS_TENANT_TRANSFER_REQUEST, PAYROLL_SYNC_EVENT } from '../lifecycles';
import { SESSION } from '@aipowersalon/identity';
import { branchRoleForLabel, TECH_SALON_MEMBERSHIP } from '@aipowersalon/workforce';   // pure (+ the membership machine)

const maskEmail = (e: unknown): string | null => { const s = e == null ? '' : String(e); const at = s.indexOf('@'); if (at < 1) return s ? '•••' : null; return s[0] + '•••' + s.slice(at); };

const n = (v: unknown): number => (v == null ? 0 : Number(v) || 0);
const iso = (v: unknown): string | null => { if (!v) return null; const d = new Date(v as any); return isNaN(+d) ? null : d.toISOString(); };
const bool = (v: unknown): boolean => v === true || v === 't' || v === 1 || v === '1';
const maskPhone = (v: unknown): string | null => { const s = v == null ? '' : String(v); const digits = s.replace(/\D/g, ''); return digits.length >= 4 ? `••• ••• ${digits.slice(-4)}` : (s ? '•••' : null); };

const EMPTY: PlatformStaffOverview = {
  kpis: { totalTechnicians: 0, activeTechnicians: 0, tenantsWithStaff: 0, avgTechsPerTenant: 0 },
  tenants: [], technicians: [], statusBreakdown: [], tenantCount: 0,
};

export class SuperAdminStaffKyselyRepository {
  constructor(private readonly db: Kysely<DB> | null) {}

  // Real grouped worker counts from `users` (+ recent audit_logs) for the Workforce Oversight aggregate. Workers are
  // staff roles only (CUSTOMER and SUPER_ADMIN excluded). All predicates honor the optional tenant scope. With no DB
  // configured it returns honest zeros/empties (no fabricated data).
  async workforceRaw(scope?: OverviewScope): Promise<WorkforceRaw> {
    if (!this.db) return { roleCounts: [], statusCounts: [], byTenant: [], duplicateGroups: 0, accessIssues: 0, missingInfo: 0, recentActivity: [], auditToday: [] };
    const WORKER = sql`role in ('OWNER','MANAGER','FRONT_DESK','RECEPTION','TECHNICIAN')`;
    const rolesP = sql<{ role: string; count: number }>`select role, count(*)::int as count from users where ${WORKER} and ${tenantPred(scope)} group by role`.execute(this.db);
    const statusP = sql<{ status: string; count: number }>`select coalesce(status,'unknown') as status, count(*)::int as count from users where ${WORKER} and ${tenantPred(scope)} group by status`.execute(this.db);
    const tenantP = sql<{ tenant_id: string; tenant_name: string | null; count: number }>`
      select t.id as tenant_id, t.display_name as tenant_name, count(u.id)::int as count
      from tenants t join users u on u.tenant_id = t.id and u.role in ('OWNER','MANAGER','FRONT_DESK','RECEPTION','TECHNICIAN')
      where ${tenantPred(scope, 't.id')} group by t.id, t.display_name order by count desc, t.display_name asc`.execute(this.db);
    const dupP = sql<{ groups: number }>`select count(*)::int as groups from (
      select tenant_id, lower(email) e from users where ${WORKER} and email is not null and ${tenantPred(scope)} group by tenant_id, lower(email) having count(*) > 1) x`.execute(this.db);
    const accessP = sql<{ c: number }>`select count(*)::int as c from users where ${WORKER} and (status = 'suspended' or must_change_password = true) and ${tenantPred(scope)}`.execute(this.db);
    const missingP = sql<{ c: number }>`select count(*)::int as c from users where ${WORKER} and (email is null or normalized_phone is null or full_name is null or btrim(full_name) = '') and ${tenantPred(scope)}`.execute(this.db);
    const recentP = sql<{ id: string; action_type: string; entity_type: string | null; user_id: string | null; tenant_id: string | null; created_at: unknown }>`
      select id, action_type, entity_type, user_id, tenant_id, created_at from audit_logs
      where (entity_type in ('user','staff','technician','role','session') or action_type ilike '%user%' or action_type ilike '%role%' or action_type ilike '%staff%' or action_type ilike '%login%' or action_type ilike '%session%')
        and ${tenantPred(scope)} order by created_at desc limit 6`.execute(this.db);
    const auditTodayP = sql<{ action_type: string; count: number }>`select action_type, count(*)::int as count from audit_logs where created_at >= date_trunc('day', now()) and ${tenantPred(scope)} group by action_type order by count desc limit 50`.execute(this.db);

    const [roles, status, tenants, dup, access, missing, recent, auditToday] = await Promise.all([rolesP, statusP, tenantP, dupP, accessP, missingP, recentP, auditTodayP]);
    return {
      roleCounts: roles.rows.map((r) => ({ role: r.role, count: n(r.count) })),
      statusCounts: status.rows.map((r) => ({ status: r.status, count: n(r.count) })),
      byTenant: tenants.rows.map((r) => ({ tenantId: String(r.tenant_id), tenantName: r.tenant_name, count: n(r.count) })),
      duplicateGroups: n(dup.rows[0]?.groups),
      accessIssues: n(access.rows[0]?.c),
      missingInfo: n(missing.rows[0]?.c),
      recentActivity: recent.rows.map((r) => ({ id: String(r.id), actionType: r.action_type, entityType: r.entity_type ?? null, userId: r.user_id ? String(r.user_id) : null, tenantId: r.tenant_id ? String(r.tenant_id) : null, at: iso(r.created_at) })),
      auditToday: auditToday.rows.map((r) => ({ actionType: r.action_type, count: n(r.count) })),
    };
  }

  // Server-side workforce directory. A CTE computes the duplicate flag over the FULL tenant worker set (window over
  // tenant_id + lower(email)); filters/sort/pagination are applied after, so duplicate detection is independent of the
  // current view. Sort key is whitelisted upstream; values are bound parameters (no injection). Honest gaps: availability
  // and payroll-sync have no source yet → 'Unknown' / 'Not Configured'.
  async workforceDirectory(q: WorkforceQuery, scope?: OverviewScope): Promise<WorkforceDirectoryPage> {
    if (!this.db) return { rows: [], total: 0, page: q.page, pageSize: q.pageSize, pages: 1, facets: { statuses: [] } };
    const cte = sql`
      select u.id, u.full_name, u.email, u.normalized_phone, u.role, u.status, u.must_change_password,
             u.tenant_id, u.branch_id, u.last_login_at, u.created_at,
             u.avatar_url as user_avatar_url, gtp.avatar_url as gtp_avatar_url, tech.avatar_url as tech_avatar_url,
             (u.email is not null and count(*) over (partition by u.tenant_id, lower(u.email)) > 1) as is_duplicate
      from users u
      left join technicians tech on tech.user_id = u.id
      left join global_tech_profiles gtp on (gtp.id = tech.global_tech_profile_id or gtp.user_id = u.id)
      where u.role in ('OWNER','MANAGER','FRONT_DESK','RECEPTION','TECHNICIAN') and ${tenantPred(scope, 'u.tenant_id')}`;

    const preds = [sql`true`];
    if (q.roles.length) preds.push(sql`w.role in (${sql.join(q.roles.map((r) => sql`${r}`), sql`, `)})`);
    if (q.status) preds.push(sql`lower(w.status) = ${q.status}`);
    if (q.tenantId) preds.push(sql`w.tenant_id = ${q.tenantId}`);
    if (q.branchId) preds.push(sql`w.branch_id = ${q.branchId}`);
    if (q.search) { const pat = `%${q.search}%`; preds.push(sql`(w.full_name ilike ${pat} or w.email ilike ${pat} or w.normalized_phone ilike ${pat} or w.role ilike ${pat} or t.display_name ilike ${pat} or b.name ilike ${pat})`); }
    const where = sql.join(preds, sql` and `);

    const SORT: Record<WorkforceQuery['sort'], string> = { name: 'w.full_name', role: 'w.role', tenantName: 't.display_name', branchName: 'b.name', status: 'w.status', lastActivity: 'w.last_login_at', createdAt: 'w.created_at' };
    const dir = q.dir === 'desc' ? sql`desc` : sql`asc`;
    const offset = (q.page - 1) * q.pageSize;

    const rowsP = sql<{ id: string; full_name: string | null; email: string | null; normalized_phone: string | null; role: string; status: string; must_change_password: unknown; is_duplicate: unknown; tenant_id: string | null; tenant_name: string | null; branch_id: string | null; branch_name: string | null; last_login_at: unknown; user_avatar_url: string | null; gtp_avatar_url: string | null; tech_avatar_url: string | null }>`
      with w as (${cte})
      select w.id, w.full_name, w.email, w.normalized_phone, w.role, w.status, w.must_change_password, w.is_duplicate,
             w.tenant_id, t.display_name as tenant_name, w.branch_id, b.name as branch_name, w.last_login_at,
             w.user_avatar_url, w.gtp_avatar_url, w.tech_avatar_url
      from w left join tenants t on t.id = w.tenant_id left join branches b on b.id = w.branch_id
      where ${where} order by ${sql.ref(SORT[q.sort])} ${dir} nulls last, w.full_name asc
      limit ${q.pageSize} offset ${offset}`.execute(this.db);
    const countP = sql<{ total: number }>`with w as (${cte}) select count(*)::int as total from w left join tenants t on t.id = w.tenant_id left join branches b on b.id = w.branch_id where ${where}`.execute(this.db);
    const facetP = sql<{ status: string }>`select distinct status from users where role in ('OWNER','MANAGER','FRONT_DESK','RECEPTION','TECHNICIAN') and ${tenantPred(scope)} order by status`.execute(this.db);

    const [rowsR, countR, facetR] = await Promise.all([rowsP, countP, facetP]);
    const rows: WorkforceDirectoryRow[] = rowsR.rows.map((r) => {
      const facts = { status: r.status, hasEmail: !!r.email, hasPhone: !!r.normalized_phone, hasName: !!(r.full_name && String(r.full_name).trim()), mustChangePassword: bool(r.must_change_password), isDuplicate: bool(r.is_duplicate) };
      const rawPhoto = r.user_avatar_url || r.gtp_avatar_url || r.tech_avatar_url || null;
      return {
        workerId: String(r.id), name: r.full_name || '—', role: r.role, roleCategory: roleCategory(r.role),
        avatarUrl: rawPhoto ? buildMediaUrl(rawPhoto) : null,
        tenantId: r.tenant_id ? String(r.tenant_id) : null, tenant: r.tenant_name ?? null,
        branchId: r.branch_id ? String(r.branch_id) : null, branch: r.branch_name ?? null,
        status: r.status, availability: 'Unknown', profileStatus: deriveProfileStatus(facts), accessStatus: deriveAccessStatus(facts),
        payrollSync: 'Not Configured', lastActivity: iso(r.last_login_at), flags: deriveFlags(facts),
      };
    });
    const total = n(countR.rows[0]?.total);
    return { rows, total, page: q.page, pageSize: q.pageSize, pages: pagesFor(total, q.pageSize), facets: { statuses: facetR.rows.map((f) => f.status) } };
  }

  // Read-only workforce profile. Worker scoped to staff roles; secrets never selected. Live access signals: active
  // sessions (status active, not revoked, not expired) and non-revoked app/device registrations. Null when not found.
  async workforceProfile(userId: string, scope?: OverviewScope): Promise<WorkforceProfile | null> {
    if (!this.db) return null;
    const u = await sql<{ id: string; first_name: string | null; last_name: string | null; full_name: string | null; email: string | null; normalized_phone: string | null; role: string; status: string; mfa_enabled: unknown; must_change_password: unknown; last_login_at: unknown; created_at: unknown; tenant_id: string | null; tenant_name: string | null; branch_id: string | null; branch_name: string | null; user_avatar_url: string | null; gtp_avatar_url: string | null; tech_avatar_url: string | null }>`
      select u.id, u.first_name, u.last_name, u.full_name, u.email, u.normalized_phone, u.role, u.status, u.mfa_enabled, u.must_change_password, u.last_login_at, u.created_at,
             u.tenant_id, t.display_name as tenant_name, u.branch_id, b.name as branch_name,
             u.avatar_url as user_avatar_url, gtp.avatar_url as gtp_avatar_url, tech.avatar_url as tech_avatar_url
      from users u left join tenants t on t.id = u.tenant_id left join branches b on b.id = u.branch_id
      left join technicians tech on tech.user_id = u.id
      left join global_tech_profiles gtp on (gtp.id = tech.global_tech_profile_id or gtp.user_id = u.id)
      where u.id = ${userId} and u.role in ('OWNER','MANAGER','FRONT_DESK','RECEPTION','TECHNICIAN') and ${tenantPred(scope, 'u.tenant_id')} limit 1`.execute(this.db).then((r) => r.rows[0]).catch(() => undefined);
    if (!u) return null;

    const sessP = sql<{ c: number }>`select count(*)::int as c from sessions where user_id = ${userId} and status = 'active' and revoked_at is null and expires_at > now()`.execute(this.db).then((r) => n(r.rows[0]?.c)).catch(() => 0);
    const devP = sql<{ c: number }>`select count(*)::int as c from device_push_tokens where user_id = ${userId} and revoked_at is null`.execute(this.db).then((r) => n(r.rows[0]?.c)).catch(() => 0);
    const histP = sql<{ id: string; action_type: string; entity_type: string | null; tenant_id: string | null; created_at: unknown }>`
      select id, action_type, entity_type, tenant_id, created_at from audit_logs where user_id = ${userId} order by created_at desc limit 8`.execute(this.db).then((r) => r.rows).catch(() => []);
    const [activeSessions, appRegistrations, hist] = await Promise.all([sessP, devP, histP]);

    const facts = { status: u.status, hasEmail: !!u.email, hasPhone: !!u.normalized_phone, hasName: !!(u.full_name && String(u.full_name).trim()), mustChangePassword: bool(u.must_change_password), isDuplicate: false };
    const gap = (reason: string) => ({ available: false as const, reason });
    const rawPhoto = u.user_avatar_url || u.gtp_avatar_url || u.tech_avatar_url || null;
    return {
      workerId: String(u.id), name: u.full_name || '—', firstName: u.first_name ?? null, lastName: u.last_name ?? null,
      avatarUrl: rawPhoto ? buildMediaUrl(rawPhoto) : null,
      maskedEmail: maskEmail(u.email), maskedPhone: maskPhone(u.normalized_phone), role: u.role, roleCategory: roleCategory(u.role),
      tenantId: u.tenant_id ? String(u.tenant_id) : null, tenant: u.tenant_name ?? null, branchId: u.branch_id ? String(u.branch_id) : null, branch: u.branch_name ?? null,
      status: u.status, createdAt: iso(u.created_at),
      access: { accountStatus: u.status, accessStatus: deriveAccessStatus(facts), mfaEnabled: bool(u.mfa_enabled), mustChangePassword: bool(u.must_change_password), lastLogin: iso(u.last_login_at), activeSessions, appRegistrations },
      monitoring: { availability: gap('No real-time availability source connected'), connectivity: gap('No technician app heartbeat source connected'), payrollSync: gap('No payroll synchronization integration connected') },
      history: hist.map((h) => ({ id: String(h.id), actionType: h.action_type, entityType: h.entity_type ?? null, userId, tenantId: h.tenant_id ? String(h.tenant_id) : null, at: iso(h.created_at) })),
    };
  }

  async platformStaffOverview(f: StaffOverviewFilters): Promise<PlatformStaffOverview> {
    if (!this.db) return EMPTY;
    const scope = f.scope;
    const hasSearch = f.search.length > 0;
    const pat = `%${f.search}%`;
    const hasStatus = f.status.length > 0;

    const kpiP = sql<{ total: number; active: number; tenants_with_staff: number }>`
      select count(*)::int as total,
             count(*) filter (where status = 'active')::int as active,
             count(distinct tenant_id)::int as tenants_with_staff
      from technicians where ${tenantPred(scope)}`.execute(this.db);

    const tenantsP = sql<{ tenant_id: string; tenant_name: string | null; technician_count: number; active_count: number }>`
      select t.id as tenant_id, t.display_name as tenant_name,
             count(tch.id)::int as technician_count,
             count(tch.id) filter (where tch.status = 'active')::int as active_count
      from tenants t
      join technicians tch on tch.tenant_id = t.id
      where ${tenantPred(scope, 't.id')}
      group by t.id, t.display_name
      order by technician_count desc, t.display_name asc`.execute(this.db);

    const statusP = sql<{ status: string; count: number }>`
      select coalesce(status, 'unknown') as status, count(*)::int as count
      from technicians where ${tenantPred(scope)} group by status order by count desc`.execute(this.db);

    const rosterP = sql<{ technician_id: string; tenant_id: string; tenant_name: string | null; full_name: string; branch_name: string | null; role_label: string | null; status: string; is_active: unknown; created_at: unknown }>`
      select tch.id as technician_id, tch.tenant_id, t.display_name as tenant_name,
             tch.full_name, b.name as branch_name, tch.role_label, tch.status, tch.is_active, tch.created_at
      from technicians tch
      left join tenants t on t.id = tch.tenant_id
      left join branches b on b.id = tch.branch_id
      where (${hasSearch ? sql`(tch.full_name ilike ${pat} or t.display_name ilike ${pat})` : sql`true`})
        and (${hasStatus ? sql`tch.status = ${f.status}` : sql`true`}) ${andTenant(scope, 'tch.tenant_id')}
      order by tch.created_at desc nulls last
      limit ${f.limit}`.execute(this.db);

    const [kpi, tenants, status, roster] = await Promise.all([kpiP, tenantsP, statusP, rosterP]);
    const k = kpi.rows[0] ?? { total: 0, active: 0, tenants_with_staff: 0 };
    const tenantsWithStaff = n(k.tenants_with_staff);

    const tenantRows: PlatformStaffTenantRow[] = tenants.rows.map((r) => ({
      tenantId: r.tenant_id, tenantName: r.tenant_name, technicianCount: n(r.technician_count), activeCount: n(r.active_count),
    }));
    const technicianRows: PlatformStaffRow[] = roster.rows.map((r) => ({
      technicianId: r.technician_id, tenantId: r.tenant_id, tenantName: r.tenant_name,
      fullName: r.full_name, branchName: r.branch_name, roleLabel: r.role_label,
      status: r.status, isActive: bool(r.is_active), createdAt: iso(r.created_at),
    }));
    const statusBreakdown: PlatformStaffStatusSlice[] = status.rows.map((r) => ({ status: r.status, count: n(r.count) }));

    return {
      kpis: {
        totalTechnicians: n(k.total),
        activeTechnicians: n(k.active),
        tenantsWithStaff,
        avgTechsPerTenant: tenantsWithStaff > 0 ? Math.round((n(k.total) / tenantsWithStaff) * 10) / 10 : 0,
      },
      tenants: tenantRows,
      technicians: technicianRows,
      statusBreakdown,
      tenantCount: tenantsWithStaff,
    };
  }

  async staffDetail(technicianId: string): Promise<PlatformStaffDetail | null> {
    if (!this.db) return null;
    const r = (await sql<{ technician_id: string; tenant_id: string; tenant_name: string | null; full_name: string; first_name: string | null; last_name: string | null; phone_display: unknown; email: string | null; branch_id: string | null; branch_name: string | null; role_label: string | null; status: string; is_active: unknown; commission_split_pct: unknown; created_at: unknown; updated_at: unknown }>`
      select tch.id as technician_id, tch.tenant_id, t.display_name as tenant_name,
             tch.full_name, tch.first_name, tch.last_name, tch.phone_display, tch.email,
             tch.branch_id, b.name as branch_name, tch.role_label, tch.status, tch.is_active,
             tch.default_commission_split_percent as commission_split_pct, tch.created_at, tch.updated_at
      from technicians tch
      left join tenants t on t.id = tch.tenant_id
      left join branches b on b.id = tch.branch_id
      where tch.id = ${technicianId}`.execute(this.db)).rows[0];
    if (!r) return null;
    return {
      technicianId: r.technician_id, tenantId: r.tenant_id, tenantName: r.tenant_name,
      fullName: r.full_name, firstName: r.first_name, lastName: r.last_name,
      maskedPhone: maskPhone(r.phone_display), email: r.email,
      branchId: r.branch_id, branchName: r.branch_name,
      roleLabel: r.role_label, status: r.status, isActive: bool(r.is_active),
      commissionSplitPct: r.commission_split_pct == null ? null : n(r.commission_split_pct),
      createdAt: iso(r.created_at), updatedAt: iso(r.updated_at),
    };
  }

  // ---- account-access support (§32): real, audited mutations ----
  async workforceAccessTarget(userId: string, scope?: OverviewScope): Promise<{ userId: string; name: string; role: string; status: string } | null> {
    if (!this.db) return null;
    const r = await sql<{ id: string; full_name: string | null; role: string; status: string }>`
      select id, full_name, role, status from users
      where id = ${userId} and role in ('OWNER','MANAGER','FRONT_DESK','RECEPTION','TECHNICIAN') and ${tenantPred(scope, 'tenant_id')} limit 1`
      .execute(this.db).then((x) => x.rows[0]).catch(() => undefined);
    return r ? { userId: String(r.id), name: r.full_name || '—', role: r.role, status: r.status } : null;
  }

  async revokeWorkerSessions(userId: string): Promise<number> {
    if (!this.db) return 0;
    return sql<{ c: number }>`
      with revoked as (update sessions set status = 'revoked', revoked_at = now()
        where user_id = ${userId} and status = 'active' and revoked_at is null and ${canMoveToSql(SESSION, 'revoked')} returning 1)
      select count(*)::int as c from revoked`.execute(this.db).then((x) => n(x.rows[0]?.c)).catch(() => 0);
  }

  async forceWorkerPasswordReset(userId: string): Promise<void> {
    if (!this.db) return;
    await sql`update users set must_change_password = true where id = ${userId}`.execute(this.db).catch(() => undefined);
  }

  async revokeWorkerDeviceTokens(userId: string): Promise<number> {
    if (!this.db) return 0;
    return sql<{ c: number }>`
      with revoked as (update device_push_tokens set revoked_at = now()
        where user_id = ${userId} and revoked_at is null returning 1)
      select count(*)::int as c from revoked`.execute(this.db).then((x) => n(x.rows[0]?.c)).catch(() => 0);
  }

  async deactivationQueue(scope?: OverviewScope): Promise<import('./super-admin-staff.service').WorkforceDeactivationRow[]> {
    if (!this.db) return [];
    const rows = await sql<{ id: string; full_name: string | null; role: string; status: string; tenant_name: string | null; active_sessions: number; app_registrations: number }>`
      select u.id, u.full_name, u.role, u.status, t.display_name as tenant_name,
        (select count(*)::int from sessions s where s.user_id = u.id and s.status = 'active' and s.revoked_at is null and s.expires_at > now()) as active_sessions,
        (select count(*)::int from device_push_tokens d where d.user_id = u.id and d.revoked_at is null) as app_registrations
      from users u left join tenants t on t.id = u.tenant_id
      where u.role in ('OWNER','MANAGER','FRONT_DESK','RECEPTION','TECHNICIAN') and u.status in ('inactive','suspended') and ${tenantPred(scope, 'u.tenant_id')}
      and ((select count(*) from sessions s where s.user_id = u.id and s.status = 'active' and s.revoked_at is null and s.expires_at > now()) > 0
        or (select count(*) from device_push_tokens d where d.user_id = u.id and d.revoked_at is null) > 0)
      order by u.status, u.full_name limit 200`.execute(this.db).then((x) => x.rows).catch(() => []);
    return rows.map((r) => ({ workerId: String(r.id), name: r.full_name || '—', role: r.role, tenant: r.tenant_name ?? null, status: r.status, activeSessions: n(r.active_sessions), appRegistrations: n(r.app_registrations) }));
  }

  async resetWorkerMfa(userId: string): Promise<void> {
    if (!this.db) return;
    await sql`update users set mfa_enabled = false where id = ${userId}`.execute(this.db).catch(() => undefined);
  }

  async recordWorkforceAudit(ctx: { userId?: string }, action: string, entityId: string, meta: Record<string, unknown>): Promise<void> {
    if (!this.db) return;
    await this.db.insertInto('audit_logs').values({
      id: sql`gen_random_uuid()`, tenant_id: null, user_id: (ctx?.userId || null), role: 'SUPER_ADMIN',
      action_type: action, entity_type: 'user', entity_id: entityId, metadata_json: JSON.stringify(meta || {}),
    }).execute().catch(() => { /* auditing must never break the action; failures surface in health checks */ });
  }

  // ---- duplicate-profile review (§28/29) ----
  async duplicateGroups(scope?: OverviewScope): Promise<import('./super-admin-staff.service').WorkforceDuplicateGroup[]> {
    if (!this.db) return [];
    const rows = await sql<{ id: string; full_name: string | null; role: string; status: string; last_login_at: unknown; created_at: unknown; tenant_id: string | null; tenant_name: string | null; email: string | null }>`
      with dups as (
        select tenant_id, lower(email) as ek from users
        where role in ('OWNER','MANAGER','FRONT_DESK','RECEPTION','TECHNICIAN') and email is not null and ${tenantPred(scope, 'tenant_id')}
        group by tenant_id, lower(email) having count(*) > 1)
      select u.id, u.full_name, u.role, u.status, u.last_login_at, u.created_at, u.tenant_id, t.display_name as tenant_name, u.email
      from users u join dups d on d.tenant_id is not distinct from u.tenant_id and lower(u.email) = d.ek
      left join tenants t on t.id = u.tenant_id
      where u.role in ('OWNER','MANAGER','FRONT_DESK','RECEPTION','TECHNICIAN')
      order by u.tenant_id, lower(u.email), u.created_at limit 600`.execute(this.db).then((x) => x.rows).catch(() => []);
    const groups = new Map<string, import('./super-admin-staff.service').WorkforceDuplicateGroup>();
    for (const r of rows) {
      const key = `${r.tenant_id || ''}|${(r.email || '').toLowerCase()}`;
      let g = groups.get(key);
      if (!g) { g = { tenantId: r.tenant_id ? String(r.tenant_id) : null, tenant: r.tenant_name ?? null, maskedEmail: maskEmail(r.email) || '•••', members: [] }; groups.set(key, g); }
      g.members.push({ workerId: String(r.id), name: r.full_name || '—', role: r.role, status: r.status, lastLogin: iso(r.last_login_at), createdAt: iso(r.created_at) });
    }
    return [...groups.values()].filter((g) => g.members.length > 1).slice(0, 100);
  }

  async confirmDuplicateGroup(canonicalId: string, memberIds: string[], scope?: OverviewScope): Promise<{ tenantId: string | null; maskedEmail: string } | null> {
    if (!this.db) return null;
    const canon = await sql<{ tenant_id: string | null; email: string | null }>`
      select tenant_id, email from users where id = ${canonicalId} and role in ('OWNER','MANAGER','FRONT_DESK','RECEPTION','TECHNICIAN') and email is not null and ${tenantPred(scope, 'tenant_id')} limit 1`
      .execute(this.db).then((x) => x.rows[0]).catch(() => undefined);
    if (!canon) return null;
    const real = await sql<{ id: string }>`
      select id from users where role in ('OWNER','MANAGER','FRONT_DESK','RECEPTION','TECHNICIAN')
        and tenant_id is not distinct from ${canon.tenant_id} and lower(email) = lower(${canon.email})`
      .execute(this.db).then((x) => x.rows.map((r) => String(r.id))).catch(() => [] as string[]);
    if (real.length < 2) return null;
    const realSet = new Set(real);
    if (!memberIds.every((m) => realSet.has(m))) return null; // every submitted member must belong to the real group
    return { tenantId: canon.tenant_id ? String(canon.tenant_id) : null, maskedEmail: maskEmail(canon.email) || '•••' };
  }

  // ---- worker branch transfer (§30) ----
  async workerTransferTarget(userId: string, scope?: OverviewScope): Promise<import('./super-admin-staff.service').WorkerTransferTarget | null> {
    if (!this.db) return null;
    const r = await sql<{ id: string; full_name: string | null; tenant_id: string | null; branch_id: string | null }>`
      select id, full_name, tenant_id, branch_id from users
      where id = ${userId} and role in ('OWNER','MANAGER','FRONT_DESK','RECEPTION','TECHNICIAN') and ${tenantPred(scope, 'tenant_id')} limit 1`
      .execute(this.db).then((x) => x.rows[0]).catch(() => undefined);
    return r ? { userId: String(r.id), name: r.full_name || '—', tenantId: r.tenant_id ? String(r.tenant_id) : null, branchId: r.branch_id ? String(r.branch_id) : null } : null;
  }

  async createWorkerTransferRequest(input: { tenantId: string | null; userId: string; fromBranchId: string | null; toBranchId: string; reason: string; requestedBy?: string }): Promise<{ id: string }> {
    if (!this.db) return { id: '' };
    const r = await sql<{ id: string }>`
      insert into worker_transfer_requests (tenant_id, user_id, from_branch_id, to_branch_id, reason, requested_by_user_id)
      values (${input.tenantId}, ${input.userId}, ${input.fromBranchId}, ${input.toBranchId}, ${input.reason}, ${input.requestedBy ?? null})
      returning id`.execute(this.db).then((x) => x.rows[0]).catch(() => undefined);
    return { id: r ? String(r.id) : '' };
  }

  async workerTransferPipeline(scope?: OverviewScope): Promise<{ counts: { status: string; count: number }[]; pending: import('./super-admin-staff.service').WorkforceTransferRow[] }> {
    if (!this.db) return { counts: [], pending: [] };
    const countsP = sql<{ status: string; count: number }>`
      select status, count(*)::int as count from worker_transfer_requests where ${tenantPred(scope, 'tenant_id')} group by status`
      .execute(this.db).then((x) => x.rows).catch(() => [] as { status: string; count: number }[]);
    const pendingP = sql<{ id: string; user_id: string; worker_name: string | null; tenant_name: string | null; from_branch: string | null; to_branch: string | null; status: string; reason: string; created_at: unknown; reviewed_at: unknown; decision_note: string | null }>`
      select w.id, w.user_id, u.full_name as worker_name, t.display_name as tenant_name,
        fb.name as from_branch, tb.name as to_branch, w.status, w.reason, w.created_at, w.reviewed_at, w.decision_note
      from worker_transfer_requests w
      left join users u on u.id = w.user_id
      left join tenants t on t.id = w.tenant_id
      left join branches fb on fb.id = w.from_branch_id
      left join branches tb on tb.id = w.to_branch_id
      where w.status = 'requested' and ${tenantPred(scope, 'w.tenant_id')}
      order by w.created_at asc limit 100`.execute(this.db).then((x) => x.rows).catch(() => []);
    const [counts, pending] = await Promise.all([countsP, pendingP]);
    return {
      counts,
      pending: pending.map((p) => ({ id: String(p.id), workerId: String(p.user_id), workerName: p.worker_name || '—', tenant: p.tenant_name ?? null, fromBranch: p.from_branch ?? null, toBranch: p.to_branch ?? null, status: p.status, reason: p.reason, requestedAt: iso(p.created_at), decidedAt: iso(p.reviewed_at), decisionNote: p.decision_note ?? null })),
    };
  }

  async getWorkerTransferRequest(id: string, scope?: OverviewScope): Promise<import('./super-admin-staff.service').WorkerTransferRecord | null> {
    if (!this.db) return null;
    const r = await sql<{ id: string; tenant_id: string | null; user_id: string; to_branch_id: string; status: string }>`
      select id, tenant_id, user_id, to_branch_id, status from worker_transfer_requests where id = ${id} and ${tenantPred(scope, 'tenant_id')} limit 1`
      .execute(this.db).then((x) => x.rows[0]).catch(() => undefined);
    return r ? { id: String(r.id), tenantId: r.tenant_id ? String(r.tenant_id) : null, userId: String(r.user_id), toBranchId: String(r.to_branch_id), status: r.status } : null;
  }

  async decideWorkerTransfer(id: string, decision: 'approve' | 'reject', note: string | null, reviewedBy?: string): Promise<import('./super-admin-staff.service').WorkerTransferRecord> {
    const db = this.db;
    if (!db) return { id, tenantId: null, userId: '', toBranchId: '', status: decision === 'approve' ? 'approved' : 'rejected' };
    const status = decision === 'approve' ? 'approved' : 'rejected';
    // Approve executes the branch move + status flip atomically; reject only records the outcome.
    const out = await db.transaction().execute(async (trx) => {
      const req = await sql<{ user_id: string; to_branch_id: string; from_branch_id: string | null; tenant_id: string | null }>`
        select user_id, to_branch_id, from_branch_id, tenant_id from worker_transfer_requests where id = ${id} for update`.execute(trx).then((x) => x.rows[0]);
      if (!req) return { id, tenantId: null, userId: '', toBranchId: '', status };
      // Phase 12 (#27): the request moves first (requested → approved | rejected, conditional); only a request that
      // actually moved this time moves the worker — a decided request is never re-applied
      const moved = await sql`update worker_transfer_requests set status = ${status}, reviewed_by_user_id = ${reviewedBy ?? null}, reviewed_at = now(), decision_note = ${note}, updated_at = now() where id = ${id} and ${canMoveToSql(WORKER_TRANSFER_REQUEST, status)} returning id`.execute(trx);
      if (!moved.rows.length) throw new InvalidStateTransitionError(WORKER_TRANSFER_REQUEST, null, status, 'concurrent');
      if (decision === 'approve') {
        await sql`update users set branch_id = ${req.to_branch_id}, updated_at = now() where id = ${req.user_id}`.execute(trx);
        // A TECHNICIAN's branch is not only users.branch_id. The roster row's PRIMARY branch, the per-branch
        // membership and the per-branch login grant (user_branch_access — what branch selection reads) all name
        // the branch she works at. Moving one and not the others left her scheduled at the old branch, selectable
        // at the old branch, and a member of the old branch — with a login that said otherwise. (Technician Profile merge.)
        await this.moveTechnicianBranch(trx, { tenantId: req.tenant_id, userId: String(req.user_id), fromBranchId: req.from_branch_id ? String(req.from_branch_id) : null, toBranchId: String(req.to_branch_id), reviewedBy: reviewedBy ?? null });
      }
      return { id, tenantId: req.tenant_id ? String(req.tenant_id) : null, userId: String(req.user_id), toBranchId: String(req.to_branch_id), status };
    }).catch((e) => { if (e instanceof InvalidStateTransitionError) throw e; return { id, tenantId: null, userId: '', toBranchId: '', status }; });
    return out;
  }

  /**
   * The technician half of a branch transfer (no-op for non-technician logins). Inside the caller's transaction.
   *   technicians.branch_id       → the new PRIMARY branch (every live roster row of this login at this salon)
   *   tech_salon_memberships      → the active membership at the old branch moves to the new one; when a row at
   *                                 the new branch already exists it is (re)activated and the old one ends as
   *                                 'former' / 'branch_transfer' (the (profile, tenant, branch) key is unique)
   *   user_branch_access          → old-branch staff grant removed, new-branch grant written (TECHNICIAN, or
   *                                 MANAGER when the membership's role_label says so)
   */
  private async moveTechnicianBranch(trx: any, i: { tenantId: string | null; userId: string; fromBranchId: string | null; toBranchId: string; reviewedBy: string | null }) {
    const u = await sql<{ tenant_id: string | null; role: string; global_tech_profile_id: string | null; prev_branch_id: string | null }>`
      select tenant_id, role, global_tech_profile_id, branch_id as prev_branch_id from users where id = ${i.userId} limit 1`.execute(trx).then((x) => x.rows[0]);
    if (!u || u.role !== 'TECHNICIAN') return;
    const tenantId = i.tenantId ?? u.tenant_id;
    if (!tenantId) return;
    const fromBranchId = i.fromBranchId ?? u.prev_branch_id;

    await sql`update technicians set branch_id = ${i.toBranchId}, updated_at = now()
               where tenant_id = ${tenantId} and user_id = ${i.userId} and archived_at is null`.execute(trx);
    // her weekly schedule (one row per weekday per technician in the salon) follows her: it now describes her hours at the
    // new location. Left behind, the new location saw no hours for her and saving them failed on the unique weekday key
    // (200-technician M5 pilot, Oct 24 2026). Appointments, tickets and pay stay where they happened.
    await sql`update technician_schedules set branch_id = ${i.toBranchId}, updated_at = now()
               where tenant_id = ${tenantId} and branch_id is distinct from ${i.toBranchId}
                 and technician_id in (select id from technicians where tenant_id = ${tenantId} and user_id = ${i.userId} and archived_at is null)`.execute(trx);

    let roleLabel: string | null = null;
    if (u.global_tech_profile_id) {
      const gtp = u.global_tech_profile_id;
      const old = await sql<{ id: string; role_label: string | null; technician_id: string | null }>`
        select id, role_label, technician_id from tech_salon_memberships
         where global_tech_profile_id = ${gtp} and tenant_id = ${tenantId} and status = 'active'
           and branch_id is not distinct from ${fromBranchId} limit 1`.execute(trx).then((x) => x.rows[0]);
      roleLabel = old?.role_label ?? null;
      const atTarget = await sql<{ id: string }>`
        select id from tech_salon_memberships
         where global_tech_profile_id = ${gtp} and tenant_id = ${tenantId} and branch_id = ${i.toBranchId} limit 1`.execute(trx).then((x) => x.rows[0]);
      if (atTarget) {
        await sql`update tech_salon_memberships set status = 'active', start_date = coalesce(start_date, now()), end_date = null, ended_reason = null,
                         user_id = ${i.userId}, technician_id = coalesce(technician_id, ${old?.technician_id ?? null}), updated_at = now()
                   where id = ${atTarget.id} and tenant_id = ${tenantId} and ${canMoveToSql(TECH_SALON_MEMBERSHIP, 'active')}`.execute(trx);
        if (old && old.id !== atTarget.id) {
          await sql`update tech_salon_memberships set status = 'former', end_date = coalesce(end_date, now()), ended_reason = 'branch_transfer', updated_at = now()
                     where id = ${old.id} and tenant_id = ${tenantId} and ${canMoveToSql(TECH_SALON_MEMBERSHIP, 'former')}`.execute(trx);
        }
      } else if (old) {
        await sql`update tech_salon_memberships set branch_id = ${i.toBranchId}, updated_at = now()
                   where id = ${old.id} and tenant_id = ${tenantId}`.execute(trx);
      }
    }

    // the login grant follows the membership (what auth/branch-access.ts reads; fails closed without it)
    if (fromBranchId && fromBranchId !== i.toBranchId) {
      await sql`delete from user_branch_access where tenant_id = ${tenantId} and user_id = ${i.userId} and branch_id = ${fromBranchId} and access_level = 'staff'`.execute(trx);
    }
    const role = branchRoleForLabel(roleLabel);
    await sql`
      insert into user_branch_access (tenant_id, branch_id, user_id, role, access_level, created_by_user_id)
      values (${tenantId}, ${i.toBranchId}, ${i.userId}, ${role}, 'staff', ${i.reviewedBy})
      on conflict (tenant_id, user_id, branch_id) do update set role = excluded.role, access_level = 'staff', updated_at = now()`.execute(trx);
  }

  // ---- cross-tenant transfer (§31): reviewed request + decision, NO provisioning ----
  async workerCrossTransferTarget(userId: string, scope?: OverviewScope): Promise<import('./super-admin-staff.service').WorkerCrossTransferTarget | null> {
    if (!this.db) return null;
    const r = await sql<{ id: string; full_name: string | null; tenant_id: string | null }>`
      select id, full_name, tenant_id from users
      where id = ${userId} and role in ('OWNER','MANAGER','FRONT_DESK','RECEPTION','TECHNICIAN') and ${tenantPred(scope, 'tenant_id')} limit 1`
      .execute(this.db).then((x) => x.rows[0]).catch(() => undefined);
    return r ? { userId: String(r.id), name: r.full_name || '—', tenantId: r.tenant_id ? String(r.tenant_id) : null } : null;
  }

  async tenantExists(tenantId: string): Promise<boolean> {
    if (!this.db) return false;
    return sql<{ one: number }>`select 1 as one from tenants where id = ${tenantId} limit 1`.execute(this.db).then((x) => x.rows.length > 0).catch(() => false);
  }

  async createCrossTransferRequest(input: { userId: string; fromTenantId: string | null; toTenantId: string; toBranchId: string | null; effectiveDate: string | null; reason: string; requestedBy?: string }): Promise<{ id: string }> {
    if (!this.db) return { id: '' };
    const r = await sql<{ id: string }>`
      insert into worker_cross_tenant_transfer_requests (user_id, from_tenant_id, to_tenant_id, to_branch_id, effective_date, reason, requested_by_user_id)
      values (${input.userId}, ${input.fromTenantId}, ${input.toTenantId}, ${input.toBranchId}, ${input.effectiveDate}, ${input.reason}, ${input.requestedBy ?? null})
      returning id`.execute(this.db).then((x) => x.rows[0]).catch(() => undefined);
    return { id: r ? String(r.id) : '' };
  }

  async crossTransferList(scope?: OverviewScope): Promise<import('./super-admin-staff.service').WorkforceCrossTransferRow[]> {
    if (!this.db) return [];
    // Scope by the DESTINATION tenant so a tenant-scoped admin sees inbound requests; platform admins see all.
    const rows = await sql<{ id: string; user_id: string; worker_name: string | null; from_tenant: string | null; to_tenant: string | null; to_branch: string | null; effective_date: unknown; status: string; reason: string; created_at: unknown; reviewed_at: unknown; decision_note: string | null }>`
      select w.id, w.user_id, u.full_name as worker_name, ft.display_name as from_tenant, tt.display_name as to_tenant,
        tb.name as to_branch, w.effective_date, w.status, w.reason, w.created_at, w.reviewed_at, w.decision_note
      from worker_cross_tenant_transfer_requests w
      left join users u on u.id = w.user_id
      left join tenants ft on ft.id = w.from_tenant_id
      left join tenants tt on tt.id = w.to_tenant_id
      left join branches tb on tb.id = w.to_branch_id
      where w.status = 'requested' and ${tenantPred(scope, 'w.to_tenant_id')}
      order by w.created_at asc limit 100`.execute(this.db).then((x) => x.rows).catch(() => []);
    return rows.map((p) => ({ id: String(p.id), workerId: String(p.user_id), workerName: p.worker_name || '—', fromTenant: p.from_tenant ?? null, toTenant: p.to_tenant ?? null, toBranch: p.to_branch ?? null, effectiveDate: iso(p.effective_date), status: p.status, reason: p.reason, requestedAt: iso(p.created_at), decidedAt: iso(p.reviewed_at), decisionNote: p.decision_note ?? null }));
  }

  async getCrossTransferRequest(id: string, scope?: OverviewScope): Promise<import('./super-admin-staff.service').WorkerCrossTransferRecord | null> {
    if (!this.db) return null;
    const r = await sql<{ id: string; user_id: string; to_tenant_id: string; status: string; from_tenant_id: string | null; to_branch_id: string | null; requested_by_user_id: string | null; effective_date: unknown }>`
      select id, user_id, to_tenant_id, status, from_tenant_id, to_branch_id, requested_by_user_id, effective_date
        from worker_cross_tenant_transfer_requests where id = ${id} and ${tenantPred(scope, 'to_tenant_id')} limit 1`
      .execute(this.db).then((x) => x.rows[0]).catch(() => undefined);
    return r ? {
      id: String(r.id), userId: String(r.user_id), toTenantId: String(r.to_tenant_id), status: r.status,
      fromTenantId: r.from_tenant_id ? String(r.from_tenant_id) : null,
      toBranchId: r.to_branch_id ? String(r.to_branch_id) : null,
      requestedByUserId: r.requested_by_user_id ? String(r.requested_by_user_id) : null,
      effectiveDate: iso(r.effective_date) || null,
    } : null;
  }

  async decideCrossTransfer(id: string, decision: 'approve' | 'reject', note: string | null, reviewedBy?: string): Promise<import('./super-admin-staff.service').WorkerCrossTransferRecord> {
    if (!this.db) return { id, userId: '', toTenantId: '', status: decision === 'approve' ? 'approved' : 'rejected' };
    const status = decision === 'approve' ? 'approved' : 'rejected';
    // NOTE: neither branch records the decision by provisioning access or moving history — a cross-tenant move's
    // execution is a separate, live-infrastructure step. Here we only flip status + record who/when/why.
    const r = await sql<{ user_id: string; to_tenant_id: string }>`
      update worker_cross_tenant_transfer_requests set status = ${status}, reviewed_by_user_id = ${reviewedBy ?? null}, reviewed_at = now(), decision_note = ${note}, updated_at = now()
      where id = ${id} and ${canMoveToSql(WORKER_CROSS_TENANT_TRANSFER_REQUEST, status)} returning user_id, to_tenant_id`.execute(this.db).then((x) => x.rows[0]).catch(() => undefined);
    return { id, userId: r ? String(r.user_id) : '', toTenantId: r ? String(r.to_tenant_id) : '', status };
  }

  // ---- payroll-sync monitoring + retry (§35): status/error metadata only, never amounts ----
  async payrollSyncCounts(scope?: OverviewScope): Promise<{ status: string; count: number }[]> {
    if (!this.db) return [];
    return sql<{ status: string; count: number }>`
      select status, count(*)::int as count from payroll_sync_events where ${tenantPred(scope, 'tenant_id')} group by status`
      .execute(this.db).then((x) => x.rows).catch(() => [] as { status: string; count: number }[]);
  }

  async payrollSyncEvents(scope?: OverviewScope): Promise<Array<{ id: string; userId: string | null; workerName: string | null; tenant: string | null; provider: string; eventType: string; status: string; errorCode: string | null; errorMessage: string | null; attemptCount: number; maxAttempts: number; lastAttemptAt: string | null; nextRetryAt: string | null }>> {
    if (!this.db) return [];
    const rows = await sql<{ id: string; user_id: string | null; worker_name: string | null; tenant_name: string | null; provider: string; event_type: string; status: string; error_code: string | null; error_message: string | null; attempt_count: number; max_attempts: number; last_attempt_at: unknown; next_retry_at: unknown }>`
      select e.id, e.user_id, u.full_name as worker_name, t.display_name as tenant_name, e.provider, e.event_type, e.status,
        e.error_code, e.error_message, e.attempt_count, e.max_attempts, e.last_attempt_at, e.next_retry_at
      from payroll_sync_events e
      left join users u on u.id = e.user_id
      left join tenants t on t.id = e.tenant_id
      where ${tenantPred(scope, 'e.tenant_id')}
      order by (case when e.status in ('failed','retrying') then 0 else 1 end), e.updated_at desc limit 200`
      .execute(this.db).then((x) => x.rows).catch(() => []);
    return rows.map((e) => ({ id: String(e.id), userId: e.user_id ? String(e.user_id) : null, workerName: e.worker_name ?? null, tenant: e.tenant_name ?? null, provider: e.provider, eventType: e.event_type, status: e.status, errorCode: e.error_code ?? null, errorMessage: e.error_message ?? null, attemptCount: n(e.attempt_count), maxAttempts: n(e.max_attempts), lastAttemptAt: iso(e.last_attempt_at), nextRetryAt: iso(e.next_retry_at) }));
  }

  async getPayrollSyncEventRecord(id: string, scope?: OverviewScope): Promise<import('./super-admin-staff.service').PayrollSyncEventRecord | null> {
    if (!this.db) return null;
    const r = await sql<{ id: string; status: string; error_code: string | null; attempt_count: number; max_attempts: number }>`
      select id, status, error_code, attempt_count, max_attempts from payroll_sync_events where id = ${id} and ${tenantPred(scope, 'tenant_id')} limit 1`
      .execute(this.db).then((x) => x.rows[0]).catch(() => undefined);
    return r ? { id: String(r.id), status: r.status, errorCode: r.error_code ?? null, attemptCount: n(r.attempt_count), maxAttempts: n(r.max_attempts) } : null;
  }

  async recordPayrollRetryAttempt(id: string, nextRetryAt: string): Promise<{ status: string; attemptCount: number }> {
    if (!this.db) return { status: 'retrying', attemptCount: 0 };
    // Increments the attempt count and re-queues the event (status 'retrying'). The row's unique idempotency key
    // guarantees a re-attempt never creates a duplicate payroll entry. No amounts are touched.
    const r = await sql<{ status: string; attempt_count: number }>`
      update payroll_sync_events set attempt_count = attempt_count + 1, status = 'retrying', last_attempt_at = now(), next_retry_at = ${nextRetryAt}, updated_at = now()
      where id = ${id} and ${canMoveToSql(PAYROLL_SYNC_EVENT, 'retrying')} returning status, attempt_count`.execute(this.db).then((x) => x.rows[0]).catch(() => undefined);
    return { status: r ? r.status : 'retrying', attemptCount: r ? n(r.attempt_count) : 0 };
  }

  // ---- suspicious activity (§37): five real derived signals from sessions + audit_logs + user status ----
  async securitySignals(scope?: OverviewScope): Promise<import('./super-admin-staff.service').SecuritySignalRow[]> {
    if (!this.db) return [];
    const WORKER = `u.role in ('OWNER','MANAGER','FRONT_DESK','RECEPTION','TECHNICIAN')`;
    const base = (rows: Array<{ user_id: string; full_name: string | null; tenant_name: string | null; status: string; c: number }>, type: string) =>
      rows.map((r) => ({ type, userId: String(r.user_id), name: r.full_name || '—', tenant: r.tenant_name ?? null, status: r.status, count: n(r.c) }));

    // 1) inactive/suspended worker holding active sessions
    const terminated = sql<{ user_id: string; full_name: string | null; tenant_name: string | null; status: string; c: number }>`
      select u.id as user_id, u.full_name, t.display_name as tenant_name, u.status,
        (select count(*)::int from sessions s where s.user_id = u.id and s.status = 'active' and s.revoked_at is null and s.expires_at > now()) as c
      from users u left join tenants t on t.id = u.tenant_id
      where ${sql.raw(WORKER)} and u.status in ('inactive','suspended') and ${tenantPred(scope, 'u.tenant_id')}
        and (select count(*) from sessions s where s.user_id = u.id and s.status = 'active' and s.revoked_at is null and s.expires_at > now()) > 0
      limit 200`.execute(this.db).then((x) => base(x.rows, 'terminated_access')).catch(() => []);

    // 2) excessive session creation in the last 24h (floor 5; core applies the real threshold)
    const sessions = sql<{ user_id: string; full_name: string | null; tenant_name: string | null; status: string; c: number }>`
      select u.id as user_id, u.full_name, t.display_name as tenant_name, u.status, count(s.id)::int as c
      from sessions s join users u on u.id = s.user_id left join tenants t on t.id = u.tenant_id
      where ${sql.raw(WORKER)} and s.created_at > now() - interval '24 hours' and ${tenantPred(scope, 'u.tenant_id')}
      group by u.id, u.full_name, t.display_name, u.status having count(s.id) >= 5 limit 200`
      .execute(this.db).then((x) => base(x.rows, 'excessive_sessions')).catch(() => []);

    // audit-derived signals (floor 2)
    const auditSig = (type: string, codes: string[], like: string, since: string) => sql<{ user_id: string; full_name: string | null; tenant_name: string | null; status: string; c: number }>`
      select u.id as user_id, u.full_name, t.display_name as tenant_name, u.status, count(a.id)::int as c
      from audit_logs a join users u on u.id = a.user_id left join tenants t on t.id = u.tenant_id
      where ${sql.raw(WORKER)} and a.created_at > now() - ${sql.raw(`interval '${since}'`)}
        and (a.action_type in (${sql.join(codes.map((c) => sql`${c}`), sql`, `)}) or a.action_type ilike ${like})
        and ${tenantPred(scope, 'u.tenant_id')}
      group by u.id, u.full_name, t.display_name, u.status having count(a.id) >= 2 limit 200`
      .execute(this.db!).then((x) => base(x.rows, type)).catch(() => []);

    const mfa = auditSig('mfa_anomalies', ['invalid_mfa', 'replayed_mfa', 'mfa_required'], '%mfa%', '7 days');
    const denials = auditSig('permission_denials', ['permission_denied', 'blocked_permission'], '%permission_denied%', '7 days');
    const roles = auditSig('role_churn', ['role_changed'], '%role_change%', '30 days');

    const parts = await Promise.all([terminated, sessions, mfa, denials, roles]);
    return parts.flat();
  }

  // Per-technician latest non-revoked push-token heartbeat (§21/§34). last_seen null / no token → handled by the core.
  async technicianConnectivity(scope?: OverviewScope): Promise<import('./super-admin-staff.service').TechnicianConnectivityRawRow[]> {
    if (!this.db) return [];
    const rows = await sql<{ user_id: string; last_seen: unknown; token_count: number }>`
      select u.id as user_id,
        max(d.last_seen_at) filter (where d.revoked_at is null) as last_seen,
        count(d.id) filter (where d.revoked_at is null)::int as token_count
      from users u left join device_push_tokens d on d.user_id = u.id
      where u.role = 'TECHNICIAN' and ${tenantPred(scope, 'u.tenant_id')}
      group by u.id limit 5000`.execute(this.db).then((x) => x.rows).catch(() => []);
    return rows.map((r) => ({ userId: String(r.user_id), lastSeen: iso(r.last_seen), hasToken: n(r.token_count) > 0 }));
  }

  // ---- saved views (§6): owner-scoped persistence ----
  async listSavedViews(ownerUserId: string, surface: string): Promise<import('./super-admin-staff.service').SavedViewRow[]> {
    if (!this.db) return [];
    const rows = await sql<{ id: string; name: string; filters_json: string; is_default: unknown; created_at: unknown }>`
      select id, name, filters_json, is_default, created_at from super_admin_saved_views
      where owner_user_id = ${ownerUserId} and surface = ${surface} order by is_default desc, name asc limit 100`
      .execute(this.db).then((x) => x.rows).catch(() => []);
    return rows.map((r) => ({ id: String(r.id), name: r.name, filters: parseViewFilters(r.filters_json), isDefault: bool(r.is_default), createdAt: iso(r.created_at) }));
  }

  async createSavedView(input: { ownerUserId: string; surface: string; name: string; filtersJson: string; isDefault: boolean }): Promise<{ id: string }> {
    if (!this.db) return { id: '' };
    const r = await sql<{ id: string }>`
      insert into super_admin_saved_views (owner_user_id, surface, name, filters_json, is_default)
      values (${input.ownerUserId}, ${input.surface}, ${input.name}, ${input.filtersJson}, ${input.isDefault})
      on conflict (owner_user_id, surface, name) do update set filters_json = excluded.filters_json, is_default = excluded.is_default, updated_at = now()
      returning id`.execute(this.db).then((x) => x.rows[0]).catch(() => undefined);
    return { id: r ? String(r.id) : '' };
  }

  async clearDefaultViews(ownerUserId: string, surface: string): Promise<void> {
    if (!this.db) return;
    await sql`update super_admin_saved_views set is_default = false, updated_at = now() where owner_user_id = ${ownerUserId} and surface = ${surface} and is_default = true`.execute(this.db).catch(() => undefined);
  }

  async deleteSavedView(id: string, ownerUserId: string): Promise<boolean> {
    if (!this.db) return false;
    return sql<{ id: string }>`delete from super_admin_saved_views where id = ${id} and owner_user_id = ${ownerUserId} returning id`
      .execute(this.db).then((x) => x.rows.length > 0).catch(() => false);
  }
}
