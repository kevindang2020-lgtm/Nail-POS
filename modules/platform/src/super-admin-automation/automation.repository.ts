// automation.repository.ts — READ-ONLY raw aggregates for the Automation Rules dashboard, over the engine tables joined
// to tenants. Tenant-scoped via the shared helpers. Production KPIs exclude is_test executions. Empty DB → empty bundle.
import { type DB, tenantPred, type OverviewScope } from '@aipowersalon/database';
import { Kysely, sql } from 'kysely';

export interface AutoKpisRaw { activeRules: number; executionsToday: number; successfulToday: number; failedToday: number; disabledRules: number; exceptionsActive: number; notificationsToday: number; avgDurationMs: number }
export interface DayCount { day: string; count: number }
export interface DaySuccessFail { day: string; success: number; failed: number }
export interface KeyCount { key: string; count: number }
export interface TopRuleRaw { id: string; name: string; triggerId: string; triggerCategory: string; ruleType: string; status: string; scopeKind: string; tenantName: string | null; executions: number; successes: number }
export interface ExecRow { id: string; startedAt: string; ruleName: string | null; tenantName: string | null; branchId: string | null; status: string; durationMs: number | null; triggeredBy: string }
export interface FailureRow { id: string; ruleName: string | null; tenantName: string | null; failureReason: string; severity: string; status: string; failureCategory: string; lastAttemptAt: string | null }
export interface ExceptionRow { id: string; tenantName: string | null; ruleName: string | null; exceptionType: string; notes: string | null; status: string }
export interface UpcomingRow { id: string; ruleName: string; triggerCategory: string; ruleType: string; status: string; nextEvaluationAt: string; tenantName: string | null }
export interface TenantPerfRow { tenantId: string; tenantName: string | null; total: number; success: number; failed: number }

export interface AutomationDashboardData {
  kpis: AutoKpisRaw;
  executionTrend: DayCount[];
  successVsFailed: DaySuccessFail[];
  byTrigger: KeyCount[]; byStatus: KeyCount[]; byType: KeyCount[];
  topRules: TopRuleRaw[]; executionHistory: ExecRow[]; failures: FailureRow[]; exceptions: ExceptionRow[];
  recentActivity: ExecRow[]; upcoming: UpcomingRow[]; tenantPerf: TenantPerfRow[];
  totalRules: number;
}

const n = (v: unknown): number => (v == null ? 0 : Number(v) || 0);
const EMPTY: AutomationDashboardData = {
  kpis: { activeRules: 0, executionsToday: 0, successfulToday: 0, failedToday: 0, disabledRules: 0, exceptionsActive: 0, notificationsToday: 0, avgDurationMs: 0 },
  executionTrend: [], successVsFailed: [], byTrigger: [], byStatus: [], byType: [], topRules: [], executionHistory: [], failures: [], exceptions: [], recentActivity: [], upcoming: [], tenantPerf: [], totalRules: 0,
};

// Success = success|partial ; Failed = failed|timed_out (documented; skipped/suppressed/cancelled excluded from both).
const SUCCESS_SQL = sql`e.status in ('success','partial')`;
const FAILED_SQL = sql`e.status in ('failed','timed_out')`;

export class AutomationRepository {
  constructor(private readonly db: Kysely<DB> | null) {}

  async dashboardData(scope?: OverviewScope): Promise<AutomationDashboardData> {
    if (!this.db) return EMPTY;

    const kpisP = sql<any>`
      select
        (select count(*) from automation_rules r where r.status = 'active' and ${tenantPred(scope, 'r.tenant_id')})::int as active_rules,
        (select count(*) from automation_executions e where e.is_test = false and e.started_at >= date_trunc('day', now()) and ${tenantPred(scope, 'e.tenant_id')})::int as exec_today,
        (select count(*) from automation_executions e where e.is_test = false and e.started_at >= date_trunc('day', now()) and ${SUCCESS_SQL} and ${tenantPred(scope, 'e.tenant_id')})::int as success_today,
        (select count(*) from automation_executions e where e.is_test = false and e.started_at >= date_trunc('day', now()) and ${FAILED_SQL} and ${tenantPred(scope, 'e.tenant_id')})::int as failed_today,
        (select count(*) from automation_rules r where r.status = 'disabled' and ${tenantPred(scope, 'r.tenant_id')})::int as disabled_rules,
        (select count(*) from automation_exceptions x where x.status = 'active' and ${tenantPred(scope, 'x.tenant_id')})::int as exceptions_active,
        (select coalesce(sum(notifications_sent),0) from automation_executions e where e.is_test = false and e.started_at >= date_trunc('day', now()) and ${tenantPred(scope, 'e.tenant_id')})::int as notifications_today,
        (select coalesce(avg(duration_ms),0) from automation_executions e where e.is_test = false and e.completed_at is not null and e.started_at >= date_trunc('day', now()) and ${tenantPred(scope, 'e.tenant_id')})::int as avg_ms`.execute(this.db);

    const trendP = sql<any>`
      select to_char(date_trunc('day', started_at),'YYYY-MM-DD') as day, count(*)::int as count
      from automation_executions e where is_test = false and started_at >= now() - interval '7 days' and ${tenantPred(scope, 'e.tenant_id')}
      group by 1 order by 1`.execute(this.db);

    const svfP = sql<any>`
      select to_char(date_trunc('day', started_at),'YYYY-MM-DD') as day,
             count(*) filter (where ${SUCCESS_SQL})::int as success,
             count(*) filter (where ${FAILED_SQL})::int as failed
      from automation_executions e where is_test = false and started_at >= now() - interval '7 days' and ${tenantPred(scope, 'e.tenant_id')}
      group by 1 order by 1`.execute(this.db);

    const byTriggerP = sql<any>`select trigger_category as key, count(*)::int as count from automation_rules r where ${tenantPred(scope, 'r.tenant_id')} group by 1`.execute(this.db);
    const byStatusP = sql<any>`select status as key, count(*)::int as count from automation_rules r where ${tenantPred(scope, 'r.tenant_id')} group by 1`.execute(this.db);
    const byTypeP = sql<any>`select rule_type as key, count(*)::int as count from automation_rules r where ${tenantPred(scope, 'r.tenant_id')} group by 1`.execute(this.db);
    const totalRulesP = sql<any>`select count(*)::int c from automation_rules r where ${tenantPred(scope, 'r.tenant_id')}`.execute(this.db);

    const topP = sql<any>`
      select r.id, r.name, r.trigger_id, r.trigger_category, r.rule_type, r.status, r.scope_kind, t.display_name as tenant_name,
             (select count(*) from automation_executions e where e.rule_id = r.id and e.is_test = false)::int as executions,
             (select count(*) from automation_executions e where e.rule_id = r.id and e.is_test = false and ${SUCCESS_SQL})::int as successes
      from automation_rules r left join tenants t on t.id = r.tenant_id
      where ${tenantPred(scope, 'r.tenant_id')}
      order by executions desc, r.created_at desc limit 10`.execute(this.db);

    const histP = sql<any>`
      select e.id, to_char(e.started_at,'YYYY-MM-DD"T"HH24:MI:SSZ') as started_at, r.name as rule_name, t.display_name as tenant_name, e.branch_id, e.status, e.duration_ms, e.triggered_by
      from automation_executions e left join automation_rules r on r.id = e.rule_id left join tenants t on t.id = e.tenant_id
      where e.is_test = false and ${tenantPred(scope, 'e.tenant_id')} order by e.started_at desc limit 12`.execute(this.db);

    const failP = sql<any>`
      select f.id, r.name as rule_name, t.display_name as tenant_name, f.failure_reason, f.severity, f.status, f.failure_category, to_char(f.last_attempt_at,'YYYY-MM-DD"T"HH24:MI:SSZ') as last_attempt_at
      from automation_failures f left join automation_rules r on r.id = f.rule_id left join tenants t on t.id = f.tenant_id
      where f.status in ('waiting','retrying') and ${tenantPred(scope, 'f.tenant_id')} order by f.created_at desc limit 12`.execute(this.db);

    const excP = sql<any>`
      select x.id, t.display_name as tenant_name, r.name as rule_name, x.exception_type, x.notes, x.status
      from automation_exceptions x left join automation_rules r on r.id = x.rule_id left join tenants t on t.id = x.tenant_id
      where x.status = 'active' and ${tenantPred(scope, 'x.tenant_id')} order by x.created_at desc limit 12`.execute(this.db);

    const upcomingP = sql<any>`
      select r.id, r.name as rule_name, r.trigger_category, r.rule_type, r.status, to_char(r.next_evaluation_at,'YYYY-MM-DD"T"HH24:MI:SSZ') as next_eval, t.display_name as tenant_name
      from automation_rules r left join tenants t on t.id = r.tenant_id
      where r.next_evaluation_at is not null and r.status = 'active' and ${tenantPred(scope, 'r.tenant_id')} order by r.next_evaluation_at asc limit 8`.execute(this.db);

    const perfP = sql<any>`
      select e.tenant_id, t.display_name as tenant_name, count(*)::int as total,
             count(*) filter (where ${SUCCESS_SQL})::int as success, count(*) filter (where ${FAILED_SQL})::int as failed
      from automation_executions e left join tenants t on t.id = e.tenant_id
      where e.is_test = false and e.tenant_id is not null and ${tenantPred(scope, 'e.tenant_id')}
      group by 1,2 order by total desc limit 5`.execute(this.db);

    const [kpis, trend, svf, byTrigger, byStatus, byType, totalRules, top, hist, fail, exc, upcoming, perf] =
      await Promise.all([kpisP, trendP, svfP, byTriggerP, byStatusP, byTypeP, totalRulesP, topP, histP, failP, excP, upcomingP, perfP]);

    const kr = kpis.rows[0] ?? {};
    const mapExec = (x: any): ExecRow => ({ id: String(x.id), startedAt: String(x.started_at), ruleName: x.rule_name ?? null, tenantName: x.tenant_name ?? null, branchId: x.branch_id ? String(x.branch_id) : null, status: x.status, durationMs: x.duration_ms == null ? null : n(x.duration_ms), triggeredBy: x.triggered_by });
    return {
      kpis: { activeRules: n(kr.active_rules), executionsToday: n(kr.exec_today), successfulToday: n(kr.success_today), failedToday: n(kr.failed_today), disabledRules: n(kr.disabled_rules), exceptionsActive: n(kr.exceptions_active), notificationsToday: n(kr.notifications_today), avgDurationMs: n(kr.avg_ms) },
      executionTrend: trend.rows.map((r: any) => ({ day: String(r.day), count: n(r.count) })),
      successVsFailed: svf.rows.map((r: any) => ({ day: String(r.day), success: n(r.success), failed: n(r.failed) })),
      byTrigger: byTrigger.rows.map((r: any) => ({ key: String(r.key), count: n(r.count) })),
      byStatus: byStatus.rows.map((r: any) => ({ key: String(r.key), count: n(r.count) })),
      byType: byType.rows.map((r: any) => ({ key: String(r.key), count: n(r.count) })),
      totalRules: n(totalRules.rows[0]?.c),
      topRules: top.rows.map((r: any) => ({ id: String(r.id), name: r.name, triggerId: r.trigger_id, triggerCategory: r.trigger_category, ruleType: r.rule_type, status: r.status, scopeKind: r.scope_kind, tenantName: r.tenant_name ?? null, executions: n(r.executions), successes: n(r.successes) })),
      executionHistory: hist.rows.map(mapExec),
      failures: fail.rows.map((r: any) => ({ id: String(r.id), ruleName: r.rule_name ?? null, tenantName: r.tenant_name ?? null, failureReason: r.failure_reason, severity: r.severity, status: r.status, failureCategory: r.failure_category, lastAttemptAt: r.last_attempt_at ?? null })),
      exceptions: exc.rows.map((r: any) => ({ id: String(r.id), tenantName: r.tenant_name ?? null, ruleName: r.rule_name ?? null, exceptionType: r.exception_type, notes: r.notes ?? null, status: r.status })),
      recentActivity: hist.rows.slice(0, 6).map(mapExec),
      upcoming: upcoming.rows.map((r: any) => ({ id: String(r.id), ruleName: r.rule_name, triggerCategory: r.trigger_category, ruleType: r.rule_type, status: r.status, nextEvaluationAt: String(r.next_eval), tenantName: r.tenant_name ?? null })),
      tenantPerf: perf.rows.map((r: any) => ({ tenantId: String(r.tenant_id), tenantName: r.tenant_name ?? null, total: n(r.total), success: n(r.success), failed: n(r.failed) })),
    };
  }
}
