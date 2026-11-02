// ai-money-protection-explain.vitest.spec.ts — advisory AI explanation safety.
import { describe, it, expect } from 'vitest';
import { buildExplainPrompt, finalizeExplanation, deterministicFallback, EXPLAIN_SYSTEM } from './ai-money-protection-explain';
import { MoneyProtectionExplainService, type AiExplainPort } from './ai-money-protection-explain.service';
import { InMemoryMoneyProtectionRepository } from './ai-money-protection.repository';
import { MoneyProtectionForbiddenError, MoneyProtectionValidationError } from './ai-money-protection.service';
import type { MoneyProtectionContext, AlertCandidate, MoneyProtectionAlert } from './ai-money-protection.dto';

const ctx = (perms: string[], tenantId = 'A'): MoneyProtectionContext => ({ tenantId, branchId: 'b1', userId: 'u1', role: 'OWNER', permissions: perms });
const VIEW = ['ai_money_protection.view'];

const candidate = (): AlertCandidate => ({
  ruleId: 'MP_REVERSAL_RATE_OUTLIER', alertType: 'reversal_rate_outlier', severity: 'LOW', confidence: 'low',
  riskScore: 45, amountCents: 0, entityFingerprint: 'reversal_rate:user:emp7', evaluationWindow: '2026-07-07', branchId: 'b1',
  evidence: {
    summary: 'Possible anomaly — requires review.', triggeredRules: ['MP_REVERSAL_RATE_OUTLIER'],
    currentValues: { reversalRatePct: 22 }, baselineValues: { peerMeanRatePct: 4 }, differences: { zScore: 3.1 },
    recommendedReview: ['Review a sample of reversals.'], alternativeExplanations: ['Handles more returns.'], dataFreshness: 'window',
  },
  related: { userIds: ['emp7'], transactionIds: ['p1', 'p2'] },
});
const alertOf = (over: Partial<MoneyProtectionAlert> = {}): MoneyProtectionAlert => ({
  ...candidate(), id: 'mpa_1', tenantId: 'A', status: 'NEW', eventCount: 1, firstSeenAt: 't', lastSeenAt: 't',
  assignedUserId: null, investigationId: null, createdAt: 't', updatedAt: 't', ...over,
});

describe('buildExplainPrompt', () => {
  it('carries the non-accusatory system rules and includes only structured evidence', () => {
    const built = buildExplainPrompt(alertOf())!;
    expect(built.system).toBe(EXPLAIN_SYSTEM);
    expect(built.system.toLowerCase()).toContain('advisory');
    expect(built.prompt).toContain('reversal_rate_outlier');
    // no raw tenant id or card-like data
    expect(built.prompt).not.toContain('tenant');
    expect(/\b\d{13,19}\b/.test(built.prompt)).toBe(false);
  });
  it('refuses to build a prompt if sensitive tokens somehow appear in evidence', () => {
    const bad = alertOf({ evidence: { ...candidate().evidence, currentValues: { note: 'card 4111111111111111' } } });
    expect(buildExplainPrompt(bad)).toBeNull();
  });
});

describe('finalizeExplanation — output sanitizer', () => {
  it('passes through a clean advisory summary as source=ai', () => {
    const r = finalizeExplanation('This is a possible anomaly that requires review. One benign reason: more returns.', alertOf());
    expect(r.source).toBe('ai');
    expect(r.disclaimer.toLowerCase()).toContain('advisory');
  });
  it('DISCARDS accusatory model output and returns the deterministic fallback', () => {
    for (const bad of ['This employee committed fraud.', 'They stole money — fire them.', 'The technician is guilty of theft.']) {
      const r = finalizeExplanation(bad, alertOf());
      expect(r.source).toBe('fallback');
      expect(r.summary.toLowerCase()).not.toMatch(/fraud|theft|stole|guilty|fire/);
    }
  });
  it('empty output → fallback', () => {
    expect(finalizeExplanation('', alertOf()).source).toBe('fallback');
  });
});

describe('deterministicFallback', () => {
  it('is non-accusatory and states value is not a confirmed loss', () => {
    const s = deterministicFallback(alertOf({ amountCents: 5000 }));
    expect(s.toLowerCase()).not.toMatch(/fraud|theft|stole|guilty/);
    expect(s.toLowerCase()).toContain('not');
    expect(s.toLowerCase()).toContain('review');
  });
});

describe('MoneyProtectionExplainService', () => {
  async function setup(gateway: AiExplainPort) {
    const repo = new InMemoryMoneyProtectionRepository();
    const { alert } = await repo.upsertAlert(ctx(VIEW), candidate());
    return { svc: new MoneyProtectionExplainService(repo, gateway), alertId: alert.id };
  }
  // Constitution 10 Phase 23: the fake now returns the VALIDATED shape the platform hands back
  // (money.explanation.v1), not raw provider text. The service joins explanation + first_check.
  const okGateway: AiExplainPort = { async explain() { return { explanation: 'This is a possible anomaly requiring review. A benign reason: this person handles more returns.', firstCheck: 'the drawer log' }; } };
  const evilGateway: AiExplainPort = { async explain() { return { explanation: 'This employee is guilty of theft and should be fired.', firstCheck: 'x' }; } };
  const brokenGateway: AiExplainPort = { async explain() { throw new Error('platform unavailable'); } };

  it('requires view permission', async () => {
    const { svc, alertId } = await setup(okGateway);
    await expect(svc.explainAlert(ctx([]), alertId)).rejects.toBeInstanceOf(MoneyProtectionForbiddenError);
  });
  it('returns an advisory AI summary for a clean model', async () => {
    const { svc, alertId } = await setup(okGateway);
    const r = await svc.explainAlert(ctx(VIEW), alertId);
    expect(r.source).toBe('ai');
  });
  it('NEUTRALIZES an accusatory model → deterministic fallback', async () => {
    const { svc, alertId } = await setup(evilGateway);
    const r = await svc.explainAlert(ctx(VIEW), alertId);
    expect(r.source).toBe('fallback');
    expect(r.summary.toLowerCase()).not.toMatch(/theft|guilty|fire/);
  });
  it('gateway failure → deterministic fallback (never throws to the user)', async () => {
    const { svc, alertId } = await setup(brokenGateway);
    expect((await svc.explainAlert(ctx(VIEW), alertId)).source).toBe('fallback');
  });
  it('cannot explain another tenant\'s alert', async () => {
    const { svc, alertId } = await setup(okGateway);
    await expect(svc.explainAlert(ctx(VIEW, 'B'), alertId)).rejects.toBeInstanceOf(MoneyProtectionValidationError);
  });
});
