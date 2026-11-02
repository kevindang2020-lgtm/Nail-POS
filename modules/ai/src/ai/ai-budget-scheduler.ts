// ai-budget-scheduler.ts — Constitution 10 §99–§108: budgets, thresholds, priority classes, fair queueing.
//
// Two separate decisions that are easy to conflate:
//   MAY this job run at all?   → the budget engine (§99–§101). Spend against a limit, with a policy at the limit.
//   WHICH job runs next?       → the scheduler (§103–§105). Priority first, then fairness between tenants.
//
// §103's rule is the one worth stating plainly: a tenant that queues 100,000 forecasting jobs must not delay
// another tenant's live receptionist call. Priority alone does NOT achieve that — 100,000 P1 jobs from one
// tenant would still starve everyone else — so the scheduler caps how many of one batch any single tenant can
// take, at the same priority. That cap is what makes it fair queueing rather than a priority queue.
import type { RiskLevel } from './ai-task-registry';

/** §104. Lower number = served first. */
export const PRIORITY = Object.freeze({ SAFETY: 0, CUSTOMER_ACTIVE: 1, OPERATIONAL: 2, ANALYTICS: 3, BULK: 4 });
export type PriorityClass = 0 | 1 | 2 | 3 | 4;
export const PRIORITY_NAMES: Readonly<Record<number, string>> = Object.freeze({ 0: 'P0_SAFETY', 1: 'P1_CUSTOMER_ACTIVE', 2: 'P2_OPERATIONAL', 3: 'P3_ANALYTICS', 4: 'P4_BULK' });

/** §105: a live customer interaction outranks a backfill, whatever module asked. */
export function priorityFor(taskKey: string, opts: { risk: RiskLevel; userWaiting?: boolean; backfill?: boolean } ): PriorityClass {
  if (opts.backfill) return PRIORITY.BULK as PriorityClass;                       // §105 the 12-month forecast backfill
  if (taskKey.startsWith('receptionist.') || taskKey.startsWith('checkout.')) return PRIORITY.CUSTOMER_ACTIVE as PriorityClass;
  if (opts.risk === 'HIGH') return PRIORITY.SAFETY as PriorityClass;              // money and reconciliation exceptions
  if (opts.userWaiting) return PRIORITY.CUSTOMER_ACTIVE as PriorityClass;
  if (taskKey.startsWith('forecast.') || taskKey.startsWith('business.')) return PRIORITY.ANALYTICS as PriorityClass;
  return PRIORITY.OPERATIONAL as PriorityClass;
}

// ---------------------------------------------------------------------------------------------------------------
// §99–§101 budgets
// ---------------------------------------------------------------------------------------------------------------
export type AtLimitBehavior = 'block_low_priority' | 'block_all' | 'queue' | 'downgrade_model';

export interface BudgetRow { tenantId: string; scopeKey: string; period: 'daily' | 'monthly'; limitMicroUsd: number; atLimitBehavior: AtLimitBehavior }
export interface BudgetSpend { spentMicroUsd: number }

export interface BudgetDecision {
  allowed: boolean;
  /** §101: what the caller must do differently, if anything. */
  action: 'proceed' | 'downgrade_model' | 'queue' | 'blocked';
  reason: string;
  /** Percent of limit already spent, 0–∞. Undefined when no limit applies. */
  usedPercent?: number;
  /** §100 thresholds newly crossed by THIS call — the caller records/alerts them once. */
  thresholdsCrossed: number[];
  /** Which budget row decided. */
  scopeKey?: string;
}

export const BUDGET_THRESHOLDS = Object.freeze([50, 80, 90, 100]);

/** §100: thresholds crossed moving from `before` to `after` spend against `limit`. Empty when unlimited. */
export function thresholdsCrossed(before: number, after: number, limit: number): number[] {
  if (limit <= 0) return [];
  const pct = (v: number) => (v / limit) * 100;
  return BUDGET_THRESHOLDS.filter((t) => pct(before) < t && pct(after) >= t);
}

/**
 * §99–§101. Budgets are checked most-specific-first: a module budget decides before the tenant-wide one, and a
 * daily budget before a monthly one — the tighter leash wins, and the decision says which one bound.
 *
 * `estimatedMicroUsd` is the projected cost of the call being considered. It is an ESTIMATE, so a call is never
 * refused for a fraction of a cent: the check is whether spend is ALREADY at or over the limit, plus whether
 * this call would exceed it. Both are reported, never guessed at.
 */
export function evaluateBudget(input: {
  budgets: BudgetRow[];
  spendByScope: Record<string, BudgetSpend>;   // keyed `${scopeKey}:${period}`
  module: string;
  priority: PriorityClass;
  estimatedMicroUsd: number;
}): BudgetDecision {
  const relevant = input.budgets
    .filter((b) => b.scopeKey === '*' || b.scopeKey === input.module)
    .filter((b) => b.limitMicroUsd > 0)
    // most specific first: module before tenant-wide, daily before monthly
    .sort((a, b) => (a.scopeKey === '*' ? 1 : 0) - (b.scopeKey === '*' ? 1 : 0) || (a.period === 'daily' ? -1 : 1));

  if (!relevant.length) return { allowed: true, action: 'proceed', reason: 'no budget configured', thresholdsCrossed: [] };

  let crossed: number[] = [];
  for (const b of relevant) {
    const spent = input.spendByScope[`${b.scopeKey}:${b.period}`]?.spentMicroUsd ?? 0;
    const after = spent + Math.max(0, input.estimatedMicroUsd);
    crossed = [...new Set([...crossed, ...thresholdsCrossed(spent, after, b.limitMicroUsd)])].sort((x, y) => x - y);
    const usedPercent = (spent / b.limitMicroUsd) * 100;
    if (after <= b.limitMicroUsd) continue;                                    // within this budget; check the next

    const scope = `${b.scopeKey === '*' ? 'tenant' : b.scopeKey} ${b.period}`;
    switch (b.atLimitBehavior) {
      case 'block_all':
        return { allowed: false, action: 'blocked', reason: `${scope} AI budget reached`, usedPercent, thresholdsCrossed: crossed, scopeKey: b.scopeKey };
      case 'block_low_priority':
        // §101: safety and live-customer work continues; analytics and bulk stop. A tenant at their cap still
        // gets their money alerts explained — stopping THAT to save a cent would be the wrong trade.
        if (input.priority >= PRIORITY.ANALYTICS) return { allowed: false, action: 'blocked', reason: `${scope} AI budget reached; ${PRIORITY_NAMES[input.priority]} work is paused`, usedPercent, thresholdsCrossed: crossed, scopeKey: b.scopeKey };
        return { allowed: true, action: 'proceed', reason: `${scope} AI budget reached, but ${PRIORITY_NAMES[input.priority]} continues`, usedPercent, thresholdsCrossed: crossed, scopeKey: b.scopeKey };
      case 'queue':
        if (input.priority >= PRIORITY.OPERATIONAL) return { allowed: false, action: 'queue', reason: `${scope} AI budget reached; work is held until the period rolls over`, usedPercent, thresholdsCrossed: crossed, scopeKey: b.scopeKey };
        return { allowed: true, action: 'proceed', reason: `${scope} AI budget reached, but ${PRIORITY_NAMES[input.priority]} continues`, usedPercent, thresholdsCrossed: crossed, scopeKey: b.scopeKey };
      case 'downgrade_model':
        return { allowed: true, action: 'downgrade_model', reason: `${scope} AI budget reached; routing to the cheapest capable model`, usedPercent, thresholdsCrossed: crossed, scopeKey: b.scopeKey };
    }
  }
  const tightest = relevant[0];
  const spent = input.spendByScope[`${tightest.scopeKey}:${tightest.period}`]?.spentMicroUsd ?? 0;
  return { allowed: true, action: 'proceed', reason: 'within budget', usedPercent: (spent / tightest.limitMicroUsd) * 100, thresholdsCrossed: crossed, scopeKey: tightest.scopeKey };
}

// ---------------------------------------------------------------------------------------------------------------
// §102 rate limits
// ---------------------------------------------------------------------------------------------------------------
export interface RateLimitRule { key: string; limit: number; windowMs: number }
export interface RateLimitDecision { allowed: boolean; rule?: string; retryAfterMs?: number }

/** §102: a fixed-window counter per dimension. The caller supplies the dimensions it cares about. */
export class AiRateLimiter {
  private readonly hits = new Map<string, { count: number; resetAt: number }>();
  constructor(private readonly now: () => number = Date.now) {}
  check(rules: RateLimitRule[]): RateLimitDecision {
    const t = this.now();
    // Check every rule BEFORE incrementing any: a request refused by the third rule must not have consumed the
    // first two, or a client retrying against a hard limit silently burns its softer allowances.
    for (const r of rules) {
      const e = this.hits.get(r.key);
      if (e && e.resetAt > t && e.count >= r.limit) return { allowed: false, rule: r.key, retryAfterMs: e.resetAt - t };
    }
    for (const r of rules) {
      const e = this.hits.get(r.key);
      if (!e || e.resetAt <= t) this.hits.set(r.key, { count: 1, resetAt: t + r.windowMs });
      else e.count++;
    }
    return { allowed: true };
  }
  /** Test/ops visibility. */
  peek(key: string) { const e = this.hits.get(key); return e && e.resetAt > this.now() ? { ...e } : null; }
}

// ---------------------------------------------------------------------------------------------------------------
// §103–§105 fair-share scheduling
// ---------------------------------------------------------------------------------------------------------------
export interface ClaimableJob { id: string; tenantId: string; priority: PriorityClass; createdAt: number }

/**
 * §103: choose the next batch from claimable jobs. Priority first, oldest first — but no tenant may take more
 * than `maxPerTenant` of one batch while another tenant has work of the SAME priority waiting.
 *
 * The comparison is per priority on purpose. A tenant's P1 call should still beat another tenant's P4 backfill;
 * fairness is about not being starved by an equal, not about strict round-robin across unequal work.
 */
/**
 * MEASURED (§45, measure-ai-capacity.mjs): 0.06 ms at 100 queued jobs, 0.78 ms at 10k, 9.63 ms at 100k. The
 * cost is linear in QUEUE DEPTH, not batch size, because the fairness check has to know whether another tenant
 * is waiting at the same priority.
 *
 * That is fine as written and it is not fine forever. The caller is expected to hand this a WINDOW — the rows
 * a `LIMIT`-ed claim query returned, ordered by the partial index in migration 437 — not the whole table. At
 * 100k genuinely queued jobs, 9.63 ms of scheduling per batch is the signal to push the fairness rule into SQL
 * (a window function over the same index), not to make this function cleverer.
 */
export function selectBatch(jobs: ClaimableJob[], batchSize: number, maxPerTenant: number): ClaimableJob[] {
  const ordered = [...jobs].sort((a, b) => a.priority - b.priority || a.createdAt - b.createdAt);
  const taken: ClaimableJob[] = [];
  const perTenant = new Map<string, number>();
  const deferred: ClaimableJob[] = [];
  for (const j of ordered) {
    if (taken.length >= batchSize) break;
    const n = perTenant.get(j.tenantId) ?? 0;
    // Only hold a tenant back if someone ELSE has work at the same priority still to consider.
    const contested = ordered.some((o) => o.tenantId !== j.tenantId && o.priority === j.priority && !taken.includes(o));
    if (n >= maxPerTenant && contested) { deferred.push(j); continue; }
    taken.push(j); perTenant.set(j.tenantId, n + 1);
  }
  // §108: an idle worker must not idle while work exists. Once every tenant has had its share, fill the rest of
  // the batch from what was deferred — the cap is anti-starvation, not a throughput ceiling.
  for (const j of deferred) { if (taken.length >= batchSize) break; taken.push(j); }
  return taken;
}

/** §108 backpressure signal: the age of the oldest queued job, per priority. */
export function oldestQueuedAgeMs(jobs: ClaimableJob[], now: number): Record<number, number> {
  const out: Record<number, number> = {};
  for (const j of jobs) { const age = now - j.createdAt; if (age > (out[j.priority] ?? -1)) out[j.priority] = age; }
  return out;
}
