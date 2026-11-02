// ai-money-protection-plans.vitest.spec.ts — feature flags + entitlement gate + super-admin aggregate.
import { describe, it, expect } from 'vitest';
import { moneyProtectionFlags } from './ai-money-protection-flags';
import { InMemoryEntitlement } from './ai-money-protection-entitlement';
import { MoneyProtectionService, MoneyProtectionDisabledError, MoneyProtectionForbiddenError } from './ai-money-protection.service';
import { InMemoryMoneyProtectionRepository } from './ai-money-protection.repository';
import type { MoneyProtectionContext, AlertCandidate } from './ai-money-protection.dto';
import type { NormalizedPayment } from './ai-money-protection-rules';

const ctx = (perms: string[], tenantId = 'A'): MoneyProtectionContext => ({ tenantId, branchId: 'b1', userId: 'u1', role: 'OWNER', permissions: perms });
const ALL = ['ai_money_protection.view', 'ai_money_protection.view_alerts', 'ai_money_protection.manage_rules'];
const pay = (o: Partial<NormalizedPayment>): NormalizedPayment => ({ id: 'p', branchId: 'b1', ticketId: 't1', amountCents: 5000, method: 'card', status: 'approved', idempotencyKey: null, processorTxnId: null, createdByUserId: 'u1', createdAtMs: Date.parse('2026-07-07T10:00:00Z'), ...o });

describe('moneyProtectionFlags', () => {
  it('defaults: enabled + all detection layers ON, auto-prevention OFF', () => {
    const f = moneyProtectionFlags({} as any);
    expect(f.enabled).toBe(true);
    expect(f.deterministicRules && f.baselines && f.reconciliation && f.aiSummaries).toBe(true);
    expect(f.autoExactDuplicatePrevention).toBe(false); // money-mutating → off by default
  });
  it('master off disables all layers', () => {
    const f = moneyProtectionFlags({ AI_MONEY_PROTECTION_ENABLED: '0' } as any);
    expect(f.enabled).toBe(false);
    expect(f.deterministicRules || f.baselines || f.reconciliation).toBe(false);
  });
  it('auto-prevention can be explicitly enabled', () => {
    expect(moneyProtectionFlags({ AI_MONEY_PROTECTION_AUTO_DUP_PREVENTION_ENABLED: '1' } as any).autoExactDuplicatePrevention).toBe(true);
  });
});

describe('entitlement gate (Plans/Feature-Limits)', () => {
  it('blocks a non-entitled tenant with AI_MONEY_PROTECTION_DISABLED', async () => {
    const svc = new MoneyProtectionService(new InMemoryMoneyProtectionRepository(), new InMemoryEntitlement(() => false));
    await expect(svc.getState(ctx(ALL))).rejects.toBeInstanceOf(MoneyProtectionDisabledError);
    await expect(svc.listAlerts(ctx(ALL), {})).rejects.toBeInstanceOf(MoneyProtectionDisabledError);
    await expect(svc.evaluateDeterministic(ctx(ALL))).rejects.toBeInstanceOf(MoneyProtectionDisabledError);
  });
  it('allows an entitled tenant', async () => {
    const svc = new MoneyProtectionService(new InMemoryMoneyProtectionRepository(), new InMemoryEntitlement(() => true));
    await expect(svc.getState(ctx(ALL))).resolves.toBeTruthy();
  });
  it('master flag off disables even an entitled tenant', async () => {
    const svc = new MoneyProtectionService(new InMemoryMoneyProtectionRepository(), new InMemoryEntitlement(() => true), moneyProtectionFlags({ AI_MONEY_PROTECTION_ENABLED: '0' } as any));
    await expect(svc.getState(ctx(ALL))).rejects.toBeInstanceOf(MoneyProtectionDisabledError);
  });
});

describe('per-layer flags in evaluate', () => {
  it('baselines OFF → no reversal-rate outliers even with qualifying data', async () => {
    const repo = new InMemoryMoneyProtectionRepository();
    // seed a dup-charge (deterministic) so evaluate still creates something
    repo.seedActivity('A', [pay({ id: 'p1', processorTxnId: 'TX' }), pay({ id: 'p2', processorTxnId: 'TX' })], []);
    const svc = new MoneyProtectionService(repo, new InMemoryEntitlement(() => true), moneyProtectionFlags({ AI_MONEY_PROTECTION_BASELINES_ENABLED: '0' } as any));
    const r = await svc.evaluateDeterministic(ctx(ALL));
    expect(r.created).toBe(1); // the deterministic dup charge, no baseline alerts
  });
});

describe('super-admin platform aggregate (counts only)', () => {
  const candidate = (tenant: string, sev: AlertCandidate['severity']): AlertCandidate => ({
    ruleId: 'R', alertType: 'duplicate_charge_exact', severity: sev, confidence: 'high', riskScore: 90, amountCents: 5000,
    entityFingerprint: `fp:${tenant}:${sev}`, evaluationWindow: 'w', branchId: 'b1',
    evidence: { summary: 's', triggeredRules: ['R'], recommendedReview: [] }, related: {},
  });
  it('aggregates across tenants without exposing tenant identifiers, gated by super-admin perm', async () => {
    const repo = new InMemoryMoneyProtectionRepository();
    await repo.upsertAlert(ctx([], 'A'), candidate('A', 'CRITICAL'));
    await repo.upsertAlert(ctx([], 'B'), candidate('B', 'HIGH'));
    const svc = new MoneyProtectionService(repo, new InMemoryEntitlement(() => true));
    const overview = await svc.getPlatformOverview(ctx(['super_admin.tenants.view']));
    expect(overview.tenantsWithOpenAlerts).toBe(2);
    expect(overview.totalOpenAlerts).toBe(2);
    expect(JSON.stringify(overview)).not.toMatch(/"A"|"B"/); // no tenant ids leaked, counts only
  });
  it('requires super-admin permission', async () => {
    const svc = new MoneyProtectionService(new InMemoryMoneyProtectionRepository(), new InMemoryEntitlement(() => true));
    await expect(svc.getPlatformOverview(ctx(ALL))).rejects.toBeInstanceOf(MoneyProtectionForbiddenError);
  });
});
