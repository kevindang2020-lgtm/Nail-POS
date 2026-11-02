// live-queue.repository.ts — READ-ONLY real data for the Live Queue Monitor. Reads pos_queue_items (the canonical
// front-desk queue) joined to tenants/branches/technicians, plus technicians.status (availability) and the *_devices
// heartbeat tables (offline detection via last_seen_at). Writes nothing. With no DB it returns an honest empty bundle.
import { type DB, andTenant } from '@aipowersalon/database';
import { Kysely, sql } from 'kysely';
import type {
  RawLiveQueueData, RawLiveItem, RawBranchMeta, RawTechStatus, RawDeviceCounts, RawTodayCounts, RawHourly,
  LiveQueueFilters,
} from './live-queue.service';

const n = (v: unknown): number => (v == null ? 0 : Number(v) || 0);
const ms = (v: unknown): number | null => { if (!v) return null; const d = new Date(v as string); return isNaN(+d) ? null : +d; };
const ms0 = (v: unknown): number => ms(v) ?? 0;
const bool = (v: unknown): boolean => v === true || v === 't' || v === 1 || v === '1';

const ACTIVE = sql`q.status in ('waiting','called','assigned','in_service')`;
const DEVICE_OFFLINE_SEC = 300; // 5-minute heartbeat window for the platform view (a Go Check-In kiosk reports less often than a customer display, whose own POS rule is 75 s)

import { buildMediaUrl } from '@aipowersalon/media';

const EMPTY: RawLiveQueueData = {
  aggItems: [], pageItems: [], pageTotal: 0, branchMeta: [], techStatus: [],
  devices: { total: 0, offline: 0 }, today: { totalQueues: 0, totalCustomers: 0, completedServices: 0 }, hourly: [],
};

type ItemRow = {
  id: string; tenant_id: string; tenant_name: string | null; branch_id: string | null; branch_name: string | null;
  customer_name: string; is_vip: unknown; priority: string; status: string; station: string | null; service: string | null;
  assigned_technician_id: string | null; technician_name: string | null; technician_photo_url: string | null; technician_avatar_url: string | null; source: string | null;
  checked_in_at: unknown; called_at: unknown; started_at: unknown; updated_at: unknown;
};

const mapItem = (r: ItemRow): RawLiveItem => ({
  id: r.id, tenantId: r.tenant_id, tenantName: r.tenant_name, branchId: r.branch_id, branchName: r.branch_name,
  customerName: r.customer_name, isVip: bool(r.is_vip), priority: r.priority, status: r.status, station: r.station,
  service: r.service, assignedTechnicianId: r.assigned_technician_id, technicianName: r.technician_name,
  technicianPhotoUrl: (r.technician_photo_url || r.technician_avatar_url) ? buildMediaUrl(r.technician_photo_url || r.technician_avatar_url) : null,
  source: r.source,
  checkedInAtMs: ms0(r.checked_in_at), calledAtMs: ms(r.called_at), startedAtMs: ms(r.started_at), updatedAtMs: ms0(r.updated_at),
});

const SELECT_ITEM = sql`
  q.id, q.tenant_id, t.display_name as tenant_name, q.branch_id, b.name as branch_name,
  q.customer_name, q.is_vip, q.priority, q.status, q.station,
  (q.requested_services ->> 0) as service,
  q.assigned_technician_id, tech.full_name as technician_name, tech.avatar_url as technician_photo_url, tech_user.avatar_url as technician_avatar_url, q.source,
  q.checked_in_at, q.called_at, q.started_at, q.updated_at`;

const FROM_ITEM = sql`
  from pos_queue_items q
  left join tenants t on t.id = q.tenant_id
  left join branches b on b.id = q.branch_id
  left join technicians tech on tech.id = q.assigned_technician_id
  left join users tech_user on tech_user.id = tech.user_id`;

const SORT_COL: Record<string, string> = {
  queueId: 'q.id', customer: 'q.customer_name', tenant: 't.display_name', branch: 'b.name',
  status: 'q.status', technician: 'tech.full_name', service: 'service', updated: 'q.updated_at',
};

export class LiveQueueRepository {
  constructor(private readonly db: Kysely<DB> | null) {}

  async liveQueueData(f: LiveQueueFilters): Promise<RawLiveQueueData> {
    if (!this.db) return EMPTY;
    const scope = f.scope;
    const pat = `%${f.search}%`;
    const hasSearch = f.search.length > 0;
    const hasStatus = f.status.length > 0;
    const hasTenant = !!f.tenantId;
    const hasBranch = !!f.branchId;

    const where = sql`where ${ACTIVE}
      and (${hasSearch ? sql`(q.customer_name ilike ${pat} or t.display_name ilike ${pat} or q.id::text ilike ${pat})` : sql`true`})
      and (${hasStatus ? sql`q.status = ${f.status}` : sql`true`})
      and (${hasTenant ? sql`q.tenant_id = ${f.tenantId}` : sql`true`})
      and (${hasBranch ? sql`q.branch_id = ${f.branchId}` : sql`true`})
      ${andTenant(scope, 'q.tenant_id')}`;

    // aggregation set (all active in scope, capped) — drives KPIs/charts/derivations
    const aggP = sql<ItemRow>`select ${SELECT_ITEM} ${FROM_ITEM} ${where} order by q.checked_in_at asc nulls last limit 5000`.execute(this.db);

    // directory page (filtered + sorted + paginated). "wait" sorts by checked_in_at (older = longer wait).
    // Security Deep Scan §84 (Oct 28 2026): an OWN key of the reviewed map only — `sort=constructor` found Object's function text
    // through the prototype and put it into ORDER BY (a 500); now any unknown key is the default column
    const sortCol = f.sort === 'wait' ? 'q.checked_in_at' : (Object.prototype.hasOwnProperty.call(SORT_COL, f.sort) ? SORT_COL[f.sort] : 'q.checked_in_at');
    const waitInvert = f.sort === 'wait'; // longer wait (desc) = earlier checked_in (asc)
    const dir = (waitInvert ? (f.direction === 'desc' ? 'asc' : 'desc') : f.direction).toUpperCase();
    const offset = (f.page - 1) * f.pageSize;
    const pageP = sql<ItemRow>`select ${SELECT_ITEM} ${FROM_ITEM} ${where} order by ${sql.raw(sortCol)} ${sql.raw(dir)} nulls last limit ${f.pageSize} offset ${offset}`.execute(this.db);
    const countP = sql<{ c: number }>`select count(*)::int as c ${FROM_ITEM} ${where}`.execute(this.db);

    // per-branch capacity + available techs (real technicians.status; present = on-shift-ish)
    const branchMetaP = sql<{ branch_id: string; branch_name: string | null; tenant_name: string | null; available_techs: number; capacity: number }>`
      select b.id as branch_id, b.name as branch_name, t.display_name as tenant_name,
             count(*) filter (where tech.status = 'available')::int as available_techs,
             count(*) filter (where tech.status in ('available','busy','on_shift','on_break'))::int as capacity
      from technicians tech
      join branches b on b.id = tech.branch_id
      left join tenants t on t.id = tech.tenant_id
      where tech.is_active = true ${andTenant(scope, 'tech.tenant_id')}
      group by b.id, b.name, t.display_name`.execute(this.db);

    // technician availability distribution
    const techStatusP = sql<{ status: string; count: number }>`
      select status, count(*)::int as count from technicians
      where is_active = true ${andTenant(scope, 'tenant_id')} group by status`.execute(this.db);

    // device heartbeat (offline = no heartbeat within window). Two device tables; summed in JS (different tenant_id types).
    const goDevP = sql<{ total: number; offline: number }>`
      select count(*)::int as total,
             count(*) filter (where last_seen_at is null or last_seen_at < now() - ${sql.raw(`interval '${DEVICE_OFFLINE_SEC} seconds'`)})::int as offline
      from go_checkin_devices where status not in ('disabled','revoked') ${andTenant(scope, 'tenant_id')}`.execute(this.db).catch(() => ({ rows: [{ total: 0, offline: 0 }] }));
    // the salons' customer displays (23-inch spec §85): customer_display_devices is the registry the displays' own
    // heartbeats write. (This read used to count pos_display_devices — a table nothing has ever written — and without
    // the tenant scope every other line here carries.)
    const posDevP = sql<{ total: number; offline: number }>`
      select count(*)::int as total,
             count(*) filter (where last_seen_at is null or last_seen_at < now() - ${sql.raw(`interval '${DEVICE_OFFLINE_SEC} seconds'`)})::int as offline
      from customer_display_devices where revoked_at is null and pairing_status = 'paired' ${andTenant(scope, 'tenant_id')}`.execute(this.db).catch(() => ({ rows: [{ total: 0, offline: 0 }] }));

    // today counts (branch-local day approximated as UTC day here; refined per-branch tz in a later unit)
    const todayP = sql<{ total_queues: number; total_customers: number; completed: number }>`
      select count(*)::int as total_queues,
             count(distinct coalesce(customer_id::text, customer_name))::int as total_customers,
             count(*) filter (where started_at is not null)::int as completed
      from pos_queue_items q where q.checked_in_at >= date_trunc('day', now()) ${andTenant(scope, 'q.tenant_id')}`.execute(this.db);

    // hourly volume today (queue entries created per hour)
    const hourlyP = sql<{ hour: number; count: number }>`
      select extract(hour from checked_in_at)::int as hour, count(*)::int as count
      from pos_queue_items q where q.checked_in_at >= date_trunc('day', now()) ${andTenant(scope, 'q.tenant_id')}
      group by 1 order by 1`.execute(this.db);

    const [agg, page, count, branchMeta, techStatus, goDev, posDev, today, hourly] = await Promise.all([
      aggP, pageP, countP, branchMetaP, techStatusP, goDevP, posDevP, todayP, hourlyP,
    ]);

    const devTotal = n(goDev.rows[0]?.total) + n(posDev.rows[0]?.total);
    const devOffline = n(goDev.rows[0]?.offline) + n(posDev.rows[0]?.offline);

    return {
      aggItems: agg.rows.map(mapItem),
      pageItems: page.rows.map(mapItem),
      pageTotal: n(count.rows[0]?.c),
      branchMeta: branchMeta.rows.map((r): RawBranchMeta => ({ branchId: r.branch_id, branchName: r.branch_name, tenantName: r.tenant_name, availableTechs: n(r.available_techs), capacity: n(r.capacity) })),
      techStatus: techStatus.rows.map((r): RawTechStatus => ({ status: r.status, count: n(r.count) })),
      devices: { total: devTotal, offline: devOffline } as RawDeviceCounts,
      today: { totalQueues: n(today.rows[0]?.total_queues), totalCustomers: n(today.rows[0]?.total_customers), completedServices: n(today.rows[0]?.completed) } as RawTodayCounts,
      hourly: hourly.rows.map((r): RawHourly => ({ hour: n(r.hour), count: n(r.count) })),
    };
  }

  /** Append a metrics snapshot for a scope (platform or tenant). Append-only; never mutates prior rows. */
  async insertSnapshot(scopeKey: string, tenantId: string | null, metrics: Record<string, number | null>): Promise<void> {
    if (!this.db) return;
    await sql`INSERT INTO queue_metrics_snapshots (scope_key, tenant_id, metrics)
              VALUES (${scopeKey}, ${tenantId}, ${JSON.stringify(metrics)}::jsonb)`.execute(this.db);
  }

  /** Most recent snapshot for a scope captured strictly before `beforeIso` — the baseline for period-over-period trends. */
  async latestPriorSnapshot(scopeKey: string, beforeIso: string): Promise<{ capturedAt: string; metrics: Record<string, number | null> } | null> {
    if (!this.db) return null;
    const r = await sql<{ captured_at: unknown; metrics: unknown }>`
      SELECT captured_at, metrics FROM queue_metrics_snapshots
      WHERE scope_key = ${scopeKey} AND captured_at < ${beforeIso}::timestamptz
      ORDER BY captured_at DESC LIMIT 1`.execute(this.db).catch(() => ({ rows: [] }));
    const row = r.rows[0];
    if (!row) return null;
    const m = typeof row.metrics === 'string' ? JSON.parse(row.metrics) : (row.metrics as Record<string, number | null>);
    return { capturedAt: new Date(row.captured_at as string).toISOString(), metrics: m ?? {} };
  }
}
