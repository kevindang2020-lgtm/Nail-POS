// ai-money-protection-settings.vitest.spec.ts
import { describe, it, expect } from 'vitest';
import { validateRuleSetting, applyRuleSettings, thresholdOverrides, type RuleSettingsMap } from './ai-money-protection-settings';
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
    const r = await svc.evaluateDeterministic(ctx(perms));
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
