// super-admin-ai-scheduling-optimizer.repository.ts — BUILD_PLAN Phase 7 (agent B): platform oversight reads + the two
// platform writes (the platform kill switch, the audit row) for the AI Scheduling Optimizer. CROSS-TENANT BY DESIGN —
// reached only behind SuperAdminGuard (super-admin/ai-scheduling-optimizer). No customer, appointment or technician data:
// counts, statuses, error codes and ids only.
import { sql, type Kysely } from 'kysely';
import type { SaSchedTenantRow } from '@aipowersalon/api-contracts/platform';
import type { SupportSessionRow } from './super-admin-ai-scheduling-optimizer-core';

export const SCHED_PACKAGE = 'ai_scheduling_optimizer';
export const SCHED_PLATFORM_SETTING = 'ai.scheduling_optimizer_disabled';
const rowsOf = (r: any): any[] => (r && Array.isArray(r.rows) ? r.rows : []);
const iso = (v: unknown): string | null => (v == null ? null : new Date(v as any).toISOString());

export interface SaOverviewCounts {
  enabledTenants: number; killedTenants: number; platformKilled: boolean;
  runs: { status: string; n: number }[]; runsLast24h: number;
  recommendations: { status: string; automated: boolean; n: number }[];
  proposals: { status: string; n: number }[];
  conflictsOpen: number; understaffingOpen: number;
  explanations: { source: string | null; n: number }[]; llmCostMicroUsd30d: number;
}
export interface SaTenantDetailRead {
  exists: boolean;
  settings: { enabled: boolean; killed: boolean; automationEnabled: boolean; allowedAutoActions: number; version: number };
  runs: { id: string; scope: string; status: string; startedAt: string; errorCode: string | null }[];
  failedApplications: { recommendationId: string; status: string; errorCode: string | null; attempt: number; updatedAt: string }[];
  recommendationsByStatus: Record<string, number>;
}
export interface SaSchedRead {
  overview(): Promise<SaOverviewCounts>;
  tenants(opts: { search?: string; limit: number }): Promise<SaSchedTenantRow[]>;
  supportSessions(tenantId: string, adminUserId: string): Promise<SupportSessionRow[]>;
  detail(tenantId: string): Promise<SaTenantDetailRead>;
  recommendation(tenantId: string, id: string): Promise<{ id: string; status: string; version: number } | null>;
  platformKilled(): Promise<boolean>;
  setPlatformKilled(actorUserId: string | null, killed: boolean, reason: string): Promise<void>;
  audit(row: { tenantId: string | null; userId: string | null; action: string; entityType: string; entityId: string | null; metadata: Record<string, unknown> }): Promise<void>;
}

export class KyselySaSchedRead implements SaSchedRead {
  constructor(private readonly db: Kysely<any>) {}
  private async one(q: any): Promise<number> { return Number(rowsOf(await q.execute(this.db))[0]?.n ?? 0); }

  async platformKilled(): Promise<boolean> {
    const r = rowsOf(await sql`select value from platform_settings where setting_key = ${SCHED_PLATFORM_SETTING} limit 1`.execute(this.db))[0];
    return !!r && (r.value === true || r.value === 'true');
  }

  async overview(): Promise<SaOverviewCounts> {
    const [enabledTenants, killedTenants, platformKilled, runs, runsLast24h, recommendations, proposals, conflictsOpen, understaffingOpen, explanations, llmCostMicroUsd30d] = await Promise.all([
      this.one(sql`select count(*)::int as n from tenants t
                    where t.status = 'active'
                      and exists (select 1 from tenant_ai_subscriptions s where s.tenant_id = t.id and s.package_code = ${SCHED_PACKAGE} and s.status in ('active','trialing'))
                      and not exists (select 1 from tenant_scheduling_ai_settings x where x.tenant_id = t.id and x.level = 'tenant' and x.enabled = false)`),
      this.one(sql`select count(distinct tenant_id)::int as n from tenant_scheduling_ai_settings where level = 'tenant' and kill_switch = true`),
      this.platformKilled(),
      sql`select status, count(*)::int as n from schedule_optimization_runs group by status`.execute(this.db).then(rowsOf),
      this.one(sql`select count(*)::int as n from schedule_optimization_runs where started_at > now() - interval '24 hours'`),
      sql`select status, automated, count(*)::int as n from schedule_optimization_recommendations group by status, automated`.execute(this.db).then(rowsOf),
      sql`select status, count(*)::int as n from schedule_change_proposals group by status`.execute(this.db).then(rowsOf),
      this.one(sql`select count(*)::int as n from schedule_conflicts where not resolved and type not ilike '%understaff%'`),
      this.one(sql`select count(*)::int as n from schedule_conflicts where not resolved and type ilike '%understaff%'`),
      sql`select explanation_source as source, count(*)::int as n from schedule_optimization_recommendations where explanation_source is not null group by explanation_source`.execute(this.db).then(rowsOf),
      this.one(sql`select coalesce(sum(cost_micro_usd), 0)::bigint as n from ai_usage_logs where package_code = ${SCHED_PACKAGE} and created_at > now() - interval '30 days'`),
    ]);
    return {
      enabledTenants, killedTenants, platformKilled, runsLast24h, conflictsOpen, understaffingOpen, llmCostMicroUsd30d,
      runs: runs.map((r: any) => ({ status: String(r.status), n: Number(r.n) })),
      recommendations: recommendations.map((r: any) => ({ status: String(r.status), automated: !!r.automated, n: Number(r.n) })),
      proposals: proposals.map((r: any) => ({ status: String(r.status), n: Number(r.n) })),
      explanations: explanations.map((r: any) => ({ source: r.source ?? null, n: Number(r.n) })),
    };
  }

  async tenants(opts: { search?: string; limit: number }): Promise<SaSchedTenantRow[]> {
    const q = opts.search ? `%${opts.search.trim().slice(0, 80)}%` : null;
    const rows = rowsOf(await sql`
      select t.id, t.display_name,
             coalesce(s.enabled, true) as enabled, coalesce(s.kill_switch, false) as killed,
             (select count(*)::int from schedule_optimization_runs ru where ru.tenant_id = t.id and ru.started_at > now() - interval '30 days') as runs30d,
             (select count(*)::int from schedule_optimization_recommendations rc where rc.tenant_id = t.id and rc.applied_at > now() - interval '30 days') as applied30d,
             (select count(*)::int from schedule_change_applications ap where ap.tenant_id = t.id and ap.status = 'failed' and ap.created_at > now() - interval '30 days') as failed30d,
             (select max(ru.started_at) from schedule_optimization_runs ru where ru.tenant_id = t.id) as last_run_at
        from tenants t
        left join tenant_scheduling_ai_settings s on s.tenant_id = t.id and s.level = 'tenant'
       where (exists (select 1 from tenant_ai_subscriptions sub where sub.tenant_id = t.id and sub.package_code = ${SCHED_PACKAGE})
              or s.id is not null
              or exists (select 1 from schedule_optimization_runs ru where ru.tenant_id = t.id))
         and (${q}::text is null or t.display_name ilike ${q}::text or t.tenant_code ilike ${q}::text)
       order by last_run_at desc nulls last, t.display_name
       limit ${opts.limit}`.execute(this.db));
    return rows.map((r) => ({ tenantId: String(r.id), tenantName: String(r.display_name ?? ''), enabled: r.enabled !== false, killed: !!r.killed,
      runs30d: Number(r.runs30d ?? 0), applied30d: Number(r.applied30d ?? 0), failed30d: Number(r.failed30d ?? 0), lastRunAt: iso(r.last_run_at) }));
  }

  async supportSessions(tenantId: string, adminUserId: string): Promise<SupportSessionRow[]> {
    return rowsOf(await sql`select id, tenant_id, admin_user_id, ended_at, expires_at from support_access_sessions
                             where tenant_id = ${tenantId} and admin_user_id = ${adminUserId} and ended_at is null and expires_at > now()
                             order by started_at desc limit 5`.execute(this.db)) as SupportSessionRow[];
  }

  async detail(tenantId: string): Promise<SaTenantDetailRead> {
    const t = rowsOf(await sql`select id from tenants where id = ${tenantId}`.execute(this.db))[0];
    const s = rowsOf(await sql`select enabled, kill_switch, config, version from tenant_scheduling_ai_settings where tenant_id = ${tenantId} and level = 'tenant' limit 1`.execute(this.db))[0];
    const runs = rowsOf(await sql`select id, scope, status, started_at, error_code from schedule_optimization_runs where tenant_id = ${tenantId} order by started_at desc limit 20`.execute(this.db));
    const failed = rowsOf(await sql`select rc.id, rc.status, rc.apply_attempt, rc.updated_at,
                                           (select ap.error_code from schedule_change_applications ap where ap.tenant_id = rc.tenant_id and ap.recommendation_id = rc.id order by ap.created_at desc limit 1) as error_code
                                      from schedule_optimization_recommendations rc
                                     where rc.tenant_id = ${tenantId} and rc.status = 'application_failed' order by rc.updated_at desc limit 50`.execute(this.db));
    const by = rowsOf(await sql`select status, count(*)::int as n from schedule_optimization_recommendations where tenant_id = ${tenantId} group by status`.execute(this.db));
    const cfg = s?.config && typeof s.config === 'object' ? s.config : {};
    const recommendationsByStatus: Record<string, number> = {};
    for (const r of by) recommendationsByStatus[String(r.status)] = Number(r.n);
    return {
      exists: !!t,
      settings: { enabled: s?.enabled !== false, killed: !!s?.kill_switch, automationEnabled: cfg.automationEnabled === true, allowedAutoActions: Array.isArray(cfg.allowedAutoActions) ? cfg.allowedAutoActions.length : 0, version: Number(s?.version ?? 0) },
      runs: runs.map((r) => ({ id: String(r.id), scope: String(r.scope), status: String(r.status), startedAt: iso(r.started_at) ?? '', errorCode: r.error_code ?? null })),
      failedApplications: failed.map((r) => ({ recommendationId: String(r.id), status: String(r.status), errorCode: r.error_code ?? null, attempt: Number(r.apply_attempt ?? 0), updatedAt: iso(r.updated_at) ?? '' })),
      recommendationsByStatus,
    };
  }

  async recommendation(tenantId: string, id: string) {
    const r = rowsOf(await sql`select id, status, version from schedule_optimization_recommendations where tenant_id = ${tenantId} and id = ${id}`.execute(this.db))[0];
    return r ? { id: String(r.id), status: String(r.status), version: Number(r.version) } : null;
  }

  /** The platform switch: setting + immutable history + audit, one transaction (the kill-switch centre's pattern). */
  async setPlatformKilled(actorUserId: string | null, killed: boolean, reason: string): Promise<void> {
    await this.db.transaction().execute(async (trx) => {
      const prev = rowsOf(await sql`select value, version from platform_settings where setting_key = ${SCHED_PLATFORM_SETTING} for update`.execute(trx))[0];
      await sql`insert into platform_settings (setting_key, setting_group, value, value_type, version)
                values (${SCHED_PLATFORM_SETTING}, 'kill_switches', ${JSON.stringify(killed)}::jsonb, 'boolean', 1)
                on conflict (setting_key) do update set value = excluded.value, version = platform_settings.version + 1, updated_at = now()`.execute(trx);
      await sql`insert into platform_setting_changes (setting_key, setting_group, previous_value, new_value, version, actor, actor_role, reason, source)
                values (${SCHED_PLATFORM_SETTING}, 'kill_switches', ${prev ? JSON.stringify(prev.value) : null}::jsonb, ${JSON.stringify(killed)}::jsonb,
                        ${Number(prev?.version ?? 0) + 1}, ${actorUserId}, 'SUPER_ADMIN', ${reason}, 'ui')`.execute(trx);
      await sql`insert into audit_logs (user_id, role, action_type, entity_type, entity_id, metadata_json)
                values (${actorUserId}, 'SUPER_ADMIN', ${killed ? 'super_admin_ai_scheduling_platform_killed' : 'super_admin_ai_scheduling_platform_released'}, 'platform_setting', ${SCHED_PLATFORM_SETTING},
                        ${JSON.stringify({ killed, reason })}::jsonb)`.execute(trx);
    });
  }

  async audit(row: { tenantId: string | null; userId: string | null; action: string; entityType: string; entityId: string | null; metadata: Record<string, unknown> }): Promise<void> {
    await sql`insert into audit_logs (tenant_id, user_id, role, action_type, entity_type, entity_id, metadata_json)
              values (${row.tenantId}, ${row.userId}, 'SUPER_ADMIN', ${row.action}, ${row.entityType}, ${row.entityId}, ${JSON.stringify(row.metadata)}::jsonb)`.execute(this.db);
  }
}
