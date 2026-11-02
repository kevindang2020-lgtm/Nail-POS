// super-admin-checkin.kysely.repository.ts — READ-ONLY, platform-wide (cross-tenant) kiosk Check-in activity for the
// Super Admin Booking & Check-in screen. Reads go_checkin_sessions across all tenants (joined to go_checkin_devices,
// branches, tenants for display names). It does NOT re-implement any check-in/kiosk logic and writes nothing. With no DB
// configured it returns an honest empty overview (no fabricated data).
import { type DB, andTenant, tenantPred } from '@aipowersalon/database';
import { Kysely, sql } from 'kysely';
import type {
  PlatformCheckinOverview, CheckinOverviewFilters,
  PlatformCheckinTenantRow, PlatformCheckinSessionRow, PlatformCheckinStatusSlice,
} from './super-admin-checkin.service';

const n = (v: unknown): number => (v == null ? 0 : Number(v) || 0);
const iso = (v: unknown): string | null => { if (!v) return null; const d = new Date(v as any); return isNaN(+d) ? null : d.toISOString(); };

const EMPTY: PlatformCheckinOverview = {
  kpis: { activeNow: 0, completedToday: 0, sessionsToday: 0, totalSessions: 0 },
  tenants: [], sessions: [], statusBreakdown: [], tenantCount: 0,
};

export class SuperAdminCheckinKyselyRepository {
  constructor(private readonly db: Kysely<DB> | null) {}

  async platformCheckinOverview(f: CheckinOverviewFilters): Promise<PlatformCheckinOverview> {
    if (!this.db) return EMPTY;
    const scope = f.scope;
    const hasSearch = f.search.length > 0;
    const pat = `%${f.search}%`;
    const hasStatus = f.status.length > 0;

    const kpiP = sql<{ active_now: number; completed_today: number; sessions_today: number; total_sessions: number }>`
      select count(*) filter (where status = 'active')::int as active_now,
             count(*) filter (where completed_at >= date_trunc('day', now()))::int as completed_today,
             count(*) filter (where started_at >= date_trunc('day', now()))::int as sessions_today,
             count(*)::int as total_sessions
      from go_checkin_sessions where ${tenantPred(scope)}`.execute(this.db);

    const tenantsP = sql<{ tenant_id: string; tenant_name: string | null; session_count: number; active_count: number }>`
      select t.id as tenant_id, t.display_name as tenant_name,
             count(s.id)::int as session_count,
             count(s.id) filter (where s.status = 'active')::int as active_count
      from tenants t
      join go_checkin_sessions s on s.tenant_id = t.id
      where ${tenantPred(scope, 't.id')}
      group by t.id, t.display_name
      order by session_count desc, t.display_name asc`.execute(this.db);

    const statusP = sql<{ status: string; count: number }>`
      select coalesce(status, 'unknown') as status, count(*)::int as count
      from go_checkin_sessions where ${tenantPred(scope)} group by status order by count desc`.execute(this.db);

    const sessionsP = sql<{ session_id: string; tenant_id: string; tenant_name: string | null; branch_name: string | null; device_name: string | null; status: string; started_at: unknown; completed_at: unknown; last_seen_at: unknown }>`
      select s.id as session_id, s.tenant_id, t.display_name as tenant_name, b.name as branch_name,
             d.device_name, s.status, s.started_at, s.completed_at, s.last_seen_at
      from go_checkin_sessions s
      left join tenants t on t.id = s.tenant_id
      left join branches b on b.id = s.branch_id
      left join go_checkin_devices d on d.id = s.device_id
      where (${hasSearch ? sql`(t.display_name ilike ${pat} or d.device_name ilike ${pat})` : sql`true`})
        and (${hasStatus ? sql`s.status = ${f.status}` : sql`true`}) ${andTenant(scope, 's.tenant_id')}
      order by s.started_at desc nulls last
      limit ${f.limit}`.execute(this.db);

    const [kpi, tenants, status, sessions] = await Promise.all([kpiP, tenantsP, statusP, sessionsP]);
    const k = kpi.rows[0] ?? { active_now: 0, completed_today: 0, sessions_today: 0, total_sessions: 0 };

    const tenantRows: PlatformCheckinTenantRow[] = tenants.rows.map((r) => ({
      tenantId: r.tenant_id, tenantName: r.tenant_name, sessionCount: n(r.session_count), activeCount: n(r.active_count),
    }));
    const sessionRows: PlatformCheckinSessionRow[] = sessions.rows.map((r) => ({
      sessionId: r.session_id, tenantId: r.tenant_id, tenantName: r.tenant_name, branchName: r.branch_name,
      deviceName: r.device_name, status: r.status, startedAt: iso(r.started_at), completedAt: iso(r.completed_at), lastSeenAt: iso(r.last_seen_at),
    }));
    const statusBreakdown: PlatformCheckinStatusSlice[] = status.rows.map((r) => ({ status: r.status, count: n(r.count) }));

    return {
      kpis: { activeNow: n(k.active_now), completedToday: n(k.completed_today), sessionsToday: n(k.sessions_today), totalSessions: n(k.total_sessions) },
      tenants: tenantRows,
      sessions: sessionRows,
      statusBreakdown,
      tenantCount: tenantRows.length,
    };
  }
}
