// super-admin-queue.kysely.repository.ts — READ-ONLY, platform-wide (cross-tenant) live Queue Management for the Super
// Admin Queue screen. Reads pos_queue_items across all tenants (joined to tenants/branches/technicians for names),
// limited to currently-active queue statuses (waiting/called/assigned/in_service). It does NOT re-implement any queue
// assignment/wait logic and writes nothing. With no DB configured it returns an honest empty overview (no fabricated data).
import { type DB, andTenant, tenantPred } from '@aipowersalon/database';
import { Kysely, sql } from 'kysely';
import type {
  PlatformQueueOverview, QueueOverviewFilters,
  PlatformQueueTenantRow, PlatformQueueItemRow, PlatformQueueStatusSlice,
} from './super-admin-queue.service';

const n = (v: unknown): number => (v == null ? 0 : Number(v) || 0);
const iso = (v: unknown): string | null => { if (!v) return null; const d = new Date(v as any); return isNaN(+d) ? null : d.toISOString(); };
const bool = (v: unknown): boolean => v === true || v === 't' || v === 1 || v === '1';
const minutes = (sec: unknown): number => Math.max(0, Math.round(n(sec) / 60));

const EMPTY: PlatformQueueOverview = {
  kpis: { waitingNow: 0, inServiceNow: 0, vipWaiting: 0, longestWaitMin: 0, salonsWithActiveQueue: 0 },
  tenants: [], items: [], statusBreakdown: [], tenantCount: 0,
};

// Active = currently in the queue. Terminal statuses (completed/cancelled/done/moved_to_tech_queue/…) are excluded.
const WAITING = sql`status in ('waiting','called','assigned')`;
const ACTIVE = sql`status in ('waiting','called','assigned','in_service')`;

export class SuperAdminQueueKyselyRepository {
  constructor(private readonly db: Kysely<DB> | null) {}

  async platformQueueOverview(f: QueueOverviewFilters): Promise<PlatformQueueOverview> {
    if (!this.db) return EMPTY;
    const scope = f.scope;
    const hasSearch = f.search.length > 0;
    const pat = `%${f.search}%`;
    const hasStatus = f.status.length > 0;

    const kpiP = sql<{ waiting_now: number; in_service_now: number; vip_waiting: number; salons_active: number; longest_wait_sec: number }>`
      select count(*) filter (where ${WAITING})::int as waiting_now,
             count(*) filter (where status = 'in_service')::int as in_service_now,
             count(*) filter (where ${WAITING} and is_vip)::int as vip_waiting,
             count(distinct tenant_id) filter (where ${ACTIVE})::int as salons_active,
             coalesce(max(extract(epoch from (now() - checked_in_at))) filter (where ${WAITING}), 0)::int as longest_wait_sec
      from pos_queue_items where ${tenantPred(scope)}`.execute(this.db);

    const tenantsP = sql<{ tenant_id: string; tenant_name: string | null; waiting_count: number; serving_count: number }>`
      select t.id as tenant_id, t.display_name as tenant_name,
             count(q.id) filter (where ${sql`q.status in ('waiting','called','assigned')`})::int as waiting_count,
             count(q.id) filter (where q.status = 'in_service')::int as serving_count
      from tenants t
      join pos_queue_items q on q.tenant_id = t.id and ${sql`q.status in ('waiting','called','assigned','in_service')`}
      where ${tenantPred(scope, 't.id')}
      group by t.id, t.display_name
      order by count(q.id) desc, t.display_name asc`.execute(this.db);

    const statusP = sql<{ status: string; count: number }>`
      select status, count(*)::int as count
      from pos_queue_items where ${ACTIVE} ${andTenant(scope)} group by status order by count desc`.execute(this.db);

    const itemsP = sql<{ queue_item_id: string; tenant_id: string; tenant_name: string | null; branch_name: string | null; customer_name: string; is_vip: unknown; priority: string; status: string; station: string | null; technician_name: string | null; checked_in_at: unknown; wait_sec: number }>`
      select q.id as queue_item_id, q.tenant_id, t.display_name as tenant_name, b.name as branch_name,
             q.customer_name, q.is_vip, q.priority, q.status, q.station,
             tech.full_name as technician_name, q.checked_in_at,
             extract(epoch from (now() - q.checked_in_at))::int as wait_sec
      from pos_queue_items q
      left join tenants t on t.id = q.tenant_id
      left join branches b on b.id = q.branch_id
      left join technicians tech on tech.id = q.assigned_technician_id
      where ${sql`q.status in ('waiting','called','assigned','in_service')`}
        and (${hasSearch ? sql`(q.customer_name ilike ${pat} or t.display_name ilike ${pat})` : sql`true`})
        and (${hasStatus ? sql`q.status = ${f.status}` : sql`true`}) ${andTenant(scope, 'q.tenant_id')}
      order by q.checked_in_at asc nulls last
      limit ${f.limit}`.execute(this.db);

    const [kpi, tenants, status, items] = await Promise.all([kpiP, tenantsP, statusP, itemsP]);
    const k = kpi.rows[0] ?? { waiting_now: 0, in_service_now: 0, vip_waiting: 0, salons_active: 0, longest_wait_sec: 0 };

    const tenantRows: PlatformQueueTenantRow[] = tenants.rows.map((r) => ({
      tenantId: r.tenant_id, tenantName: r.tenant_name, waitingCount: n(r.waiting_count), servingCount: n(r.serving_count),
    }));
    const itemRows: PlatformQueueItemRow[] = items.rows.map((r) => ({
      queueItemId: r.queue_item_id, tenantId: r.tenant_id, tenantName: r.tenant_name, branchName: r.branch_name,
      customerName: r.customer_name, isVip: bool(r.is_vip), priority: r.priority, status: r.status, station: r.station,
      technicianName: r.technician_name, checkedInAt: iso(r.checked_in_at), waitMinutes: minutes(r.wait_sec),
    }));
    const statusBreakdown: PlatformQueueStatusSlice[] = status.rows.map((r) => ({ status: r.status, count: n(r.count) }));

    return {
      kpis: {
        waitingNow: n(k.waiting_now), inServiceNow: n(k.in_service_now), vipWaiting: n(k.vip_waiting),
        longestWaitMin: minutes(k.longest_wait_sec), salonsWithActiveQueue: n(k.salons_active),
      },
      tenants: tenantRows,
      items: itemRows,
      statusBreakdown,
      tenantCount: tenantRows.length,
    };
  }
}
