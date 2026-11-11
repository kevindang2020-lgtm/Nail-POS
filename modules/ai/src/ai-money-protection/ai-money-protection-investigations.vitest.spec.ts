// ai-money-protection-investigations.vitest.spec.ts — investigation workflow safety properties.
import { describe, it, expect } from 'vitest';
import { InvestigationService } from './ai-money-protection-investigations.service';
import { InMemoryInvestigationRepository } from './ai-money-protection-investigations.repository';
import { InMemoryMoneyProtectionRepository } from './ai-money-protection.repository';
import { MoneyProtectionForbiddenError, MoneyProtectionValidationError } from './ai-money-protection.service';
import type { MoneyProtectionContext, AlertCandidate } from './ai-money-protection.dto';

const PERMS = {
  investigate: ['ai_money_protection.view', 'ai_money_protection.investigate'],
  resolve: ['ai_money_protection.view', 'ai_money_protection.investigate', 'ai_money_protection.resolve'],
  elevated: ['ai_money_protection.view', 'ai_money_protection.investigate', 'ai_money_protection.resolve', 'ai_money_protection.escalate'],
};
const ctx = (perms: string[], userId = 'u1', tenantId = 'A'): MoneyProtectionContext => ({ tenantId, branchId: 'b1', userId, role: 'OWNER', permissions: perms });

const candidate = (over: Partial<AlertCandidate> = {}): AlertCandidate => ({
  ruleId: 'MP_DUP_CHARGE_EXACT', alertType: 'duplicate_charge_exact', severity: 'CRITICAL', confidence: 'high',
  riskScore: 95, amountCents: 5000, entityFingerprint: 'dup:exact:ptx:TX9', evaluationWindow: '2026-07-07',
  branchId: 'b1', evidence: { summary: 'x', triggeredRules: ['MP_DUP_CHARGE_EXACT'], recommendedReview: [] },
  related: { userIds: ['emp7'], ticketIds: ['t1'], transactionIds: ['p1', 'p2'] }, ...over,
});

async function setup() {
  const alertRepo = new InMemoryMoneyProtectionRepository();
  const invRepo = new InMemoryInvestigationRepository();
  const svc = new InvestigationService(invRepo, alertRepo);
  const { alert } = await alertRepo.upsertAlert(ctx(PERMS.investigate), candidate());
  return { alertRepo, svc, alertId: alert.id };
}

describe('InvestigationService — create + link', () => {
  it('opens an investigation from alerts, snapshots value, links the alerts', async () => {
    const { svc, alertRepo, alertId } = await setup();
    const inv = await svc.create(ctx(PERMS.investigate), { title: 'Dup charge on ticket t1', alertIds: [alertId] });
    expect(inv.valueUnderReviewCents).toBe(5000);
    expect(inv.severity).toBe('CRITICAL');
    expect(inv.related.alertIds).toEqual([alertId]);
    expect(inv.related.userIds).toEqual(['emp7']);
    const linked = await alertRepo.getAlertsByIds(ctx(PERMS.investigate), [alertId]);
    expect(linked[0].investigationId).toBe(inv.id);
    expect(linked[0].status).toBe('INVESTIGATING');
  });
});

describe('InvestigationService — one case per incident', () => {
  it('a repeated open for alerts already in a case returns that case (no duplicate)', async () => {
    const { svc, alertId } = await setup();
    const first = await svc.create(ctx(PERMS.investigate), { title: 'Dup charge', alertIds: [alertId] });
    const again = await svc.create(ctx(PERMS.investigate), { title: 'Dup charge', alertIds: [alertId] });
    expect(again.id).toBe(first.id);
  });
  it('a case without alerts is always new', async () => {
    const { svc } = await setup();
    const a = await svc.create(ctx(PERMS.investigate), { title: 'manual' });
    const b = await svc.create(ctx(PERMS.investigate), { title: 'manual' });
    expect(a.id).not.toBe(b.id);
  });
});

describe('InvestigationService — append-only notes', () => {
  it('accumulates notes in order and never rewrites them', async () => {
    const { svc, alertId } = await setup();
    const inv = await svc.create(ctx(PERMS.investigate), { title: 't', alertIds: [alertId] });
    await svc.addNote(ctx(PERMS.investigate), inv.id, 'first note');
    await svc.addNote(ctx(PERMS.investigate, 'u2'), inv.id, 'second note by another user');
    const { notes } = await svc.get(ctx(PERMS.investigate), inv.id);
    expect(notes.map((n) => n.body)).toEqual(['first note', 'second note by another user']);
    expect(notes.map((n) => n.authorUserId)).toEqual(['u1', 'u2']);
  });
});

describe('InvestigationService — permission + human-only gates', () => {
  it('create requires investigate permission', async () => {
    const { svc } = await setup();
    await expect(svc.create(ctx(['ai_money_protection.view']), { title: 't' })).rejects.toBeInstanceOf(MoneyProtectionForbiddenError);
  });
  it('resolve requires resolve permission', async () => {
    const { svc, alertId } = await setup();
    const inv = await svc.create(ctx(PERMS.investigate), { title: 't', alertIds: [alertId] });
    await expect(svc.recordResolution(ctx(PERMS.investigate), inv.id, 'FALSE_POSITIVE')).rejects.toBeInstanceOf(MoneyProtectionForbiddenError);
  });
  it('EMPLOYEE_MISUSE_CONFIRMED requires ELEVATED permission (never auto-set)', async () => {
    // resolver must not be part of the investigated activity → use a different userId
    const { svc, alertId } = await setup();
    const inv = await svc.create(ctx(PERMS.investigate), { title: 't', alertIds: [alertId] });
    const resolver = ctx(PERMS.resolve, 'manager1'); // has resolve but NOT escalate
    await expect(svc.recordResolution(resolver, inv.id, 'EMPLOYEE_MISUSE_CONFIRMED')).rejects.toBeInstanceOf(MoneyProtectionForbiddenError);
    const elevated = ctx(PERMS.elevated, 'manager1');
    const done = await svc.recordResolution(elevated, inv.id, 'EMPLOYEE_MISUSE_CONFIRMED', 5000);
    expect(done.status).toBe('RESOLVED');
    expect(done.resolution).toBe('EMPLOYEE_MISUSE_CONFIRMED');
    expect(done.recoveryAmountCents).toBe(5000);
  });
});

describe('InvestigationService — segregation of duties', () => {
  it('a user cannot resolve an investigation involving their OWN activity', async () => {
    const { svc, alertId } = await setup();
    const inv = await svc.create(ctx(PERMS.investigate), { title: 't', alertIds: [alertId] }); // related.userIds = ['emp7']
    // emp7 tries to resolve their own case
    await expect(svc.recordResolution(ctx(PERMS.resolve, 'emp7'), inv.id, 'FALSE_POSITIVE'))
      .rejects.toBeInstanceOf(MoneyProtectionValidationError);
  });
});

describe('InvestigationService — transitions + isolation', () => {
  it('rejects an invalid status transition', async () => {
    const { svc, alertId } = await setup();
    const inv = await svc.create(ctx(PERMS.investigate), { title: 't', alertIds: [alertId] }); // OPEN
    await expect(svc.updateStatus(ctx(PERMS.investigate), inv.id, 'RESOLVED')).rejects.toBeInstanceOf(MoneyProtectionValidationError); // OPEN→RESOLVED not allowed
  });
  it('escalation requires escalate permission', async () => {
    const { svc, alertId } = await setup();
    const inv = await svc.create(ctx(PERMS.investigate), { title: 't', alertIds: [alertId] });
    await expect(svc.updateStatus(ctx(PERMS.investigate), inv.id, 'ESCALATED')).rejects.toBeInstanceOf(MoneyProtectionForbiddenError);
  });
  it('tenant B cannot see tenant A investigations', async () => {
    const { svc, alertId } = await setup();
    await svc.create(ctx(PERMS.investigate), { title: 't', alertIds: [alertId] });
    expect(await svc.list(ctx(PERMS.investigate, 'u1', 'B'), {})).toHaveLength(0);
  });
});
