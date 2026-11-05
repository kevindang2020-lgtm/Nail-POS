import { type AiProvider, MockAiProvider } from '@aipowersalon/ai';
import { describe, it, expect } from 'vitest';
import { buildReconFacts, EXPLANATION_PROMPT_VERSION } from './deposit-reconciliation.explain';
import type { ReconRow } from './deposit-reconciliation.dto';
import type { FeeReconRow } from './deposit-reconciliation.fees';
import { InMemoryReconRepository } from './deposit-reconciliation.repository';
import { InMemoryFeeScheduleRepository } from './deposit-reconciliation.fees.repository';
import { InMemoryExplainUsageLogger } from './deposit-reconciliation.explain.usage';
import { AiExplanationService } from './deposit-reconciliation.explain.service';
import { ReconForbiddenError, ReconValidationError } from './deposit-reconciliation.service';

const row = (o: Partial<ReconRow> = {}): ReconRow => ({ settlementId: 's1', processorType: 'fiserv', settledAt: '2026-07-01T00:00:00.000Z', grossCents: 100000, feeCents: 2900, expectedNetCents: 97100, depositId: 'd1', actualCents: 97100, differenceCents: 0, status: 'matched', matchType: 'amount_exact', confidence: 0.85, dateDiffDays: 1, ...o });
const feeRow = (o: Partial<FeeReconRow> = {}): FeeReconRow => ({ settlementId: 's1', processorType: 'fiserv', settledAt: '2026-07-01', grossCents: 100000, actualFeeCents: 2900, expectedFeeCents: 2900, differenceCents: 0, status: 'matched', scheduleVersion: 1, components: null, confidence: 0.9, unverifiedReason: null, ...o });

describe('explain — deterministic facts (pure, never invents)', () => {
  it('matched settlement + matched fee', () => {
    const f = buildReconFacts(row(), feeRow());
    expect(f.summary).toMatch(/matched to a bank deposit/i);
    expect(f.summary).toMatch(/fee of \$29\.00 matches/i);
    expect(f.promptVersion).toBe(EXPLANATION_PROMPT_VERSION);
    expect(f.unverified).toBe(false);
  });
  it('missing deposit is explained as flagged for review', () => {
    const f = buildReconFacts(row({ status: 'missing_deposit', depositId: null, actualCents: null }), null);
    expect(f.summary).toMatch(/missing deposit/i);
  });
  it('unverified fee is NOT called a difference', () => {
    const f = buildReconFacts(row(), feeRow({ status: 'unverified', expectedFeeCents: null, differenceCents: null, unverifiedReason: 'settlement has no transaction count' }));
    expect(f.unverified).toBe(true);
    expect(f.summary).toMatch(/could not be fully verified/i);
    expect(f.summary).not.toMatch(/higher than|lower than/i);
  });
});

describe('explain — service (source of truth, usage logging, fallback)', () => {
  const ctx = (t = 't1') => ({ tenantId: t, branchId: 'b1', userId: 'u1', role: 'OWNER', permissions: ['reconciliation.view'] } as any);
  const seedRepo = () => new InMemoryReconRepository({ settlements: [{ tenantId: 't1', id: 's1', branchId: 'b1', processorType: 'fiserv', settlementRef: 'B1', grossCents: 100000, feeCents: 2900, netCents: 97100, currency: 'USD', status: 'settled', settledAt: '2026-07-01T00:00:00.000Z' } as any] });

  it('rejects unauthenticated + not-found', async () => {
    const svc = new AiExplanationService(seedRepo(), new InMemoryFeeScheduleRepository(), new MockAiProvider(), new InMemoryExplainUsageLogger());
    await expect(svc.explainSettlement({ ...ctx(), userId: '' }, 's1')).rejects.toBeInstanceOf(ReconForbiddenError);
    await expect(svc.explainSettlement(ctx(), 'nope')).rejects.toBeInstanceOf(ReconValidationError);
  });
  it('with a mock provider returns the deterministic explanation + logs usage', async () => {
    const logger = new InMemoryExplainUsageLogger();
    const svc = new AiExplanationService(seedRepo(), new InMemoryFeeScheduleRepository(), new MockAiProvider(), logger);
    const r = await svc.explainSettlement(ctx(), 's1');
    expect(r.source).toBe('deterministic');           // mock output is not used as the explanation
    expect(r.explanation).toMatch(/settlement/i);
    expect(logger.entries.length).toBe(1); expect(logger.entries[0].status).toBe('success');
  });
  it('with a real provider uses AI phrasing (grounded in facts)', async () => {
    const real: AiProvider = { name: 'anthropic', model: 'claude', async complete() { return { text: 'Your deposit matched the settlement exactly; no action needed.', inputTokens: 50, outputTokens: 12, provider: 'anthropic', model: 'claude' }; } };
    const svc = new AiExplanationService(seedRepo(), new InMemoryFeeScheduleRepository(), real, new InMemoryExplainUsageLogger());
    const r = await svc.explainSettlement(ctx(), 's1');
    expect(r.source).toBe('ai'); expect(r.explanation).toMatch(/no action needed/i);
  });
  it('provider error falls back to deterministic + logs provider_error', async () => {
    const boom: AiProvider = { name: 'x', model: 'y', async complete() { throw new Error('upstream down'); } };
    const logger = new InMemoryExplainUsageLogger();
    const svc = new AiExplanationService(seedRepo(), new InMemoryFeeScheduleRepository(), boom, logger);
    const r = await svc.explainSettlement(ctx(), 's1');
    expect(r.source).toBe('deterministic'); expect(logger.entries[0].status).toBe('provider_error');
  });
});
