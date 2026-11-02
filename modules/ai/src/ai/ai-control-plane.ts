// ai-control-plane.ts — Constitution 10 §171–§176: the Super Admin "AI & Automation" read model.
//
// This is a VIEW, not a store. Every figure comes from something that already exists — ai_usage_logs for
// requests and cost, the circuit breakers for provider health, the registries for models, routing and tasks.
// Adding an ai_metrics table would be a second source of truth for numbers the usage ledger already holds.
//
// §173 is a hard rule with a one-line implementation: "No credentials displayed." Nothing in this file reads a
// key, and a test greps the source to keep it that way.
import { AI_TASKS, type TaskDefinition } from './ai-task-registry';
import { AI_MODELS, modelCost, type ModelDefinition } from './ai-model-registry';
import { preferredTier, ROUTING_POLICY_VERSION } from './ai-model-router';
import { PLATFORM_MAX_AUTOMATION } from './ai-safety-policy';
import type { ProviderHealth, ProviderCircuitBreakers } from './ai-provider-health';

/** One row of ai_usage_logs, as the control plane needs it. */
export interface UsageRow { tenantId: string; packageCode: string; action: string; modelProvider: string | null; modelName: string | null; inputTokens: number; outputTokens: number; costMicroUsd: number; status: string; createdAt: string }

/** §172. */
export interface AiOverview {
  requestsToday: number;
  successRate: number | null;          // null when there is nothing to divide — never a fake 100%
  averageLatencyMs: number | null;
  costTodayMicroUsd: number;
  costMonthMicroUsd: number;
  activeTenants: number;
  jobsRunning: number;
  failures: number;
  providerHealth: Record<string, ProviderHealth>;
  safetyEvents: number;
}

export interface OverviewInput {
  usageToday: readonly UsageRow[];
  usageMonth: readonly UsageRow[];
  jobsRunning: number;
  safetyEvents: number;
  breakers: Pick<ProviderCircuitBreakers, 'snapshot'>;
  latenciesMs?: readonly number[];
}

const sum = (rows: readonly UsageRow[], f: (r: UsageRow) => number) => rows.reduce((a, r) => a + f(r), 0);

export function buildOverview(i: OverviewInput): AiOverview {
  const total = i.usageToday.length;
  const succeeded = i.usageToday.filter((r) => r.status === 'success').length;
  const failures = i.usageToday.filter((r) => r.status === 'failed').length;
  const lat = i.latenciesMs ?? [];
  return {
    requestsToday: total,
    // §303-adjacent: a rate computed from zero requests is not 100%, it is unknown. Showing 100% on an idle
    // platform would tell a Super Admin everything is fine when nothing has been measured at all.
    successRate: total === 0 ? null : succeeded / total,
    averageLatencyMs: lat.length === 0 ? null : Math.round(lat.reduce((a, b) => a + b, 0) / lat.length),
    costTodayMicroUsd: sum(i.usageToday, (r) => r.costMicroUsd),
    costMonthMicroUsd: sum(i.usageMonth, (r) => r.costMicroUsd),
    activeTenants: new Set(i.usageToday.map((r) => r.tenantId)).size,
    jobsRunning: i.jobsRunning,
    failures,
    providerHealth: i.breakers.snapshot(),
    safetyEvents: i.safetyEvents,
  };
}

/** §173. Status, latency, error rate, usage, cost, last incident — and NO credentials. */
export interface ProviderPanel {
  provider: string;
  status: ProviderHealth['status'];
  latencyMsP50: number | null;
  errorRate: number | null;
  requests: number;
  costMicroUsd: number;
  lastIncidentAt: string | null;
  /** How many models of this provider are routable right now. */
  routableModels: number;
}

export function buildProviderPanels(usage: readonly UsageRow[], health: Record<string, ProviderHealth>): ProviderPanel[] {
  const providers = new Set([...Object.keys(health), ...usage.map((r) => r.modelProvider).filter((p): p is string => !!p)]);
  return [...providers].sort().map((provider) => {
    const rows = usage.filter((r) => r.modelProvider === provider);
    const failed = rows.filter((r) => r.status === 'failed').length;
    const h = health[provider];
    return {
      provider,
      status: h?.status ?? 'HEALTHY',
      latencyMsP50: h?.latencyMsP50 ?? null,
      errorRate: rows.length === 0 ? null : failed / rows.length,
      requests: rows.length,
      costMicroUsd: sum(rows, (r) => r.costMicroUsd),
      lastIncidentAt: h?.lastFailureAt ? new Date(h.lastFailureAt).toISOString() : null,
      routableModels: Object.values(AI_MODELS).filter((m) => m.provider === provider && (m.status === 'ACTIVE' || m.status === 'BETA')).length,
    };
  });
}

/** §174. Provider, model, status, allowed tasks, usage, cost, latency. */
export interface ModelPanel {
  model: string; provider: string; status: ModelDefinition['status']; tier: ModelDefinition['tier'];
  allowedTasks: string[]; requests: number; costMicroUsd: number; inPerM: number; outPerM: number;
  /** §174 "quality score": null until evaluations exist (§119–§128). An invented score is worse than none. */
  qualityScore: null;
}

export function buildModelPanels(usage: readonly UsageRow[]): ModelPanel[] {
  return Object.values(AI_MODELS).map((m) => {
    const rows = usage.filter((r) => r.modelName === m.key);
    const price = modelCost(m.key);
    return {
      model: m.key, provider: m.provider, status: m.status, tier: m.tier,
      // A task "allows" a model when its provider is permitted and either it names no models or names this one.
      allowedTasks: (Object.values(AI_TASKS) as TaskDefinition[])
        .filter((t) => t.allowedProviders.includes(m.provider) && (!t.allowedModels.length || t.allowedModels.includes(m.key)) && m.capabilities.includes(t.capability))
        .map((t) => t.key),
      requests: rows.length, costMicroUsd: sum(rows, (r) => r.costMicroUsd),
      inPerM: price.inPerM, outPerM: price.outPerM,
      qualityScore: null,
    };
  });
}

/** §175. Task, primary model, fallback, cost ceiling, risk level. Derived from the registries, never stored twice. */
export interface RoutingPanel {
  taskKey: string; module: string; riskLevel: string; capability: string; preferredTier: string;
  allowedProviders: string[]; defaultModel: string | null; maxOutputTokens: number; timeoutMs: number;
  maxAutomation: string; approval: string; routingPolicyVersion: string;
}

export function buildRoutingPanels(): RoutingPanel[] {
  return (Object.values(AI_TASKS) as TaskDefinition[]).map((t) => ({
    taskKey: t.key, module: t.module, riskLevel: t.risk, capability: t.capability, preferredTier: preferredTier(t),
    allowedProviders: [...t.allowedProviders], defaultModel: t.defaultModel, maxOutputTokens: t.maxOutputTokens,
    timeoutMs: t.timeoutMs, maxAutomation: PLATFORM_MAX_AUTOMATION[t.key] ?? 'SUGGEST_ONLY', approval: t.approval,
    routingPolicyVersion: ROUTING_POLICY_VERSION,
  }));
}

/** §176-adjacent: per-tenant AI usage and cost, for the Tenant AI Usage section of §171. */
export interface TenantUsagePanel { tenantId: string; requests: number; costMicroUsd: number; failures: number; topTask: string | null }

export function buildTenantUsage(usage: readonly UsageRow[]): TenantUsagePanel[] {
  const byTenant = new Map<string, UsageRow[]>();
  for (const r of usage) { const a = byTenant.get(r.tenantId) ?? []; a.push(r); byTenant.set(r.tenantId, a); }
  return [...byTenant.entries()].map(([tenantId, rows]) => {
    const counts = new Map<string, number>();
    for (const r of rows) counts.set(r.action, (counts.get(r.action) ?? 0) + 1);
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    return { tenantId, requests: rows.length, costMicroUsd: sum(rows, (r) => r.costMicroUsd), failures: rows.filter((r) => r.status === 'failed').length, topTask: top?.[0] ?? null };
  }).sort((a, b) => b.costMicroUsd - a.costMicroUsd);
}
