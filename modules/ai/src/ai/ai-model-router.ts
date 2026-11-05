// ai-model-router.ts — Constitution 10 Phase 7: policy-based model selection.
//
// §12: the router picks a model from task + capability + risk + tenant policy + cost + latency + availability +
// structured-output support + provider health. §13: "do not automatically use the most expensive model."
// §78: every decision carries a routing_policy_version so a result can later explain why THIS model was chosen.
// §79/§80: failover only to a compatible alternative, and for HIGH risk never silently — the fallback and its
// reason are recorded on the decision and the task's policy decides whether it is even allowed.
import { AI_MODELS, INTEGRATED_PROVIDERS, modelsFor, modelCost, type ModelDefinition } from './ai-model-registry';
import type { TaskDefinition } from './ai-task-registry';

/** §78: bump when the selection rules below change in a way that could pick a different model for the same input. */
export const ROUTING_POLICY_VERSION = 'routing.v1';

/** §81/§82: the health signal the router consumes. A provider with no entry is assumed healthy. */
export interface ProviderHealthView { isOpen(provider: string): boolean }
export const ALWAYS_HEALTHY: ProviderHealthView = { isOpen: () => true };

/** §52/§53: the slice of tenant/branch AI settings the router honours. */
export interface RoutingTenantPolicy {
  /** Providers the tenant has excluded (e.g. data-residency). Intersected with the task's allow-list. */
  blockedProviders?: string[];
  /** A tenant may pin a task to a model; only honoured if the task allows it. */
  pinnedModel?: string;
  /** §77 "tenant budget": when true the router prefers the cheapest capable model even for strong-tier tasks. */
  costSensitive?: boolean;
}

export interface RoutingDecision {
  provider: string;
  model: string;
  routingPolicyVersion: string;
  /** §117: human-readable why. */
  reason: string;
  /** §80: set only when the primary choice was unavailable and an alternative was taken. */
  fallback?: { fromProvider: string; fromModel: string; reason: string };
  /** The ordered list the executor walks if the chosen model fails at call time (§79). */
  alternatives: Array<{ provider: string; model: string }>;
}

export class NoRoutableModelError extends Error {
  readonly status = 503;
  constructor(readonly taskKey: string, readonly why: string) {
    super(`No routable model for task "${taskKey}": ${why}`);
    this.name = 'NoRoutableModelError';
  }
}
export class HighRiskFailoverRefused extends Error {
  readonly status = 503;
  constructor(readonly taskKey: string, readonly from: string) {
    super(`Task "${taskKey}" is ${'HIGH'} risk and its primary (${from}) is unavailable; §80 forbids a silent provider change`);
    this.name = 'HighRiskFailoverRefused';
  }
}

/** §13: which tier a task wants, from its declared shape — not from a per-module opinion. */
export function preferredTier(task: TaskDefinition): ModelDefinition['tier'] {
  if (task.capability === 'text.classify') return 'fast';                   // "simple classification → cheaper fast model"
  if (task.risk === 'HIGH') return 'strong';                                // money and reconciliation get reasoning
  if (task.capability === 'vision.extract') return 'strong';               // §47: extraction accuracy over cost
  if (task.capability === 'text.summarize') return 'fast';
  return 'balanced';
}

const TIER_RANK = { fast: 0, balanced: 1, strong: 2 } as const;

/** Total price per 1M tokens, the router's cost scalar. */
const costScalar = (m: ModelDefinition) => { const p = modelCost(m.key); return p.inPerM + p.outPerM; };

export function route(task: TaskDefinition, opts: {
  tenant?: RoutingTenantPolicy;
  health?: ProviderHealthView;
  env?: NodeJS.ProcessEnv;
  /** §79: a provider that has just failed for this request; excluded and recorded as the fallback origin. */
  excludeProvider?: string;
} = {}): RoutingDecision {
  const env = opts.env ?? process.env;
  const health = opts.health ?? ALWAYS_HEALTHY;
  const production = env.NODE_ENV === 'production';
  const tenant = opts.tenant ?? {};

  // 1. §11: candidates by capability, narrowed by the TASK's allow-lists (never widened by anyone).
  let candidates = modelsFor(task.capability, { providers: task.allowedProviders, allowedModels: task.allowedModels, includeMock: !production });
  // 2. §16: only providers with an adapter. §268: the Mock never serves production.
  // Defence in depth: modelsFor() already excludes the Mock in production; this repeats it so a future change to
  // modelsFor() cannot quietly admit it. A mutation test confirmed the test only fails when BOTH guards go.
  candidates = candidates.filter((m) => INTEGRATED_PROVIDERS.has(m.provider) && (m.provider !== 'mock' || !production));
  // 3. §52: tenant exclusions — they may remove, never add.
  if (tenant.blockedProviders?.length) candidates = candidates.filter((m) => !tenant.blockedProviders!.includes(m.provider));
  if (!candidates.length) throw new NoRoutableModelError(task.key, 'no model of an allowed, integrated provider offers this capability');

  // 4. Provider health / call-time exclusion (§79, §83).
  const primaryPool = candidates;
  const healthy = candidates.filter((m) => health.isOpen(m.provider) && m.provider !== opts.excludeProvider);
  const failedOver = healthy.length < primaryPool.length && healthy.length > 0 && !primaryPool.every((m) => healthy.includes(m));

  // 5. §13 ranking. Pin (if allowed) > tenant cost sensitivity > tier match > cost > latency.
  const wanted = preferredTier(task);
  const rank = (pool: ModelDefinition[]) => [...pool].sort((a, b) => {
    if (tenant.pinnedModel) { if (a.key === tenant.pinnedModel) return -1; if (b.key === tenant.pinnedModel) return 1; }
    if (tenant.costSensitive) return costScalar(a) - costScalar(b);
    const da = Math.abs(TIER_RANK[a.tier] - TIER_RANK[wanted]), db = Math.abs(TIER_RANK[b.tier] - TIER_RANK[wanted]);
    if (da !== db) return da - db;
    // Same tier distance: prefer NOT over-provisioning (a 'balanced' task should not pay for 'strong' when 'fast' ties).
    if (TIER_RANK[a.tier] !== TIER_RANK[b.tier]) return TIER_RANK[a.tier] - TIER_RANK[b.tier];
    const c = costScalar(a) - costScalar(b);
    if (c !== 0) return c;
    return ({ low: 0, medium: 1, high: 2 })[a.latency] - ({ low: 0, medium: 1, high: 2 })[b.latency];
  });

  const primaryOrder = rank(primaryPool);
  const primary = primaryOrder[0];
  if (task.defaultModel && primaryOrder.some((m) => m.key === task.defaultModel) && !tenant.pinnedModel && !tenant.costSensitive) {
    // A task-declared default outranks the heuristic — it was declared deliberately (§10).
    primaryOrder.splice(primaryOrder.findIndex((m) => m.key === task.defaultModel), 1);
    primaryOrder.unshift(AI_MODELS[task.defaultModel]);
  }

  if (!healthy.length) throw new NoRoutableModelError(task.key, `every allowed provider is unhealthy or excluded (${[...new Set(primaryPool.map((m) => m.provider))].join(', ')})`);

  const chosenOrder = rank(healthy);
  const chosen = healthy.includes(primaryOrder[0]) ? primaryOrder[0] : chosenOrder[0];
  const decision: RoutingDecision = {
    provider: chosen.provider, model: chosen.key, routingPolicyVersion: ROUTING_POLICY_VERSION,
    reason: tenant.pinnedModel === chosen.key ? `tenant pinned ${chosen.key}`
      : tenant.costSensitive ? `tenant is cost-sensitive; cheapest ${task.capability} model`
      : task.defaultModel === chosen.key ? `task default model`
      : `${task.capability} at ${task.risk} risk wants tier=${wanted}; ${chosen.key} is the cheapest ${chosen.tier} model`,
    alternatives: chosenOrder.filter((m) => m !== chosen).map((m) => ({ provider: m.provider, model: m.key })),
  };

  // 6. §80: if the primary choice was unavailable and we moved provider, that is a failover. Record it; refuse it for HIGH risk.
  if ((failedOver || opts.excludeProvider) && primary.provider !== chosen.provider) {
    const reason = opts.excludeProvider === primary.provider ? 'primary provider failed at call time' : 'primary provider circuit open';
    if (task.risk === 'HIGH') throw new HighRiskFailoverRefused(task.key, `${primary.provider}/${primary.key}`);
    decision.fallback = { fromProvider: primary.provider, fromModel: primary.key, reason };
  }
  return decision;
}
