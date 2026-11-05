// ai-marketing-send-sweep.vitest.spec.ts — the worker loop, with fakes.
import { describe, it, expect, vi } from 'vitest';
import {
  AiMarketingSendSweep,
  selectFairBatch,
  type DueCampaign,
  type DueCampaignSource,
  type PlanReaderPort,
  type SendExecutorPort,
} from './ai-marketing-send-sweep';

const NOW = '2026-07-07T12:00:00Z';
function due(over: Partial<DueCampaign> = {}): DueCampaign {
  return { tenantId: 'tenantA', branchId: null, campaignId: 'c1', scheduledAt: '2026-07-07T11:00:00Z', status: 'scheduled', ...over };
}
function build(dues: DueCampaign[], plans: Record<string, { messageVersion: number; body: string } | null>) {
  const source: DueCampaignSource = { findDue: vi.fn(async () => dues) };
  const planReader: PlanReaderPort = { get: vi.fn(async (_t, id) => plans[id] ?? null) };
  const calls: any[] = [];
  const executor: SendExecutorPort = { executeCampaign: vi.fn(async (ctx, args) => { calls.push({ ctx, args }); return { campaignId: args.campaignId, sent: 3 }; }) };
  return { sweep: new AiMarketingSendSweep(source, planReader, executor), calls, executor };
}

describe('AiMarketingSendSweep.runOnce', () => {
  it('executes each due campaign under a system context using its plan', async () => {
    const { sweep, calls } = build([due()], { c1: { messageVersion: 2, body: 'Hi {{booking_link}}' } });
    const res = await sweep.runOnce(NOW);
    expect(res.processed).toBe(1);
    expect(res.sent).toHaveLength(1);
    expect(calls[0].ctx.userId).toBe('system:ai-marketing-send-sweep');   // systemContext() names the job (Constitution 13 §72)
    expect(calls[0].ctx.role).toBe('SYSTEM');
    expect(calls[0].args).toEqual({ campaignId: 'c1', messageVersion: 2, body: 'Hi {{booking_link}}' });
  });

  it('skips campaigns with no send plan', async () => {
    const { sweep, executor } = build([due({ campaignId: 'c2' })], { c2: null });
    const res = await sweep.runOnce(NOW);
    expect(res.skippedNoPlan).toEqual(['c2']);
    expect(executor.executeCampaign).not.toHaveBeenCalled();
  });

  it('ignores campaigns whose scheduled time has not arrived (defensive re-check)', async () => {
    const { sweep, executor } = build([due({ scheduledAt: '2026-07-07T13:00:00Z' })], { c1: { messageVersion: 1, body: 'x' } });
    const res = await sweep.runOnce(NOW);
    expect(res.processed).toBe(0);
    expect(executor.executeCampaign).not.toHaveBeenCalled();
  });

  it('captures executor errors without aborting the batch', async () => {
    const source: DueCampaignSource = { findDue: async () => [due({ campaignId: 'a' }), due({ campaignId: 'b' })] };
    const plans: PlanReaderPort = { get: async () => ({ messageVersion: 1, body: 'x' }) };
    let n = 0;
    const executor: SendExecutorPort = { executeCampaign: async () => { n++; if (n === 1) throw new Error('provider down'); return { ok: true }; } };
    const sweep = new AiMarketingSendSweep(source, plans, executor);
    const res = await sweep.runOnce(NOW);
    expect(res.errors).toHaveLength(1);
    expect(res.errors[0].error).toContain('provider down');
    expect(res.sent).toHaveLength(1); // second one still ran
  });
});

describe('selectFairBatch (per-tenant fairness)', () => {
  const mk = (tenantId: string, id: string): DueCampaign => ({ tenantId, campaignId: id, branchId: null, scheduledAt: '2026-07-07T11:00:00Z', status: 'scheduled' });
  it('caps per tenant and round-robins across tenants', () => {
    const pool = [
      mk('A', 'a1'), mk('A', 'a2'), mk('A', 'a3'), mk('A', 'a4'),
      mk('B', 'b1'), mk('B', 'b2'),
    ];
    const out = selectFairBatch(pool, { maxPerTenant: 2, maxTotal: 100 });
    expect(out.map((d) => d.campaignId)).toEqual(['a1', 'b1', 'a2', 'b2']); // interleaved, A capped at 2
  });
  it('respects maxTotal', () => {
    const pool = [mk('A', 'a1'), mk('A', 'a2'), mk('A', 'a3'), mk('B', 'b1'), mk('B', 'b2'), mk('B', 'b3')];
    const out = selectFairBatch(pool, { maxPerTenant: 5, maxTotal: 4 });
    expect(out).toHaveLength(4);
    expect(out.map((d) => d.campaignId)).toEqual(['a1', 'b1', 'a2', 'b2']); // fair split under the cap
  });
  it('handles a single tenant without starving itself', () => {
    const pool = [mk('A', 'a1'), mk('A', 'a2')];
    expect(selectFairBatch(pool, { maxPerTenant: 1, maxTotal: 100 }).map((d) => d.campaignId)).toEqual(['a1']); // rest deferred to next tick
  });
});

describe('AiMarketingSendSweep.runOnce fairness', () => {
  it('processes only the fair subset; the rest remain for the next tick', async () => {
    const pool: DueCampaign[] = [
      { tenantId: 'A', campaignId: 'a1', branchId: null, scheduledAt: '2026-07-07T11:00:00Z', status: 'scheduled' },
      { tenantId: 'A', campaignId: 'a2', branchId: null, scheduledAt: '2026-07-07T11:00:00Z', status: 'scheduled' },
      { tenantId: 'A', campaignId: 'a3', branchId: null, scheduledAt: '2026-07-07T11:00:00Z', status: 'scheduled' },
      { tenantId: 'B', campaignId: 'b1', branchId: null, scheduledAt: '2026-07-07T11:00:00Z', status: 'scheduled' },
    ];
    const source: DueCampaignSource = { findDue: async () => pool };
    const plans: PlanReaderPort = { get: async () => ({ messageVersion: 1, body: 'x' }) };
    const done: string[] = [];
    const executor: SendExecutorPort = { executeCampaign: async (_c, a) => { done.push(a.campaignId); return {}; } };
    const sweep = new AiMarketingSendSweep(source, plans, executor);
    const res = await sweep.runOnce('2026-07-07T12:00:00Z', { maxPerTenant: 1, maxTotal: 10 });
    expect(res.processed).toBe(2);               // one per tenant this tick
    expect(done.sort()).toEqual(['a1', 'b1']);   // a2/a3 deferred (fairness), not dropped
  });
});
