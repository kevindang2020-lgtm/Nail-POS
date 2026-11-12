// ai-money-protection-settings.vitest.spec.ts
import { describe, it, expect } from 'vitest';
import { validateRuleSetting, applyRuleSettings, previewThresholdDiff, type RuleSettingsMap } from './ai-money-protection-settings';
import { runDeterministicRules, detectFailedPaymentRetryLoop, type NormalizedAttempt, type NormalizedPayment } from './ai-money-protection-rules';
import { MoneyProtectionService, MoneyProtectionForbiddenError, MoneyProtectionValidationError } from './ai-money-protection.service';
import { InMemoryMoneyProtectionRepository } from './ai-money-protection.repository';
import { InMemoryEntitlement } from './ai-money-protection-entitlement';
import type { MoneyProtectionContext, AlertCandidate } from './ai-money-protection.dto';

const KNOWN = new Set(['MP_DUP_CHARGE_EXACT', 'MP_FAILED_PAYMENT_RETRY_LOOP', 'MP_REVERSAL_RATE_OUTLIER']);
const ctx = (perms: string[], tenantId = 'A'): MoneyProtectionContext => ({ tenantId, branchId: 'b1', userId: 'u1', role: 'OWNER', permissions: perms });
const pay = (o: Partial<NormalizedPayment>): NormalizedPayment => ({ id: 'p', branchId: 'b1', ticketId: 't1', amountCents: 5000, method: 'card', status: 'approved', idempotencyKey: null, processorTxnId: null, createdByUserId: 'u1', createdAtMs: Date.parse('2026-07-07T10:00:00Z'), ...o });

describe('validateRuleSetting', () => {
  it('accepts a valid setting', () => {
    const r = validateRuleSetting('MP_FAILED_PAYMENT_RETRY_LOOP', { enabled: true, severityOverride: 'LOW', thresholds: { minDeclines: 6 } }, KNOWN);
    expect(r.ok).toBe(true);
    expect(r.value!.thresholds.minDeclines).toBe(6);
  });
  it('rejects unknown rule id, unknown threshold key, out-of-bounds value, and bad severity', () => {
    expect(validateRuleSetting('NOPE', {}, KNOWN).ok).toBe(false);
    expect(validateRuleSetting('MP_FAILED_PAYMENT_RETRY_LOOP', { thresholds: { bogus: 1 } }, KNOWN).ok).toBe(false);
    expect(validateRuleSetting('MP_FAILED_PAYMENT_RETRY_LOOP', { thresholds: { minDeclines: 0 } }, KNOWN).ok).toBe(false); // below bound (2)
    expect(validateRuleSetting('MP_FAILED_PAYMENT_RETRY_LOOP', { severityOverride: 'BOGUS' }, KNOWN).ok).toBe(false);
  });
});

describe('applyRuleSettings', () => {
  const c = (ruleId: string, severity: AlertCandidate['severity']): AlertCandidate => ({ ruleId, alertType: 'x', severity, confidence: 'high', riskScore: 50, amountCents: 0, entityFingerprint: 'f', evaluationWindow: '', branchId: null, evidence: { summary: 's', triggeredRules: [ruleId], recommendedReview: [] }, related: {} });
  it('drops disabled rules and overrides severity', () => {
    const map: RuleSettingsMap = {
      MP_DUP_CHARGE_EXACT: { ruleId: 'MP_DUP_CHARGE_EXACT', enabled: false, severityOverride: null, thresholds: {} },
      MP_FAILED_PAYMENT_RETRY_LOOP: { ruleId: 'MP_FAILED_PAYMENT_RETRY_LOOP', enabled: true, severityOverride: 'LOW', thresholds: {} },
    };
    const out = applyRuleSettings([c('MP_DUP_CHARGE_EXACT', 'CRITICAL'), c('MP_FAILED_PAYMENT_RETRY_LOOP', 'MEDIUM')], map);
    expect(out).toHaveLength(1);
    expect(out[0].ruleId).toBe('MP_FAILED_PAYMENT_RETRY_LOOP');
    expect(out[0].severity).toBe('LOW');
  });
});

describe('threshold override consumption', () => {
  it('retry loop uses an overridden minDeclines', () => {
    const att = (i: number): NormalizedAttempt => ({ id: 'a' + i, branchId: 'b1', ticketId: 't1', status: 'declined', method: 'card', createdAtMs: Date.parse('2026-07-07T10:00:00Z') + i * 1000 });
    const three = [att(0), att(1), att(2)];
    expect(detectFailedPaymentRetryLoop(three)).toHaveLength(0);                       // default min 4
    expect(detectFailedPaymentRetryLoop(three, { minDeclines: 3 })).toHaveLength(1);   // overridden to 3
    // via runDeterministicRules overrides map
    const viaRun = runDeterministicRules([], [], [], three, { MP_FAILED_PAYMENT_RETRY_LOOP: { minDeclines: 3 } });
    expect(viaRun.some((a) => a.alertType === 'failed_payment_retry_loop')).toBe(true);
  });
});

describe('MoneyProtectionService settings integration', () => {
  const perms = ['ai_money_protection.view', 'ai_money_protection.view_alerts', 'ai_money_protection.manage_rules', 'ai_money_protection.manage_settings'];
  async function seededSvc() {
    const repo = new InMemoryMoneyProtectionRepository();
    repo.seedActivity('A', [pay({ id: 'p1', processorTxnId: 'TX' }), pay({ id: 'p2', processorTxnId: 'TX' })], []);
    return { repo, svc: new MoneyProtectionService(repo, new InMemoryEntitlement(() => true)) };
  }

  it('updateSetting requires manage_settings and validates', async () => {
    const { svc } = await seededSvc();
    await expect(svc.updateSetting(ctx(['ai_money_protection.view']), 'MP_DUP_CHARGE_EXACT', { enabled: false })).rejects.toBeInstanceOf(MoneyProtectionForbiddenError);
    await expect(svc.updateSetting(ctx(perms), 'NOPE', {})).rejects.toBeInstanceOf(MoneyProtectionValidationError);
  });

  it('a disabled rule produces no alert of that type', async () => {
    const { svc } = await seededSvc();
    await svc.updateSetting(ctx(perms), 'MP_DUP_CHARGE_EXACT', { enabled: false });
    await svc.evaluateDeterministic(ctx(perms));
    const alerts = await svc.listAlerts(ctx(perms), {});
    expect(alerts.items.some((a) => a.alertType === 'duplicate_charge_exact')).toBe(false);
  });

  it('a severity override changes the stored alert severity', async () => {
    const { svc } = await seededSvc();
    await svc.updateSetting(ctx(perms), 'MP_DUP_CHARGE_EXACT', { severityOverride: 'LOW' });
    await svc.evaluateDeterministic(ctx(perms));
    const alerts = await svc.listAlerts(ctx(perms), {});
    const dup = alerts.items.find((a) => a.alertType === 'duplicate_charge_exact');
    expect(dup?.severity).toBe('LOW');
  });

  it('settings are tenant-scoped', async () => {
    const { svc } = await seededSvc();
    await svc.updateSetting(ctx(perms), 'MP_DUP_CHARGE_EXACT', { enabled: false });
    expect(await svc.getSettings(ctx(perms, 'B'))).toEqual({}); // tenant B unaffected
  });
});

describe('Threshold Change Preview (Money Protection Rules 09) — dry run only', () => {
  const perms = ['ai_money_protection.view', 'ai_money_protection.view_alerts', 'ai_money_protection.manage_settings'];
  const t0 = Date.now() - 2 * 86_400_000;
  const dec = (id: string, ticketId: string, min: number): NormalizedAttempt => ({ id, branchId: 'b1', ticketId, status: 'declined', method: 'card', createdAtMs: t0 + min * 60_000 });
  // t1: 5 declines in 10 min · t2: 3 declines · t3: 9 declines (HIGH at the default 8)
  const attempts = [...[0, 2, 4, 6, 8].map((m, i) => dec('a1' + i, 't1', m)), ...[0, 1, 2].map((m, i) => dec('a2' + i, 't2', m)), ...[0, 1, 2, 3, 4, 5, 6, 7, 8].map((m, i) => dec('a3' + i, 't3', m))];
  function svcWith() {
    const repo = new InMemoryMoneyProtectionRepository();
    repo.seedActivity('A', [], [], [], attempts);
    return { repo, svc: new MoneyProtectionService(repo, new InMemoryEntitlement(() => true)) };
  }
  it('pure diff: stops / starts / severity by fingerprint, for that rule only', () => {
    const c = (fp: string, severity: AlertCandidate['severity'], ruleId = 'R'): AlertCandidate => ({ ruleId, alertType: 'x', severity, confidence: 'high', riskScore: 1, amountCents: 0, entityFingerprint: fp, evaluationWindow: '', branchId: null, evidence: { summary: '', triggeredRules: [], recommendedReview: [], alternativeExplanations: [], dataFreshness: 'realtime' }, related: { ticketIds: [fp] } } as AlertCandidate);
    const d = previewThresholdDiff('R', [c('a', 'MEDIUM'), c('b', 'MEDIUM'), c('z', 'HIGH', 'OTHER')], [c('b', 'HIGH'), c('c', 'MEDIUM')]);
    expect(d).toMatchObject({ currentCount: 2, proposedCount: 2, stops: 1, starts: 1, severityChanges: 1, unchanged: 0 });
    expect(d.examples.map((x) => [x.fingerprint, x.change, x.fromSeverity, x.toSeverity])).toEqual([['a', 'stops', 'MEDIUM', null], ['c', 'starts', null, 'MEDIUM'], ['b', 'severity', 'MEDIUM', 'HIGH']]);
  });
  it('raising minDeclines 4 → 6 stops the 5-decline ticket; lowering to 3 starts the 3-decline ticket; highSeverityAt 10 lowers t3 — nothing saved, no alert', async () => {
    const { repo, svc } = svcWith();
    const up: any = await svc.previewThresholds(ctx(perms), 'MP_FAILED_PAYMENT_RETRY_LOOP', { minDeclines: 6 });
    expect(up).toMatchObject({ dryRun: true, supported: true, windowDays: 30, currentThresholds: { minDeclines: 4, windowMinutes: 15, highSeverityAt: 8 }, proposedThresholds: { minDeclines: 6 }, currentCount: 2, proposedCount: 1, stops: 1, starts: 0 });
    expect(up.examples[0]).toMatchObject({ change: 'stops', ticketIds: ['t1'] });
    const down: any = await svc.previewThresholds(ctx(perms), 'MP_FAILED_PAYMENT_RETRY_LOOP', { minDeclines: 3 });
    expect(down).toMatchObject({ currentCount: 2, proposedCount: 3, stops: 0, starts: 1 });
    expect(down.examples[0]).toMatchObject({ change: 'starts', ticketIds: ['t2'], toSeverity: 'MEDIUM' });
    const sev: any = await svc.previewThresholds(ctx(perms), 'MP_FAILED_PAYMENT_RETRY_LOOP', { highSeverityAt: 10 });
    expect(sev).toMatchObject({ severityChanges: 1, stops: 0, starts: 0 });
    expect(sev.examples[0]).toMatchObject({ ticketIds: ['t3'], fromSeverity: 'HIGH', toSeverity: 'MEDIUM' });
    expect(await svc.getSettings(ctx(perms))).toEqual({});                      // nothing saved
    expect((await repo.listAlerts(ctx(perms), { limit: 50 } as any)).items).toEqual([]);   // no alert raised
  });
  it('a saved threshold is the baseline; out-of-bounds is refused; a rule whose detector ignores thresholds says so', async () => {
    const { svc } = svcWith();
    await svc.updateSetting(ctx(perms), 'MP_FAILED_PAYMENT_RETRY_LOOP', { thresholds: { minDeclines: 6 } });
    expect(await svc.previewThresholds(ctx(perms), 'MP_FAILED_PAYMENT_RETRY_LOOP', { minDeclines: 4 })).toMatchObject({ currentThresholds: { minDeclines: 6 }, currentCount: 1, proposedCount: 2, starts: 1 });
    await expect(svc.previewThresholds(ctx(perms), 'MP_FAILED_PAYMENT_RETRY_LOOP', { minDeclines: 0 })).rejects.toBeInstanceOf(MoneyProtectionValidationError);
    expect(await svc.previewThresholds(ctx(perms), 'MP_CASH_DRAWER_VARIANCE', { toleranceCents: 500 })).toEqual({ ruleId: 'MP_CASH_DRAWER_VARIANCE', dryRun: true, supported: false, reason: 'threshold_not_read_by_detector', windowDays: 30 });
    await expect(svc.previewThresholds(ctx([]), 'MP_FAILED_PAYMENT_RETRY_LOOP', {})).rejects.toBeInstanceOf(MoneyProtectionForbiddenError);
  });
});
