// ai-control-plane.service.ts — the data source behind the §171–§176 Super Admin pages and the §166 tenant
// dashboard. The read MODELS live in ai-control-plane.ts and ai-feedback.ts and are pure functions over rows;
// this service's only job is to fetch those rows for a window and hand them over.
//
// Why the split: the shaping rules (an idle platform reports null, not 100%; a forbidden section is named
// rather than emptied) are the part worth testing exhaustively, and they stay testable without a database.
// This file is the thin, boring half.
import { sql, type Kysely } from 'kysely';
import type { DB } from '@aipowersalon/database';
import { buildOverview, buildProviderPanels, buildModelPanels, buildRoutingPanels, buildTenantUsage, type UsageRow } from './ai-control-plane';
import { buildTenantDashboard, summarizeFeedback, type FeedbackRow, type TenantDashboardInput } from './ai-feedback';
import type { ProviderCircuitBreakers } from './ai-provider-health';
import type { TenantSafetySettings } from './ai-safety-policy';

export interface AiUsageReadPort {
  usageSince(from: Date, tenantId?: string): Promise<UsageRow[]>;
  runningJobs(): Promise<number>;
  safetyEventCount(from: Date): Promise<number>;
  pendingApprovals(tenantId: string): Promise<Array<{ requestId: string; taskKey: string; riskLevel: string; createdAt: string }>>;
  budgetFor(tenantId: string): Promise<{ limitMicroUsd: number; spentMicroUsd: number } | null>;
  enabledPackages(tenantId: string): Promise<string[]>;
  feedbackFor(tenantId: string, taskKey?: string): Promise<FeedbackRow[]>;
}

const startOfToday = (now: Date) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
const startOfMonth = (now: Date) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

export class AiControlPlaneService {
  constructor(private readonly read: AiUsageReadPort, private readonly breakers: Pick<ProviderCircuitBreakers, 'snapshot'>, private readonly now: () => Date = () => new Date()) {}

  /** §172. */
  async overview() {
    const now = this.now();
    const [usageToday, usageMonth, jobsRunning, safetyEvents] = await Promise.all([
      this.read.usageSince(startOfToday(now)), this.read.usageSince(startOfMonth(now)),
      this.read.runningJobs(), this.read.safetyEventCount(startOfToday(now)),
    ]);
    return buildOverview({ usageToday, usageMonth, jobsRunning, safetyEvents, breakers: this.breakers });
  }

  /** §173 — no credentials, by construction: this method never reads one. */
  async providers() {
    return buildProviderPanels(await this.read.usageSince(startOfMonth(this.now())), this.breakers.snapshot());
  }

  /** §174. */
  async models() { return buildModelPanels(await this.read.usageSince(startOfMonth(this.now()))); }

  /** §175 — derived from the registries, no query needed. */
  routing() { return buildRoutingPanels(); }

  /** Tenant AI usage, ranked by cost. */
  async tenants(limit = 25) { return buildTenantUsage(await this.read.usageSince(startOfMonth(this.now()))).slice(0, limit); }

  /** §166 the tenant's own dashboard, shaped by what their role may see. */
  async tenantDashboard(input: { tenantId: string; role: string; permissions: readonly string[]; safety?: TenantSafetySettings }): Promise<ReturnType<typeof buildTenantDashboard>> {
    const now = this.now();
    const [usage, budget, pendingApprovals, enabledPackages] = await Promise.all([
      this.read.usageSince(startOfMonth(now), input.tenantId), this.read.budgetFor(input.tenantId),
      this.read.pendingApprovals(input.tenantId), this.read.enabledPackages(input.tenantId),
    ]);
    const dash: TenantDashboardInput = { ...input, usage, budget, pendingApprovals, enabledPackages };
    return buildTenantDashboard(dash);
  }

  /** §129: what the tenant's own corrections say about a task. */
  async feedback(tenantId: string, taskKey?: string) {
    return summarizeFeedback(await this.read.feedbackFor(tenantId, taskKey), taskKey ? { taskKey } : {});
  }
}

/** The Kysely implementation. Every query is tenant-filtered where a tenant is given; none joins across tenants. */
export class KyselyAiUsageRead implements AiUsageReadPort {
  constructor(private readonly db: Kysely<DB>) {}

  async usageSince(from: Date, tenantId?: string): Promise<UsageRow[]> {
    let q = this.db.selectFrom('ai_usage_logs')
      .select(['tenant_id', 'package_code', 'action', 'model_provider', 'model_name', 'input_tokens', 'output_tokens', 'cost_micro_usd', 'status', 'created_at'])
      .where('created_at', '>=', from);
    if (tenantId) q = q.where('tenant_id', '=', tenantId);
    const rows = await q.execute();
    return rows.map((r) => ({
      tenantId: String(r.tenant_id), packageCode: String(r.package_code), action: String(r.action),
      modelProvider: r.model_provider as string | null, modelName: r.model_name as string | null,
      inputTokens: Number(r.input_tokens ?? 0), outputTokens: Number(r.output_tokens ?? 0),
      costMicroUsd: Number(r.cost_micro_usd ?? 0), status: String(r.status), createdAt: new Date(r.created_at as never).toISOString(),
    }));
  }

  async runningJobs(): Promise<number> {
    const r = await this.db.selectFrom('ai_jobs').select(({ fn }) => fn.countAll().as('n')).where('status', 'in', ['RUNNING', 'WAITING_PROVIDER', 'VALIDATING']).executeTakeFirst();
    return Number(r?.n ?? 0);
  }

  async safetyEventCount(from: Date): Promise<number> {
    const r = await this.db.selectFrom('ai_usage_logs').select(({ fn }) => fn.countAll().as('n'))
      .where('created_at', '>=', from).where('status', 'in', ['blocked_permission', 'blocked_limit', 'blocked_unpaid']).executeTakeFirst();
    return Number(r?.n ?? 0);
  }

  async pendingApprovals(tenantId: string) {
    const rows = await this.db.selectFrom('ai_jobs').select(['id', 'task_key', 'created_at'])
      .where('tenant_id', '=', tenantId).where('status', '=', 'REVIEW_REQUIRED').orderBy('created_at', 'desc').limit(50).execute();
    // riskLevel comes from the task registry, not the row — one source of truth for risk.
    const { AI_TASKS } = await import('./ai-task-registry');
    return rows.map((r) => ({ requestId: String(r.id), taskKey: String(r.task_key), riskLevel: AI_TASKS[String(r.task_key)]?.risk ?? 'MEDIUM', createdAt: new Date(r.created_at as never).toISOString() }));
  }

  async budgetFor(tenantId: string) {
    const b = await this.db.selectFrom('ai_budgets').select(['limit_micro_usd']).where('tenant_id', '=', tenantId).where('scope_key', '=', '*').where('period', '=', 'monthly').executeTakeFirst();
    if (!b) return null;
    const now = new Date();
    const spent = await this.db.selectFrom('ai_usage_logs').select(({ fn }) => fn.sum<number>('cost_micro_usd').as('s'))
      .where('tenant_id', '=', tenantId).where('created_at', '>=', new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))).executeTakeFirst();
    return { limitMicroUsd: Number(b.limit_micro_usd ?? 0), spentMicroUsd: Number(spent?.s ?? 0) };
  }

  async enabledPackages(tenantId: string): Promise<string[]> {
    const rows = await sql<{ package_code: string }>`
      select distinct package_code from ai_usage_logs where tenant_id = ${tenantId}
    `.execute(this.db as never).then((r) => r.rows).catch(() => []);
    return rows.map((r) => r.package_code);
  }

  async feedbackFor(tenantId: string, taskKey?: string): Promise<FeedbackRow[]> {
    let q = this.db.selectFrom('ai_feedback').selectAll().where('tenant_id', '=', tenantId);
    if (taskKey) q = q.where('task_key', '=', taskKey);
    const rows = await q.orderBy('created_at', 'desc').limit(500).execute();
    return rows.map((r) => ({
      tenantId: String(r.tenant_id), branchId: (r.branch_id as string | null) ?? null, requestId: String(r.request_id),
      taskKey: String(r.task_key), promptKey: String(r.prompt_key), promptVersion: Number(r.prompt_version),
      provider: (r.provider as string | null) ?? null, model: (r.model as string | null) ?? null,
      outcome: r.outcome as FeedbackRow['outcome'], reasonCode: (r.reason_code as FeedbackRow['reasonCode']) ?? undefined,
      note: (r.note as string | null) ?? undefined, retainedRatio: r.retained_ratio === null ? undefined : Number(r.retained_ratio),
      actorUserId: (r.actor_user_id as string | null) ?? null, createdAt: new Date(r.created_at as never).toISOString(),
    }));
  }
}
