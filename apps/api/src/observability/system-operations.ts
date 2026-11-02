// system-operations.ts — Constitution 11 §140–156, §290, §330–333, §390: the Super Admin System Operations API.
//
// READS PERSISTED STATE, NOT ONE PROCESS. With several API instances, the instance answering a Super Admin request
// is not necessarily the one whose aggregator last ran, and its in-memory registry holds only its own traffic. So
// everything here reads what the aggregator persisted — status_components, system_health_snapshots, alerts — and the
// per-minute request table every instance writes. The page shows the platform, not whichever box answered.
//
// NO FAKE GREEN (§332–333). A computed component whose expires_at has passed is shown UNKNOWN whatever its stored
// status says, and the payload carries `stale: true` so the screen can say "health data is stale — the aggregator
// may have stopped". The overall status is rolled up from those EFFECTIVE statuses with the same rule the aggregator
// uses (health-core.rollup), so the page and the alerts can never disagree about what "overall" means.
//
// NOT HERE, AND SAID SO: request lookup and correlation search (§291–292) need a log store to search. Logs go to
// stdout for the platform's log service; nothing in this codebase indexes them, and §182 forbids handing the browser
// monitoring-vendor credentials. Those endpoints are left unbuilt rather than faked; the final report lists them.
import { SuperAdminGuard, RequirePermission } from '@aipowersalon/permissions/guards';
import { Controller, Get, Inject, Injectable, NotFoundException, Optional, Param, UseGuards } from '@nestjs/common';
import { sql } from 'kysely';
import { DATABASE } from '@aipowersalon/database';
import { COMPONENTS, rollup, type Criticality, type HealthStatus } from './health-core';
import { readAllSlos } from './slo-reader';
import type { SloReport } from './slo-core';
import { readSloValidations, type SloValidationView } from './slo-validation';   // BUILD_PLAN Phase 14 C (§80)
import { BUILD, type BuildInfo } from '@aipowersalon/observability';

/** The status page's vocabulary back to the health model, for the rollup. */
export function fromStatusPage(s: string): HealthStatus {
  switch (s) {
    case 'operational': return 'HEALTHY';
    case 'degraded': return 'DEGRADED';
    case 'partial_outage': case 'major_outage': return 'OUTAGE';
    case 'maintenance': return 'MAINTENANCE';
    default: return 'UNKNOWN';
  }
}

export interface ComponentCard {
  key: string; name: string; criticality: Criticality; owner: string | null; runbook: string | null;
  status: HealthStatus; storedStatus: string; source: string; reason: string | null;
  computedAt: string | null; expiresAt: string | null; stale: boolean; lastChangeAt: string | null;
}
export interface Overview {
  generatedAt: string; overall: HealthStatus; stale: boolean; build: BuildInfo; components: ComponentCard[];
  alerts: { open: number; bySeverity: Record<string, number>; recent: Array<{ id: string; title: string; severity: string; status: string; component: string; createdAt: string }> };
  slos: SloReport[];
  /** §80: each SLO's verdict from persisted production data (proposed until enough days exist). */
  sloValidations: SloValidationView[];
}

/**
 * Pure: turns persisted rows into cards and an overall status. Exported for tests.
 * A computed row past its expiry is UNKNOWN (§333). A MANUAL maintenance row has no expiry and stays MAINTENANCE.
 */
export function buildCards(rows: any[], lastChanges: Record<string, string>, now: Date): { cards: ComponentCard[]; overall: HealthStatus; stale: boolean } {
  const byKey = new Map(rows.map((r) => [r.key, r]));
  let stale = false;
  const cards: ComponentCard[] = COMPONENTS.map((def) => {
    const r = byKey.get(def.key);
    if (!r) return { key: def.key, name: def.name, criticality: def.criticality, owner: def.owner, runbook: def.runbook, status: 'UNKNOWN', storedStatus: 'missing',
      source: 'none', reason: 'never_computed', computedAt: null, expiresAt: null, stale: true, lastChangeAt: null };
    const expired = r.status_source === 'computed' && r.expires_at !== null && new Date(r.expires_at).getTime() < now.getTime();
    if (expired) stale = true;
    return {
      key: def.key, name: r.name ?? def.name, criticality: def.criticality, owner: r.owner_team ?? def.owner, runbook: r.runbook ?? def.runbook,
      status: expired ? 'UNKNOWN' : fromStatusPage(r.status), storedStatus: r.status, source: r.status_source, reason: expired ? 'stale' : r.reason_code,
      computedAt: r.computed_at ? new Date(r.computed_at).toISOString() : null, expiresAt: r.expires_at ? new Date(r.expires_at).toISOString() : null,
      stale: expired, lastChangeAt: lastChanges[def.key] ?? null,
    };
  });
  const overall = rollup(cards.map((c) => ({ key: c.key, status: c.status, criticality: c.criticality, availability: COMPONENTS.find((d) => d.key === c.key)?.availability })));
  return { cards, overall, stale };
}

@Injectable()
export class SystemOperationsService {
  constructor(@Optional() @Inject(DATABASE) private readonly db: any) {}

  async overview(now = new Date()): Promise<Overview> {
    if (!this.db) return { generatedAt: now.toISOString(), overall: 'UNKNOWN', stale: true, build: BUILD, components: buildCards([], {}, now).cards, alerts: { open: 0, bySeverity: {}, recent: [] }, slos: [], sloValidations: [] };
    const keys = COMPONENTS.map((c) => c.key);
    const rows = (await sql`select key, name, status, status_source, reason_code, criticality, runbook, owner_team, computed_at, expires_at
                            from status_components where key in (${sql.join(keys.map((k) => sql`${k}`))})`.execute(this.db)).rows;
    const changes = (await sql<{ component_key: string; at: Date }>`select component_key, max(observed_at) at from system_health_snapshots group by component_key`.execute(this.db)).rows;
    const lastChanges = Object.fromEntries(changes.map((c) => [c.component_key, new Date(c.at).toISOString()]));
    const { cards, overall, stale } = buildCards(rows, lastChanges, now);
    const openRows = (await sql<any>`select id, title, severity, status, related_record_id, created_at from alerts
                                     where tenant_id is null and related_module = 'system_health' and status in ('unread', 'read')
                                     order by case severity when 'critical' then 0 when 'high' then 1 when 'medium' then 2 else 3 end, created_at desc`.execute(this.db)).rows;
    const bySeverity: Record<string, number> = {};
    for (const a of openRows) bySeverity[a.severity] = (bySeverity[a.severity] ?? 0) + 1;
    let slos: SloReport[] = [];
    try { slos = await readAllSlos(this.db, now); } catch { slos = []; }
    let sloValidations: SloValidationView[] = [];
    try { sloValidations = await readSloValidations(this.db); } catch { sloValidations = []; }
    return {
      generatedAt: now.toISOString(), overall, stale, build: BUILD, components: cards, slos, sloValidations,
      alerts: { open: openRows.length, bySeverity, recent: openRows.slice(0, 10).map((a: any) => ({ id: a.id, title: a.title, severity: a.severity, status: a.status, component: a.related_record_id, createdAt: new Date(a.created_at).toISOString() })) },
    };
  }

  /** §390–391: status changes over the last 30 days — the "degraded from 2:00 to 2:35" timeline. */
  async history(key: string, now = new Date()) {
    if (!COMPONENTS.some((c) => c.key === key)) throw new NotFoundException('Unknown component');
    if (!this.db) return { component: key, changes: [] };
    const since = new Date(now.getTime() - 30 * 86_400_000);
    const r = await sql<any>`select status, previous, reason_code, summary, observed_at from system_health_snapshots
                             where component_key = ${key} and observed_at >= ${since} order by observed_at desc limit 500`.execute(this.db);
    return { component: key, changes: r.rows.map((x: any) => ({ status: x.status, previous: x.previous, reason: x.reason_code, summary: x.summary, at: new Date(x.observed_at).toISOString() })) };
  }

  /** §143: top failing and slowest routes over the last hour, across every instance. Route TEMPLATES only. */
  async api(now = new Date()) {
    if (!this.db) return { windowMinutes: 60, failing: [], slowest: [] };
    const since = new Date(now.getTime() - 3_600_000);
    const failing = (await sql<any>`select method, route, sum(count)::bigint total, sum(count) filter (where status_class = 5)::bigint server_errors
        from platform_request_metrics_minute where bucket_minute >= ${since} group by method, route
        having coalesce(sum(count) filter (where status_class = 5), 0) > 0 order by server_errors desc limit 10`.execute(this.db)).rows;
    const slowest = (await sql<any>`select method, route, sum(count)::bigint total, (sum(sum_ms)::float8 / nullif(sum(count), 0)) avg_ms, max(max_ms) max_ms
        from platform_request_metrics_minute where bucket_minute >= ${since} group by method, route having sum(count) >= 10
        order by avg_ms desc nulls last limit 10`.execute(this.db)).rows;
    return {
      windowMinutes: 60,
      failing: failing.map((r: any) => ({ method: r.method, route: r.route, total: Number(r.total), serverErrors: Number(r.server_errors ?? 0) })),
      slowest: slowest.map((r: any) => ({ method: r.method, route: r.route, total: Number(r.total), avgMs: Math.round(Number(r.avg_ms)), maxMs: Number(r.max_ms) })),
    };
  }
}

@UseGuards(SuperAdminGuard)
@Controller('super-admin/system')
export class SystemOperationsController {
  constructor(private readonly svc: SystemOperationsService) {}
  @Get('overview') @RequirePermission('super_admin.system_operations.view') overview() { return this.svc.overview(); }
  @Get('api') @RequirePermission('super_admin.system_operations.view') api() { return this.svc.api(); }
  @Get('components/:key/history') @RequirePermission('super_admin.system_operations.view') history(@Param('key') key: string) { return this.svc.history(key); }
}
