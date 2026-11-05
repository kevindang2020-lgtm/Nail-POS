// ai-budget-scheduler.vitest.spec — Constitution 10 §99–§108.
import { describe, it, expect } from 'vitest';
import { PRIORITY, priorityFor, evaluateBudget, thresholdsCrossed, AiRateLimiter, selectBatch, oldestQueuedAgeMs, type BudgetRow, type ClaimableJob } from './ai-budget-scheduler';
import { AI_TASKS, type TaskDefinition } from './ai-task-registry';

const B = (over: Partial<BudgetRow> = {}): BudgetRow => ({ tenantId: 't1', scopeKey: '*', period: 'monthly', limitMicroUsd: 1_000_000, atLimitBehavior: 'block_low_priority', ...over });

describe('§104/§105 priority classes', () => {
  it('a live customer interaction outranks analytics, and a backfill is always bulk', () => {
    expect(priorityFor('receptionist.reply_draft', { risk: 'MEDIUM' })).toBe(PRIORITY.CUSTOMER_ACTIVE);
    expect(priorityFor('forecast.explain', { risk: 'LOW' })).toBe(PRIORITY.ANALYTICS);
    expect(priorityFor('forecast.explain', { risk: 'LOW', backfill: true })).toBe(PRIORITY.BULK);
    // §105 exactly: the receptionist call must outrank the 12-month forecast backfill
    expect(priorityFor('receptionist.reply_draft', { risk: 'MEDIUM' })).toBeLessThan(priorityFor('forecast.explain', { risk: 'LOW', backfill: true }));
  });
  it('HIGH-risk money work is P0', () => {
    for (const t of Object.values(AI_TASKS) as TaskDefinition[]) if (t.risk === 'HIGH') expect(priorityFor(t.key, { risk: t.risk }), t.key).toBe(PRIORITY.SAFETY);
  });
});

describe('§100 thresholds', () => {
  it('reports only thresholds newly crossed by this call', () => {
    expect(thresholdsCrossed(0, 400_000, 1_000_000)).toEqual([]);
    expect(thresholdsCrossed(400_000, 550_000, 1_000_000)).toEqual([50]);
    expect(thresholdsCrossed(400_000, 950_000, 1_000_000)).toEqual([50, 80, 90]);
    expect(thresholdsCrossed(950_000, 1_100_000, 1_000_000)).toEqual([100]);
    expect(thresholdsCrossed(990_000, 999_000, 1_000_000)).toEqual([]);   // already past 90, not yet 100
    expect(thresholdsCrossed(0, 5_000, 0)).toEqual([]);                   // unlimited
  });
});

describe('§99/§101 budget behaviour', () => {
  const spend = (v: number, key = '*:monthly') => ({ [key]: { spentMicroUsd: v } });
  it('no budget configured → proceed', () => {
    expect(evaluateBudget({ budgets: [], spendByScope: {}, module: 'ai-marketing', priority: 3, estimatedMicroUsd: 500 })).toMatchObject({ allowed: true, action: 'proceed' });
  });
  it('within budget → proceed, with usedPercent', () => {
    const d = evaluateBudget({ budgets: [B()], spendByScope: spend(250_000), module: 'ai-marketing', priority: 3, estimatedMicroUsd: 1_000 });
    expect(d).toMatchObject({ allowed: true, action: 'proceed' }); expect(d.usedPercent).toBeCloseTo(25);
  });
  it('§101 block_low_priority: analytics and bulk stop, safety and live customer continue', () => {
    const at = spend(1_000_000);
    expect(evaluateBudget({ budgets: [B()], spendByScope: at, module: 'ai-analytics-forecasting', priority: PRIORITY.ANALYTICS, estimatedMicroUsd: 500 })).toMatchObject({ allowed: false, action: 'blocked' });
    expect(evaluateBudget({ budgets: [B()], spendByScope: at, module: 'ai-analytics-forecasting', priority: PRIORITY.BULK, estimatedMicroUsd: 500 }).allowed).toBe(false);
    // the money explanation keeps working — stopping a HIGH-risk alert explanation to save a cent is the wrong trade
    expect(evaluateBudget({ budgets: [B()], spendByScope: at, module: 'ai-money-protection', priority: PRIORITY.SAFETY, estimatedMicroUsd: 500 })).toMatchObject({ allowed: true, action: 'proceed' });
    expect(evaluateBudget({ budgets: [B()], spendByScope: at, module: 'ai', priority: PRIORITY.CUSTOMER_ACTIVE, estimatedMicroUsd: 500 }).allowed).toBe(true);
  });
  it('§101 block_all stops everything, including safety', () => {
    const d = evaluateBudget({ budgets: [B({ atLimitBehavior: 'block_all' })], spendByScope: spend(1_000_000), module: 'ai-money-protection', priority: PRIORITY.SAFETY, estimatedMicroUsd: 500 });
    expect(d).toMatchObject({ allowed: false, action: 'blocked' });
  });
  it('§101 queue holds operational and below; downgrade_model lets the call through on a cheaper model', () => {
    expect(evaluateBudget({ budgets: [B({ atLimitBehavior: 'queue' })], spendByScope: spend(1_000_000), module: 'ai-inventory', priority: PRIORITY.OPERATIONAL, estimatedMicroUsd: 500 })).toMatchObject({ allowed: false, action: 'queue' });
    expect(evaluateBudget({ budgets: [B({ atLimitBehavior: 'queue' })], spendByScope: spend(1_000_000), module: 'ai', priority: PRIORITY.CUSTOMER_ACTIVE, estimatedMicroUsd: 500 }).allowed).toBe(true);
    expect(evaluateBudget({ budgets: [B({ atLimitBehavior: 'downgrade_model' })], spendByScope: spend(1_000_000), module: 'ai-marketing', priority: PRIORITY.ANALYTICS, estimatedMicroUsd: 500 })).toMatchObject({ allowed: true, action: 'downgrade_model' });
  });
  it('the TIGHTER leash binds when BOTH are exceeded: the module daily budget decides, not the tenant monthly one', () => {
    // A first version of this test left the tenant budget well under its limit, so the ordering was never
    // exercised — a mutation removing the sort still passed. Both must be over, with different behaviours.
    const both = [B({ limitMicroUsd: 1_000, atLimitBehavior: 'downgrade_model' }), B({ scopeKey: 'ai-marketing', period: 'daily', limitMicroUsd: 1_000, atLimitBehavior: 'block_all' })];
    const spent = { '*:monthly': { spentMicroUsd: 1_000 }, 'ai-marketing:daily': { spentMicroUsd: 1_000 } };
    const d = evaluateBudget({ budgets: both, spendByScope: spent, module: 'ai-marketing', priority: PRIORITY.OPERATIONAL, estimatedMicroUsd: 100 });
    expect(d).toMatchObject({ allowed: false, action: 'blocked', scopeKey: 'ai-marketing' });   // module rule won
  });

  it('a module budget binds only its own module', () => {
    const budgets = [B({ limitMicroUsd: 10_000_000 }), B({ scopeKey: 'ai-marketing', period: 'daily', limitMicroUsd: 1_000, atLimitBehavior: 'block_all' })];
    const d = evaluateBudget({ budgets, spendByScope: { '*:monthly': { spentMicroUsd: 0 }, 'ai-marketing:daily': { spentMicroUsd: 1_000 } }, module: 'ai-marketing', priority: PRIORITY.OPERATIONAL, estimatedMicroUsd: 100 });
    expect(d).toMatchObject({ allowed: false, scopeKey: 'ai-marketing' });
    // a DIFFERENT module is unaffected by that module budget
    expect(evaluateBudget({ budgets, spendByScope: { '*:monthly': { spentMicroUsd: 0 }, 'ai-marketing:daily': { spentMicroUsd: 1_000 } }, module: 'ai-inventory', priority: PRIORITY.OPERATIONAL, estimatedMicroUsd: 100 }).allowed).toBe(true);
  });
  it('a decision carries the thresholds this call crossed, so an alert fires once', () => {
    const d = evaluateBudget({ budgets: [B()], spendByScope: spend(790_000), module: 'ai-marketing', priority: 2, estimatedMicroUsd: 20_000 });
    expect(d.thresholdsCrossed).toEqual([80]);
  });
});

describe('§102 rate limits', () => {
  it('limits per dimension and reports retryAfter', () => {
    let t = 0; const rl = new AiRateLimiter(() => t);
    const rules = [{ key: 'tenant:t1', limit: 2, windowMs: 1000 }];
    expect(rl.check(rules).allowed).toBe(true);
    expect(rl.check(rules).allowed).toBe(true);
    const third = rl.check(rules);
    expect(third).toMatchObject({ allowed: false, rule: 'tenant:t1' }); expect(third.retryAfterMs).toBe(1000);
    t = 1001;
    expect(rl.check(rules).allowed).toBe(true);
  });
  it('a request refused by ONE rule does not consume the others\' allowance', () => {
    let t = 0; const rl = new AiRateLimiter(() => t);
    const rules = [{ key: 'tenant:t1', limit: 10, windowMs: 1000 }, { key: 'user:u1', limit: 1, windowMs: 1000 }];
    expect(rl.check(rules).allowed).toBe(true);
    expect(rl.check(rules).allowed).toBe(false);               // blocked by user rule
    expect(rl.check(rules).allowed).toBe(false);
    expect(rl.peek('tenant:t1')!.count).toBe(1);               // the tenant allowance was NOT burned by the refusals
  });
  it('dimensions are independent', () => {
    let t = 0; const rl = new AiRateLimiter(() => t);
    rl.check([{ key: 'tenant:t1', limit: 1, windowMs: 1000 }]);
    expect(rl.check([{ key: 'tenant:t2', limit: 1, windowMs: 1000 }]).allowed).toBe(true);
  });
});

describe('§103 fair queueing — the noisy neighbour', () => {
  const job = (id: string, tenantId: string, priority: number, createdAt: number): ClaimableJob => ({ id, tenantId, priority: priority as ClaimableJob['priority'], createdAt });

  it('a tenant with 100,000 queued jobs does not shut out another tenant of the same priority', () => {
    const noisy = Array.from({ length: 1000 }, (_, i) => job(`n${i}`, 'noisy', PRIORITY.ANALYTICS, i));
    const quiet = [job('q1', 'quiet', PRIORITY.ANALYTICS, 5000)];   // queued LAST, and still gets served
    const batch = selectBatch([...noisy, ...quiet], 10, 5);
    expect(batch.filter((j) => j.tenantId === 'quiet')).toHaveLength(1);
    expect(batch.filter((j) => j.tenantId === 'noisy').length).toBeLessThanOrEqual(9);
  });
  it('priority still wins across tenants: a live call beats another tenant\'s backfill', () => {
    const backfill = Array.from({ length: 100 }, (_, i) => job(`b${i}`, 'noisy', PRIORITY.BULK, i));
    const live = [job('live', 'quiet', PRIORITY.CUSTOMER_ACTIVE, 9999)];
    expect(selectBatch([...backfill, ...live], 5, 2)[0].id).toBe('live');
  });
  it('within a tenant and priority, oldest first', () => {
    const jobs = [job('new', 't1', 2, 100), job('old', 't1', 2, 1)];
    expect(selectBatch(jobs, 2, 5).map((j) => j.id)).toEqual(['old', 'new']);
  });
  it('§108 the cap is anti-starvation, not a throughput ceiling: one tenant alone fills the whole batch', () => {
    const only = Array.from({ length: 20 }, (_, i) => job(`o${i}`, 'solo', 2, i));
    expect(selectBatch(only, 10, 3)).toHaveLength(10);
  });
  it('§108 a CONTESTED batch is still filled to capacity once every tenant has had its share', () => {
    // The previous test had a single tenant, so nothing was ever deferred and the refill loop was never
    // exercised — deleting it still passed. Here two tenants are capped at 2 each but the batch holds 8:
    // after both take their share the remainder MUST come from the deferred pile, or workers sit idle.
    const a = Array.from({ length: 10 }, (_, i) => job(`a${i}`, 'tA', 2, i));
    const b = Array.from({ length: 10 }, (_, i) => job(`b${i}`, 'tB', 2, i + 100));
    const batch = selectBatch([...a, ...b], 8, 2);
    expect(batch).toHaveLength(8);
    expect(batch.filter((j) => j.tenantId === 'tA').length).toBeGreaterThanOrEqual(2);
    expect(batch.filter((j) => j.tenantId === 'tB').length).toBeGreaterThanOrEqual(2);
  });
  it('an empty queue yields an empty batch', () => { expect(selectBatch([], 10, 3)).toEqual([]); });
  it('§108 oldest queued age per priority is the backpressure signal', () => {
    const jobs = [job('a', 't1', 1, 1000), job('b', 't1', 1, 500), job('c', 't2', 4, 100)];
    expect(oldestQueuedAgeMs(jobs, 2000)).toEqual({ 1: 1500, 4: 1900 });
  });
});
