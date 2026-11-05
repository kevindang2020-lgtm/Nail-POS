// ai-scheduling-usage.ts — BUILD_PLAN Phase 7 (agent B): metering for the AI Scheduling Optimizer (SchedUsagePort) and the
// tenant's usage summary (GET pos/ai-scheduling-optimizer/usage → SchedUsageSummary).
//
// Every row lands in ai_usage_logs under package 'ai_scheduling_optimizer' (the same ledger AiPlatform writes):
//   action 'optimization_run' → usage_amount 1   — the package's billing unit is "runs" (catalog: 1000 / month);
//   action 'options' | 'recommendation' | 'explanation' → usage_amount 0 — recorded for visibility, never billed: a
//     receptionist looking for a time must not burn a salon's run allowance.
// An LLM explanation is ALSO logged by AiPlatform itself (action 'schedule.explain_suggestion', with its real token cost);
// our 'explanation' row carries no cost, so the summary's cost (sum of cost_micro_usd) never counts a call twice.
// record() never throws into the caller (metering is not the work).
import { sql, type Kysely } from 'kysely';
import { utcDate } from '@aipowersalon/date-time';
import type { SchedUsageSummary } from '@aipowersalon/api-contracts/tenant';
import type { SchedCtx, SchedUsageAction, SchedUsagePort } from './ai-scheduling.ports';
import { SCHED_PACKAGE, isYmd, needPerm, rowsOf, uuidOrNull, SchedOpsError, addDaysYmd } from './ai-scheduling-ops.common';

export const BILLED_ACTIONS: ReadonlySet<SchedUsageAction> = new Set<SchedUsageAction>(['optimization_run']);

export interface UsageRow { tenantId: string; userId: string | null; action: SchedUsageAction; usageAmount: number; status: 'success' | 'failed'; costMicroUsd: number; modelName: string | null; createdAt: string }
export interface UsageStore { insert(row: UsageRow): Promise<void>; summary(tenantId: string, fromIso: string, toIso: string): Promise<Omit<SchedUsageSummary, 'from' | 'to'>> }

/** Pure: the ledger row for one metered action. */
export function usageRow(ctx: SchedCtx, action: SchedUsageAction, extra: { amount?: number; costMicroUsd?: number; model?: string | null; status?: 'ok' | 'error' } = {}, now = new Date()): UsageRow {
  const billed = BILLED_ACTIONS.has(action);
  const status = extra.status === 'error' ? 'failed' : 'success';
  return {
    tenantId: ctx.tenantId, userId: uuidOrNull(ctx.userId), action,
    // a failed run is not billed; a non-billed action never counts against the allowance whatever the caller passes
    usageAmount: billed && status === 'success' ? Math.max(1, Math.floor(extra.amount ?? 1)) : 0,
    status, costMicroUsd: Math.max(0, Math.round(extra.costMicroUsd ?? 0)), modelName: extra.model ?? null, createdAt: now.toISOString(),
  };
}

export class SchedUsageService implements SchedUsagePort {
  constructor(private readonly store: UsageStore, private readonly now: () => Date = () => new Date()) {}
  async record(ctx: SchedCtx, action: SchedUsageAction, extra?: { amount?: number; costMicroUsd?: number; model?: string | null; status?: 'ok' | 'error' }): Promise<void> {
    try { if (ctx?.tenantId) await this.store.insert(usageRow(ctx, action, extra, this.now())); } catch { /* metering never fails the caller */ }
  }
  /** GET usage?from&to (dates, inclusive; default the last 30 days). */
  async summary(ctx: SchedCtx, q: { from?: string; to?: string }): Promise<SchedUsageSummary> {
    needPerm(ctx, 'ai_scheduling.view');
    const today = utcDate(this.now());   // UTC day: ai_usage_logs / runs are filtered by UTC instants
    const to = q.to ? q.to : today;
    const from = q.from ? q.from : addDaysYmd(to, -29);
    if (!isYmd(from) || !isYmd(to) || from > to) throw new SchedOpsError('VALIDATION', 'from / to must be dates (YYYY-MM-DD) with from ≤ to.');
    const s = await this.store.summary(ctx.tenantId, `${from}T00:00:00.000Z`, `${addDaysYmd(to, 1)}T00:00:00.000Z`);
    return { from, to, ...s };
  }
}

export class InMemoryUsageStore implements UsageStore {
  rows: UsageRow[] = [];
  extra: { runs: number; recommendations: number; applied: number } = { runs: 0, recommendations: 0, applied: 0 };
  async insert(row: UsageRow) { this.rows.push(row); }
  async summary(tenantId: string, fromIso: string, toIso: string) {
    const r = this.rows.filter((x) => x.tenantId === tenantId && x.createdAt >= fromIso && x.createdAt < toIso);
    return { ...this.extra, explanations: r.filter((x) => x.action === 'explanation').length, llmCostMicroUsd: r.reduce((n, x) => n + x.costMicroUsd, 0) };
  }
}

export class KyselyUsageStore implements UsageStore {
  constructor(private readonly db: Kysely<any>) {}
  async insert(r: UsageRow): Promise<void> {
    await sql`insert into ai_usage_logs (tenant_id, user_id, package_code, action, model_name, usage_unit, usage_amount, status, cost_micro_usd, created_at)
              values (${r.tenantId}, ${r.userId}, ${SCHED_PACKAGE}, ${r.action}, ${r.modelName}, 'runs', ${r.usageAmount}, ${r.status}, ${r.costMicroUsd}, ${r.createdAt})`.execute(this.db);
  }
  async summary(tenantId: string, fromIso: string, toIso: string) {
    const one = async (q: any) => Number(rowsOf(await q.execute(this.db))[0]?.n ?? 0);
    const [runs, recommendations, applied, explanations, cost] = await Promise.all([
      one(sql`select count(*)::int as n from schedule_optimization_runs where tenant_id = ${tenantId} and started_at >= ${fromIso} and started_at < ${toIso}`),
      one(sql`select count(*)::int as n from schedule_optimization_recommendations where tenant_id = ${tenantId} and created_at >= ${fromIso} and created_at < ${toIso}`),
      one(sql`select count(*)::int as n from schedule_optimization_recommendations where tenant_id = ${tenantId} and applied_at >= ${fromIso} and applied_at < ${toIso}`),
      one(sql`select count(*)::int as n from ai_usage_logs where tenant_id = ${tenantId} and package_code = ${SCHED_PACKAGE} and action = 'explanation' and created_at >= ${fromIso} and created_at < ${toIso}`),
      one(sql`select coalesce(sum(cost_micro_usd), 0)::bigint as n from ai_usage_logs where tenant_id = ${tenantId} and package_code = ${SCHED_PACKAGE} and created_at >= ${fromIso} and created_at < ${toIso}`),
    ]);
    return { runs, recommendations, applied, explanations, llmCostMicroUsd: cost };
  }
}
