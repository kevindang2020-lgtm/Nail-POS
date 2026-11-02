// ai-queue-assignment-superadmin.repository.ts — BUILD_PLAN Phase 6: platform oversight of AI queue assignment.
// CROSS-TENANT BY DESIGN (reached only behind SuperAdminGuard): counts, per-salon rows and one salon's detail.
// No guest data: alert reasons are built by the detection core from minutes and counts; no names / phones selected.
//
// Audit bug 12, fixed: "tenantsEnabled" counted queue_assignment_settings ROWS (one per branch) where auto_enabled — a
// salon with three locations counted three times, and a salon that switched auto on salon-wide (Phase 6 tenant row)
// counted zero. Now: DISTINCT salons with at least one active location whose EFFECTIVE auto switch is on (location value,
// else the salon value) and whose salon kill switch is off. And the AI-call statuses are the ones AiPlatform really
// writes to ai_usage_logs (success / failed / blocked_limit / blocked_permission / blocked_unpaid) — the old
// 'provider_error' bucket was never written by anything.
import { sql, type Kysely } from 'kysely';

export const AI_CALL_STATUSES = ['success', 'failed', 'blocked_limit', 'blocked_permission', 'blocked_unpaid'] as const;
const PACKAGE = 'ai_queue_technician_assignment';

export interface PlatformAggregate {
  salons: { using: number; autoEnabled: number; autoKilled: number; entitled: number };
  platformAutoActionsDisabled: boolean;
  recommendations: { total: number; last30Days: number };
  decisions: { accepted: number; rejected: number; overridden: number; kept_unassigned: number; auto_assigned: number; total: number; acceptanceRate: number | null };
  alerts: { total: number; open: number; autoResolved: number; openByType: Record<string, number>; openBySeverity: Record<string, number> };
  aiCalls: Record<(typeof AI_CALL_STATUSES)[number], number> & { total: number; other: number };
  jobs: { lastScanAt: string | null; lastAutoRunAt: string | null; branchesScannedLast10Min: number };
  /** kept for older readers: the same number as salons.autoEnabled */
  auto: { tenantsEnabled: number };
  tenantsWithSettings: number;
}
export interface SalonRow {
  tenantId: string; name: string; status: string; branches: number; branchesAutoOn: number; autoKilled: boolean; autoKilledReason: string | null;
  openAlerts: number; criticalAlerts: number; decisions30d: number; autoAssigned30d: number; lastScanAt: string | null; lastAutoRunAt: string | null;
}
export interface SalonDetailRead {
  tenant: { tenantId: string; name: string; status: string } | null;
  branches: { branchId: string; name: string; status: string; openAlerts: number; lastScanAt: string | null; lastAutoRunAt: string | null }[];
  openAlerts: { id: string; branchId: string; type: string; severity: string; reason: string; ageMinutes: number; createdAt: string; autoResolved: boolean }[];
  alertsByType: Record<string, number>;
  decisions30d: Record<string, number>;
  aiCalls30d: Record<string, number>;
}

export interface QueueSuperAdminReadPort {
  aggregate(): Promise<PlatformAggregate>;
  salons(opts?: { search?: string; limit?: number }): Promise<SalonRow[]>;
  salonDetail(tenantId: string): Promise<SalonDetailRead>;
}

const EMPTY: PlatformAggregate = {
  salons: { using: 0, autoEnabled: 0, autoKilled: 0, entitled: 0 }, platformAutoActionsDisabled: false,
  recommendations: { total: 0, last30Days: 0 },
  decisions: { accepted: 0, rejected: 0, overridden: 0, kept_unassigned: 0, auto_assigned: 0, total: 0, acceptanceRate: null },
  alerts: { total: 0, open: 0, autoResolved: 0, openByType: {}, openBySeverity: {} },
  aiCalls: { success: 0, failed: 0, blocked_limit: 0, blocked_permission: 0, blocked_unpaid: 0, total: 0, other: 0 },
  jobs: { lastScanAt: null, lastAutoRunAt: null, branchesScannedLast10Min: 0 },
  auto: { tenantsEnabled: 0 }, tenantsWithSettings: 0,
};
const iso = (v: unknown): string | null => (v == null ? null : new Date(v as any).toISOString());

export class InMemoryQueueSuperAdminRead implements QueueSuperAdminReadPort {
  constructor(private readonly data: Partial<PlatformAggregate> = {}, private readonly rows: SalonRow[] = []) {}
  async aggregate(): Promise<PlatformAggregate> { return { ...EMPTY, ...this.data }; }
  async salons() { return this.rows; }
  async salonDetail(tenantId: string): Promise<SalonDetailRead> {
    const r = this.rows.find((x) => x.tenantId === tenantId);
    return { tenant: r ? { tenantId, name: r.name, status: r.status } : null, branches: [], openAlerts: [], alertsByType: {}, decisions30d: {}, aiCalls30d: {} };
  }
}

/** the effective auto switch of every active location: location value, else the salon value; off while the salon is killed */
const EFFECTIVE_AUTO = sql`
  select b.tenant_id, b.id as branch_id,
         coalesce(s.auto_enabled, ts.auto_enabled, false) and not coalesce(ts.auto_killed, false) as auto_on
    from branches b
    left join queue_assignment_settings s on s.tenant_id = b.tenant_id and s.branch_id = b.id
    left join queue_assignment_tenant_settings ts on ts.tenant_id = b.tenant_id
   where b.status = 'active'`;

export class KyselyQueueSuperAdminRead implements QueueSuperAdminReadPort {
  constructor(private readonly db: Kysely<any>) {}
  private async rows(q: any): Promise<any[]> { return ((await q.execute(this.db)) as any).rows ?? []; }
  private async group(q: any): Promise<Record<string, number>> { const out: Record<string, number> = {}; for (const r of await this.rows(q)) out[String(r.k)] = Number(r.n); return out; }

  async aggregate(): Promise<PlatformAggregate> {
    const [salons] = await this.rows(sql`
      with eff as (${EFFECTIVE_AUTO}),
      using_ as (select tenant_id from queue_assignment_tenant_settings union select tenant_id from queue_assignment_settings union select tenant_id from queue_assignment_recommendations)
      select (select count(distinct tenant_id) from using_)::int as using_,
             (select count(distinct tenant_id) from eff where auto_on)::int as auto_on,
             (select count(*) from queue_assignment_tenant_settings where auto_killed)::int as killed,
             (select count(distinct tenant_id) from tenant_ai_subscriptions where package_code = ${PACKAGE} and status in ('active','trialing'))::int as entitled`);
    const [rec] = await this.rows(sql`select count(*)::int as total, count(*) filter (where created_at > now() - interval '30 days')::int as recent from queue_assignment_recommendations`);
    const dec = await this.group(sql`select decision as k, count(*)::int as n from queue_assignment_decisions group by decision`);
    const [al] = await this.rows(sql`select count(*)::int as total, count(*) filter (where status <> 'resolved')::int as open, count(*) filter (where auto_resolved)::int as auto from queue_alerts`);
    const openByType = await this.group(sql`select type as k, count(*)::int as n from queue_alerts where status <> 'resolved' group by type`);
    const openBySeverity = await this.group(sql`select severity as k, count(*)::int as n from queue_alerts where status <> 'resolved' group by severity`);
    const calls = await this.group(sql`select status as k, count(*)::int as n from ai_usage_logs where package_code = ${PACKAGE} group by status`);
    const [jobs] = await this.rows(sql`select max(last_scan_at) as scan, max(last_auto_run_at) as auto, count(*) filter (where last_scan_at > now() - interval '10 minutes')::int as recent from queue_assignment_settings`);
    const platform = (await this.rows(sql`select value from platform_settings where setting_key = 'ai.auto_actions_disabled' limit 1`))[0];
    const n = (k: string) => dec[k] ?? 0;
    const staff = n('accepted') + n('rejected') + n('overridden') + n('kept_unassigned');
    const aiCalls: any = { total: 0, other: 0 };
    for (const s of AI_CALL_STATUSES) aiCalls[s] = calls[s] ?? 0;
    for (const [k, v] of Object.entries(calls)) { aiCalls.total += v; if (!(AI_CALL_STATUSES as readonly string[]).includes(k)) aiCalls.other += v; }
    const autoEnabled = Number(salons?.auto_on ?? 0);
    return {
      salons: { using: Number(salons?.using_ ?? 0), autoEnabled, autoKilled: Number(salons?.killed ?? 0), entitled: Number(salons?.entitled ?? 0) },
      platformAutoActionsDisabled: !!platform && (platform.value === true || platform.value === 'true'),
      recommendations: { total: Number(rec?.total ?? 0), last30Days: Number(rec?.recent ?? 0) },
      decisions: { accepted: n('accepted'), rejected: n('rejected'), overridden: n('overridden'), kept_unassigned: n('kept_unassigned'), auto_assigned: n('auto_assigned'),
        total: Object.values(dec).reduce((a, b) => a + b, 0), acceptanceRate: staff ? Math.round((n('accepted') / staff) * 1000) / 1000 : null },
      alerts: { total: Number(al?.total ?? 0), open: Number(al?.open ?? 0), autoResolved: Number(al?.auto ?? 0), openByType, openBySeverity },
      aiCalls, jobs: { lastScanAt: iso(jobs?.scan), lastAutoRunAt: iso(jobs?.auto), branchesScannedLast10Min: Number(jobs?.recent ?? 0) },
      auto: { tenantsEnabled: autoEnabled }, tenantsWithSettings: Number(salons?.using_ ?? 0),
    };
  }

  async salons(opts: { search?: string; limit?: number } = {}): Promise<SalonRow[]> {
    const search = (opts.search ?? '').trim().slice(0, 80);
    const r = await this.rows(sql`
      with eff as (${EFFECTIVE_AUTO}),
      salons as (
        select tenant_id from queue_assignment_tenant_settings union select tenant_id from queue_assignment_settings
        union select tenant_id from tenant_ai_subscriptions where package_code = ${PACKAGE} and status in ('active','trialing')
      )
      select t.id, coalesce(t.display_name, t.legal_name) as name, t.status,
             (select count(*) from branches b where b.tenant_id = t.id and b.status = 'active')::int as branches,
             (select count(*) from eff where eff.tenant_id = t.id and eff.auto_on)::int as auto_on,
             coalesce(ts.auto_killed, false) as killed, ts.auto_killed_reason,
             (select count(*) from queue_alerts a where a.tenant_id = t.id and a.status <> 'resolved')::int as open_alerts,
             (select count(*) from queue_alerts a where a.tenant_id = t.id and a.status <> 'resolved' and a.severity = 'critical')::int as critical,
             (select count(*) from queue_assignment_decisions d where d.tenant_id = t.id and d.created_at > now() - interval '30 days' and d.decision <> 'auto_assigned')::int as decisions,
             (select count(*) from queue_assignment_decisions d where d.tenant_id = t.id and d.created_at > now() - interval '30 days' and d.decision = 'auto_assigned')::int as auto_assigned,
             (select max(last_scan_at) from queue_assignment_settings s where s.tenant_id = t.id) as last_scan,
             (select max(last_auto_run_at) from queue_assignment_settings s where s.tenant_id = t.id) as last_auto
        from tenants t join salons x on x.tenant_id = t.id
        left join queue_assignment_tenant_settings ts on ts.tenant_id = t.id
       where ${search ? sql`(t.display_name ilike ${'%' + search + '%'} or t.legal_name ilike ${'%' + search + '%'})` : sql`true`}
       order by open_alerts desc, name limit ${Math.max(1, Math.min(500, opts.limit ?? 200))}`);
    return r.map((x) => ({ tenantId: String(x.id), name: String(x.name), status: String(x.status), branches: Number(x.branches), branchesAutoOn: Number(x.auto_on), autoKilled: !!x.killed,
      autoKilledReason: x.auto_killed_reason ?? null, openAlerts: Number(x.open_alerts), criticalAlerts: Number(x.critical), decisions30d: Number(x.decisions), autoAssigned30d: Number(x.auto_assigned),
      lastScanAt: iso(x.last_scan), lastAutoRunAt: iso(x.last_auto) }));
  }

  async salonDetail(tenantId: string): Promise<SalonDetailRead> {
    const t = (await this.rows(sql`select id, coalesce(display_name, legal_name) as name, status from tenants where id = ${tenantId}`))[0];
    if (!t) return { tenant: null, branches: [], openAlerts: [], alertsByType: {}, decisions30d: {}, aiCalls30d: {} };
    const branches = await this.rows(sql`select b.id, b.name, b.status, s.last_scan_at, s.last_auto_run_at,
                                                (select count(*) from queue_alerts a where a.tenant_id = b.tenant_id and a.branch_id = b.id and a.status <> 'resolved')::int as open
                                           from branches b left join queue_assignment_settings s on s.tenant_id = b.tenant_id and s.branch_id = b.id
                                          where b.tenant_id = ${tenantId} and b.deleted_at is null order by b.name`);
    const open = await this.rows(sql`select id, branch_id, type, severity, reason, age_minutes, created_at, auto_resolved from queue_alerts
                                      where tenant_id = ${tenantId} and status <> 'resolved' order by created_at desc limit 50`);
    return {
      tenant: { tenantId: String(t.id), name: String(t.name), status: String(t.status) },
      branches: branches.map((b) => ({ branchId: String(b.id), name: String(b.name), status: String(b.status), openAlerts: Number(b.open), lastScanAt: iso(b.last_scan_at), lastAutoRunAt: iso(b.last_auto_run_at) })),
      openAlerts: open.map((a) => ({ id: String(a.id), branchId: String(a.branch_id), type: a.type, severity: a.severity, reason: a.reason, ageMinutes: Number(a.age_minutes), createdAt: iso(a.created_at)!, autoResolved: !!a.auto_resolved })),
      alertsByType: await this.group(sql`select type as k, count(*)::int as n from queue_alerts where tenant_id = ${tenantId} and status <> 'resolved' group by type`),
      decisions30d: await this.group(sql`select decision as k, count(*)::int as n from queue_assignment_decisions where tenant_id = ${tenantId} and created_at > now() - interval '30 days' group by decision`),
      aiCalls30d: await this.group(sql`select status as k, count(*)::int as n from ai_usage_logs where tenant_id = ${tenantId} and package_code = ${PACKAGE} and created_at > now() - interval '30 days' group by status`),
    };
  }
}
